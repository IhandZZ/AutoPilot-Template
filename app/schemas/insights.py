# app/schemas/insights.py
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class SuggestedPolicy(BaseModel):
    """A ready-to-apply exception_config row — lets the frontend create the
    policy in one click instead of routing to the manual creation form."""

    key: str
    value: str
    description: str


class Insight(BaseModel):
    id: str
    type: str  # pattern | anomaly | recommendation | trend | alert
    severity: str  # critical | high | warning | medium | low | info
    title: str
    description: str
    data: dict[str, Any] | None = None
    suggested_action: str | None = None
    action_type: str | None = None
    suggested_policy: SuggestedPolicy | None = None
    confidence: float | None = None
    created_at: datetime
    is_demo: bool = False


class Pattern(BaseModel):
    name: str
    frequency: str
    confidence: float
    sample_size: int
    description: str
    is_demo: bool = False


class ActionItem(BaseModel):
    title: str
    priority: str  # low | medium | high | critical
    estimated_impact: str
    action_type: str
    action_config: dict[str, Any]
    is_demo: bool = False


class InsightsResponse(BaseModel):
    insights: list[Insight]
    patterns: list[Pattern]
    actions: list[ActionItem]
    generated_at: datetime
