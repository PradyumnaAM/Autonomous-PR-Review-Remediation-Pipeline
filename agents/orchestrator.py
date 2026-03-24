"""
Orchestrator — entry point for the Python agent pipeline.

Reads PR data JSON from stdin, runs four specialist agents in parallel,
synthesizes the findings, optionally runs autofix, and writes the final
JSON result to stdout.

All diagnostic logs are written to stderr so stdout stays clean for the
Node.js parent process to parse.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import sys
import time

# Ensure all sibling modules in this directory are importable.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import httpx

import autofix_agent
import logic_agent
import quality_agent
import security_agent
import synthesis_agent
import test_gen_agent

# ─── Logging ─────────────────────────────────────────────────────────────────
# Write to stderr so Node can capture stdout cleanly.

logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("orchestrator")

# ─── GitHub file fetching ─────────────────────────────────────────────────────

GITHUB_API = "https://api.github.com"


async def fetch_pr_files(
    owner: str,
    repo: str,
    pr_number: int,
    head_sha: str,
    token: str,
) -> list[dict]:
    """Fetch changed files + their full content at head_sha from the GitHub API."""
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Get the list of changed files (paginated, max 300 files).
        files_url = f"{GITHUB_API}/repos/{owner}/{repo}/pulls/{pr_number}/files"
        all_files: list[dict] = []
        page = 1
        while True:
            resp = await client.get(files_url, headers=headers, params={"per_page": 100, "page": page})
            resp.raise_for_status()
            batch = resp.json()
            if not batch:
                break
            all_files.extend(batch)
            if len(batch) < 100:
                break
            page += 1

        logger.info("PR #%d — %d changed files", pr_number, len(all_files))

        # Fetch full content for each non-removed file concurrently.
        async def fetch_content(file_info: dict) -> dict:
            filename = file_info["filename"]
            status = file_info["status"]

            if status == "removed":
                return {
                    "filename": filename,
                    "content": "",
                    "patch": file_info.get("patch", ""),
                    "status": status,
                }

            content_url = (
                f"{GITHUB_API}/repos/{owner}/{repo}/contents/{filename}"
            )
            try:
                content_resp = await client.get(
                    content_url,
                    headers=headers,
                    params={"ref": head_sha},
                )
                content_resp.raise_for_status()
                data = content_resp.json()
                if data.get("encoding") == "base64":
                    raw = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
                else:
                    raw = data.get("content", "")
            except Exception as exc:  # noqa: BLE001
                logger.warning("Could not fetch content for %s: %s", filename, exc)
                raw = ""

            return {
                "filename": filename,
                "content": raw,
                "patch": file_info.get("patch", ""),
                "status": status,
            }

        results = await asyncio.gather(*[fetch_content(f) for f in all_files])
        return list(results)


# ─── Main pipeline ────────────────────────────────────────────────────────────

async def run_pipeline(pr_data: dict) -> dict:
    t_start = time.monotonic()

    owner = pr_data["owner"]
    repo = pr_data["repo"]
    pr_number = pr_data["prNumber"]
    head_sha = pr_data["headSHA"]
    diff = pr_data.get("diff", "")

    github_token = os.environ.get("GITHUB_TOKEN", "")
    if not github_token:
        raise EnvironmentError("GITHUB_TOKEN env var is required")

    logger.info("Pipeline started — PR #%d (%s/%s)", pr_number, owner, repo)

    # 1. Fetch file contents.
    logger.info("Fetching PR files…")
    files = await fetch_pr_files(owner, repo, pr_number, head_sha, github_token)
    logger.info("Fetched %d files", len(files))

    # 2. Run all four specialist agents in parallel.
    logger.info("Running specialist agents in parallel…")
    (
        security_result,
        quality_result,
        logic_result,
        test_gen_result,
    ) = await asyncio.gather(
        security_agent.run_async(pr_number, diff, files),
        quality_agent.run_async(pr_number, diff, files),
        logic_agent.run_async(pr_number, diff, files),
        test_gen_agent.run_async(pr_number, diff, files),
    )
    logger.info("All specialist agents completed")

    # 3. Synthesis.
    logger.info("Running synthesis agent…")
    synthesis_result = await synthesis_agent.run_async(
        pr_number,
        security_result,
        quality_result,
        logic_result,
        test_gen_result,
    )
    verdict: str = synthesis_result.get("verdict", "comment-only")
    logger.info("Synthesis verdict: %s", verdict)

    # 4. Autofix (only if synthesis says "fix" and there are fixable issues).
    fixed_files: list[dict] = []
    fixable_issues: list[dict] = synthesis_result.get("fixableIssues", [])

    if verdict == "fix" and fixable_issues:
        logger.info("Running autofix agent on %d issue(s)…", len(fixable_issues))
        autofix_result = await autofix_agent.run_async(pr_number, fixable_issues, files)
        fixed_files = autofix_result.get("fixedFiles", [])
        logger.info("Autofix produced %d modified file(s)", len(fixed_files))
    else:
        logger.info("Skipping autofix (verdict=%s, fixable=%d)", verdict, len(fixable_issues))

    # 5. Assemble output.
    elapsed = time.monotonic() - t_start
    logger.info("Pipeline complete in %.1fs", elapsed)

    return {
        "verdict": verdict,
        "summary": synthesis_result.get("summary", ""),
        "reviewComment": synthesis_result.get("reviewComment", ""),
        "agentFindings": {
            "security": security_result,
            "quality": quality_result,
            "logic": logic_result,
            "testGen": test_gen_result,
        },
        "fixedFiles": fixed_files,
    }


# ─── Entry point ─────────────────────────────────────────────────────────────

def main() -> None:
    # Read PR data JSON from stdin.
    raw_input = sys.stdin.read()
    try:
        pr_data = json.loads(raw_input)
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse input JSON: %s", exc)
        sys.exit(1)

    try:
        result = asyncio.run(run_pipeline(pr_data))
    except Exception as exc:  # noqa: BLE001
        logger.exception("Pipeline failed: %s", exc)
        sys.exit(1)

    # Write the final result to stdout as a single JSON line.
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
