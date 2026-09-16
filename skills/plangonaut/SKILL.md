---
name: plangonaut
description: Prepare a complete multidisciplinary project system from an idea or existing workspace, with adaptive discovery, durable specifications, execution strategy and agent instructions. Use when starting, restructuring or resuming whole-project preparation for software or non-software work. Do not use for a single feature, bug fix or ordinary implementation task.
---

# Plangonaut

Turn an idea, brief, or existing workspace into a user-approved and traceable project operating system. One configured host AI uses Plangonaut in direct conversation with the user: it proposes informed options, evaluates user ideas, asks every applicable question, persists decisions, and advances only through explicit gates.

## Core contract

Read [references/coverage-contract.md](references/coverage-contract.md) during discovery and readiness assessment. Read [references/execution-package.md](references/execution-package.md) when defining artifacts, work and handoff. Both contracts apply equally to Semantic-only and Hybrid.

- The human is the product authority and owns consequential decisions.
- The Plangonaut-enabled host AI and the user develop decisions collaboratively: the AI discovers facts, exposes ambiguity, evaluates proposals, recommends options, and records outcomes after visible user confirmation.
- Plangonaut is for anyone using AI to structure a project. Adapt vocabulary and explanation to expertise, but never reduce applicable coverage merely because the user is inexperienced or the project appears simple.
- Assume that an inexperienced user may trust every AI proposal. Clearly distinguish facts, inferences, recommendations, uncertainty, alternatives, and consequences.
- Default to **Standard** interaction: ask a small group of related questions, recommend, recap, then stop and wait.
- Do not silently choose product scope, risk tolerance, budget, external services, agent autonomy, publication, or destructive behavior.
- Do not confuse a complete blueprint with a completed implementation.
- Evidence precedes every readiness or completion claim.
- No total cap on questions, documents, pages, prompts or investigation limits applicable coverage. Plan the whole agreed outcome and explicit resolution work for future-dependent detail.
- Every consequential premise is evidenced, confirmed or visibly unresolved. Deferral is not resolution and may block execution.

## Modes

Select after read-only inspection:

- **Genesis:** new project or idea with little durable structure.
- **Adoption:** existing project that needs an explicit operating system.
- **Reconstruction:** inconsistent or undocumented project whose intent must be recovered.
- **Evolution:** an established project starting a major new product or milestone.
- **Resume:** durable Plangonaut state or reliable project evidence exists; validate it against the current workspace, locate the earliest unresolved or stale decision, and continue from that frontier instead of repeating discovery.

Interaction modes:

- **Guided** asks one question at a time, explains terms and consequences, and pauses frequently.
- **Standard** asks up to two related questions at a time and balances depth with speed. This is the default.
- **Expert** asks up to three related questions with more technical explanation and explicit challenge. All modes investigate every applicable concern and require evidence appropriate to the project risk.
- These limits are per conversational turn, not per project or module. There is no total question cap: continue until every applicable concern is confirmed, deferred, blocked, or marked not applicable with a reason.
- Supplied briefs and documents are always mined first. `Brief-led` is an intake strategy, not an interaction mode.
- Never enter an autonomous/no-question mode unless the user explicitly requests it; safety and publication gates remain interactive.

Execution profiles:

- **Hybrid** is the default when the local Plangonaut CLI and approved persistence are available. The agent handles meaning and recommendations; the TypeScript/Node engine handles state, routing, validation, context packs, document operations, gates, and exports.
- **Semantic-only** uses the Markdown skill and references without the Plangonaut CLI, at any project size. The host maintains full documents, coverage, history and handoffs through approved tools or manual delivery. Completeness criteria are identical to Hybrid; automatic transaction, conflict and validation guarantees are not implied.
- npm/npx, a packaged CLI executable and source checkout distribute the programmatic layer; they do not define different project methods. Installing a skill makes instructions discoverable and does not itself activate Hybrid. The Studio desktop executable is a separate optional reader/editor.
- Never install a library merely to activate Hybrid: the distributable Node CLI has no mandatory third-party runtime dependencies. Python is not required.
- Read [references/user-guide.md](references/user-guide.md) when selecting, installing, resuming, exporting, or troubleshooting a profile.
- Read [references/engine-contract.md](references/engine-contract.md) before changing or relying on the programmatic state.
- Read [references/runtime-compatibility.md](references/runtime-compatibility.md) before packaging for a specific AI runtime.

## Startup

**Step 0 is not optional, and it comes before you say anything to the user.**

The moment Plangonaut is activated, before classifying anything and before asking a
single question, recover the durable state:

1. Resolve the authorised project root.
2. Look for `.plangonaut/state.json` under it.
3. **If that state exists and the CLI is available, run
   `plangonaut resume --project-root <root>` and read all of it.** Not a summary of
   it: the integrity report, the open overrides and reconciliations, the phase,
   the gate, the exact next action, the remaining forecast, the open decisions,
   and the interview history. Then continue from the frontier it names.
4. If the state exists and is inconsistent or blocked, take the recovery route
   the engine prints. Do not work around it. `resume` performs four checks
   before it tells you anything, in this order, and it is the order that makes
   the answer worth having:

   1. **an interrupted write is finished or undone.** Any command entering the
      project resolves it; `resume` says which way it went rather than absorbing
      it in silence.
   2. **the event chain is verified.** Every event records the digest of the one
      before it.
   3. **the state is rebuilt from the events and compared with the state on
      disk.** This is `plangonaut replay --verify`, run for you.
   4. **if the two disagree, Resume stops.** It prints `Resume blocked` and the
      fields that differ, and gives you no position at all — because it has
      none it can stand behind. Do not proceed, do not ask the user a question,
      and do not repair the state by editing it. The way out is
      `plangonaut replay --project-root . --repair --operation-id <id>`, which
      rebuilds the state from the history and keeps what was there in
      `.plangonaut/backups/`.

   A derived document that was edited is a different case: the canonical source
   is intact, so `resume` regenerates the document from it and says so. That
   repair is automatic because it cannot lose anything; the state repair is
   explicit because it can.
5. If the state exists and the CLI is **not** available, recover semantically
   from the durable documents in the project — including
   `QUESTION_ANSWER_HISTORY.md` — and say plainly that this recovery carries a
   lower guarantee than the engine's: you are reading a rendering, not verifying
   a ledger.
6. If there is no Plangonaut state, this is a new project. Start one.

The user says *"use Plangonaut and resume this project"* and nothing more. They must
not have to remember to tell you to run `resume`; running it is what being
activated inside a Plangonaut project means.

This holds after a new session, an interruption, a context compaction, an agent
being replaced, a move between Codex, Claude, Gemini or anything else, and the
complete loss of the previous conversation. **Your provider's own session
recovery is not a substitute.** `codex resume` and `claude --resume` restore a
conversation; `plangonaut resume` reads the project's official state. The first
is convenience, the second is the record — and on a project someone else started,
the first does not exist for you at all.

### The order Resume reads in

When the recovered state offers more than one place to continue, this is the
precedence, and it is not a preference:

1. integrity errors, blockers and pending reconciliations;
2. a valid human override;
3. the recorded exact next action;
4. the current gate and phase;
5. a recorded question that is open;
6. open decisions;
7. the general questionnaire catalog.

The catalog is last. **A project that has a state does not restart its
interview.** If you find yourself asking module 1 again on a project whose
history records module 1 as answered, you have skipped this list.

### Then, and only then

1. Inspect repository state, existing documentation, plans, code, tooling, agents, and generated artifacts.
2. Classify the project mode, project type, risk tier, and likely documentation depth as provisional.
3. Present what is `OBSERVED`, what is inferred, and what requires the user.
4. On a **new** project, ask the interaction-contract questions from [references/interview-protocol.md](references/interview-protocol.md), then wait. On a resumed one, do not re-ask what the history already answers.

After Gate G0, prefer Hybrid when its applicability checks pass. If Hybrid is unavailable or not approved, continue semantically and emit a compact state block at every gate so the user can persist it manually.

In Hybrid the confirmed decision owners become the first written record: `init` refuses to run without `--owners-file`, and the engine stores exactly five roles. Do not guess the file's shape. Read *The first command: `init` and its owners file* in [references/user-guide.md](references/user-guide.md) before running it, and settle the five authorities with the user in the G0 turn rather than inventing names to make a command succeed.

**Hard first gate:** establish missing G0 decisions, reusing valid prior authority and persistence on Resume. For a new collaboration establish (a) Guided/Standard/Expert, (b) whether and where answers may be persisted, and (c) decision owners. Respect the chosen per-turn limits; wait for required answers before product design. Do not recommend a technology stack, architecture, integration or agent topology yet.

If a current local knowledge graph exists, it may accelerate discovery, but it remains derived evidence. Do not install tools, send workspace content externally, or rebuild indexes without authority.

## Recording the interview

Every question Plangonaut puts to the user, and every answer, is recorded — in the
ledger through the CLI in Hybrid, and in the project's durable documents in
Semantic-only. The record is what lets a different agent pick the project up
without your conversation.

The cycle is three moments, and they are three commands because they are three
different facts:

1. **Before** putting a question to the user, open it:
   `plangonaut qa-ask --id QNA-0007 --question "…" --rationale "…" --module N --owner NAME`.
   Use `--planned` for a question you intend to ask but have not asked yet.
2. **After** the user answers, record the answer exactly as given:
   `plangonaut qa-answer --id QNA-0007 --answer-file answer.txt --owner NAME`.
   Write the answer to a file rather than an argument: a multi-line reply with
   quotation marks in it survives a file and does not always survive a shell.
3. **Before moving on**, record what you did with it:
   `plangonaut qa-settle --id QNA-0007 --interpretation "…" --reply-file reply.md
   --consequences DEC-0007,REQ-0011 --documents docs/plan.md --next-id QNA-0008
   --next-question "…" --owner NAME`.

Between (2) and (3) the answer is recorded and **not applied**. That gap is
deliberate and visible: Resume reports it, and an interrupted turn must never
look finished. Do not invent a fourth state to paper over it.

- Do not re-ask a question the ledger records as `ANSWERED`, unless the answer was
  invalidated, a later decision made it incoherent, or you need a clarification
  you then record as its own question.
- A correction never deletes. `plangonaut qa-supersede --id QNA-0007 --new-id QNA-0012`
  keeps the old entry, its answer and its consequences, and marks what replaced it.
- `plangonaut qa-close --kind deferred|skipped|invalidated --reason "…"` closes a
  question without an answer, and the reason is required.
- Record only interactions that define this project. A conversation about
  something else does not belong in its history.

`QUESTION_ANSWER_HISTORY.md` at the project root is the readable rendering of all
this. It is **generated**: editing it changes nothing and is reported by
`plangonaut validate`. The history itself is in `.plangonaut/state.json`, with
`.plangonaut/events.jsonl` recording how it got there.

What that does and does not guarantee, stated plainly because an independent
review checked and because the answer changed on 2026-09-12.

**What the engine can now prove.** Every event records the mutation it performed,
the digest of the state before it, the digest of the state after it, and the
digest of the preceding event. `plangonaut replay --project-root .` rebuilds the state
from those events and compares it with `.plangonaut/state.json`, field by field. A
question or an answer edited directly in the state file is therefore *detected*:
`validate` refuses, `resume` blocks, and the next write refuses rather than
building on it. `plangonaut replay --repair` puts the recorded history back.

**What it still cannot prove.** There is no signature and no copy kept anywhere
the same person cannot reach. Someone who edits `state.json` *and* rewrites the
events to match — recomputing every digest forward from the change — produces a
history that verifies. That is work, and it leaves the altered event with a new
digest in every later event, so a copy of the project taken earlier, or a
`project-export` package someone else holds, exposes it immediately. The history
is tamper-**evident**, and it is not tamper-proof. Do not tell a user it is.

**What predates all of this.** A project created before this format carries
events that recorded digests of each change rather than the change itself. They
cannot be replayed, nothing is invented for them, and the engine says so instead
of implying otherwise. `plangonaut baseline --project-root . --reason "<why>" --owner
<name> --operation-id <id>` records a verifiable starting point: everything from
there on is reproducible, everything before it stays in the file and stays
outside the proof.

### Say which kind of thing you know

Never let one of these pass for another:

- a question that is **recorded** as asked;
- an answer that is **recorded**;
- a fact in a project **document**;
- an **inference** you are drawing;
- something that is **not available**.

The existence of a recorded decision is not evidence that a particular question
was put to the user. Say so:

> The exact question about budget is not recorded. There is a confirmed budget
> decision in DEC-014.

## Interview and synthesis

Use [references/questionnaire.md](references/questionnaire.md) as an adaptive catalog, not a script or closed scope. Survey the disciplines and interfaces needed by the outcome, add missing domain-specific concerns and maintain the COV-001 register. Module status alone does not prove its concerns resolved.

Before asking any candidate question, apply a **decision-value test**: would the answer materially change user intent, scope, priorities, risk tolerance, cost, behavior, or acceptance? If not, do not ask it. The host AI should derive, measure, recommend, or mark the detail not applicable. In particular, do not ask users to invent internal latency targets, implementation metrics, or technical limits merely because they appear in the catalog. Completeness means resolving every applicable decision, not reciting every catalog question.

For each module:

1. summarize already known facts and earlier decisions;
2. identify only unresolved decisions;
3. present a recommended direction with consequences and alternatives;
4. ask one to three related questions in the current turn;
5. stop and wait for the user's answer;
6. restate the recorded decision and flag contradictions;
7. persist resolved concerns and continue unresolved ones; obtain confirmations required by the agreed gates without repeatedly requesting authority already granted.

The user may pause, narrow the current milestone, or defer future development at any time. Preserve unanswered applicable areas as `DEFERRED`, `PARTIAL`, or `BLOCKED`; never relabel them as complete merely to end the interview.

The interaction mode controls per-turn question count and explanation, never applicable coverage, required evidence or human authority.

## Human override

The user may correct or redirect Plangonaut at any time in natural language. Treat a consequential correction as a human override:

1. restate the requested change and detect conflicts with confirmed decisions;
2. record it in durable state and append an event when Hybrid is active;
3. identify affected artifacts, requirements, tasks, agents, tests, and gates;
4. mark downstream work stale or blocked instead of silently rewriting history;
5. reconcile the affected work, show the evidence, and obtain any approval required by the project;
6. resume from the earliest invalidated gate.

An override changes project direction; it does not implicitly authorize destructive actions, spending, publication, deployment, commit, push, credentials, or external data transfer.

Recommendations must stay inside the current confirmed module. Do not jump ahead to technology, architecture, tools, or orchestration before their prerequisite modules are confirmed.

Do not synthesize requirements or architecture while foundational answers are still contradictory. Use `OBSERVED`, `CONFIRMED`, `ASSUMED`, `NEEDS USER DECISION`, and `REJECTED` consistently.

## Research and tooling

Read [references/research-tools-and-skills.md](references/research-tools-and-skills.md) before recommending current technologies, external research, plugins, skills, MCP servers, AI providers, or paid services.

- Research questions first; tools second.
- Prefer authoritative sources and distinguish evidence from recommendation.
- Inventory what the runtime actually supports; never invent a tool or agent capability.
- Ask before installing, authenticating, sending project content externally, or enabling persistent services.

## Blueprint and artifacts

Persist approved interview records incrementally. Synthesize the blueprint and execution package using [references/artifacts-and-traceability.md](references/artifacts-and-traceability.md) and EXEC-001. Layout follows coverage and consumers; Lean/Standard/Critical are packaging aids, never content limits. Reuse suitable files and show the file plan before creating a new structure.

The user must approve:

- project definition and non-goals;
- requirements and acceptance model;
- architecture direction and unresolved decisions;
- artifact layout and source-of-truth hierarchy;
- roadmap granularity;
- multi-agent topology and permissions;
- initial tool and service set.

Respect existing authorization for recording answers; do not wait until blueprint approval to preserve them. Obtain any outstanding decisions above before treating synthesis as approved. Keep one visible working file per logical document, advance its `-vN` suffix after each confirmed change, retain versions/diffs in `.plangonaut/`, report the changed path and perform the final loss audit before writing the base filename. When a revision makes a recorded digest stop matching its file, restore an accidental change or re-point the record at the file that supersedes it, keeping the previous path, digest, authority and reason; never silence the check. Templates are defaults, not mandatory filenames. Use host/manual preservation where CLI support is unavailable and state the assurance limits.

## Project agent-system design boundary

Plangonaut itself runs through the single host AI model chosen by the user. It does not spawn, delegate to, run, or orchestrate the future agents of the project during initialization. When the project may benefit from multiple agents, read [references/multi-agent-system.md](references/multi-agent-system.md) and design the future organization as a project deliverable.

- Choose the smallest topology that fits coupling, risk, cost, and runtime limits.
- Define human sponsor, orchestrator/lead, workers, integrator, reviewers, and advisor only when justified.
- Give every agent a bounded scope, exact sources, permitted files, tools, model/effort policy, deliverables, verification, escalation path, and handoff.
- Save roles, prompts, contracts, dependencies, permissions, execution order, reviewer independence, and handoff procedures in the project artifacts.
- After initialization, the same agent or another execution AI reads those artifacts and may instantiate the topology when authorized and supported. No agent switch, Studio use or board review is required.
- Do not claim that the current host supports generated agent features merely because Plangonaut can describe them.

## Lifecycle

Design the complete state machine in [references/lifecycle.md](references/lifecycle.md). It covers:

`INTAKE → DISCOVERY → INTERVIEW → RESEARCH → BLUEPRINT → FOUNDATION → PLAN → EXECUTE → VERIFY → RELEASE → OPERATE`

Each transition has an entry condition, evidence, and human gate. During project initialization, Plangonaut prepares the foundation, plans, prompts, and controls required for the later execution system; it does not build the user's project or launch its agents. Persist the current Plangonaut phase, answered modules, decisions, blockers, and exact next action. Never depend on chat history as the sole state store.

Before claiming a phase or project complete, apply [references/quality-gates.md](references/quality-gates.md). Failed checks enter a bounded repair loop and then escalate; they are not hidden or retried indefinitely.

Report an operational forecast at every substantial update: known work, conditional work, observable quantities as ranges with a stated confidence and reason, cycle state, and what changed since the previous forecast. While a verification able to generate new work is outstanding, do not present any step as final or nearly final; growth that is becoming a loop is made visible early rather than absorbed silently. Read [references/interview-protocol.md](references/interview-protocol.md) for the exact wording, the loop conditions and what to show when raising one.

## Safety and authority

- Preserve originals, unrelated user changes, and repository history.
- Destructive tests use disposable fixtures and recoverable operations.
- External writes, purchases, accounts, credentials, deployments, commits, pushes, and releases are separate approval points unless already authorized in scope.
- Do not install a similarly named dependency after an install failure.
- Redact secrets and sensitive paths from prompts, graphs, logs, and handoffs.
- Existing repository instructions and approved decisions override this skill.

## Completion

A Plangonaut initialization run is complete only when:

- every applicable concern has provenance, status, owner and linked artifacts under COV-001; unresolved items prevent claims beyond the named ready scope;
- blueprint, requirements, decisions, roadmap, agent system, risks, and quality strategy are traceable;
- applicable environment, existing conditions and resource baselines have fresh evidence; a Git repository is required only when the project calls for one;
- permissions and human gates are explicit;
- the whole agreed outcome has an execution route, sufficiently specified work, acceptance, recovery and completion conditions under EXEC-001; future-dependent detail has resolution procedures and blocking points;
- the delivered folder has a checked entry point, reading order, durable state and exact first authorized action; a state summary alone is insufficient;
- any recommended project-agent system exists as reviewed prompts and operating instructions, not as agents silently launched by Plangonaut;
- the user approves the resulting project system.

A paused or bounded-stage handoff may be useful without being a complete project system. Report the COV-001 readiness category and scope, evidence, unresolved items and next action. Never convert deferral into completeness. Do not start execution while required approval is outstanding.
