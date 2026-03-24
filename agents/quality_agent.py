"""
Quality Agent — code quality, maintainability, and style.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from base_agent import BaseAgent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are a senior software engineer performing a code quality and maintainability review.

You look for:
- Excessive cognitive complexity and deeply nested conditional logic
- Missing or inadequate error handling and unhandled promise rejections
- Code duplication violating the DRY principle
- Unclear or misleading naming (variables, functions, classes, modules)
- Missing type hints / type annotations in Python or TypeScript
- Dead code, unused variables, and unnecessary imports
- Functions or methods that are too long (> 50 lines is a smell)
- Violation of single responsibility principle
- Missing documentation comments on complex or non-obvious logic
- Inconsistent coding style within the same file
- Magic numbers and unexplained constants"""


class QualityAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("quality_agent")

    def run(
        self,
        pr_number: int,
        diff: str,
        files: list[dict[str, Any]],
    ) -> dict[str, Any]:
        file_block = _format_files(files)

        user_content = f"""\
Analyze the following pull request diff and changed file contents for code quality issues.

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
      "description": "<concise description of the quality issue>",
      "suggestion": "<actionable improvement>"
    }}
  ],
  "qualityScore": <integer 1–10, where 10 is perfect>
}}

If no issues are found, return {{"issues": [], "qualityScore": 10}}."""

        return self._call_llm(SYSTEM_PROMPT, user_content, pr_number)


async def run_async(
    pr_number: int,
    diff: str,
    files: list[dict[str, Any]],
) -> dict[str, Any]:
    loop = asyncio.get_event_loop()
    agent = QualityAgent()
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
