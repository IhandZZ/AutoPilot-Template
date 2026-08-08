# app/routers/ai_chat.py
"""
AI Manager chat — POST /api/ai/chat. Matches the contract already built
into frontend/src/components/ai/AIManager.tsx: {message, history, context}
-> {response, tool_calls?}. Grounds Gemini's answers in a live snapshot of
Workbench/Policy data pulled from Supabase so it isn't just guessing.
"""

import logging
import re

from fastapi import APIRouter, BackgroundTasks, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.supabase_db import get_supabase_db
from ..models.supabase_models import DisruptionNotice, ExceptionConfig, PolicyEvaluation, WorkbenchItem
from ..schemas.ai_chat import ChatRequest, ChatResponse, ToolCall
from ..services.gemini import GeminiNotConfigured, GeminiRateLimited, generate
from ..services.supervity import SupervityNotConfigured, trigger_workflow

log = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["AI Manager"])

SYSTEM_PROMPT_TEMPLATE = """You are the AI Manager for the Procurement Exception Command Center — an AI Employee that monitors supplier disruption notices, evaluates policies, and routes exceptions to a human Workbench when it can't safely decide on its own.

You are speaking with the operator running this Command Center. Be concise and concrete, and ground your answers in the live snapshot below rather than guessing. Orchestration (the Intake/Impact/Recovery/Execute agents) runs on the Supervity Auto platform, but the operator CAN trigger or re-trigger a run from right here in this chat — if they ask how, tell them to type something like "re-run DN-EXT-XXXXXXXX" with the real notice ID, which fires the Orchestrator directly (handled outside of you, deterministically, before you ever see the message). If asked to create or edit a policy, explain that policies are stored in the exception_config table (visible on the AI Policies page) and ask for the key/value/description, but don't claim to have made the change yourself unless a tool result confirms it.

Live snapshot:
{snapshot}

The operator is currently viewing: {page}
"""

# Matches disruption notice IDs like DN-EXT-BC318736 anywhere in the message.
NOTICE_ID_RE = re.compile(r"\bDN-EXT-[0-9A-Fa-f]{8}\b", re.IGNORECASE)
TRIGGER_KEYWORDS = (
    "re-run", "rerun", "re-trigger", "retrigger", "trigger", "run again", "resubmit", "kick off", "restart",
)


def _run_trigger_in_background(notice_id: str) -> None:
    try:
        result = trigger_workflow(notice_id)
        log.info("AI Manager-triggered Supervity workflow finished for %s: %s", notice_id, result.get("status"))
    except SupervityNotConfigured as e:
        log.warning("Supervity not configured, skipping AI Manager trigger for %s: %s", notice_id, e)
    except Exception:
        log.exception("AI Manager-triggered Supervity workflow failed for %s", notice_id)


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
def chat(payload: ChatRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_supabase_db)):
    message = payload.message or ""

    # Let the operator trigger or re-trigger the Auto Orchestrator directly
    # from this chat (Round 2 requirement: the AI Manager must let a person
    # "trigger or re-trigger an Operator from the same place"). Handled
    # deterministically via keyword + notice-ID matching rather than left to
    # the LLM to decide whether to call a tool, so it's reliable to demo.
    notice_match = NOTICE_ID_RE.search(message)
    wants_trigger = any(kw in message.lower() for kw in TRIGGER_KEYWORDS)
    if notice_match and wants_trigger:
        notice_id = notice_match.group(0).upper()
        notice = db.query(DisruptionNotice).filter(DisruptionNotice.notice_id == notice_id).first()
        if notice is None:
            return ChatResponse(
                response=(
                    f"I couldn't find a notice with ID {notice_id} — double-check it against the "
                    "New Disruption or Workbench pages."
                )
            )
        background_tasks.add_task(_run_trigger_in_background, notice_id)
        return ChatResponse(
            response=(
                f"Triggering the Orchestrator for {notice_id} now — it runs through all Operators "
                f"in the background. Check its status on the New Disruption page, or GET "
                f"/notices/{notice_id}/status, in a minute or two."
            ),
            tool_calls=[
                ToolCall(
                    id=f"trigger-{notice_id}",
                    name="trigger_workflow",
                    args={"notice_id": notice_id},
                    result={"status": "queued"},
                )
            ],
        )

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
