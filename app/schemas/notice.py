# app/schemas/notice.py
from typing import Any

from pydantic import BaseModel, field_validator


class NoticeSubmitRequest(BaseModel):
    # supplier_id / item_number are REQUIRED, not optional. Per the hackathon
    # guide: "Don't let the agent invent a value on a missing field; pause
    # and escalate." Every downstream Operator (True-Availability, Recovery
    # Strategist, etc.) reasons about a specific supplier/item's real
    # inventory position — if either is missing, there's nothing real to
    # reason about, and letting the run proceed anyway means Auto has to
    # guess or silently fall back. Rejecting the submission at intake with a
    # clear 422 *is* the pause — it stops a bad run before Auto ever sees
    # it, rather than discovering the gap mid-workflow.
    supplier_id: str
    item_number: str
    notice_type: str
    message_body: str
    channel: str = "manual"
    severity: str | None = None
    confidence: float | None = 1.0

    @field_validator("supplier_id", "item_number", "notice_type", "message_body", mode="before")
    @classmethod
    def _strip_required(cls, v: str) -> str:
        # A stray leading/trailing space (easy to introduce via copy-paste)
        # breaks exact-match lookups downstream (e.g. purchase_order_lines.
        # item_number) and would otherwise silently send the Auto workflow
        # down a missing-data fallback path instead of finding real records.
        v = v.strip() if isinstance(v, str) else v
        if not v:
            raise ValueError("This field is required and cannot be blank — Auto cannot process a notice with a missing/invented value here.")
        return v

    @field_validator("severity", mode="before")
    @classmethod
    def _strip_optional(cls, v: str | None) -> str | None:
        # severity is genuinely optional: it's only a submitter hint. Auto's
        # own True-Availability Operator computes the real severity from
        # live inventory data and can (correctly) override this — see the
        # earlier low/medium test cases that came back HIGH.
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v


class NoticeSubmitResponse(BaseModel):
    notice_id: str
    status: str


class NoticeStatus(BaseModel):
    notice_id: str
    disruption_notice: dict[str, Any] | None = None
    run_context: dict[str, Any] | None = None
    incident: dict[str, Any] | None = None
    workbench_item: dict[str, Any] | None = None
    stage: str
