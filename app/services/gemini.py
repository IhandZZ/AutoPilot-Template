# app/services/gemini.py
"""
Thin wrapper around the Gemini REST API (no SDK dependency needed — just
httpx, already in requirements.txt). Used for AI Policies (natural language),
AI Insights (optional narrative polish), and the AI Manager chat. Never used
for Auto agent orchestration — that stays exclusively on auto.supervity.ai
per hackathon rules.
"""

import logging
import os

import httpx

log = logging.getLogger(__name__)

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"


class GeminiNotConfigured(Exception):
    pass


class GeminiRateLimited(Exception):
    """Raised on 429 / RESOURCE_EXHAUSTED — quota or prepay credits exhausted.

    Kept distinct from a generic RuntimeError so callers (the /ai/chat
    endpoint) can show a clean, demo-safe message instead of dumping raw
    Gemini error JSON in front of a judge.
    """
    pass


def generate(system_instruction: str, history: list[dict], message: str, timeout: float = 30.0) -> str:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise GeminiNotConfigured("GEMINI_API_KEY is not set")

    contents = []
    for turn in history:
        role = "model" if turn.get("role") == "assistant" else "user"
        contents.append({"role": role, "parts": [{"text": turn.get("content", "")}]})
    contents.append({"role": "user", "parts": [{"text": message}]})

    payload = {
        "system_instruction": {"parts": [{"text": system_instruction}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.4, "maxOutputTokens": 1024},
    }

    with httpx.Client(timeout=timeout) as client:
        resp = client.post(GEMINI_URL, params={"key": api_key}, json=payload)
        if resp.status_code == 429:
            log.warning("Gemini quota/credits exhausted: %s", resp.text)
            raise GeminiRateLimited(resp.text[:500])
        if resp.status_code >= 400:
            log.error("Gemini API error %s: %s", resp.status_code, resp.text)
            raise RuntimeError(f"Gemini {resp.status_code}: {resp.text[:500]}")
        data = resp.json()

    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        log.error("Unexpected Gemini response shape: %s", data)
        raise RuntimeError("Gemini returned an unexpected response shape")
