# app/routers/ai_chat.py
"""
AI Manager chat — POST /api/ai/chat. Matches the contract already built
into frontend/src/components/ai/AIManager.tsx: {message, history, context}
-> {response, tool_calls?}. Grounds Gemini's answers in a live snapshot of
Workbench/Policy data pulled from Supabase so it isn't just guessing.
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.supabase_db import get_supabase_db
from ..models.supabase_models import ExceptionConfig, PolicyEvaluation, WorkbenchItem
from ..schemas.ai_chat import ChatRequest, ChatResponse
from ..services.gemini import GeminiNotConfigured, GeminiRateLimited, generate

log = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["AI Manager"])

SYSTEM_PROMPT_TEMPLATE = """You are the AI Manager for the Procurement Exception Command Center — an AI Employee that monitors supplier disruption notices, evaluates policies, and routes exceptions to a human Workbench when it can't safely decide on its own.

You are speaking with the operator running this Command Center. Be concise and concrete, and ground your answers in the live snapshot below rather than guessing. Orchestration (the Intake/Impact/Recovery/Execute agents) runs on the Supervity Auto platform, not here — you are the assistant layered on top of the Command Center UI. If asked to create or edit a policy, explain that policies are stored in the exception_config table (visible on the AI Policies page) and ask for the key/value/description, but don't claim to have made the change yourself unless a tool result confirms it.

Live snapshot:
{snapshot}

The operator is currently viewing: {page}
"""


def _snapshot(db: Session) -> str:
    pending = db.query(func.count(WorkbenchItem.id)).filter(WorkbenchItem.status == "pending").scalar() or 0
    resolved = db.query(func.count(WorkbenchItem.id)).filter(WorkbenchItem.status == "resolved").scalar() or 0
    policies = db.query(func.count(ExceptionConfig.key)).scalar() or 0
    evaluations = db.query(func.count(PolicyEvaluation.id)).scalar() or 0
    return (
        f"- Workbench: {pending} pending exception(s), {resolved} resolved\n"
        f"- Active policies (exception_config rules): {policies}\n"
        f"- Policy evaluations logged so far: {evaluations}"
    )


@router.post("/chat", response_model=ChatResponse)
def chat(payload: ChatRequest, db: Session = Depends(get_supabase_db)):
    page = payload.context.page if payload.context else None
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(snapshot=_snapshot(db), page=page or "unknown")
    history = [{"role": m.role, "content": m.content} for m in payload.history]

    try:
        text = generate(system_prompt, history, payload.message)
    except GeminiNotConfigured:
        return ChatResponse(
            response=(
                "I don't have a Gemini API key configured yet, so I can't generate a real reply. "
                "Add GEMINI_API_KEY to .env and restart the backend to enable me."
            )
        )
    except GeminiRateLimited:
        # Gemini's free-tier quota / prepay credits are exhausted. Rather than
        # surface raw error JSON in the chat UI, fall back to the same live
        # snapshot the system prompt would have grounded a real answer in —
        # still useful, and doesn't look broken in front of a judge.
        log.warning("Gemini rate-limited; serving snapshot fallback instead of a generated reply")
        return ChatResponse(
            response=(
                "My language model (Gemini) is temporarily rate-limited on its free-tier quota, "
                "so I can't generate a full conversational reply right now. Here's what's live in "
                f"the Command Center instead:\n\n{_snapshot(db)}\n\n"
                "Ask again shortly, or check the Workbench / AI Policies pages directly for the full detail."
            )
        )
    except Exception as e:  # noqa: BLE001 — surfaced to the chat UI, not a 500
        log.exception("Gemini chat call failed")
        return ChatResponse(response="I hit an unexpected error talking to Gemini just now. Check the backend logs for details.")

    return ChatResponse(response=text)
