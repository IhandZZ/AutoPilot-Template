# app/schemas/policy.py
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class PolicyConfigCreate(BaseModel):
    key: str
    value: str
    description: str | None = None


class PolicyConfigUpdate(BaseModel):
    value: str | None = None
    description: str | None = None


class PolicyOut(BaseModel):
    """
    Shaped to match the frontend's `Policy` type (frontend/src/components/ai/policies/PolicyCard.tsx)
    so the existing Policy UI (cards, detail modal) works unmodified against
    real data. Backed by the `exception_config` table — the same table the
    Auto Operators read at runtime, so editing a value here immediately
    changes agent behavior (no code, no redeploy).
    """

    id: str
    name: str
    description: str
    natural_language: str
    summary: str
    policy_type: str = "config"
    dsl: dict[str, Any] | None = None
    refined_instruction: str | None = None
    ai_instruction: str
    entity_name: str | None = None
    is_active: bool = True
    priority: int = 0
    tags: list[str] = []
    execution_count: int = 0
    last_executed_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class EvaluationSummary(BaseModel):
    total_evaluations: int
    first_evaluated_at: datetime | None = None
    last_evaluated_at: datetime | None = None
    by_decision: dict[str, int]
