# app/schemas/dashboard.py
from datetime import datetime

from pydantic import BaseModel


class RecentIncident(BaseModel):
    notice_id: str | None
    supplier_name: str | None
    item_number: str | None
    severity: str | None
    action_taken: str | None
    escalated: bool | None
    cost_avoided_myr: float
    created_at: datetime | None


class TopRiskSupplier(BaseModel):
    supplier_id: str
    supplier_name: str | None
    risk_score: float
    risk_band: str | None
    incident_count: int


class DashboardSummary(BaseModel):
    pending_exceptions: int
    resolved_exceptions: int
    total_cost_avoided_myr: float
    total_value_at_risk_myr: float
    active_policies: int
    total_evaluations: int
    notices_total: int
    notices_processed: int
    high_risk_suppliers: int
    recent_incidents: list[RecentIncident]
    top_risk_suppliers: list[TopRiskSupplier]
