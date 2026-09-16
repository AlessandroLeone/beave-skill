# Complete project coverage

**Contract:** COV-001, version 1.0.0. Semantic contract; not a claim that the current CLI enforces these fields.

Read during discovery, throughout the interview, after changes and before readiness assessment. Use the same contract in Semantic-only and Hybrid.

## Derive coverage from the outcome

Name the agreed outcome and completion boundary first. Survey the disciplines needed to achieve it, their interfaces, resources and verification responsibilities. The questionnaire is a starting catalog, not a closed list of disciplines or a limit on inquiry. Add concerns whenever an answer, source, experiment or reviewer reveals them.

For every applicable discipline consider intent, existing conditions, requirements, technical/domain design, resources and procurement, responsibilities, interfaces, execution sequence, acceptance, failure/recovery, delivery and ongoing operation. This is a coverage lens, not a demand to ask a fixed question list or to create one document per cell. Record reasoned exclusions. A single model may prepare several disciplines; that does not turn it into a qualified human authority or a physical executor.

Use existing sources before questioning. Distinguish observed facts, confirmed decisions, recommendations, assumptions and unresolved questions. Trace consequential premises to evidence or a decision owner. Derive or research facts within authority; ask the human for intent, priorities, constraints and consequential choices that evidence cannot settle. Never invent an answer to close a row.

There is no total question, document, page, prompt or investigation cap. Presentation can be concise while project coverage remains exhaustive for the agreed outcome. Do not add repetitive documents to simulate completeness.

## Coverage record

Maintain a durable coverage register with stable IDs and these information roles, using project conventions. A Markdown table with linked detail is sufficient; neither JSON nor the CLI is required.

| Field | Meaning |
|---|---|
| Concern ID and discipline | Stable identity and domain of responsibility |
| Question or obligation | The issue that must be settled, or work that must be specified |
| Applicability and rationale | Why it matters, or why it does not apply |
| Status | OPEN, IN_PROGRESS, RESOLVED, DEFERRED, BLOCKED, or NOT_APPLICABLE |
| Provenance | Source, observation or human confirmation; distinguish assumptions |
| Decision and owner | Recorded conclusion and accountable decision authority |
| Artifacts and verification | Where the conclusion is implemented in the dossier and how adequacy is assessed |
| Dependencies and impact | Prerequisite concerns and downstream requirements/tasks/contracts |
| Next action / blocking point | What happens next and what cannot proceed meanwhile |

These are coverage statuses, not new values to insert into an existing CLI module/schema enum. Until a compatible engine schema exists, keep this register in governed Markdown and point to it from the project index. Do not patch state.json by hand to simulate support.

RESOLVED requires an answer or fulfilled obligation, applicable confirmation, accessible evidence and propagation to the relevant artifacts. A module label, filled heading or passing file validator is insufficient. NOT_APPLICABLE requires a reason; it is not completed work. DEFERRED requires owner, consequence, prerequisite/trigger, resolution procedure, acceptance and the exact point it blocks. BLOCKED identifies what is missing and who can unblock it.

When a premise changes, preserve the old decision, reopen affected concerns and invalidate dependent readiness claims. A timestamp or file revision does not perform semantic reconciliation. If a relation is uncertain, record that uncertainty rather than claiming a complete impact map.

## Interview progression

Survey breadth before deep design so an early technical choice does not hide a necessary discipline. Then resolve dependencies in a sensible order. Respect per-turn question limits, but continue as many turns as needed. Reuse valid earlier confirmations; do not restart the authority interview on Resume unless authority or scope changed.

At each checkpoint report the unresolved frontier, important new discoveries and the next question or investigation. Totals help navigation, but no percentage or module count establishes readiness. A user's request to pause ends the session with unfinished work preserved, not a false completion claim.

## Readiness assessment

Record one of these human-readable outcomes with scope, evidence, authority and remaining restrictions. They are report labels, not new CLI gate values.

- **Not ready:** design prerequisites or required artifacts are missing or contradictory.
- **Ready for a named bounded stage:** that stage has no unresolved prerequisites; later uncertainties have explicit resolution work and blocking points. This is not whole-project readiness.
- **Prepared for the agreed outcome:** the full execution path and all currently decidable prerequisites are specified; unavoidable future-dependent decisions have executable resolution procedures before dependent work. Explicit human/physical/capability gates still apply.

Deferred product choices that could be resolved now do not become a complete project by attaching a generic “ask later” instruction. If the user intentionally narrows the outcome, record the changed boundary and preserve the excluded work. Do not silently narrow the outcome to pass readiness.

Apply [execution-package.md](execution-package.md) to test whether the folder actually supplies what the executor needs. Readiness of a dossier never claims that the future implementation has already passed its tests.
