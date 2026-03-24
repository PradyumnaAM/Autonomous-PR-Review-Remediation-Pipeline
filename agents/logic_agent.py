"""
Logic Agent — correctness, edge cases, and potential runtime bugs.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from base_agent import BaseAgent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are an expert software engineer specializing in program correctness and edge-case analysis.

You look for:
- Off-by-one errors in loops, slices, and index calculations
- Null / None / undefined dereference without prior guard
- Race conditions and unsafe shared state in concurrent code
- Incorrect error propagation (swallowed exceptions, wrong error type)
- Missing input validation at function boundaries
- Integer overflow or underflow in arithmetic
- Incorrect operator precedence or short-circuit evaluation assumptions
- Infinite loops or recursion without proper base cases
- Incorrect use of async/await (missing await, unnecessary await)
- Mutable default arguments in Python
- Mutation of function arguments the caller does not expect"""


class LogicAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("logic_agent")

    def run(
        self,
        pr_number: int,
        diff: str,
        files: list[dict[str, Any]],
    ) -> dict[str, Any]:
        file_block = _format_files(files)

        user_content = f"""\
Analyze the following pull request diff and changed file contents for logic errors and edge-case bugs.

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
      "description": "<concise description of the logic error>",
      "fix": "<concrete fix or safe alternative>"
    }}
  ],
  "confidence": <float 0.0–1.0 representing your confidence in the analysis>
}}

If no issues are found, return {{"issues": [], "confidence": 0.95}}."""

        return self._call_llm(SYSTEM_PROMPT, user_content, pr_number)


async def run_async(
    pr_number: int,
    diff: str,
    files: list[dict[str, Any]],
) -> dict[str, Any]:
    loop = asyncio.get_event_loop()
    agent = LogicAgent()
    return await loop.run_in_executor(None, agent.run, pr_number, diff, files)


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
