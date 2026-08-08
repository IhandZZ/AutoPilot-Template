# app/schemas/workbench.py
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel


class WorkbenchItemSummary(BaseModel):
    id: int
    notice_id: str | None = None
    item_number: str | None = None
    supplier_id: str | None = None
    supplier_name: str | None = None
    severity: str | None = None
    # float, not Decimal: Pydantic serializes Decimal to JSON as a *string*
    # (e.g. "77843.83") to avoid float precision loss, but the frontend does
    # plain `sum + value` across pending items — JS treats `0 + "77843.83"`
    # as string concatenation, not addition, and the resulting mangled
    # string (two decimals stitched together) parses to NaN. float avoids
    # this entirely by sending a real JSON number.
    value_at_risk_myr: float | None = None
    recommended_option: str | None = None
    reason: str | None = None
    status: str | None = None
    human_decision: str | None = None
    decided_by: str | None = None
    decided_at: datetime | None = None
    created_at: datetime | None = None

    class Config:
        orm_mode = True


class WorkbenchItemDetail(WorkbenchItemSummary):
    context_json: dict[str, Any] | None = None
    human_notes: str | None = None
    run_context: dict[str, Any] | None = None
    incident: dict[str, Any] | None = None

    class Config:
        orm_mode = True


class WorkbenchDecisionRequest(BaseModel):
    decision: Literal["approve", "reject", "modify"]
    notes: str | None = None
    decided_by: str = "Dev User"
    # Only used when decision == "modify" — overrides the recommended option
    modified_option: str | None = None
