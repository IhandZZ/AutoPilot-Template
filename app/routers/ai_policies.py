# app/routers/ai_policies.py
"""
AI-assisted policy authoring — the "Create with AI" wizard and the Edit
modal's "Generate Rules with AI" button (frontend/src/components/ai/policies/
CreateWithAI.tsx and PolicyEditModal.tsx) call these endpoints. They were
previously unimplemented (404), which silently broke both flows: the create
wizard couldn't get past step 1 ("Analyze with AI"), and the Edit modal's
save button threw against a route that didn't exist.

Design constraint: the real store behind every policy is `exception_config`
— a flat key/value/description table, the same one the Supervity Auto
Operators read directly at run time (see routers/policies.py). So "AI
analysis" here does NOT invent conditions/actions that get thrown away; it
extracts a single (key, value) pair from the natural-language input using
plain text heuristics (no external AI call, no dependency on the currently
rate-limited Gemini key), and every create/update in this file writes
through the identical `exception_config` row that /api/policies uses. That
keeps the "editable without code, applied before the agent acts" guarantee
real end-to-end instead of cosmetic.
"""

import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..core.supabase_db import get_supabase_db
from ..models.supabase_models import ExceptionConfig
from ..schemas.policy import PolicyOut
from .policies import _to_policy_out

log = logging.getLogger(__name__)

router = APIRouter(prefix="/ai/policies", tags=["AI Policies"])


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.strip().lower()).strip("_")
    return slug or "policy"


# Longer/more specific keywords first so e.g. "at least" wins over a bare "least".
_OPERATOR_KEYWORDS: list[tuple[str, str]] = [
    ("at least", "gte"),
    ("minimum of", "gte"),
    ("no less than", "gte"),
    ("at most", "lte"),
    ("maximum of", "lte"),
    ("no more than", "lte"),
    ("less than", "lt"),
    ("under", "lt"),
    ("below", "lt"),
    ("greater than", "gt"),
    ("more than", "gt"),
    ("over", "gt"),
    ("above", "gt"),
    ("exceed", "gt"),
]

_FIELD_KEYWORDS: list[tuple[str, str]] = [
    ("value at risk", "value_at_risk_high"),
    ("risk", "value_at_risk_high"),
    ("buffer", "buffer_days_low"),
    ("safety stock", "buffer_days_low"),
    ("severity", "severity_threshold"),
    ("lead time", "lead_time_days"),
    ("vendor", "vendor_rule"),
    ("supplier", "vendor_rule"),
    ("invoice", "amount_threshold"),
    ("amount", "amount_threshold"),
    ("cost", "amount_threshold"),
]

_NUMBER_RE = re.compile(r"\$?\s*([\d,]+(?:\.\d+)?)\s*%?")


def _parse_rule(text: str) -> dict:
    lowered = text.lower()

    operator = "eq"
    for phrase, op in _OPERATOR_KEYWORDS:
        if phrase in lowered:
            operator = op
            break

    field = None
    for phrase, key in _FIELD_KEYWORDS:
        if phrase in lowered:
            field = key
            break

    match = _NUMBER_RE.search(text)
    value: str | float | None = None
    if match:
        raw = match.group(1).replace(",", "")
        try:
            value = float(raw) if "." in raw else int(raw)
        except ValueError:
            value = raw

    if field is None:
        # No recognizable domain keyword — fall back to a slug of the first
        # few words so the rule still gets a stable, meaningful key.
        words = re.findall(r"[a-zA-Z0-9]+", text)[:5]
        field = _slugify(" ".join(words)) if words else "custom_rule"

    confidence = 0.85 if (match and field) else (0.6 if match or field != "custom_rule" else 0.35)

    suggested_name = field.replace("_", " ").title()
    dsl = {
        "conditions": [{"field": field, "operator": operator, "value": value if value is not None else text[:60]}],
        "actions": [{"type": "flag_for_review" if operator in ("gt", "gte") else "auto_approve"}],
        "match_mode": "all",
    }
    reason = (
        f"Detected a numeric threshold ({value}) on '{field}'."
        if match
        else "No numeric threshold detected — stored as a plain instruction; refine it manually if needed."
    )

    return {
        "suggested_type": "logical" if match else "natural_language",
        "confidence": confidence,
        "reason": reason,
        "suggested_name": suggested_name,
        "summary": text.strip()[:200],
        "dsl": dsl if match else None,
        "refined_instruction": None if match else text.strip(),
        "entity_name": None,
        "suggested_tags": ["auto-detected"],
        "_key": field,
        "_value": str(value) if value is not None else text.strip()[:200],
    }


class AnalyzeRequest(BaseModel):
    input: str


class AnalysisResult(BaseModel):
    suggested_type: str
    confidence: float
    reason: str
    suggested_name: str
    summary: str
    dsl: dict | None
    refined_instruction: str | None
    entity_name: str | None
    suggested_tags: list[str]


@router.post("/analyze-input", response_model=AnalysisResult)
def analyze_input(payload: AnalyzeRequest):
    if not payload.input.strip():
        raise HTTPException(status_code=400, detail="input is required")
    parsed = _parse_rule(payload.input)
    return AnalysisResult(**{k: v for k, v in parsed.items() if not k.startswith("_")})


class ConflictCheckRequest(BaseModel):
    natural_language: str
    policy_scope: str | None = None
    entity_name: str | None = None


class ConflictEntry(BaseModel):
    conflicting_rule_id: str
    conflicting_rule_name: str
    explanation: str


class ConflictResult(BaseModel):
    conflicts: list[ConflictEntry]
    overrides: list[dict]
    clarifications: list[str]
    suggested_instructions: list[str]
    refined_instruction: str
    is_valid: bool
    warnings: list[str] = []


@router.post("/check-conflicts", response_model=ConflictResult)
def check_conflicts(payload: ConflictCheckRequest, db: Session = Depends(get_supabase_db)):
    parsed = _parse_rule(payload.natural_language)
    key = parsed["_key"]
    existing = db.query(ExceptionConfig).filter(ExceptionConfig.key == key).first()

    conflicts: list[ConflictEntry] = []
    if existing:
        conflicts.append(
            ConflictEntry(
                conflicting_rule_id=existing.key,
                conflicting_rule_name=existing.key.replace("_", " ").title(),
                explanation=(
                    f"A live rule named '{existing.key}' already exists (current value: {existing.value}). "
                    "Saving will overwrite it — the Auto Operators will pick up the new value on their next run."
                ),
            )
        )

    return ConflictResult(
        conflicts=conflicts,
        overrides=[],
        clarifications=[],
        suggested_instructions=[],
        refined_instruction=payload.natural_language,
        is_valid=True,
        warnings=[] if key != "custom_rule" else ["Could not map this rule to a known field — it will be saved as a custom key."],
    )


class TranslateRequest(BaseModel):
    natural_language: str


class TranslateResult(BaseModel):
    dsl: dict | None
    confidence: float


@router.post("/translate", response_model=TranslateResult)
def translate(payload: TranslateRequest):
    parsed = _parse_rule(payload.natural_language)
    return TranslateResult(dsl=parsed["dsl"], confidence=parsed["confidence"])


class AIPolicySave(BaseModel):
    name: str
    description: str | None = None
    natural_language: str
    policy_type: str
    refined_instruction: str | None = None
    entity_name: str | None = None
    priority: int | None = None
    tags: list[str] | None = None
    is_active: bool = True
    dsl: dict | None = None


def _extract_value(payload: AIPolicySave) -> str:
    if payload.dsl and payload.dsl.get("conditions"):
        raw_value = payload.dsl["conditions"][0].get("value")
        if raw_value is not None:
            return str(raw_value)
    if payload.refined_instruction:
        return payload.refined_instruction[:200]
    return payload.natural_language[:200]


@router.post("", response_model=PolicyOut)
def create_ai_policy(payload: AIPolicySave, db: Session = Depends(get_supabase_db)):
    key = _slugify(payload.name)
    existing = db.query(ExceptionConfig).filter(ExceptionConfig.key == key).first()
    value = _extract_value(payload)
    description = payload.description or payload.natural_language

    if existing:
        existing.value = value
        existing.description = description
        db.commit()
        db.refresh(existing)
        return _to_policy_out(existing, 0)

    row = ExceptionConfig(key=key, value=value, description=description)
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_policy_out(row, 0)


@router.patch("/{policy_id}", response_model=PolicyOut)
def update_ai_policy(policy_id: str, payload: AIPolicySave, db: Session = Depends(get_supabase_db)):
    row = db.query(ExceptionConfig).filter(ExceptionConfig.key == policy_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Policy not found")
    row.value = _extract_value(payload)
    row.description = payload.description or payload.natural_language
    db.commit()
    db.refresh(row)
    return _to_policy_out(row, 0)
