# app/schemas/notice.py
from typing import Any

from pydantic import BaseModel, field_validator


class NoticeSubmitRequest(BaseModel):
    supplier_id: str | None = None
    item_number: str | None = None
    notice_type: str
    message_body: str
    channel: str = "manual"
    severity: str | None = None
    confidence: float | None = 1.0

    @field_validator("supplier_id", "item_number", "severity", mode="before")
    @classmethod
    def _strip_optional(cls, v: str | None) -> str | None:
        # A stray leading/trailing space (easy to introduce via copy-paste)
        # breaks exact-match lookups downstream (e.g. purchase_order_lines.
        # item_number) and silently sends the Auto workflow down its
        # missing-data fallback path instead of finding real records. Strip
        # it here so that never happens from this form. Empty-after-strip
        # becomes None (same as "not provided").
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    @field_validator("notice_type", "message_body", mode="before")
    @classmethod
    def _strip_required(cls, v: str) -> str:
        return v.strip() if isinstance(v, str) else v


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
