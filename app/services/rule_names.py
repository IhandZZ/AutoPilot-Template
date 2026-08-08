# app/services/rule_names.py
"""
Shared translation of Auto's generic rule_1..rule_14 policy identifiers into
human-readable names, used everywhere a workbench_item's `reason` field is
surfaced (Workbench queue/detail, New Disruption status panel, etc.).

Kept in one place so every consumer stays in sync — this used to live only
in app/routers/workbench.py, which meant the New Disruption page's "Routed
to Workbench" panel still showed raw rule_N tags even after the Workbench
page itself was fixed, since it builds its own dict from the same
workbench_items row via a separate code path (app/routers/notices.py).
"""

import ast
import re

# Attempts to get Auto's own Execute & Escalate Operator to write these
# names itself did not take effect after two verified rounds (confirmed
# against fresh test data), so this is done here instead, in code we fully
# control. Threshold-based rules map to their real exception_config key;
# the rest are structural checks with no configurable threshold.
RULE_NAME_MAP = {
    "rule_1": "value_at_risk_high",
    "rule_2": "buffer_days_low",
    "rule_3": "expedite_cost_cap",
    "rule_4": "auto_approve_tiers",
    "rule_5": "escalate_sole_source",
    "rule_6": "escalate_expired_contract",
    "rule_7": "cascade_tier_threshold",
    "rule_8": "logistics_risk_check",
    "rule_9": "penalty_breach_cap",
    "rule_10": "phantom_inventory_check",
    "rule_11": "buffer_days_check",
    "rule_12": "contention_check",
    "rule_13": "requires_human_check",
    "rule_14": "unresolved_check",
}


def translate_reason(reason: str | None) -> str | None:
    """Best-effort translation of raw rule_N tags in a workbench_item.reason
    string into human-readable policy names, without breaking on formats we
    don't recognize (falls back to the original string untouched)."""
    if not reason or "rule_" not in reason:
        return reason
    try:
        parsed = ast.literal_eval(reason)
        if isinstance(parsed, (list, tuple)):
            translated = [RULE_NAME_MAP.get(str(r), str(r)) for r in parsed]
            return ", ".join(translated)
    except (ValueError, SyntaxError):
        pass
    return re.sub(r"\brule_(\d+)\b", lambda m: RULE_NAME_MAP.get(m.group(0), m.group(0)), reason)
