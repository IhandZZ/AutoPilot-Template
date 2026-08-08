# app/routers/insights.py
"""
AI Insights — rule/statistics-based analysis over live Supabase data
(supplier_scorecard, policy_evaluations, workbench_items). No LLM call is
required for this to work; if GEMINI_API_KEY is set, insight descriptions
could later be rephrased by Gemini, but the underlying detection is honest
statistics over real rows — not fabricated demo content.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..core.supabase_db import get_supabase_db
from ..models.supabase_models import ExceptionConfig, PolicyEvaluation, SupplierScorecard, WorkbenchItem
from ..schemas.insights import ActionItem, Insight, InsightsResponse, Pattern, SuggestedPolicy

log = logging.getLogger(__name__)

router = APIRouter(prefix="/insights", tags=["Insights"])


def _generate(db: Session) -> InsightsResponse:
    now = datetime.now(timezone.utc)
    insights: list[Insight] = []
    patterns: list[Pattern] = []
    actions: list[ActionItem] = []

    # --- Supplier risk ---------------------------------------------------
    suppliers = db.query(SupplierScorecard).all()
    total_suppliers = len(suppliers)

    high_risk = sorted(
        [s for s in suppliers if (s.risk_band or "").lower() in ("high", "critical")],
        key=lambda s: (s.risk_score or 0),
        reverse=True,
    )
    if high_risk:
        top = high_risk[0]
        insights.append(
            Insight(
                id="risk-top-supplier",
                type="anomaly",
                severity="critical" if (top.risk_band or "").lower() == "critical" else "high",
                title=f"{top.supplier_name or top.supplier_id} is your highest-risk supplier",
                description=(
                    f"Risk score {top.risk_score}, {top.incident_count or 0} incidents logged "
                    f"({top.high_severity_count or 0} high-severity), MYR "
                    f"{float(top.total_value_at_risk_myr or 0):,.0f} total value at risk."
                ),
                data={
                    "supplier_id": top.supplier_id,
                    "risk_score": float(top.risk_score or 0),
                    "incident_count": top.incident_count,
                    "value_at_risk_myr": float(top.total_value_at_risk_myr or 0),
                },
                suggested_action=f"Review contract terms and alternative sourcing for {top.supplier_name or top.supplier_id}",
                action_type="investigate",
                confidence=0.9,
                created_at=now,
            )
        )
        actions.append(
            ActionItem(
                title=f"Review {top.supplier_name or top.supplier_id} sourcing risk",
                priority="critical" if (top.risk_band or "").lower() == "critical" else "high",
                estimated_impact=f"MYR {float(top.total_value_at_risk_myr or 0):,.0f} exposure",
                action_type="investigate",
                action_config={"supplier_id": top.supplier_id},
            )
        )

    if total_suppliers:
        patterns.append(
            Pattern(
                name="Supplier Risk Distribution",
                frequency="ongoing",
                confidence=1.0,
                sample_size=total_suppliers,
                description=(
                    f"{len(high_risk)} of {total_suppliers} suppliers ({len(high_risk) / total_suppliers:.0%}) "
                    f"are flagged high/critical risk."
                ),
            )
        )

    sole_source_at_risk = [
        s for s in suppliers if (s.sole_source or "").lower() == "true" and (s.incident_count or 0) > 0
    ]
    if sole_source_at_risk:
        insights.append(
            Insight(
                id="sole-source-exposure",
                type="alert",
                severity="warning",
                title=f"{len(sole_source_at_risk)} sole-source supplier(s) have active incidents",
                description=(
                    "Sole-source suppliers with no fallback have logged incidents — "
                    "any further disruption has no alternative supply path."
                ),
                data={"count": len(sole_source_at_risk)},
                suggested_action="Always escalate sole-source suppliers with active incidents to a human",
                action_type="create_policy",
                suggested_policy=SuggestedPolicy(
                    key="escalate_sole_source_active_incident",
                    value="true",
                    description=(
                        f"Auto-generated from Insights: {len(sole_source_at_risk)} sole-source supplier(s) "
                        "currently have active incidents with no fallback — always route these to a human."
                    ),
                ),
                confidence=0.85,
                created_at=now,
            )
        )

    # --- Policy evaluation activity ---------------------------------------
    total_evals = db.query(func.count(PolicyEvaluation.id)).scalar() or 0
    if total_evals:
        by_decision = dict(
            db.query(PolicyEvaluation.decision, func.count(PolicyEvaluation.id))
            .group_by(PolicyEvaluation.decision)
            .all()
        )
        top_decision = max(by_decision, key=by_decision.get) if by_decision else None
        patterns.append(
            Pattern(
                name="Policy Evaluation Outcomes",
                frequency="per-notice",
                confidence=1.0,
                sample_size=total_evals,
                description=(
                    f"{total_evals} rule evaluations logged. Most common outcome: "
                    f"{top_decision} ({by_decision.get(top_decision, 0)} times)."
                    if top_decision
                    else f"{total_evals} rule evaluations logged."
                ),
            )
        )
        high_share = by_decision.get("HIGH", 0) / total_evals if total_evals else 0
        if high_share > 0.5:
            current_threshold_row = (
                db.query(ExceptionConfig).filter(ExceptionConfig.key == "value_at_risk_high").first()
            )
            suggested_policy = None
            if current_threshold_row and current_threshold_row.value:
                try:
                    current_val = float(current_threshold_row.value)
                    suggested_policy = SuggestedPolicy(
                        key="value_at_risk_high",
                        value=str(round(current_val * 1.2)),
                        description=(
                            f"Auto-generated from Insights: {high_share:.0%} of evaluations are HIGH — "
                            f"raising the threshold from {current_val:,.0f} to reduce over-escalation."
                        ),
                    )
                except ValueError:
                    pass
            insights.append(
                Insight(
                    id="high-decision-rate",
                    type="trend",
                    severity="warning",
                    title="Most disruptions are being classified HIGH impact",
                    description=(
                        f"{high_share:.0%} of {total_evals} policy evaluations resulted in a HIGH "
                        "decision — worth checking whether thresholds (e.g. value_at_risk_high) are "
                        "calibrated too aggressively."
                    ),
                    data={"high_share": round(high_share, 2), "total_evaluations": total_evals},
                    suggested_action="Raise the value_at_risk_high threshold to reduce over-escalation",
                    action_type="create_policy",
                    suggested_policy=suggested_policy,
                    confidence=0.75,
                    created_at=now,
                )
            )

    # --- Workbench / human-in-the-loop -------------------------------------
    pending = db.query(func.count(WorkbenchItem.id)).filter(WorkbenchItem.status == "pending").scalar() or 0
    resolved_items = db.query(WorkbenchItem).filter(WorkbenchItem.status == "resolved").all()
    if pending:
        insights.append(
            Insight(
                id="workbench-backlog",
                type="alert",
                severity="warning" if pending < 5 else "high",
                title=f"{pending} exception(s) waiting for human review",
                description="These need a decision in the Workbench before recovery actions execute.",
                data={"pending_count": pending},
                suggested_action="Clear the Workbench queue",
                action_type="investigate",
                confidence=1.0,
                created_at=now,
            )
        )
        actions.append(
            ActionItem(
                title=f"Clear {pending} pending Workbench item(s)",
                priority="high" if pending >= 5 else "medium",
                estimated_impact="Unblocks recovery actions",
                action_type="investigate",
                action_config={"status": "pending"},
            )
        )

    if resolved_items:
        overrides = [i for i in resolved_items if i.human_decision in ("reject", "modify")]
        override_rate = len(overrides) / len(resolved_items)
        patterns.append(
            Pattern(
                name="Human Override Rate",
                frequency="ongoing",
                confidence=1.0,
                sample_size=len(resolved_items),
                description=(
                    f"Humans changed or rejected the AI's recommendation {len(overrides)} of "
                    f"{len(resolved_items)} times ({override_rate:.0%})."
                ),
            )
        )
        if override_rate > 0.3:
            insights.append(
                Insight(
                    id="high-override-rate",
                    type="recommendation",
                    severity="medium",
                    title="AI recommendations are being overridden often",
                    description=(
                        f"{override_rate:.0%} of resolved exceptions were modified or rejected by a human — "
                        "the Recovery Strategist logic may need tuning."
                    ),
                    data={"override_rate": round(override_rate, 2)},
                    suggested_action="Review recent rejected/modified Workbench decisions for a pattern",
                    action_type="investigate",
                    confidence=0.7,
                    created_at=now,
                )
            )

    # --- Value delivered ----------------------------------------------------
    total_cost_avoided = sum(float(s.total_cost_avoided_myr or 0) for s in suppliers)
    if total_cost_avoided > 0:
        insights.append(
            Insight(
                id="cost-avoided",
                type="trend",
                severity="info",
                title=f"MYR {total_cost_avoided:,.0f} in cost avoided so far",
                description="Cumulative cost avoided across all suppliers from automated recovery actions.",
                data={"total_cost_avoided_myr": total_cost_avoided},
                confidence=1.0,
                created_at=now,
            )
        )

    if not insights:
        insights.append(
            Insight(
                id="no-signal-yet",
                type="pattern",
                severity="info",
                title="Not enough activity yet for insights",
                description="Run the Orchestrator on a few more notices, then re-run analysis.",
                confidence=0.5,
                created_at=now,
            )
        )

    return InsightsResponse(insights=insights, patterns=patterns, actions=actions, generated_at=now)


@router.get("", response_model=InsightsResponse)
def get_insights(db: Session = Depends(get_supabase_db)):
    return _generate(db)


@router.post("/analyze", response_model=InsightsResponse)
def analyze(db: Session = Depends(get_supabase_db)):
    """Re-run the analysis. Same engine as GET — kept as a separate route
    because the frontend's 'Run Analysis' button POSTs here."""
    return _generate(db)
