# Artifacts and Traceability

## Choose a layout after deriving coverage

Apply [coverage-contract.md](coverage-contract.md) and [execution-package.md](execution-package.md) first. These layouts are examples, not file quotas or permission to omit a discipline. Split or extend without limit when needed; merged documents preserve all required information.

- **Lean:** consolidate related information where it remains usable, without a predefined document count.
- **Standard:** multiple components or sessions; separate requirements, architecture/decisions, quality, agent system, roadmap, and state.
- **Critical:** data-sensitive, regulated, destructive, expensive, or highly parallel; add threat/safety contracts, interface contracts, acceptance matrices, operations, audit, and independent reviews.

Propose the layout within existing writing authority. Confirm consequential structure changes and reuse earlier approval. Project conventions win over these examples without reducing coverage.

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

Do not create every suggested filename automatically. Add all EXEC-001 information roles, including coverage, resources, procurement where applicable, execution definitions and exception handling. Organization, size and consumer needs determine splitting; completeness determines content.

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

Every must-have requirement across the agreed outcome maps forward to artifacts, work and verification. Every task maps backward to a requirement or explicit enabling purpose. Rejected and superseded decisions remain traceable.

## Drift control

- Update canonical intent when validated behavior changes.
- Do not let roadmap, state, and requirements disagree silently.
- Generated graphs and indexes may report drift but never overwrite canonical truth.
- At phase completion, verify requirement coverage and update state from observed results.
- Archive or supersede; do not erase decision history.
- When a recorded digest stops matching the file it names, decide which file is now true before touching the record. A file changed by accident is restored; a file legitimately revised supersedes the recorded one, and the record is re-pointed at it with the previous path, digest, authority and reason kept. Re-pointing a record to stop a check complaining is falsification: the check was the only thing that noticed. See [engine-contract.md](engine-contract.md) for the command and what it preserves.
- Keep the operational forecast in one canonical place — the project state document, or the engine record when Hybrid is active — with its basis and its dated changes. Never copy a count that will change into several documents; other documents point at the canonical place. See [interview-protocol.md](interview-protocol.md) for what a forecast contains.

## Templates

No template is required to run Beave, and none is a source of truth. What a document must contain is defined by the contracts, not by a file of headings: the blueprint by [coverage-contract.md](coverage-contract.md) and [execution-package.md](execution-package.md) together with the information roles above; the state document by [lifecycle.md](lifecycle.md) for position and gate, by coverage-contract.md for the COV-001 register and the readiness category, and by [interview-protocol.md](interview-protocol.md) for the operational forecast; the agent system by [multi-agent-system.md](multi-agent-system.md). A document written from those is complete whether or not a template was used.

The installed skill distribution carries three optional starting files under its `assets/` directory — a blueprint, a project-state and an agent-system outline — which save typing and nothing else. They are deliberately not obligatory here, because the distributions do not all carry them: the Portable Semantic Edition is a single Markdown file with no `assets/` directory, and an instruction to open a file the reader does not have is an instruction that cannot be followed. If `assets/` is present, adapt those files after the user approves artifact paths and depth. If it is not, write the documents from the contracts above; nothing is missing.
