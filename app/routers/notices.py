# app/routers/notices.py
"""
Lets a judge (or anyone) submit an unseen disruption notice through the
Command Center, which inserts it into Supabase and triggers the real
Supervity Auto Orchestrator against it — the "bring your own dataset" flow.

POST /notices inserts the row and fires the Auto trigger in a background
task (the workflow run can take a while); the frontend then polls
GET /notices/{id}/status, which reads run_context / incident_log /
workbench_items — the same tables the Operators write to — to show live
progress without us having to parse Auto's internal streaming protocol.
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..core.supabase_db import get_supabase_db
from ..models.supabase_models import DisruptionNotice, IncidentLog, RunContext, Supplier, WorkbenchItem
from ..schemas.notice import NoticeStatus, NoticeSubmitRequest, NoticeSubmitResponse
from ..services.rule_names import translate_reason
from ..services.supervity import SupervityNotConfigured, trigger_workflow

log = logging.getLogger(__name__)

router = APIRouter(prefix="/notices", tags=["Disruption Notices"])


def _validate_references(payload: NoticeSubmitRequest, db: Session) -> None:
    """
    Fail fast with a clear 400 if supplier_id / item_number don't match
    anything real, instead of silently submitting them to Auto and letting
    a lookup miss send the run down a slow/unreliable fallback path with no
    visible error — which is exactly what happened with a typo'd item
    number that left the status panel stuck on "Processing" indefinitely.
    """
    if payload.supplier_id:
        exists = db.query(Supplier).filter(Supplier.id == payload.supplier_id).first()
        if not exists:
            raise HTTPException(
                status_code=400,
                detail=f"Supplier ID '{payload.supplier_id}' doesn't match any supplier on file. Check for typos or extra spaces.",
            )

    if payload.item_number:
        row = db.execute(
            text("SELECT 1 FROM inventory_positions WHERE item_number = :item LIMIT 1"),
            {"item": payload.item_number},
        ).first()
        if not row:
            raise HTTPException(
                status_code=400,
                detail=f"Item Number '{payload.item_number}' doesn't match any item in inventory data. Check for typos or extra spaces.",
            )


def _run_trigger_in_background(notice_id: str) -> None:
    try:
        result = trigger_workflow(notice_id)
        log.info("Supervity workflow finished for %s: %s", notice_id, result.get("status"))
    except SupervityNotConfigured as e:
        log.warning("Supervity not configured, skipping trigger for %s: %s", notice_id, e)
    except Exception:
        log.exception("Supervity trigger failed for %s", notice_id)


@router.get("", response_model=list[NoticeStatus])
def list_recent_notices(limit: int = 15, db: Session = Depends(get_supabase_db)):
    """
    Recently submitted notices (manual/external channel only — the ones
    submitted through this Command Center), most recent first, each with
    its current stage. Lets the New Disruption page show history instead
    of losing track of a submission the moment you navigate away.
    """
    notices = (
        db.query(DisruptionNotice)
        .filter(DisruptionNotice.channel == "manual")
        .order_by(DisruptionNotice.received_at.desc())
        .limit(limit)
        .all()
    )
    return [get_notice_status(n.notice_id, db) for n in notices]


@router.post("", response_model=NoticeSubmitResponse)
def submit_notice(
    payload: NoticeSubmitRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_supabase_db),
):
    _validate_references(payload, db)

    notice_id = f"DN-EXT-{uuid.uuid4().hex[:8].upper()}"
    row = DisruptionNotice(
        notice_id=notice_id,
        received_at=datetime.now(timezone.utc).isoformat(),
        channel=payload.channel,
        supplier_id=payload.supplier_id,
        item_number=payload.item_number,
        notice_type=payload.notice_type,
        message_body=payload.message_body,
        processed=False,
        severity=payload.severity,
        confidence=payload.confidence,
    )
    db.add(row)
    db.commit()

    background_tasks.add_task(_run_trigger_in_background, notice_id)

    return NoticeSubmitResponse(notice_id=notice_id, status="submitted")


def _model_to_dict(obj) -> dict | None:
    if obj is None:
        return None
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


@router.get("/{notice_id}/status", response_model=NoticeStatus)
def get_notice_status(notice_id: str, db: Session = Depends(get_supabase_db)):
    notice = db.query(DisruptionNotice).filter(DisruptionNotice.notice_id == notice_id).first()
    if notice is None:
        raise HTTPException(status_code=404, detail="Notice not found")

    run_context = db.query(RunContext).filter(RunContext.notice_id == notice_id).first()
    incident = (
        db.query(IncidentLog)
        .filter(IncidentLog.notice_id == notice_id)
        .order_by(IncidentLog.created_at.desc())
        .first()
    )
    workbench_item = (
        db.query(WorkbenchItem)
        .filter(WorkbenchItem.notice_id == notice_id)
        .order_by(WorkbenchItem.created_at.desc())
        .first()
    )

    if workbench_item and workbench_item.status == "pending":
        stage = "awaiting_human"
    elif workbench_item and workbench_item.status == "resolved":
        stage = "resolved"
    elif incident:
        stage = "escalated" if incident.escalated else "auto_resolved"
    elif run_context:
        stage = "processing"
    else:
        stage = "submitted"

    incident_dict = _model_to_dict(incident)
    # Display-only fallback: the Execute & Escalate Operator sometimes leaves
    # recommended_option/action_taken NULL on incident_log for auto-resolved
    # (non-escalated) cases even though the Recovery Strategist already wrote
    # a recommendation into run_context earlier in the same run. This does
    # NOT fix the underlying row — Dashboard/Insights/Scorecard reading
    # incident_log directly will still see NULL until the Operator itself is
    # fixed — it only makes this status view honest about what was decided.
    if incident_dict and run_context and not incident_dict.get("recommended_option"):
        fallback = getattr(run_context, "draft_recommended_option", None) if run_context else None
        if fallback:
            incident_dict["recommended_option"] = fallback
            if not incident_dict.get("action_taken"):
                incident_dict["action_taken"] = f"Auto-approved: {fallback} (backfilled from run_context)"

    workbench_item_dict = _model_to_dict(workbench_item)
    if workbench_item_dict and workbench_item_dict.get("reason"):
        workbench_item_dict["reason"] = translate_reason(workbench_item_dict["reason"])

    return NoticeStatus(
        notice_id=notice_id,
        disruption_notice=_model_to_dict(notice),
        run_context=_model_to_dict(run_context),
        incident=incident_dict,
        workbench_item=workbench_item_dict,
        stage=stage,
    )
