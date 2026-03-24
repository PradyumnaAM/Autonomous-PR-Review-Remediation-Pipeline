"""
Test Generation Agent — identifies untested paths and generates concrete test code.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from base_agent import BaseAgent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are an expert test engineer. Your job is to identify code paths that are not covered \
by tests in the changed code and write concrete, runnable test cases for the most critical \
missing scenarios.

Guidelines:
- Use pytest for Python code and Jest for TypeScript/JavaScript code.
- Each test must be self-contained and compilable as-is (use mocks/stubs where necessary).
- Prioritize: error paths, boundary conditions, security-critical flows, async edge cases.
- Do NOT generate trivial "happy path" tests that are already obvious.
- Test function names must be descriptive (test_<what>_when_<condition>_then_<outcome>).
- Include necessary imports at the top of each test snippet."""


class TestGenAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("test_gen_agent")

    def run(
        self,
        pr_number: int,
        diff: str,
        files: list[dict[str, Any]],
    ) -> dict[str, Any]:
        file_block = _format_files(files)

        user_content = f"""\
Analyze the following pull request and identify the most critical missing test cases.

## PR DIFF
```
{diff[:8_000]}
```

## CHANGED FILES
{file_block}

Return a JSON object with **exactly** this structure (no extra keys):
{{
  "missingTests": [
    {{
      "description": "<what scenario this test covers>",
      "testCode": "<complete, runnable test function including imports>",
      "filename": "<suggested filename, e.g. test_auth.py or auth.test.ts>"
    }}
  ]
}}

Return at most 5 of the most impactful missing tests.
If the diff contains no testable logic, return {{"missingTests": []}}."""

        return self._call_llm(SYSTEM_PROMPT, user_content, pr_number)


async def run_async(
    pr_number: int,
    diff: str,
    files: list[dict[str, Any]],
) -> dict[str, Any]:
    loop = asyncio.get_event_loop()
    agent = TestGenAgent()
    return await loop.run_in_executor(None, agent.run, pr_number, diff, files)


def _format_files(files: list[dict[str, Any]], max_chars: int = 6_000) -> str:
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
