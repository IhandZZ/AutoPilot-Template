# Round 2 Submission — Track 2, Operations

**Team:** Mok (solo)
**Track:** Track 2 — Operations (The Procurement Exception Commander)
**Build:** The Procurement Exception Command Center

**Auto workspace:** https://auto.supervity.ai/u/alpha/agent/workflow/019f7688-7462-7000-9adf-432a88669ebb?tab=Workflow
**Repository:** https://github.com/IhandZZ/AutoPilot-Template
**Running instance:** https://catsup-rimless-kindred.ngrok-free.dev (tunneled live from my laptop during the judging window) — API docs at https://catsup-rimless-kindred.ngrok-free.dev/api/docs.

## Outcome metric

Cost avoided and time-to-recovery across concurrent procurement disruptions — the same outcome metric named in the Round 2 problem statement. The build tracks, per disruption notice, the value at risk (MYR), the recovery cost of the chosen action, and the resulting cost avoided, plus whether the case auto-resolved or required human escalation via the Workbench.

## Integrations (3+, across 2+ categories)

- **Supabase** — System of Record. Live Postgres database holding all Round 2 dataset tables (suppliers, contracts, purchase orders, inventory, shipments, disruption notices, etc.) plus every run, decision, and policy evaluation the agent produces. Read and written by both the Auto Orchestrator/Operators and the Command Center backend.
- **Supervity Auto** — Orchestration. The Procurement Exception Commander Orchestrator coordinating 10 Operators (Intake & Normalize, Impact Mapper, True-Availability, Cascade Dependency, Shipment Logistics, Recovery Strategist, Contention Prioritisation, Penalty-Aware Cost, Execute & Escalate, Supplier Risk Scorecard).
- **Outlook** — Channel. Supplier disruption notice intake.
- **Slack** — Channel. Human-approval and escalation notifications to `#procurement-commander`.

## What the build does end to end

A disruption notice arrives (via the New Disruption page, or a live channel), the backend validates it and triggers the Auto Orchestrator, which delegates to 10 Operators to assess impact, check true availability, map cascade/shipment risk, plan recovery, prioritise contention, and cost penalties. Every proposed action is evaluated against at least 3 live, no-code-editable AI Policies (stored in `exception_config`, read by Auto at runtime) before it executes. Anything the policy engine flags is routed to the Workbench, where a human approves, modifies, or rejects it — the decision is recorded and mirrored to `incident_log`. The Dashboard, AI Insights, and AI Manager all reflect this live activity, and the AI Manager can also trigger or re-trigger a run directly from its chat interface.
