# Procurement Exception Command Center — 5-Minute Demo Script

**Track:** Operations · Autopilot Asia Hackathon 2026, Round 2
**Format:** Live demo against real Supabase data (no mocks, no canned screenshots)

---

## 0:00–0:45 — The Problem

> "Every day, procurement teams get disruption notices — a supplier delay, a price hike, a sole-source contract expiring — by email, by Teams, sometimes just a phone call. Someone has to read it, figure out what it actually affects, decide what to do, and act before the deadline passes. That triage work is manual, slow, and inconsistent. One overworked analyst might catch it. Another might not.

> We built a system that does that triage automatically, end to end, and only pulls in a human when a decision actually needs one."

Show the architecture diagram (`architecture_diagram.svg`) for ~15 seconds while saying this — it's the fastest way to set context before the live demo.

---

## 0:45–1:30 — What We Built

> "This is the Procurement Exception Command Center. It has two engines working together, and this split is deliberate:

> Supervity **Auto** runs the actual agent orchestration — a Commander Orchestrator coordinating ten specialized Operators: intake, impact mapping, true-availability checks, cascade dependency analysis, shipment logistics, recovery strategy, contention prioritisation, penalty-aware costing, execution, and supplier risk scoring. That's the reasoning pipeline that decides what a disruption actually means.

> **Gemini** handles a completely separate layer — natural-language policy explanations, AI-generated insights, and the AI Manager chat assistant. It never touches orchestration. That separation matters for the hackathon's rules, and honestly it also made the system easier to debug — if something's wrong with a decision, we know it's Auto, not the chatbot."

---

## 1:30–3:30 — Live Demo

**Step 1 — Submit a real disruption (New Disruption page).**
Use a genuinely fresh, untested case pulled straight from live Supabase data right before you go on stage (cross-reference `supplier_scorecard` risk + `purchase_order_lines`/`inventory_positions` for a real understocked item — the same way we sourced the SKU-CP-330 / Highland Chemicals test cases). Fill in supplier ID, item number, notice type, severity, and a one-line message. Submit.

> "This isn't a scripted demo — this is a disruption I picked from our live dataset five minutes ago. Judges, feel free to hand me a different one instead."

**Step 2 — Show it processing.**
Point at the status panel polling live. While it's running (~1–2 minutes):

> "Right now, ten Operators are running in sequence against this one notice — checking real inventory, real supplier contracts, real shipment data in Supabase. Nothing here is precomputed."

**Step 3 — Land in the Workbench.**
Once it resolves (or escalates), switch to the Workbench.

> "If the policy engine is confident, it auto-resolves and logs the outcome. If it's not — sole-source supplier, contract edge case, high value at risk — it lands here, in front of a human, with the full reasoning trail: what's at risk, what the AI recommends, why. A person approves, modifies, or rejects it. Nothing ships without a decision someone can point to."

Approve or modify the item live.

**Step 4 — Show the impact on the Dashboard.**

> "And here's the dashboard updating in real time — cost avoided, top risk suppliers, exception volume. Everything you just watched happen is now reflected here, because it's the same Supabase tables underneath the whole app."

---

## 3:30–4:15 — Why This Holds Up

> "A few things we specifically built to survive real use, not just a demo:

> - Bad input — a typo'd item number, a supplier ID that doesn't exist — fails fast with a clear error instead of silently hanging in 'Processing' forever.
> - Every exception a human resolves gets mirrored back into our incident log, so the Insights page can measure override rates over time — this isn't a black box that forgets what happened.
> - When our LLM quota ran out mid-build, the AI Manager didn't just throw an error — it degrades gracefully and still gives you a live data snapshot instead of nothing.

> We treated 'what happens when this breaks' as part of the spec, not an afterthought."

---

## 4:15–5:00 — Close

> "Five things this system does end to end, live, right now: ingest a real disruption notice, run it through a ten-agent orchestration pipeline, apply a configurable policy engine, route judgment calls to a human with full context, and reflect every outcome back onto a live dashboard.

> This is procurement exception handling that a team could actually turn on Monday morning — not a proof of concept that only works for the one scenario we rehearsed."

---

## Backup / Q&A Notes

- **"Why not let AI decide everything?"** — Some calls (sole-source supplier disruptions, contract edge cases) carry real financial and legal risk. The policy engine routes exactly those to a human, with full reasoning attached, instead of forcing a binary "trust the AI or don't."
- **"How long does a full run take?"** — Roughly 1–2 minutes end to end through all ten Operators. If asked to speed this up: reasonable answer is that the Orchestrator's own Audit Trail can help isolate slow Operators, and this is next on the roadmap, not something we glossed over.
- **"What's real vs. seeded?"** — Suppliers, inventory, contracts, and purchase orders are seeded reference data; every disruption notice, run, decision, and dashboard number generated during the demo is live and freshly computed.
- **"What if Auto or Gemini is down during judging?"** — Auto failures fail fast with a clear submitted/error state rather than hanging; Gemini failures degrade to a live data snapshot instead of a broken chat. Neither takes down the rest of the app.
