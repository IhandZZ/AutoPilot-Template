# app/services/supervity.py
"""
Trigger the Supervity Auto "Procurement Exception Commander" Orchestrator
from outside the platform — this is how judges' unseen notices get run
through the real agent pipeline instead of us faking a result.

Endpoint/payload shape confirmed directly from the Auto dashboard's
"Operator Info - API Details" panel (multipart/form-data, streaming
response). We don't parse Auto's internal stream events — live progress is
read back out of Supabase (run_context / incident_log / workbench_items),
which the Operators write to as they run.
"""

import logging
import os

import httpx

log = logging.getLogger(__name__)


class SupervityNotConfigured(Exception):
    pass


def trigger_workflow(notice_id: str, timeout: float = 150.0) -> dict:
    api_key = os.getenv("SUPERVITY_API_KEY")
    workflow_id = os.getenv("SUPERVITY_WORKFLOW_ID")
    api_url = os.getenv("SUPERVITY_API_URL")
    if not api_key or not workflow_id or not api_url:
        raise SupervityNotConfigured(
            "SUPERVITY_API_KEY / SUPERVITY_WORKFLOW_ID / SUPERVITY_API_URL not fully set"
        )

    headers = {
        "Authorization": f"Bearer {api_key}",
        "x-source": "external",
        "x-user-timezone": "Asia/Kuala_Lumpur",
    }
    data = {
        "workflowId": workflow_id,
        "inputs[notice_id]": notice_id,
    }

    with httpx.Client(timeout=timeout) as client:
        with client.stream("POST", api_url, headers=headers, data=data) as resp:
            if resp.status_code >= 400:
                body = resp.read().decode(errors="replace")
                log.error("Supervity trigger failed %s: %s", resp.status_code, body)
                raise RuntimeError(f"Supervity {resp.status_code}: {body[:500]}")

            chunks: list[str] = []
            for chunk in resp.iter_text():
                chunks.append(chunk)

    return {"status": "completed", "preview": "".join(chunks)[-2000:]}
