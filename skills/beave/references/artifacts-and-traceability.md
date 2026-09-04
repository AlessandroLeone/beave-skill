# Artifacts and Traceability

## Choose a depth

- **Lean:** small, reversible project; one blueprint, one state file, one roadmap/task file, plus repository instructions.
- **Standard:** multiple components or sessions; separate requirements, architecture/decisions, quality, agent system, roadmap, and state.
- **Critical:** data-sensitive, regulated, destructive, expensive, or highly parallel; add threat/safety contracts, interface contracts, acceptance matrices, operations, audit, and independent reviews.

Propose the depth and wait for approval. Existing project conventions win over these defaults.

## Default information roles

If no adequate structure exists, propose:

| Role | Suggested artifact |
|---|---|
| Entry point and precedence | `AGENTS.md` and project documentation index |
| Complete approved synthesis | `PROJECT_BLUEPRINT.md` |
| Functional/non-functional scope | `REQUIREMENTS.md` |
| Domain and terminology | `DOMAIN.md` |
| Architecture and interfaces | `ARCHITECTURE.md`, ADRs, contracts |
| UX/content direction | `UX_SPEC.md` |
| Data, safety, privacy, security | `DATA_AND_SAFETY.md`, threat model |
| Quality and acceptance | `QUALITY.md`, acceptance matrices |
| Agent organization | `AGENT_SYSTEM.md`, role prompts |
| Delivery and operations | `DELIVERY_AND_OPERATIONS.md` |
| Milestones and work | `ROADMAP.md`, tasks |
| Current position | `PROJECT_STATE.md` |
| Unresolved choices | `OPEN_DECISIONS.md` |
| Session transfer | timestamped handoffs |
| Generated views | separate ignored cache/output directory |

Do not create every file automatically. Split only when independent ownership, size, or consumers justify it.

## Source hierarchy

Define once:

1. approved product/architecture decisions;
2. canonical project documents;
3. approved contracts;
4. current operational state and tasks;
5. agent instructions;
6. history and exploration;
7. generated indexes and caches.

Record how conflicts are resolved and who may change each level.

## Traceability

Use IDs only at the complexity level needed:

- `GOAL-###`
- `USER-###` or persona/job IDs
- `FR-###` functional requirements
- `NFR-###` non-functional requirements
- `CON-###` constraints
- `ADR-###` decisions
- `RISK-###`
- `M-###` milestones
- `TASK-###`
- `TEST-###` or acceptance evidence

Every must-have requirement maps forward to a milestone/task and verification method. Every task maps backward to a requirement or explicitly labeled maintenance purpose. Rejected and superseded decisions remain traceable rather than disappearing.

## Drift control

- Update canonical intent when validated behavior changes.
- Do not let roadmap, state, and requirements disagree silently.
- Generated graphs and indexes may report drift but never overwrite canonical truth.
- At phase completion, verify requirement coverage and update state from observed results.
- Archive or supersede; do not erase decision history.

## Templates

- `assets/project-blueprint-template.md`
- `assets/project-state-template.md`
- `assets/agent-system-template.md`

Adapt them after the user approves artifact paths and depth.
