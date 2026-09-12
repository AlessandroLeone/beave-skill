# Project State — [Project name]

- **Lifecycle state:** INTAKE | DISCOVERY | INTERVIEW | RESEARCH | BLUEPRINT | FOUNDATION | PLAN | EXECUTE | VERIFY | RELEASE | OPERATE
- **Interaction mode:** Guided | Standard | Expert
- **Current milestone:**
- **Current gate:**
- **Exact next action:**
- **Decision owner required:**
- **Last verified:**

## Operational forecast

The single canonical place for this project's forecast. Other documents point here and repeat no count that will change. When Hybrid is active the engine record is canonical and this section carries the pointer to it.

- **Phase:**
- **Known work remaining:**
- **Conditional work, and the condition:**
- **Questions / operations / cycles remaining:** ranges, not percentages
- **Confidence and reason:** ALTA | MEDIA | BASSA —
- **Cycle state:** REGOLARE | IN_ESPANSIONE | RISCHIO_LOOP | BLOCCATO
- **Change since the previous forecast, and its cause:**

| Date | Phase | Ranges | Confidence | Cycle state | Change and cause |
|---|---|---|---|---|---|

## Questionnaire coverage

Track detailed concerns under COV-001. Module summaries do not establish completeness; these Markdown fields do not extend an installed CLI schema.

| Concern / discipline | Question / applicability | Status | Source / decision | Owner | Artifacts / verification | Dependencies / impact | Next action / blocking point |
|---|---|---|---|---|---|---|---|

## Readiness scope

- Assessment: Not ready / Ready for a named bounded stage / Prepared for the agreed outcome
- Exact outcome or stage and evidence:
- Unresolved items, consequences, owners, resolution procedures and blocking points:
- Approval and execution authority:
- Folder acceptance: checked / pending, with evidence:

## Module summary

| Module | Status | Evidence/decision | Owner | Next question |
|---|---|---|---|---|

## Active work

| ID | Owner | State | Dependencies | Acceptance evidence |
|---|---|---|---|---|

## Decisions and assumptions

- Confirmed:
- Assumed with expiry:
- Deferred:
- Rejected:

## Risks and blockers

| ID | Status | Impact | Owner | Unblock/mitigation |
|---|---|---|---|---|

## Recent evidence

- Check, result, timestamp, scope

## Interview history

- Recorded interactions: [count] — full history in `QUESTION_ANSWER_HISTORY.md`
- Recording began: [instant, or "this project predates the ledger"]
- Last completed interaction: [QNA-nnnn — question]
- Asked and unanswered: [QNA-nnnn, or none]
- Answered and not yet applied: [QNA-nnnn, or none]
- Next question: [QNA-nnnn — question, or none recorded]

Do not re-ask a question the history records as answered. If the exact question
behind a decision is not recorded, say so rather than presenting the decision as
proof that it was asked.

## Resume

- Run `beave resume --project-root .` first. It is the first thing a host does
  when it is activated inside this project, not something the user has to ask for.
- Files to read first
- Safe resume action without credentials
