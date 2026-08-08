# app/models/supabase_models.py
#
# SQLAlchemy ORM models mapped 1:1 to the existing Supabase schema
# (`procurement-commander` project). These tables already exist — created
# independently via SQL — so no Alembic migrations manage them. Column
# names/types below were confirmed via live schema introspection.

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Integer,
    Numeric,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP

from app.core.supabase_db import SupabaseBase


class WorkbenchItem(SupabaseBase):
    __tablename__ = "workbench_items"

    id = Column(BigInteger, primary_key=True)
    notice_id = Column(Text)
    item_number = Column(Text)
    supplier_id = Column(Text)
    severity = Column(Text)
    value_at_risk_myr = Column(Numeric)
    recommended_option = Column(Text)
    reason = Column(Text)
    context_json = Column(JSONB)
    status = Column(Text, default="pending")
    human_decision = Column(Text)
    human_notes = Column(Text)
    decided_by = Column(Text)
    decided_at = Column(TIMESTAMP(timezone=True))
    created_at = Column(TIMESTAMP(timezone=True))


class IncidentLog(SupabaseBase):
    __tablename__ = "incident_log"

    id = Column(BigInteger, primary_key=True)
    notice_id = Column(Text)
    notice_type = Column(Text)
    supplier_id = Column(Text)
    item_number = Column(Text)
    value_at_risk_myr = Column(Numeric)
    recommended_option = Column(Text)
    recovery_cost_myr = Column(Numeric)
    cost_avoided_myr = Column(Numeric)
    time_to_recovery_days = Column(Numeric)
    severity = Column(Text)
    action_taken = Column(Text)
    escalated = Column(Boolean)
    approval_status = Column(Text)
    created_at = Column(TIMESTAMP(timezone=True))
    cascade_impact = Column(Integer)
    customer_orders_affected = Column(Integer)


class RunContext(SupabaseBase):
    __tablename__ = "run_context"

    notice_id = Column(Text, primary_key=True)
    notice_type = Column(Text)
    supplier_id = Column(Text)
    item_number = Column(Text)
    received_at = Column(Text)
    x_tier = Column(Text)
    x_sole_source = Column(Text)
    contract_status = Column(Text)
    x_expedite_allowed = Column(Text)
    value_at_risk_myr = Column(Numeric)
    quantity_at_risk = Column(Numeric)
    first_pass_buffer_days = Column(Numeric)
    combined_signal = Column(Boolean)
    real_buffer_days = Column(Numeric)
    phantom_inventory_flag = Column(Boolean)
    customer_orders_affected = Column(Integer)
    cascade_impact = Column(Integer)
    cascade_severity_hint = Column(Text)
    systemic_logistics_risk = Column(Boolean)
    shipments_at_risk = Column(Integer)
    needs_penalty_check = Column(Boolean)
    requires_human = Column(Boolean)
    draft_recommended_option = Column(Text)
    recovered_by_date = Column(Text)
    rough_recovery_cost_myr = Column(Numeric)
    alternative_found = Column(Boolean)
    contention = Column(Boolean)
    alt_recovery_cost_myr = Column(Numeric)
    top_alternative_supplier = Column(Text)
    unclaimed_alternative_remains = Column(Boolean)
    penalty_breach_flag = Column(Boolean)
    breach_cost_myr = Column(Numeric)
    total_cost_if_breached_myr = Column(Numeric)
    updated_at = Column(TIMESTAMP(timezone=True))
    x_penalty_ref = Column(Text)
    x_escalation_clause = Column(Text)


class ExceptionConfig(SupabaseBase):
    __tablename__ = "exception_config"

    key = Column(Text, primary_key=True)
    value = Column(Text)
    description = Column(Text)


class PolicyEvaluation(SupabaseBase):
    __tablename__ = "policy_evaluations"

    id = Column(BigInteger, primary_key=True)
    notice_id = Column(Text)
    policy_key = Column(Text)
    policy_value = Column(Text)
    evaluated_result = Column(Text)
    decision = Column(Text)
    created_at = Column(TIMESTAMP(timezone=True))


class SupplierScorecard(SupabaseBase):
    __tablename__ = "supplier_scorecard"

    supplier_id = Column(Text, primary_key=True)
    supplier_name = Column(Text)
    tier = Column(Text)
    sole_source = Column(Text)
    incident_count = Column(Integer)
    high_severity_count = Column(Integer)
    escalation_count = Column(Integer)
    total_value_at_risk_myr = Column(Numeric)
    total_cost_avoided_myr = Column(Numeric)
    risk_score = Column(Numeric)
    risk_band = Column(Text)
    updated_at = Column(TIMESTAMP(timezone=True))


class DisruptionNotice(SupabaseBase):
    __tablename__ = "disruption_notices"

    notice_id = Column(Text, primary_key=True)
    received_at = Column(Text)
    channel = Column(Text)
    supplier_id = Column(Text)
    item_number = Column(Text)
    notice_type = Column(Text)
    message_body = Column(Text)
    processed = Column(Boolean, default=False)
    processed_at = Column(TIMESTAMP(timezone=True))
    severity = Column(Text)
    confidence = Column(Numeric)


class DemandSignal(SupabaseBase):
    __tablename__ = "demand_signals"

    id = Column(BigInteger, primary_key=True)
    signal_date = Column(Text)
    item_number = Column(Text)
    forecast_qty = Column(Numeric)
    actual_demand = Column(Numeric)
    channel = Column(Text)


class InventoryPosition(SupabaseBase):
    __tablename__ = "inventory_positions"

    id = Column(BigInteger, primary_key=True)
    item_number = Column(Text)
    description = Column(Text)
    location = Column(Text)
    on_hand_qty = Column(Numeric)
    safety_stock = Column(Numeric)
    reorder_point = Column(Numeric)
    unit_cost = Column(Numeric)
    uom = Column(Text)
    committed_qty = Column(Numeric)


class Supplier(SupabaseBase):
    __tablename__ = "suppliers"

    id = Column(Text, primary_key=True)
    supplier_number = Column(Text)
    name = Column(Text)
    status = Column(Text)
    primary_contact_email = Column(Text)
    country = Column(Text)
    x_tier = Column(Text)
    x_sole_source = Column(Text)
    created_at = Column(Text)
    updated_at = Column(Text)
    lead_time_days = Column(Numeric)
    moq = Column(Numeric)
