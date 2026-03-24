"""
Security Agent — OWASP Top 10, secrets detection, injection vulnerabilities.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from base_agent import BaseAgent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are an expert security code reviewer specializing in OWASP Top 10, secrets \
detection, injection vulnerabilities, and unsafe dependencies.

You look for:
- Hardcoded secrets, API keys, passwords, tokens, and private keys
- SQL injection, NoSQL injection, LDAP injection, OS command injection
- Cross-site scripting (XSS) — reflected, stored, and DOM-based
- Insecure deserialization of untrusted data
- Use of eval() / exec() / Function() with untrusted input
- Sensitive data (PII, credentials) written to logs
- Insecure direct object references (IDOR)
- Security misconfiguration (debug flags, CORS wildcards, weak TLS)
- Path traversal and directory traversal vulnerabilities
- Cryptographic weaknesses (MD5, SHA1, hardcoded IVs, weak RNG)
- Prototype pollution (JavaScript / TypeScript)
- Dependencies with known CVEs"""


class SecurityAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("security_agent")

    def run(
        self,
        pr_number: int,
        diff: str,
        files: list[dict[str, Any]],
    ) -> dict[str, Any]:
        file_block = _format_files(files)

        user_content = f"""\
Analyze the following pull request diff and changed file contents for security vulnerabilities.

## PR DIFF
```
{diff[:10_000]}
```

## CHANGED FILES
{file_block}

Return a JSON object with **exactly** this structure (no extra keys):
{{
  "issues": [
    {{
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "location": "<filename>:<line_or_function>",
      "description": "<concise description of the vulnerability>",
      "recommendation": "<actionable fix>"
    }}
  ],
  "overallRisk": "CRITICAL|HIGH|MEDIUM|LOW|NONE"
}}

If no issues are found, return {{"issues": [], "overallRisk": "NONE"}}."""

        return self._call_llm(SYSTEM_PROMPT, user_content, pr_number)


# ------------------------------------------------------------------
# Async entry point used by orchestrator
# ------------------------------------------------------------------

async def run_async(
    pr_number: int,
    diff: str,
    files: list[dict[str, Any]],
) -> dict[str, Any]:
    loop = asyncio.get_event_loop()
    agent = SecurityAgent()
    return await loop.run_in_executor(None, agent.run, pr_number, diff, files)


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _format_files(files: list[dict[str, Any]], max_chars: int = 8_000) -> str:
    parts: list[str] = []
    total = 0
    for f in files:
        content = f.get("content") or ""
        if not content or f.get("status") == "removed":
            continue
        snippet = content[:2_000]
        block = f"### {f['filename']}\n```\n{snippet}\n```"
        if total + len(block) > max_chars:
            break
        parts.append(block)
        total += len(block)
    return "\n\n".join(parts) if parts else "_No file content available._"
