# app/core/supabase_db.py
#
# Separate SQLAlchemy engine/session bound to Supabase (the system of record
# for procurement data + governance tables: workbench_items, incident_log,
# run_context, exception_config, policy_evaluations, supplier_scorecard,
# disruption_notices, etc). This is intentionally decoupled from
# app/core/database.py, which points at the template's local `app_db`
# Postgres and has nothing to do with our procurement domain.

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

SUPABASE_DB_URL = os.getenv("SUPABASE_DB_URL")
if not SUPABASE_DB_URL:
    raise ValueError("SUPABASE_DB_URL environment variable is not set")

# pool_pre_ping avoids stale-connection errors against a remote DB that may
# close idle connections.
supabase_engine = create_engine(SUPABASE_DB_URL, pool_pre_ping=True)
SupabaseSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=supabase_engine)

SupabaseBase = declarative_base()


def get_supabase_db():
    db = SupabaseSessionLocal()
    try:
        yield db
    finally:
        db.close()
