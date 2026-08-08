# app/routers/dashboard.py
"""
Real KPIs for the Command Center home page — pulled from the same Supabase
tables every other page uses. Replaces the template's fake generic SaaS
metrics (Total Users, Active Sessions, AI Confidence) with numbers that
actually describe the Procurement Exception Commander's activity.
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.supabase_db import get_supabase_db
from ..models.supabase_models import (
    DisruptionNotice,
    ExceptionConfig,
    IncidentLog,
    PolicyEvaluation,
    RunContext,
    Supplier,
    SupplierScorecard,
    WorkbenchItem,
)
from ..schemas.dashboard import DashboardSummary, RecentIncident, TopRiskSupplier

log = logging.getLogger(__name__)

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def get_summary(db: Session = Depends(get_supabase_db)):
    pending = db.query(func.count(WorkbenchItem.id)).filter(WorkbenchItem.status == "pending").scalar() or 0
    resolved = db.query(func.count(WorkbenchItem.id)).filter(WorkbenchItem.status == "resolved").scalar() or 0

    total_cost_avoided = db.query(func.coalesce(func.sum(IncidentLog.cost_avoided_myr), 0)).scalar() or 0
    total_value_at_risk = db.query(func.coalesce(func.sum(IncidentLog.value_at_risk_myr), 0)).scalar() or 0

    active_policies = db.query(func.count(ExceptionConfig.key)).scalar() or 0
    total_evaluations = db.query(func.count(PolicyEvaluation.id)).scalar() or 0

    notices_total = db.query(func.count(DisruptionNotice.notice_id)).scalar() or 0
    notices_processed = (
        db.query(func.count(DisruptionNotice.notice_id)).filter(DisruptionNotice.processed.is_(True)).scalar() or 0
    )

    high_risk_suppliers = (
        db.query(func.count(SupplierScorecard.supplier_id))
        .filter(func.lower(SupplierScorecard.risk_band).in_(["high", "critical"]))
        .scalar()
        or 0
    )

    recent_incidents_rows = (
        db.query(IncidentLog).order_by(IncidentLog.created_at.desc()).limit(5).all()
    )
    supplier_ids = {i.supplier_id for i in recent_incidents_rows if i.supplier_id}
    supplier_names = {}
    if supplier_ids:
        for s in db.query(Supplier).filter(Supplier.id.in_(supplier_ids)).all():
            supplier_names[s.id] = s.name

    # Display-only fallback: some auto-resolved incidents have a NULL
    # action_taken even though the Recovery Strategist already wrote a
    # recommendation into run_context earlier in the same run. Backfill it
    # here for display; the underlying incident_log row is unchanged.
    notice_ids = [i.notice_id for i in recent_incidents_rows if i.notice_id and not i.action_taken]
    run_context_by_notice = {}
    if notice_ids:
        for rc in db.query(RunContext).filter(RunContext.notice_id.in_(notice_ids)).all():
            run_context_by_notice[rc.notice_id] = rc.draft_recommended_option

    recent_incidents = [
        RecentIncident(
            notice_id=i.notice_id,
            supplier_name=supplier_names.get(i.supplier_id, i.supplier_id),
            item_number=i.item_number,
            severity=i.severity,
            action_taken=i.action_taken or run_context_by_notice.get(i.notice_id),
            escalated=i.escalated,
            cost_avoided_myr=float(i.cost_avoided_myr or 0),
            created_at=i.created_at,
        )
        for i in recent_incidents_rows
    ]

    top_risk_rows = (
        db.query(SupplierScorecard)
        .order_by(SupplierScorecard.risk_score.desc().nullslast())
        .limit(5)
        .all()
    )
    top_risk_suppliers = [
        TopRiskSupplier(
            supplier_id=s.supplier_id,
            supplier_name=s.supplier_name,
            risk_score=float(s.risk_score or 0),
            risk_band=s.risk_band,
            incident_count=s.incident_count or 0,
        )
        for s in top_risk_rows
    ]

    return DashboardSummary(
        pending_exceptions=pending,
        resolved_exceptions=resolved,
        total_cost_avoided_myr=float(total_cost_avoided),
        total_value_at_risk_myr=float(total_value_at_risk),
        active_policies=active_policies,
        total_evaluations=total_evaluations,
        notices_total=notices_total,
        notices_processed=notices_processed,
        high_risk_suppliers=high_risk_suppliers,
        recent_incidents=recent_incidents,
        top_risk_suppliers=top_risk_suppliers,
    )
