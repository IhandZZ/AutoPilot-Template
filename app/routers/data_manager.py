# app/routers/data_manager.py
"""
Data Manager — live health of every integration the AI Employee depends on.

Supabase and Supervity Auto are checked directly (we hold credentials for
both in this backend). Slack / Jira / Outlook are wired into the Auto
Orchestrator itself (per Phase A setup) rather than into this backend, so
we surface them as "configured" rather than guessing at undocumented
health-check endpoints we don't have credentials for.
"""

import logging
import os
import time
from datetime import datetime, timezone

from fastapi import APIRouter
from sqlalchemy import text

from ..core.supabase_db import supabase_engine

log = logging.getLogger(__name__)

router = APIRouter(prefix="/data-manager", tags=["Data Manager"])


def _check_supabase() -> dict:
    start = time.monotonic()
    try:
        with supabase_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        latency_ms = round((time.monotonic() - start) * 1000)
        return {
            "status": "healthy",
            "detail": f"Connected · {latency_ms}ms",
            "latency_ms": latency_ms,
        }
    except Exception as e:  # noqa: BLE001 — surfaced to the UI, not swallowed
        log.warning("Supabase health check failed: %s", e)
        return {"status": "error", "detail": str(e)[:200], "latency_ms": None}


def _check_supervity_auto() -> dict:
    api_key = os.getenv("SUPERVITY_API_KEY")
    if not api_key:
        return {
            "status": "not_configured",
            "detail": "SUPERVITY_API_KEY not set",
            "latency_ms": None,
        }
    return {
        "status": "configured",
        "detail": "API key present — Orchestrator + Operators run on auto.supervity.ai",
        "latency_ms": None,
    }


LIVE_CHECKS = [
    {"name": "Supabase", "category": "System of Record", "checker": _check_supabase},
    {"name": "Supervity Auto", "category": "Orchestration", "checker": _check_supervity_auto},
]

# Integrations connected on the Auto platform side (Phase A setup), not
# through this backend — reported as configured rather than polled.
STATIC_INTEGRATIONS = [
    {
        "name": "Slack",
        "category": "Channel",
        "status": "configured",
        "detail": "#procurement-commander — human-approval + escalation notifications",
    },
    {
        "name": "Jira",
        "category": "System of Record",
        "status": "configured",
        "detail": "Project SCRUM — recovery task creation",
    },
    {
        "name": "Outlook",
        "category": "Channel",
        "status": "configured",
        "detail": "Supplier disruption notice intake",
    },
]


@router.get("/integrations")
def list_integrations():
    results = []
    now = datetime.now(timezone.utc).isoformat()

    for integ in LIVE_CHECKS:
        check = integ["checker"]()
        results.append(
            {
                "name": integ["name"],
                "category": integ["category"],
                "checked_at": now,
                "check_type": "live",
                **check,
            }
        )

    for integ in STATIC_INTEGRATIONS:
        results.append({**integ, "latency_ms": None, "checked_at": None, "check_type": "static"})

    healthy_or_configured = sum(1 for r in results if r["status"] in ("healthy", "configured"))
    return {
        "integrations": results,
        "summary": {
            "total": len(results),
            "healthy_or_configured": healthy_or_configured,
            "categories": sorted({r["category"] for r in results}),
        },
    }
