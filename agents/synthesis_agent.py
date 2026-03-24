"""
Synthesis Agent — deduplicates findings, prioritises by severity, decides verdict.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from base_agent import BaseAgent

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are a lead code-review engineer. You receive structured findings from four specialist \
agents (security, quality, logic, test-generation) and must:

1. Deduplicate issues that refer to the same root cause.
2. Prioritize remaining issues: CRITICAL > HIGH > MEDIUM > LOW.
3. Decide the overall review verdict:
   - "pass"         — no CRITICAL or HIGH issues; only MEDIUM/LOW or none.
   - "comment-only" — MEDIUM/HIGH issues that require human judgment or refactoring.
   - "fix"          — CRITICAL or HIGH severity issues that are mechanical and safe to \
auto-fix (e.g., hardcoded secrets, missing null checks, obvious logic bugs). \
NEVER choose "fix" for architectural issues, performance refactors, or anything \
requiring domain knowledge.
4. Identify which specific issues are auto-fixable (fixableIssues list).
5. Write a concise human-readable review comment (Markdown) summarising the findings."""


class SynthesisAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__("synthesis_agent")

    def run(
        self,
        pr_number: int,
        security: dict[str, Any],
        quality: dict[str, Any],
        logic: dict[str, Any],
        test_gen: dict[str, Any],
    ) -> dict[str, Any]:
        findings_json = json.dumps(
            {
                "security": security,
                "quality": quality,
                "logic": logic,
                "testGen": test_gen,
            },
            indent=2,
        )

        user_content = f"""\
Here are the findings from the four specialist agents for PR #{pr_number}.

```json
{findings_json[:12_000]}
```

Return a JSON object with **exactly** this structure (no extra keys):
{{
  "verdict": "pass|comment-only|fix",
  "prioritizedIssues": [
    {{
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "source": "security|quality|logic",
      "location": "<filename>:<line_or_function>",
      "description": "<deduplicated issue description>",
      "recommendation": "<how to fix it>"
    }}
  ],
  "fixableIssues": [
    {{
      "severity": "CRITICAL|HIGH",
      "source": "security|quality|logic",
      "location": "<filename>:<line_or_function>",
      "description": "<issue>",
      "recommendation": "<precise fix instruction for the autofix agent>"
    }}
  ],
  "summary": "<2–3 sentence plain-English summary of the overall review>",
  "reviewComment": "<full Markdown review comment suitable for posting on GitHub>"
}}

fixableIssues must be a subset of prioritizedIssues and must only contain issues \
that are purely mechanical (safe to auto-apply without human judgment)."""

        return self._call_llm(SYSTEM_PROMPT, user_content, pr_number)


async def run_async(
    pr_number: int,
    security: dict[str, Any],
    quality: dict[str, Any],
    logic: dict[str, Any],
    test_gen: dict[str, Any],
) -> dict[str, Any]:
    loop = asyncio.get_event_loop()
    agent = SynthesisAgent()
    return await loop.run_in_executor(
        None, agent.run, pr_number, security, quality, logic, test_gen
    )
