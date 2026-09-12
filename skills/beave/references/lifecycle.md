# Project Lifecycle State Machine

Persist one current state and one exact next gate. Never skip a state merely because later work appears obvious.

Beave prepares the documents, prompts, ledgers, gates and evidence rules for this lifecycle. Initialization does not execute the project or launch its agents. The same agent or another runtime follows the prepared artifacts once execution is authorized; Beave may be invoked again for Resume, audit or evolution.

## 1. INTAKE

Establish authority, workspace, interaction mode, decision owners, persistence location, and mutation boundaries. Exit only when the collaboration contract is confirmed.

## 2. DISCOVERY

Inventory existing sources, code, assets, repository, runtime, tests, infrastructure, agents, tools, and contradictions. For brownfield work, establish a clean baseline and distinguish current behavior from desired behavior. Exit with an evidence-backed current-state summary.

## 3. INTERVIEW

Run every applicable questionnaire module. Confirm each module before continuing. Exit with a coverage ledger, decision ledger, assumptions, deferrals, non-goals, and blockers.

## 4. RESEARCH

Research only the decisions listed in the approved research plan. Use bounded questions, authoritative sources, explicit egress/cost approval, and stopping conditions. Exit with options, evidence, recommendation, uncertainty, and unresolved decisions.

## 5. BLUEPRINT

Synthesize vision, users, domain, scope, requirements, UX, data, safety, architecture, quality, delivery, agent system, roadmap, and risks. Verify internal consistency and traceability. Exit only after written user review and approval.

## 6. FOUNDATION

Create the approved source hierarchy, state system, environment pins, safe configuration examples, contracts, task model, handoff model, agent definitions, and verification baseline. Do not scaffold product code until its prerequisites pass. Exit with a reproducible baseline and no hidden blockers.

## 7. PLAN

Plan the whole agreed outcome under EXEC-001 and decompose currently definable work into executable tasks. Each names objective, requirement IDs, authoritative inputs, scope, dependencies, resources, responsibility, output, acceptance, reviewer, recovery and completion. Future-dependent detail requires resolution work, prerequisites, owner, acceptance and a gate before dependent work. Analyze dependency order and concurrency. Exit after plan review and COV-001 scoped readiness assessment; the next milestone alone is not the complete project system.

## 8. EXECUTE

The initialized project instructs its later execution AI to use the approved agent topology. Work is isolated when useful, task contexts remain fresh and bounded, user changes are preserved, and checkpoints are explicit. Each worker returns artifacts and evidence; the project's orchestrator verifies rather than trusting summaries. Beave prepares and validates these instructions but does not launch the workers.

## 9. VERIFY

Run requirement, contract, integration, quality, security, data, UX, and human acceptance checks appropriate to the risk tier. Record gaps with owners. Repair in bounded cycles; re-plan when the design is wrong. Exit only when blockers are closed or explicitly accepted by the authorized human.

## 10. RELEASE

Confirm version, change scope, migration, backup, rollback, monitoring, support, legal/security gates, and publication authority. Execute release actions only with authorization. Exit with release evidence and a recoverable rollback position.

## 11. OPERATE

Monitor outcomes, incidents, costs, quality, user feedback, dependencies, security posture, and technical debt. Schedule audits and maintenance only when requested. Feed new evidence into decisions and the next milestone without rewriting history.

## Transition rules

- A human gate is a real pause, not a sentence followed by automatic continuation.
- `BLOCKED` states identify the decision owner and exact unblock condition.
- `WARN` requires an owner, consequence, and review date.
- A failed gate returns to the earliest state whose assumption or artifact is invalid, and the return is a forecast change with a stated cause, not a silent re-plan.
- Restate the operational forecast at every transition and every substantial update, with what changed since the previous one and why ([interview-protocol.md](interview-protocol.md)). A phase that closes without one leaves the next agent guessing at what the plan could not see.
- No step is announced as the last while a verification able to open new work is still outstanding. A pending gate is such a verification.
- Maximum automatic repair attempts must be defined before execution; exhaustion escalates.
- Resume begins by reading durable state and verifying it against the workspace, not by replaying the whole chat.
