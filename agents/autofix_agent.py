"""
Autofix Agent — rewrites file sections to address CRITICAL/HIGH mechanical issues.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from base_agent import BaseAgent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are an expert software engineer performing automated code remediation. \
You receive a list of specific, mechanical issues and the full content of the \
affected files, and you rewrite the files to fix exactly those issues.

Rules you MUST follow:
1. Fix only the listed issues. Do not refactor, rename, or improve anything else.
2. Preserve all existing functionality, comments, and formatting style.
3. Add a short inline comment directly above each changed line in the format:
   # AUTO-FIX: <one-line explanation>   (Python)
   // AUTO-FIX: <one-line explanation>  (TypeScript/JavaScript)
4. If a fix requires adding an import, add it at the top of the file with an AUTO-FIX comment.
5. Never introduce new bugs while fixing existing ones.
6. If you cannot safely fix an issue without risking breakage, skip it and omit that file."""


class AutofixAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("autofix_agent")

    def run(
        self,
        pr_number: int,
        fixable_issues: list[dict[str, Any]],
        files: list[dict[str, Any]],
    ) -> dict[str, Any]:
        issues_json = json.dumps(fixable_issues, indent=2)
        file_block = _format_files_full(files)

        user_content = f"""\
Fix the following issues in the provided files.

## ISSUES TO FIX
```json
{issues_json[:4_000]}
```

## CURRENT FILE CONTENTS
{file_block}

Return a JSON object with **exactly** this structure (no extra keys):
{{
  "fixedFiles": [
    {{
      "filename": "<path/to/file.ext>",
      "newContent": "<complete new file content as a single string>",
      "changesSummary": "<one-line summary of what was changed>"
    }}
  ]
}}

Only include files that were actually changed. \
If no issues could be safely fixed, return {{"fixedFiles": []}}."""

        return self._call_llm(SYSTEM_PROMPT, user_content, pr_number)


async def run_async(
    pr_number: int,
    fixable_issues: list[dict[str, Any]],
    files: list[dict[str, Any]],
) -> dict[str, Any]:
    loop = asyncio.get_event_loop()
    agent = AutofixAgent()
    return await loop.run_in_executor(
        None, agent.run, pr_number, fixable_issues, files
    )


def _format_files_full(files: list[dict[str, Any]], max_chars: int = 12_000) -> str:
    parts: list[str] = []
    total = 0
    for f in files:
        content = f.get("content") or ""
        if not content or f.get("status") == "removed":
            continue
        block = f"### {f['filename']}\n```\n{content}\n```"
        if total + len(block) > max_chars:
            # Truncate this file rather than skipping it entirely.
            remaining = max_chars - total
            truncated = content[: remaining - 200]
            block = f"### {f['filename']}\n```\n{truncated}\n... [truncated]\n```"
            parts.append(block)
            break
        parts.append(block)
        total += len(block)
    return "\n\n".join(parts) if parts else "_No file content available._"
