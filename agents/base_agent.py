"""
Shared base class for all review agents.

Every agent:
  - Uses gemini-2.0-flash via Google Generative AI
  - Forces JSON-only output via response_mime_type
  - Retries up to MAX_RETRIES times on JSON parse failure
  - Logs timestamp, agent name, PR number, tokens used, and latency
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

import google.generativeai as genai
from google.generativeai import GenerativeModel
from google.generativeai.types import GenerationConfig

logger = logging.getLogger(__name__)

MODEL = "gemini-2.0-flash"
TEMPERATURE = 0.1
MAX_RETRIES = 2
JSON_ONLY_SUFFIX = (
    "\n\nYou must respond with valid JSON only. "
    "No markdown, no explanation, no code fences. Raw JSON only."
)


class BaseAgent:
    """Abstract base for all specialist agents."""

    def __init__(self, agent_name: str) -> None:
        self.agent_name = agent_name
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise EnvironmentError("GEMINI_API_KEY env var is required")
        genai.configure(api_key=api_key)

    # ------------------------------------------------------------------
    # Core LLM call with JSON-parse retry loop
    # ------------------------------------------------------------------

    def _call_llm(
        self,
        system_prompt: str,
        user_content: str,
        pr_number: int,
    ) -> dict[str, Any]:
        """
        Call the Gemini API and return a parsed JSON dict.
        Retries up to MAX_RETRIES times if the response is not valid JSON.
        """
        full_system = system_prompt + JSON_ONLY_SUFFIX
        current_user = user_content
        last_exc: Exception | None = None

        for attempt in range(MAX_RETRIES + 1):
            # Re-instantiate the model per attempt so the system prompt
            # can be updated if needed (rare, but keeps things consistent).
            model = GenerativeModel(
                model_name=MODEL,
                system_instruction=full_system,
                generation_config=GenerationConfig(
                    temperature=TEMPERATURE,
                    response_mime_type="application/json",
                ),
            )

            t0 = time.monotonic()
            try:
                response = model.generate_content(current_user)
            except Exception as exc:
                raise RuntimeError(
                    f"[{self.agent_name}] Gemini API error on attempt {attempt + 1}: {exc}"
                ) from exc

            latency = time.monotonic() - t0

            # response.text raises ValueError when the response is blocked by
            # safety filters or has no parts — extract text defensively.
            try:
                content = (response.text or "").strip()
            except ValueError:
                finish = (
                    response.candidates[0].finish_reason.name
                    if response.candidates
                    else "UNKNOWN"
                )
                raise RuntimeError(
                    f"[{self.agent_name}] Gemini returned no text content "
                    f"(finish_reason={finish}). Response may have been blocked."
                )

            tokens = (
                response.usage_metadata.total_token_count
                if response.usage_metadata
                else 0
            )

            logger.info(
                "[%s] PR #%d | attempt=%d | tokens=%d | latency=%.2fs",
                self.agent_name,
                pr_number,
                attempt + 1,
                tokens,
                latency,
            )

            # Strip accidental markdown code fences if the model slips up
            # (response_mime_type should prevent this, but be defensive).
            if content.startswith("```"):
                lines = content.split("\n")
                content = "\n".join(
                    line for line in lines[1:]
                    if not line.strip().startswith("```")
                ).strip()

            try:
                return json.loads(content)
            except json.JSONDecodeError as exc:
                last_exc = exc
                logger.warning(
                    "[%s] PR #%d | JSON parse failed on attempt %d: %s",
                    self.agent_name,
                    pr_number,
                    attempt + 1,
                    exc,
                )
                if attempt < MAX_RETRIES:
                    current_user = (
                        current_user
                        + f"\n\nYour previous response was not valid JSON. "
                        f"Parse error: {exc}. Respond with valid JSON only."
                    )

        raise ValueError(
            f"[{self.agent_name}] Failed to obtain valid JSON after "
            f"{MAX_RETRIES + 1} attempts. Last error: {last_exc}"
        )
