# app/routers/policies.py
"""
AI Policies — backed by `exception_config`, the same Supabase table the
Auto Operators read at runtime. This is deliberate: these are the actual
live rules governing agent behavior (auto-approve thresholds, escalation
triggers, cost caps), not a cosmetic demo. Editing a row here via the API
changes what the Orchestrator/Operators do on their next run — no code
change, no redeploy. Every rule evaluation is logged by Auto into
`policy_evaluations`, surfaced here via /policies/evaluations/summary.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.supabase_db import get_supabase_db
from ..models.supabase_models import ExceptionConfig, PolicyEvaluation
from ..schemas.policy import EvaluationSummary, PolicyConfigCreate, PolicyConfigUpdate, PolicyOut

log = logging.getLogger(__name__)

router = APIRouter(prefix="/policies", tags=["Policies"])


def _to_policy_out(cfg: ExceptionConfig, priority: int) -> PolicyOut:
    label = cfg.key.replace("_", " ").title()
    return PolicyOut(
        id=cfg.key,
        name=label,
        description=cfg.description or "",
        natural_language=cfg.description or label,
        summary=cfg.description or label,
        policy_type="config",
        dsl={
            "conditions": [{"field": cfg.key, "operator": "equals", "value": cfg.value}],
            "actions": [],
            "match_mode": "all",
        },
        refined_instruction=None,
        ai_instruction=f"{cfg.key} = {cfg.value}",
        entity_name="disruption_notice",
        is_active=True,
        priority=priority,
        tags=["live", "exception_config"],
        execution_count=0,
        last_executed_at=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


@router.get("", response_model=list[PolicyOut])
def list_policies(db: Session = Depends(get_supabase_db)):
    rows = db.query(ExceptionConfig).order_by(ExceptionConfig.key).all()
    return [_to_policy_out(r, i) for i, r in enumerate(rows)]


@router.post("", response_model=PolicyOut)
def create_policy(payload: PolicyConfigCreate, db: Session = Depends(get_supabase_db)):
    existing = db.query(ExceptionConfig).filter(ExceptionConfig.key == payload.key).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Policy '{payload.key}' already exists")
    row = ExceptionConfig(key=payload.key, value=payload.value, description=payload.description)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_policy_out(row, 0)


@router.patch("/{key}", response_model=PolicyOut)
def update_policy(key: str, payload: PolicyConfigUpdate, db: Session = Depends(get_supabase_db)):
    row = db.query(ExceptionConfig).filter(ExceptionConfig.key == key).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Policy not found")
    if payload.value is not None:
        row.value = payload.value
    if payload.description is not None:
        row.description = payload.description
    db.commit()
    db.refresh(row)
    return _to_policy_out(row, 0)


@router.delete("/{key}")
def delete_policy(key: str, db: Session = Depends(get_supabase_db)):
    row = db.query(ExceptionConfig).filter(ExceptionConfig.key == key).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Policy not found")
    db.delete(row)
    db.commit()
    return {"message": "Policy deleted"}


@router.get("/evaluations/summary", response_model=EvaluationSummary)
def evaluations_summary(db: Session = Depends(get_supabase_db)):
    total = db.query(func.count(PolicyEvaluation.id)).scalar() or 0
    first = db.query(func.min(PolicyEvaluation.created_at)).scalar()
    last = db.query(func.max(PolicyEvaluation.created_at)).scalar()
    by_decision_rows = (
        db.query(PolicyEvaluation.decision, func.count(PolicyEvaluation.id))
        .group_by(PolicyEvaluation.decision)
        .all()
    )
    by_decision = {(d or "unknown"): c for d, c in by_decision_rows}
    return EvaluationSummary(
        total_evaluations=total,
        first_evaluated_at=first,
        last_evaluated_at=last,
        by_decision=by_decision,
    )
