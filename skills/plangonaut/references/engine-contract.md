# Plangonaut Engine Contract

The CLI supplies deterministic mechanics for the same semantic method. The host AI interprets meaning, investigates and writes the project; humans retain consequential authority. Installing a CLI does not supply a reasoning model.

## Runtime and storage

The canonical CLI is TypeScript/Node without mandatory third-party runtime dependencies. Node 24 is the release target; other versions/platforms require compatibility evidence. Python is not required. A verified standalone CLI packages programmatic functionality; the optional Studio executable is separate.

Markdown remains descriptive truth. State JSON is operational state and JSONL logical history. Read-only inspection must not create state. No automatic migration, service, model call or installation is implied.

## Audited alpha command surface

Use `plangonaut help` or `node lib/bin/plangonaut.js help` from a built checkout. Check actual installed capabilities; command presence does not establish full contract enforcement.

| Commands | Purpose |
|---|---|
| capabilities, status, next, resume, validate | Inspect state, active module and supported integrity checks |
| qa-ask, qa-answer, qa-settle | Open a question, record the answer verbatim, record what the answer changed |
| qa-close, qa-supersede, qa-log | Defer, skip or invalidate a question; replace one without erasing it; read or regenerate the history |
| init, record, override, reconcile, gate | Persist approved module outcomes, corrections and gate records |
| re-record | Re-point the source of an override or the evidence of a gate at the file that supersedes it |
| blocker-record, blocker-resolve, blocker-verify-none | Record a blocker, close one without erasing it, and record that somebody looked and found none open |
| decision, requirement, task, dependency, risk, evidence, agent, checkpoint | Create or revision-check updates to typed ledgers |
| context-pack | Produce restart context and evidence pointers |
| doc-diff, doc-save, doc-history, doc-restore, doc-finalize | Preview and apply governed document revisions and history |
| migrate | Explicit supported schema transition |
| project-export, project-verify, project-import | Create, verify and resume a digest-checked project handoff |
| install, verify-install | Host skill installation and content-drift checking |
| export | Portable Markdown/adapters, not the user project dossier |

## The blocker ledger (ALN-015)

`state.blockers` existed from the beginning, was read by `resume`, the forecast, the gate and
Studio, and **no command wrote it**. So an empty array meant "this project has no blockers" and
"nobody in this system can record one" at the same time, and `status` could only answer `UNKNOWN`.
Three commands write it now.

```
blocker-record --project-root . --id BLK-ID --title TEXT --reason TEXT --owner NAME
               [--evidence-file FILE] [--expected-revision N] --operation-id ID
blocker-resolve --project-root . --id BLK-ID --resolution TEXT --owner NAME
               --expected-revision N [--evidence-file FILE] --operation-id ID
blocker-verify-none --project-root . --owner NAME [--note TEXT] --operation-id ID
```

They are hyphenated rather than `blocker record` because the parser takes the first argument as the
whole command name and everything after it as options; every multi-word command already here is
hyphenated for the same reason.

A record carries `id` (`BLK-` prefixed), `title`, `reason`, `status` (`OPEN` or `RESOLVED`),
`owner`, `recorded_at`, an optional `evidence` pointer with its digest, `revision` and `updated_at`;
a resolved one also carries `resolution`, `resolved_by` and `resolved_at`. Every mutation takes
`--operation-id`, is idempotent under a retry of the same id, takes the project lock and writes one
event: `BLOCKER_RECORDED`, `BLOCKER_UPDATED`, `BLOCKER_RESOLVED`, `BLOCKERS_VERIFIED_NONE`. Touching
an existing record needs `--expected-revision`, as every other ledger does.

**Resolving keeps the record.** It gains how it ended and stops being counted; it is not removed.
A blocker that happened and was cleared is part of how the project went, and `resume` and the
context pack still list it, marked as resolved.

### The four answers, and why the third one is not the second

| `blockers_assurance` | When |
|---|---|
| `RECORDED` | at least one entry is open |
| `NONE_VERIFIED` | nothing is open **and** somebody recorded that they looked |
| `UNKNOWN` | nothing is open and nobody has said so |
| `UNTRUSTED` | the state does not agree with its history — see the error kinds below |

`status --json` also carries `open_blockers` and `blockers_verified_none`.

**Resolving the last blocker does not verify that none is open.** It is a statement about one
blocker; "there are none" is a statement about the project, and somebody has to make it. So any
blocker mutation clears the verification, and the path is `UNKNOWN → RECORDED → UNKNOWN`, with
`NONE_VERIFIED` only after `blocker-verify-none`. A ledger that slid from the first to the second
would be the empty array again under a better name. `verify-none` is refused while anything is open,
and names what is.

### Projects written before this ledger

Their `blockers` hold plain strings. **They stay strings.** They are valid, they are counted as
**open** — a blocker whose status was never recorded has not been recorded as resolved, and they
hold `verify-none` shut for that reason — and they are never rewritten into records, because that
would mean inventing the owner, the date and the status they never had. `resume` says so where it
prints them. They have no id, so they cannot be resolved by one; the refusal says to record the
blocker properly first, so that closing it leaves a trace. Reading is explicit and lossless in both
shapes and `migrate` converts nothing.

## Machine-readable refusals (ALN-016)

A folder with no Plangonaut project and a Plangonaut project whose records disagree were both exit 2 with an
English sentence. They call for opposite responses — offer to set one up, or offer to repair and
read nothing in it as fact — so a caller had to match the prose to tell them apart.

**On a command whose output is JSON**, a refusal is a JSON document on stdout:

```json
{
  "ok": false,
  "error": {
    "kind": "NOT_PLANGONAUT_PROJECT",
    "message": "…",
    "command": "status"
  }
}
```

`status` is always such a command; any other is when it is given `--json`. **Nothing else goes to
either stream in that mode** — not even the usual `PLANGONAUT ERROR:` line on stderr — because a caller
that merges the two must still be handed one parseable document. A human command is untouched: the
sentence, on stderr, exactly as before.

| `error.kind` | Means | What a caller should do |
|---|---|---|
| `NOT_PLANGONAUT_PROJECT` | there is no Plangonaut project at the root that was asked about | offering to initialise one is safe |
| `PROJECT_STATE_UNTRUSTED` | there is one, and its state, schema, events or replay do not agree | offer to repair; read nothing in it as fact; **never** offer to initialise |
| `COMMAND_FAILED` | anything else — a bad option, a stale revision, a refused precondition | the project is fine; the call was not |

A `PROJECT_STATE_UNTRUSTED` document also carries `blockers_assurance: "UNTRUSTED"` at the top
level. That is the fourth value of the vocabulary above, and it was unreachable until now: the one
command that could report it refused such a project outright.

**Three kinds, and the set is small on purpose.** Adding a fourth is a contract change. A caller
should switch on the three and treat anything it does not recognise as `COMMAND_FAILED`, so that it
keeps working when one is added.

The exit code stays **2**. `kind` is the new information; renumbering the exits would break every
caller that already handles the old ones to carry a distinction this field already carries. **The
`message` is for people** — it is not stable, it is not a contract, and a caller that parses it is a
caller this change did not help.

`init` is the first command that writes, and the only one whose input is a file the caller must author: `--owners-file`, naming the five decision authorities the engine stores. Its format, a complete example and the three refusals are in *The first command: `init` and its owners file* in [user-guide.md](user-guide.md); they are not repeated here.

Browser Studio and app/launch are retired. Native Studio document governance uses shared conformance requirements without running the CLI.

## Required checks versus current limits

The target validates fields/IDs, references, dependencies, declared gate prerequisites, evidence presence, revisions, operation identity and recovery. It never decides whether prose fully captures intent or grants approval for a human.

The audited alpha validates typed ledger items, unique IDs, required ownership/revisions, evidence hashes, dependency references and cycles, state/event alignment and declared structural gate prerequisites. It rejects stale ledger revisions without writing. A successful validate/gate command still does not establish COV-001 or EXEC-001 semantic readiness; the host AI and human reviewers decide whether the evidence is adequate.

Every project-state mutation requires a caller-supplied `--operation-id`. Reusing it for the **same operation** is a no-op; reusing it for a different one is refused, and the refusal says what the id already recorded.

*Same operation* is decided by a canonical, versioned digest of the input: the command and its options sorted by name, so the order you type them in does not matter; `--project-root` left out, so `.` and the full path are the same project; `--output-dir` and `--package-dir` resolved to one spelling; and every `--*-file` option digested by **the content of the file**. That last one matters in both directions — the same file under two names is one operation, and the same name holding different text is two, where it used to be silently accepted as a repeat. Lists inside a single value keep their order. Records written by an earlier engine are recognised by the earlier rule, so nothing already in a project stops working. Document operations preserve supported revisions, history and disk-hash checks. `doc-diff` returns a reviewable line diff and a confirmation token bound to the artifact, path, owner, current revision/hash and proposed hash. `doc-save` requires that token. Expected revision/hash inputs remain available for explicit optimistic-concurrency checks, and Studio passes its preview values into Rust. Both implementations validate the complete known state before filesystem mutation and use a recovery journal to roll back an interrupted multi-file operation on the next load. `doc-mark-deletion` records the approved target, reason digest, source revision/hash and candidate-content hash; only a matching save consumes and links it once. The semantic comparison of full genealogy against confirmed decisions remains host-AI work supported by those records. Report this boundary. Never edit governed ledgers directly to bypass APIs.

`project-export` includes every governed current document, published base document, state and available evidence/module files, and a **portable replay origin** in place of the exporting project's event log. The log recorded that project's absolute path on the machine that made it — the user's name, the drive, the folder layout — and a handoff does not carry the machine that made it. So the package holds one event: the moment it was made, carrying the whole state, with the recorded root replaced by `<packaged>`. It also records the digest, the length and the last event id of the history it was made from, so the two can be matched later without either being disclosed. The exporting project is untouched and keeps its full history. What the recipient gets is complete as a *project* — every decision, requirement, risk, question, answer and document — and is explicitly not the exporter's event-by-event log, which is attested by digest and not reproduced. Its manifest pins allowed namespaces, byte counts, SHA-256 digests, entrypoint and embedded state metadata. `project-verify` refuses missing, duplicate, changed or unexpected content — *unexpected* meaning a file on disk the manifest does not declare, wherever in the package it sits, which it walks the directory to find. It also refuses a directory carrying a staging marker that names somewhere else: that is an export nobody finished, and a package is not a thing you can be handed halfway. `project-import` stages and validates the whole package before promoting it into a new or empty directory, rewrites the recorded root, appends an import event and validates Resume. Import does not imply that the source project's semantic readiness was approved.

COV-001 concern fields and readiness categories are semantic records, not implemented schema extensions. Keep them in indexed Markdown until a compatible engine exists. Module IDs 0–16 aggregate progress and cannot limit discovery.

## Recorded sources and their re-verification

A recorded digest is a claim that a named file still says what the record was made from. `validate` re-hashes the claims it can prove something about: typed evidence items and governed documents inside the standard checks, and separately `modules[].evidence`, `human_overrides[].source` and `gates[].evidence`. Gate evidence was the one nothing re-read until ALN-008: a project could answer `Plangonaut state is valid.` for a whole interview while the file a gate was PASSED on had been deleted or rewritten. A gate is the record that says a phase may end, so its evidence is the last thing that may quietly disappear.

These checks belong to `validate` and deliberately not to the check that runs on every mutation. Drift of this kind is expected whenever a governed evidence document advances to a new `-vN`, and refusing every later operation over it would make a working project unusable. Drift blocks `validate`; it does not block recording a decision, a task or a gate.

**What is checked and what is skipped.** Only the live record in `state.json` is read, and only when it carries both a path and a 64-hex digest. A gate written before the record kept its evidence claims nothing, so nothing is refused, and no digest is ever reconstructed from the `GATE_UPDATED` events: an event records what was true when it was written, and re-checking it would turn every wanted later revision of an evidence document into a failure. The skip is reported rather than silent. After `Plangonaut state is valid.`, a project holding such gates also prints:

> `N of M gate record(s) carry no evidence digest, so validate re-verified nothing for them: <names>. They were recorded before the gate record kept its evidence; failing them would report a drift nobody can prove. Attach the file the gate was passed on with: plangonaut re-record --project-root . --kind gate --id <gate> --source-file <file> --owner <owner> --reason "<why>" --operation-id <id>`

Read that as an open item, not as a pass: those gates rest on evidence nothing has looked at since. Attaching the file with `re-record --kind gate` ends the gap, and from then on the gate is held to its evidence like any other.

The two refusals, verbatim, so they are recognisable before they are met:

> `<record> records evidence at <path>, which is missing or escapes the project root. Restore the file, or point the record at the file that stands in its place: <remedy>`

> `<record> recorded <path> with a digest that no longer matches the file. Re-record it against the current file, or restore the recorded content. To re-record: <remedy>`

The remedy named for a module is `plangonaut record --answer-file` — a module answer is recorded again, not re-recorded. For an override and for a gate it is `re-record`.

## Re-recording a governed source

`re-record --project-root . --kind override|gate --id OVR-ID|G2 --source-file FILE --owner NAME --reason TEXT --operation-id ID` re-points what an existing record stands on at the file that supersedes it. `--kind override` moves an override's `source` and `source_sha256`; an override may legitimately point inside `.plangonaut/`. `--kind gate` moves a gate's `evidence` and `evidence_sha256` under the containment rule `gate` already enforces: an existing, non-empty file inside the project and outside the reserved `.plangonaut` directory.

It changes provenance and only provenance. It cannot pass, reopen or re-authorise anything, does not move the lifecycle, and does not clear `needs_reconciliation`. It is deliberately permitted while the project is blocked on the very override whose source drifted, because otherwise the block would be the thing preventing its own removal. No stored digest is ever edited: the new one is computed from the file's bytes.

What it preserves: the previous path and digest, the owner, the reason and the event id are appended to `source_history` on the record and written to a `RECORDED_SOURCE_UPDATED` event carrying the same values and the new state revision. When there was nothing to supersede — a gate that never recorded a digest — the history entry stores `null` for path and digest, because "nothing was claimed" and "the previous digest matched" must never look alike.

It refuses a `--kind` other than `override` or `gate`, an unknown record, an empty `--reason`, an owner who is not a confirmed decision owner, a source outside the project, and a re-record that would change nothing (`<record> already records <path> at that digest. There is nothing to re-record; no changes written.`). A refused re-record writes no event and leaves no history entry. Idempotency is the same as every other mutation: an identical retry under the same `--operation-id` prints `Idempotent retry: re-record already applied.`, and the same id with different input is refused.

## Recorded progress forecast

The forecast the agent states in conversation ([interview-protocol.md](interview-protocol.md)) has a recorded counterpart so a fresh agent reads it instead of the chat. The contracted surface is `forecast --project-root . --owner NAME --phase TEXT --known-work TEXT --conditional-work TEXT --questions MIN-MAX --operations MIN-MAX --cycles MIN-MAX --confidence ALTA|MEDIA|BASSA --confidence-reason TEXT --cycle-state REGOLARE|IN_ESPANSIONE|RISCHIO_LOOP|BLOCCATO`, with `--change-reason` required once a previous forecast exists, and `forecast --project-root .` alone reading the current one instead of writing a new one. Check `plangonaut help` and `capabilities` for the installed surface before relying on it; the semantic protocol does not depend on it and never waits for it.

What the engine owns: a typed current forecast and an ordered history of the previous ones, each carrying phase, known work, conditional work, the ranges for questions, operations and cycles, confidence and its reason, cycle state, the reason it changed, who recorded it, when, and at which state revision, under the event `PROGRESS_FORECAST_RECORDED`. A single number is stored as a range whose ends are equal and means the quantity is known, not that it was guessed precisely. **No percentage is stored anywhere.** Counts the ledgers already hold — open blockers, open overrides, tasks by status, gates remaining, unresolved modules — are derived by the engine, so the caller describes the work and does not retype what can be counted.

What the engine can derive, and returns beside the forecast, is limited to what recorded history shows: the residual growing across two consecutive forecasts without a phase closing; two consecutive forecasts carrying the same phase and a wider range; the same defect family reopening after two correction cycles; operations recorded without a blocker or finding count falling. It never overwrites the cycle state the caller recorded — a derived signal that contradicts it is recorded beside it and said on stdout, because silently correcting a person's judgement and silently accepting a wrong one are both wrong. Conditions about the conversation rather than the ledger are outside its reach and stay the agent's; they are in [interview-protocol.md](interview-protocol.md).

Where it surfaces: `resume` with its provenance, `context-pack` with the last history entries, `status` in compact form, Studio as a discreet summary and a timeline of recorded values only. A project that never recorded a forecast says so and names the command that records one; it never shows a zero, a default or an empty range that reads like a measurement.

## Durable state, and what can be rebuilt from what

Four different things live under `.plangonaut/`, and confusing any two of them is how
a recovery goes wrong.

| | What it is | Who writes it | What happens if it is lost |
|---|---|---|---|
| `state.json` | The **canonical current state**. Every command loads it; `validate` checks it. | Only `commitState`, inside a transaction. | Rebuilt from the events by `plangonaut replay --repair`, back to the last replay origin. |
| `events.jsonl` | The **append-only history**. Each event carries the mutation it performed, the digest of the state before and after it, and the digest of the event before it. | Only `commitState`, inside the same transaction. | Not rebuildable. It is the thing everything else is checked against. |
| `transactions/` | The **journal** of an operation in flight. Deleted the moment the operation finishes. | Every mutating command. | An operation interrupted with no journal cannot be resolved automatically; the engine says so and stops rather than guessing. |
| `backups/` | Copies of what a file said before it was replaced. | `atomicWrite`, and `replay --repair` / `baseline` explicitly. | Nothing current depends on them; they exist so a repair never means a loss. |

`QUESTION_ANSWER_HISTORY.md` and every other derived document sit outside that
table on purpose: they are a pure function of the state, they are regenerated
rather than repaired, and nothing reads them back.

### Replay

`plangonaut replay --project-root .` rebuilds the state from the events and compares
it with the state on disk. It is deterministic: it reads `events.jsonl` and
nothing else — no clock, no other file, and no field copied across from
`state.json`, which is the failure this mechanism exists to avoid rather than to
imitate. Running it twice produces the same answer, and it writes nothing.

It refuses, naming the line, on: a line that is not JSON, a duplicated event, a
break in the chain of digests, an event whose recorded predecessor revision does
not follow, a revision that does not advance, a patch that does not apply, and a
patch that applies but does not reproduce the digest the event recorded. Each of
those is a history that was edited outside Plangonaut -- or, in the case of a revision
that stands still, one written by two processes at once, which is what the
project lock exists to make impossible.

**Where a replay starts.** At the most recent event marked as a replay origin,
which is one of three:

- `PROJECT_INITIALIZED` — a project created by this engine is reproducible from
  its first minute;
- `PROJECT_PACKAGE_IMPORTED` — a delivered folder is reproducible from the moment
  it came into existence. The exporter's own history travels with it, is
  readable, and is outside the proof: the import rewrites the recorded root, a
  change to the copy that no event in that file describes;
- `BASELINE_RECORDED` — written by `plangonaut baseline`, for a project whose earlier
  events predate the format.

Everything before the origin stays in the file, unchanged and unreinterpreted,
and `replay`, `validate` and `resume` all say how many events that is. Nothing is
reconstructed for them.

**Repair.** `plangonaut replay --repair --operation-id <id>` copies `state.json` and
`events.jsonl` into `.plangonaut/backups/` first, puts the rebuilt state back, records
the repair as an event, and regenerates the derived documents. It refuses to run
when there is nothing to repair, and a retry with the same operation id applies
once. It is deliberately explicit: a state somebody edited on purpose is not
overwritten by a command nobody asked for.

### Writes that survive an interruption

`atomicWrite` makes one file replacement atomic. It never made a *mutation*
atomic: an operation touches a document, a history entry, the event log, the
state and a derived view, and a sequence of atomic renames is still a sequence.

Every mutating command now runs inside a journal under
`.plangonaut/transactions/<event id>/`, which records the command, the operation id,
the revisions, every file it is about to change with the digest each had, and a
phase. The phases are `PREPARED`, `COMMITTING`, `COMMITTED` — three, because
three is how many the engine writes. A fourth was declared here and never set;
an independent review ran all eight fault points and saw only these.

The **point of no return is the move to `COMMITTING`**, which happens after the
operation has been validated and after its exact result has been staged in the
journal — the new state, and the line to append to the event log. Before it, an
interruption is undone from the backups the journal took. After it, the operation
is *completed* from the staged content: the result was already decided and
written down, and completing it is the only outcome that cannot lose it.
Rolling back would be a decision to discard validated work; rolling forward is a
decision to finish it.

Recovery runs on the way into **any** command that reads or writes the project,
so it is never something a user has to remember — including before a command
decides whether it is a retry, which is where the same review found it was not:
seventeen commands asked "has this already happened?" against a history the
project had not yet caught up with, and a retry after an interrupted write
reported success over a state `replay` called diverged in the same second.
`plangonaut replay --verify` is the one exception and says so out loud: it reports a
pending operation rather than resolving it, because a command that reports must
not be the command that alters. It leaves a receipt under
`.plangonaut/recovery/` saying which way it went, and it says so on stderr rather than
passing in silence. `plangonaut recover --project-root .` reports what is outstanding
and changes nothing; `--apply` carries it out. A journal that passed the point of
no return with nothing staged is the one case the engine will not resolve: it
stops, names the directory, and changes nothing.

### Damage that is not an interrupted write

Three cases, and none of them guesses.

- **`.plangonaut/state.json` is missing and the history is intact.** Every command
  says so and names `plangonaut replay --repair`, which rebuilds it. This is what the
  replay is *for*, and it was the one case it could not handle until a review
  deleted the file and asked.
- **The last line of `events.jsonl` was cut off mid-write.** `plangonaut recover`
  reports it and `--apply` removes it, after copying the whole file into
  `.plangonaut/backups/`. An append is the last durable write of an operation, so a
  partial final line cannot be a completed one: dropping it can only discard an
  operation that never finished. A malformed line with complete lines after it is
  damage nobody can undo and stays a refusal.
- **A journal that cannot be read, or a directory with no journal.** Both are
  named by `plangonaut recover` and neither is resolved automatically. The first stops
  every command with a sentence instead of a raw JSON error; the second used to
  be skipped for ever while `recover` said everything had finished.

**The limit, stated rather than implied.** Node offers no portable way to flush a
*directory* entry, so on a power loss the operating system may lose the rename of
a file whose contents were flushed. The journal survives that — it is written and
flushed before anything moves, and recovery re-applies from it — but Plangonaut cannot
claim the stronger guarantee a database with its own storage layer makes.

### One project, one writer

`.plangonaut/lock.json` is created with an exclusive filesystem create, so which of two
processes wins is decided by the filesystem rather than by a check in either of
them. It is taken before recovery, before the idempotency question, before the
revision is read and before anything is written, and it carries the PID, the
host, the command, the operation id and the revision its holder observed.

A second process waits, briefly, and is then told what it is waiting behind. A
lock left by a process on this host that is gone is taken over, and the takeover
is recorded. A lock held by a **live** process is never taken — not by waiting,
not by `--force`.

A lock this engine cannot reason about is never taken either, and `--force` does
not change that: one whose file will not parse, one whose `pid` is not a process
id, and one that does not say which machine holds it. Liveness has three answers,
not two, and *unknown* is not *dead* — one independent review demonstrated the
cost of folding them together by having `--force` take a lock from a running
process, and a second did it again through a record with no `host` field, where
"not this machine" was being read as "another machine". In those cases `plangonaut
unlock` says which one you are looking at and tells you to make sure no Plangonaut
command is running and delete the file yourself.

`--force` releases exactly two: a lock whose process is known to be gone, and a
lock that names **another machine**. The second is deliberate — this engine
cannot ask a host it cannot see whether a process is alive, and a lock left on a
shared folder by a laptop that is not coming back has to be breakable by
somebody. It is the one case where `--force` acts on a judgement Plangonaut cannot
make for you.

A lock read in the microsecond between its creation and its content is not an
unreadable lock: the read is patient, briefly, before it says so.

`plangonaut replay --verify` is deliberately outside the lock: it never recovers and
never writes, so it reports a pending operation instead of waiting for one.

## The interview ledger

Questions and answers are recorded in `state.interview_log[]` like every other
fact the engine holds, appended to `.plangonaut/events.jsonl`, and rendered as
`QUESTION_ANSWER_HISTORY.md` at the project root.

**One canonical source.** The ledger is the record. The document is a pure
function of the state — regenerating it twice produces the same bytes — and the
engine never reads it back. Its digest is recorded in `state.interview_view`, so
a hand edit is detected by `plangonaut validate` and repaired by
`plangonaut qa-log --regenerate`. Resume reports the divergence and continues from the
ledger, because the ledger is what it is for.

**Three commands for three moments.** `qa-ask` opens a question, `qa-answer`
records the answer, `qa-settle` records the interpretation, the reply, the
records and documents it changed, and the question that follows. Between the
second and the third the entry is `ANSWERED` with `consequences_recorded_at`
still null: the answer exists and has not been applied. That is a state Resume
must be able to see, which is why "applied" is a timestamp written by the command
that applies, not a word a caller can set.

`qa-settle` opens the next question inside the same transaction when
`--next-id` names one that does not exist yet. Recording the proposal and opening
the entry separately would leave a pointer to nothing if the turn were
interrupted between them.

**Nothing is deleted.** `qa-supersede` marks the old entry `SUPERSEDED`, points it
at its replacement and leaves its question, its answer and its consequences where
they are. `qa-close --kind deferred|skipped|invalidated` requires a reason.

**Nothing is invented.** An entry carries `reconstructed: true` only when it was
rebuilt from durable evidence. A project that predates the ledger has no
`interview_log` at all, which is a different fact from an empty one: absent means
nothing was recorded, empty means recording is on and nothing has been asked.
`plangonaut migrate` opens the ledger on such a project and records the instant from
which the history exists; it reconstructs nothing.

## Resume and overrides

Resume emits current position, module, blockers, evidence pointers and next action after supported checks. Read the actual canonical sources. Context packs do not replace the complete documents, work definitions or role contracts.

Resume also emits the interview history: the last completed interaction, a
question asked and still unanswered, an answer recorded and not yet applied, the
next question, the module, the documents the last answer changed, and any
conflict between the history and the project. When a question is `ASKED` with no
answer, Resume restates its context and does not pretend it was answered. When an
answer exists and its consequences do not, Resume settles that transaction before
anything new is asked.

Overrides record changed intent and require semantic reconciliation. Reconciliation evidence must describe work actually performed, not merely be an arbitrary file. Preserve superseded decisions, affected work and authority. The same agent may continue or a new one may resume.

State/event divergence and unsupported versions remain visible. Back up before explicit migration or recovery. Structural checks, semantic review and actual execution establish distinct kinds of evidence.
