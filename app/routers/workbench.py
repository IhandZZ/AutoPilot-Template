# app/routers/workbench.py
"""
AI Workbench — the human-in-the-loop exception queue.

Backed by Supabase tables: workbench_items (the queue), joined with
suppliers (name lookup), run_context (full agent reasoning trail) and
incident_log (outcome/financial fields) for the detail view.
"""

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..core.supabase_db import get_supabase_db
from ..models.supabase_models import IncidentLog, RunContext, Supplier, WorkbenchItem
from ..schemas.workbench import (
    WorkbenchDecisionRequest,
    WorkbenchItemDetail,
    WorkbenchItemSummary,
)
from ..services.rule_names import translate_reason as _translate_reason

log = logging.getLogger(__name__)

router = APIRouter(prefix="/workbench", tags=["Workbench"])


def _model_to_dict(obj) -> dict | None:
    if obj is None:
        return None
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


@router.get("/items", response_model=list[WorkbenchItemSummary])
def list_workbench_items(
    status: str | None = None,
    limit: int = 100,
    db: Session = Depends(get_supabase_db),
):
    """
    List exception queue items, newest first. Filter by status
    (pending | resolved | ...) if provided.
    """
    query = db.query(WorkbenchItem)
    if status:
        query = query.filter(WorkbenchItem.status == status)
    items = query.order_by(WorkbenchItem.created_at.desc()).limit(limit).all()

    # Batch-lookup supplier names to avoid N+1 queries.
    supplier_ids = {i.supplier_id for i in items if i.supplier_id}
    suppliers = {}
    if supplier_ids:
        for s in db.query(Supplier).filter(Supplier.id.in_(supplier_ids)).all():
            suppliers[s.id] = s.name

    result = []
    for item in items:
        result.append(
            WorkbenchItemSummary(
                id=item.id,
                notice_id=item.notice_id,
                item_number=item.item_number,
                supplier_id=item.supplier_id,
                supplier_name=suppliers.get(item.supplier_id),
                severity=item.severity,
                value_at_risk_myr=item.value_at_risk_myr,
                recommended_option=item.recommended_option,
                reason=_translate_reason(item.reason),
                status=item.status,
                human_decision=item.human_decision,
                decided_by=item.decided_by,
                decided_at=item.decided_at,
                created_at=item.created_at,
            )
        )
    return result


@router.get("/items/{item_id}", response_model=WorkbenchItemDetail)
def get_workbench_item(item_id: int, db: Session = Depends(get_supabase_db)):
    """
    Full context for one exception — the recommended option, the raw
    agent-written context_json, the full run_context reasoning trail, and
    the linked incident_log row (if the Orchestrator already wrote one).
    """
    item = db.query(WorkbenchItem).filter(WorkbenchItem.id == item_id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="Workbench item not found")

    supplier_name = None
    if item.supplier_id:
        supplier = db.query(Supplier).filter(Supplier.id == item.supplier_id).first()
        supplier_name = supplier.name if supplier else None

    run_context = None
    incident = None
    if item.notice_id:
        rc = db.query(RunContext).filter(RunContext.notice_id == item.notice_id).first()
        run_context = _model_to_dict(rc)
        inc = (
            db.query(IncidentLog)
            .filter(IncidentLog.notice_id == item.notice_id)
            .order_by(IncidentLog.created_at.desc())
            .first()
        )
        incident = _model_to_dict(inc)

    # The Execute & Escalate Operator sometimes double-encodes context_json —
    # storing a JSON *string* inside the JSONB column instead of a raw
    # object. Parse it defensively so the API doesn't 500 on rows written
    # that way.
    context_json = item.context_json
    if isinstance(context_json, str):
        try:
            context_json = json.loads(context_json)
        except (ValueError, TypeError):
            context_json = {"raw": context_json}

    return WorkbenchItemDetail(
        id=item.id,
        notice_id=item.notice_id,
        item_number=item.item_number,
        supplier_id=item.supplier_id,
        supplier_name=supplier_name,
        severity=item.severity,
        value_at_risk_myr=item.value_at_risk_myr,
        recommended_option=item.recommended_option,
        reason=_translate_reason(item.reason),
        status=item.status,
        human_decision=item.human_decision,
        human_notes=item.human_notes,
        decided_by=item.decided_by,
        decided_at=item.decided_at,
        created_at=item.created_at,
        context_json=context_json,
        run_context=run_context,
        incident=incident,
    )


@router.post("/items/{item_id}/decide", response_model=WorkbenchItemDetail)
def decide_workbench_item(
    item_id: int,
    decision: WorkbenchDecisionRequest,
    db: Session = Depends(get_supabase_db),
):
    """
    Resolve an exception: approve the AI's recommended option, reject it,
    or modify it with a human-chosen alternative. Writes back to
    workbench_items and mirrors the outcome onto incident_log so Insights
    can later measure human-override rates.
    """
    item = db.query(WorkbenchItem).filter(WorkbenchItem.id == item_id).first()
    if item is None:
        raise HTTPException(status_code=404, detail="Workbench item not found")

    now = datetime.now(timezone.utc)
    item.status = "resolved"
    item.human_decision = decision.decision
    item.human_notes = decision.notes
    item.decided_by = decision.decided_by
    item.decided_at = now

    if decision.decision == "modify" and decision.modified_option:
        item.recommended_option = decision.modified_option

    final_action = (
        decision.modified_option
        if decision.decision == "modify" and decision.modified_option
        else item.recommended_option
    )

    # Mirror onto incident_log so downstream Insights/Dashboard/Supplier
    # Scorecard can pick up the outcome.
    if item.notice_id:
        incident = (
            db.query(IncidentLog)
            .filter(IncidentLog.notice_id == item.notice_id)
            .order_by(IncidentLog.created_at.desc())
            .first()
        )
        if incident:
            incident.approval_status = decision.decision
            incident.action_taken = final_action
            if decision.decision == "reject":
                incident.cost_avoided_myr = 0
        else:
            # Auto's own run is likely still waiting on a separate approval
            # channel (Slack, via the Commander Approval node) that a
            # decision made here doesn't touch — so no incident_log row
            # exists yet for this notice. The human just made a real
            # decision with full context in front of them, so close the
            # loop from the Command Center side rather than leaving it
            # invisible to Insights/Dashboard/Scorecard.
            rc = db.query(RunContext).filter(RunContext.notice_id == item.notice_id).first()
            recovery_cost = float((rc.rough_recovery_cost_myr or rc.alt_recovery_cost_myr) or 0) if rc else 0.0
            value_at_risk = float(item.value_at_risk_myr or 0)
            cost_avoided = max(value_at_risk - recovery_cost, 0) if decision.decision != "reject" else 0.0
            db.add(
                IncidentLog(
                    notice_id=item.notice_id,
                    notice_type=rc.notice_type if rc else None,
                    supplier_id=item.supplier_id,
                    item_number=item.item_number,
                    value_at_risk_myr=item.value_at_risk_myr,
                    recommended_option=final_action,
                    recovery_cost_myr=recovery_cost if decision.decision != "reject" else 0,
                    cost_avoided_myr=cost_avoided,
                    time_to_recovery_days=None,
                    severity=item.severity,
                    action_taken=f"{decision.decision.title()} via Workbench: {final_action}",
                    escalated=True,
                    approval_status=decision.decision,
                    cascade_impact=rc.cascade_impact if rc else None,
                    customer_orders_affected=rc.customer_orders_affected if rc else None,
                )
            )

    db.commit()
    db.refresh(item)

    return get_workbench_item(item_id, db)
