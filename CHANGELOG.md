# Changelog

## 0.3.0-alpha.2

- Correct the public npm README and installation instructions after the first Plangonaut package was published with stale pre-rename release wording.
- Keep the programmatic and semantic installation paths explicit: `plangonaut@alpha` installs the CLI; `plangonaut install` installs the skill into a chosen project and host.

## 0.3.0-alpha.1

**Beave was renamed to Plangonaut.** The product, the command, the skill and the project state
directory all carry the new name from this version on. Entries below this one describe releases made
under the earlier name and are preserved as written.

### The command

`plangonaut` replaces `beave`. The published `@beavelab/beave` package is untouched and keeps its own
command, so the two can sit side by side while you move:

```
npm uninstall -g @beavelab/beave
npm install -g plangonaut
```

### Project state

New projects use `.plangonaut/`. A project created before this version keeps `.beave/` and is read,
validated and resumed without being migrated — `status` reports `state_format: "legacy"` so a caller
knows which it is looking at. Opening a legacy project never creates `.plangonaut/`.

A project holding **both** directories is refused as `PROJECT_STATE_AMBIGUOUS`: the engine will not
guess which one is the project, because writing into the wrong one loses the other quietly.

### Migrating

```
plangonaut migrate-brand --project-root . --dry-run
plangonaut migrate-brand --project-root .
plangonaut migrate-brand --project-root . --rollback <migration-id>
```

The migration validates the source, stages the new ledger in a directory that is deliberately *not*
`.plangonaut/`, verifies it, swaps, and removes `.beave/` only once its bytes are provably inside
`.plangonaut/migrations/<id>/legacy-backup/`. A receipt records every digest. **A migrated project has
exactly one state directory**, and so does a rolled-back one. An interrupted migration reports
`MIGRATION_INCOMPLETE` with the phase it stopped at, and is never readable as an ordinary project.

### Machine codes and environment variables

`NOT_BEAVE_PROJECT` is now `NOT_PLANGONAUT_PROJECT`, and `PROJECT_STATE_AMBIGUOUS` and
`MIGRATION_INCOMPLETE` join the vocabulary. The old code is still understood on input. Every
`BEAVE_*` environment variable has a `PLANGONAUT_*` spelling; the old one still works and says so
once, the new one wins when both are set to the same value, and the two set to **different** values is
refused rather than guessed.

## 0.2.0-alpha.4

### Added — a blocker ledger something can write (`ALN-015`)

`state.blockers` existed from the first alpha, was read by `resume`, the forecast, the gate and
Studio, and **no command wrote it**. An empty array therefore meant "this project has no blockers"
and "nobody in this system can record one" at the same time, and the only honest answer `status`
could give was `UNKNOWN`.

`blocker-record`, `blocker-resolve` and `blocker-verify-none` write it. Each takes `--operation-id`,
is idempotent under a retry, takes the project lock, honours `--expected-revision` on an existing
record and writes its own event, so the ledger replays with everything else.

**Resolving keeps the record.** It gains `resolution`, `resolved_by` and `resolved_at`, stops being
counted, and stays visible in `resume` and the context pack.

**And resolving the last blocker is not the same as verifying that none is open.** One is a statement
about a blocker, the other about the project, and only a person can make the second — so any blocker
mutation clears a previous verification and the answer returns to `UNKNOWN`. `NONE_VERIFIED` is
reachable only through `blocker-verify-none`, which is refused while anything is open and names what.
`status --json` gains `open_blockers` and `blockers_verified_none`.

**Projects from earlier alphas keep their free-text blockers.** They stay strings, they are counted
as open — nothing ever recorded them as resolved — and nothing invents an owner or a date for them.
`migrate` converts none of them.

### Added — refusals a program can branch on (`ALN-016`)

A folder with no Beave project and a Beave project whose records disagree were both exit 2 with an
English sentence on stderr, and they call for opposite responses: offer to set one up, or offer to
repair and read nothing as fact. Telling them apart meant matching the prose.

On a command whose output is JSON — `status` always, anything else given `--json` — a refusal is now
a JSON document on stdout carrying `ok: false` and `error.kind`, one of `NOT_BEAVE_PROJECT`,
`PROJECT_STATE_UNTRUSTED` or `COMMAND_FAILED`. An untrusted project also carries
`blockers_assurance: "UNTRUSTED"`, which is the fourth value of a vocabulary that until now nothing
could return.

**Nothing else is on either stream in that mode**, not even the usual `BEAVE ERROR:` line, so a
caller that merges stdout and stderr still gets one parseable document. Human output is unchanged,
the exit code stays 2, and `error.message` is for people: it is not stable and a caller that parses
it is a caller this did not help.

## Unreleased

### Fixed — the same operation, written two ways, is one operation (`ALN-013`)

`--operation-id` says "this is the same operation as before", and the engine checked the claim against
a digest of the command line *as typed*. So the retry the contract teaches after an interruption was
refused as "different input" when the options were written in a different order, or when
`--project-root` was `.` the second time. The digest is canonical now: the command, and its options
sorted by name, with `--project-root` left out and `--output-dir` / `--package-dir` resolved to one
spelling.

The same change closes the opposite defect, which was worse. A `--content-file` or `--answer-file` was
digested by its **path**, so the same operation id pointing at the same filename holding entirely
different text was accepted as `Idempotent retry` and the new content was silently discarded. Those
options are digested by the content of the file now: the same bytes under two names are one operation,
different bytes at one name are two.

Every new record declares which algorithm produced its digest. Records written by earlier engines are
recognised by the earlier rule, so nothing already in a project stops working, and a project from
`alpha.1` or `alpha.2` is unaffected.

### Fixed — a handoff no longer carries the machine that made it (`ALN-014`)

Every exported package contained the exporting project's absolute path, twice: in `state.json` and
inside the first event's patch, where the whole state was written when the project began. The user's
name, the drive letter and the folder layout travelled to everybody the package was given to, and were
useless there — the import rewrites the root on arrival.

Rewriting a recorded event was never an option. A package now carries a **portable replay origin**:
one event holding the whole state, with the root replaced by `<packaged>`, plus the digest, length and
last event id of the history it was made from. `manifest.json` declares the transformation and
`PROJECT_ENTRY.md` explains it. The exporting project is untouched.

**What this costs the recipient, said plainly:** the exporter's event-by-event log no longer travels.
Everything the project *is* — decisions, requirements, risks, tasks, the interview, the documents and
their recorded revisions — arrives complete and replays from the origin; what produced it is attested
by a digest rather than reproduced.

### Fixed — a package interrupted mid-promotion is no longer handed over

A crash between the rename that promotes a package and the removal of its staging marker leaves that
marker inside the finished folder — and it records the exporting machine: absolute paths, hostname,
the process id. `beave project-verify` used to call that "harmless" and exit 0. Both `project-verify`
and `project-import` refuse such a package now, say what it discloses, and name the command that
clears it: `beave recover --project-root <the exporting project> --apply`, on the machine that made
it. Nothing is lost — the package is complete, and one command makes it handable.

The manifest's declaration about the history it was made from is also compared with the package's own
origin event, by both commands. It was attested by nothing before.

### Fixed — an operation recorded by an older Beave cannot certify a file

The digest an earlier engine recorded saw a file's **path** and never its content. So on a project
created with `alpha.1` or `alpha.2`, the same operation id pointing at the same filename holding
entirely different text was accepted as `Idempotent retry` and the new text was discarded — a human
override reading "do NOT ship. Halt the release." lost to one reading "ship on Friday", exit 0.

Beave will not guess about that. When the recorded operation was written by the older algorithm and
the command reads a file, it refuses: names the option, says the older record digested a path rather
than content, writes nothing. The cost is real and worth stating — a legacy file-valued operation now
needs a new operation id to retry, even when the file has not changed, because nothing recorded can
prove it has not. Projects created from `alpha.3` on are unaffected.

### Fixed — `"blockers": []` was an answer this engine had no right to give

No Beave command writes the blocker ledger, so that array was empty in exactly the same way for a
project with no blockers and for a project with ten that nobody had a way to record. `resume` had said
so in a sentence for two versions; the machine-readable output had not. `status --json` now reports
`blockers: null` with `blockers_recorded: false` and `blockers_assurance: "UNKNOWN"`, and names four
states — `RECORDED`, `NONE_VERIFIED`, `UNKNOWN`, `UNTRUSTED` — so that "verified none" and "nobody
looked" cannot collapse into each other. A writable ledger is recorded as separate work.


### Added — one project, one writer

There was no project lock. `appendEvent` reads the event log, appends a line and writes it back, and
`commitState` computes a patch against the state it read: two processes reaching either at the same
revision lose an event or build on a revision that has already moved. Forty parallel processes that
never collided proved nothing, because the overlap was never forced.

`.beave/lock.json` is created with an exclusive filesystem create, before recovery, before the
idempotency question and before anything is read that will be written. A second process waits briefly
and is then told what it is waiting behind — the command, the process, the machine, the instant. A
lock left by a killed process on the same machine is taken over and the takeover is recorded; a lock
held by a **live** process is never taken, with or without `--force`.

A lock from **another machine** needs `beave unlock --force`, because this engine cannot ask a machine
it cannot see whether a process is still alive, and somebody has to be able to break a lock left on a
shared folder. A lock Beave **cannot reason about** is refused even then — one whose file will not
parse, one whose `pid` is not a process id, and one that does not say which machine holds it: for
those it tells you to make sure no Beave command is running and delete the file yourself. Liveness has
three answers, not two, and *unknown* is not *dead*. `beave replay --verify` stays outside the lock:
it never recovers and never writes.

A lock caught in the microsecond between its creation and its content is read patiently rather than
condemned, so two ordinary commands overlapping cannot produce a refusal that sends a person to delete
a file by hand.

### Fixed — three independent reviews, twenty defects

The lock, the staging protocol and the interview rules above were read three times by people who did
not write them. The first review found six defects, the second fourteen, and the third — reading the
corrections made for the second — six more. All twenty are fixed. The ones a user would have met:

- an interrupted `init` left a project `validate` refuses while four commands, the retry among them,
  reported success;
- every exported package carried the exporter's hostname, PID and absolute paths in files its manifest
  never declared, and every project accumulated one backup of its lock file per command;
- `project-verify` refused a file the manifest does not declare and `project-import` accepted it —
  the check was in the command that reports and not in the command that acts;
- `beave status` printed a clean report and exited 0 over a project whose state no longer matches its
  history, where `validate`, `resume` and `replay --verify` all refuse;
- `replay --verify` accepted a history in which two events shared a revision, which is what a lost
  update leaves behind. It refuses a revision that does not advance now.

Two things are known and not fixed: the digest that recognises a retried operation is taken over the
arguments as given, so the same command with its flags in a different order is refused as different
input rather than recognised as a repeat; and a handoff package carries the exporting project's
absolute path inside its history, where removing it would mean rewriting a recorded event.

**The corrections made for the third review have not themselves been reviewed by anybody else.**

### Added — export and import are recoverable

Both build a directory beside their destination and promote it with a rename, and a killed process
used to leave `.name.<uuid>.tmp` behind with nothing to identify it. Every staging now carries a
marker — kind, operation id, source, destination, phase, pid, host — an export records a pointer in
the project so `recover` and `resume` can report it, and an interrupted staging is **discarded, never
promoted**: there is no half-finished package worth keeping. A directory with no marker is never
touched, whatever it is called.

### Fixed — a question now belongs to a module

Both handover pilots reported that questions were recorded against module 2 while the active module
was 1, and that nothing explained it. `qa-ask` without `--module` uses the module the interview is
on; a different module is refused unless it is declared with `--crosscutting --crosscutting-reason`,
which Resume and the history document then show as a detour. The active module never advances on an
answer — a module takes several questions — and `qa-settle --complete-module STATUS
--module-answer-file FILE` closes it in the same transaction as the answer that finished it, through
the same code `record` uses.

### Fixed — `owners.json` written by PowerShell 5.1 (ALN-009)

Windows PowerShell 5.1 puts `EF BB BF` in front of every file `Set-Content -Encoding utf8` produces.
The first file a Windows user creates, for the first command they run, looked correct in every editor
and was refused by `JSON.parse`. One leading byte-order mark is now accepted, and nothing else is: a
second mark, a mark anywhere but the start, and invalid JSON after one are all still refused.


### Added — the state can be rebuilt from its own history, and an interrupted write is recovered

Two things that were described and did not exist. The events recorded *digests*
of what had changed and nothing re-read them, so "the history is the record" was
a sentence no code supported; and `commitState` wrote the event log and the state
one after the other, so an interruption between them left a project that was half
one thing and half another.

**Every event now records the mutation it performed**, together with the digest
of the state before it, the digest of the state after it, and the digest of the
preceding event. `beave replay --project-root .` rebuilds the state from those
events and compares it with the file, naming any field that differs;
`beave replay --repair --operation-id <id>` puts the rebuilt state back, keeping
what was there under `.beave/backups/`. Before every write the engine compares
the state on disk with the digest its history recorded and **refuses** rather
than building on a file somebody edited; `validate` refuses too, and `resume`
stops and gives no position instead of one it cannot stand behind.

Completeness is verified per write rather than claimed: `commitState` applies the
patch it is about to record and refuses to write unless the result reproduces the
new state digest for digest. An event that cannot rebuild its own effect never
reaches the file, which is why there is no hand-maintained reducer to go stale.

**Every mutating command now runs inside a journal** under
`.beave/transactions/`, with phases and the staged result. Before the point of no
return an interruption is undone; after it the operation is completed from the
staged content, because the result was already decided and finishing it is the
only outcome that cannot lose it. Recovery happens on the way into any command
that touches the project, leaves a receipt under `.beave/recovery/`, and says so
rather than passing in silence. `beave recover` reports what is outstanding and
changes nothing until `--apply`.

**A project written by an earlier Beave cannot be replayed, and is told so.**
Nothing is reconstructed for it: `beave baseline --project-root . --reason
"<why>" --owner <name> --operation-id <id>` records a verifiable starting point,
backs up the state and the history first, and reports how many earlier events
stay in the file and outside the proof. A project this engine created, and a
folder delivered by `project-import`, are reproducible from their own first
event.

### Fixed — descriptions that the code did not support

`.beave/events.jsonl` was called "the record" in the schema and in a CLI message;
`state.json` was called a "materialized view" of the events in three documents.
Both readings implied a reconstruction that did not exist. They now say what is
true, and the section above says what replaced it.

### Documented — the limit of the tamper evidence

The chain makes an edit to one event visible in every event after it, and the
state/history comparison makes an edit to `state.json` visible immediately. There
is no signature and no anchor kept beyond the reach of whoever holds the folder,
so someone who edits the state *and* rewrites the history forward from the change
produces something that verifies — against a copy taken earlier, or a package
another party holds, it does not. It is tamper-evident, not tamper-proof, and is
described that way in the skill, the contract and the guide.


### Fixed — Beave Studio wrote project files outside `DOCOP-001`

Studio persisted documents with a plain filesystem write and persisted edits to decisions, requirements and tasks by rewriting `.beave/state.json` wholesale. Path containment was correct; document governance was absent — no ledger event, no `-vN` revision, no lock check, no external-edit revalidation, no backup, and for `state.json` no atomic write, no revision bump and no transaction guard either. This is the same class of defect as DEF-1/DEF-2/DEF-3 below, on the other side of the IPC boundary.

`DOCOP-001` is now enforced inside the desktop binary (`studio/src-tauri/src/docop.rs`):

- a governed save shows a **reviewable diff first**, then writes the next `-vN` revision, archives the previous one, appends a `DOCUMENT_SAVED` event and commits through the same transaction guard the engine uses;
- documents locked by another operation are read-only and name their owner; the lock owner is derived from the operating system by the trusted layer and is never accepted from the webview;
- publication runs the accidental-loss audit and refuses to overwrite content Beave never recorded unless the user approves, archiving what it supersedes;
- a file the catalog does not know is **imported** as a governed revision with external provenance, never edited in place;
- the ungoverned `write_project_file` is refused everywhere under `.beave/` and everywhere inside a project that carries a ledger; a plain folder with no ledger is still an ordinary markdown editor;
- Studio reports ledger-versus-disk drift when it opens a project, so damage is visible before the user edits on top of it.

Autosave was removed for governed documents: a revision per keystroke pause is not a lifecycle. Saving is an explicit action.

### Added

- **Cross-implementation conformance corpus** (`docs/contracts/docop-conformance/`). `DOCOP-001` is now implemented twice — the Node engine and the Rust desktop adapter — because Studio must govern documents on Windows, macOS and Linux without requiring a runtime to be installed (decision **D3**). The two are held to identical behaviour by 14 language-neutral scenarios that both execute: `tests/docop-conformance.test.mjs` against the CLI, `cargo test --lib` against the adapter. Writing them against the real engine immediately corrected a wrong assumption: a repeated identical `doc-finalize` is an idempotent no-op, not a refusal.
- **`scripts/docop-negative-controls.mjs`**, which re-injects each historical defect into the adapter and fails if the corpus does not go red. Its first run found two holes in the corpus, and scenarios 13 and 14 exist because of it.
- Studio: a governance bar naming the document, its revision, its status and its lock; a publication action; and a save-review dialog showing the diff, the revision it would create, and every reason the save would be refused.


### Fixed — document data loss (DEF-1, DEF-2, DEF-3)

Three defects in which Beave destroyed governed documents silently and irreversibly. There is no recovery path for any of them after the fact: `.beave/backups/` holds `state.json` and `events.jsonl` only, never document content. See `docs/DATA_AND_SAFETY.md`, "Enforced rules of the document lifecycle".

- **DEF-1** — `doc-restore` deleted the published document. After `doc-finalize` the working path *is* the base path, and restore moved it into `.beave/history/`: `docs/spec.md` disappeared while `state.json` still reported `PUBLISHED`. The same root cause also made `doc-save` on a published artifact, and a repeated `doc-finalize`, delete the published file. A published base file is now copied and never moved, and a repeated `doc-finalize` is refused.
- **DEF-2** — `doc-restore` skipped the filesystem-hash revalidation that `doc-save` performed, so it archived hand-edited content over a genuine revision and destroyed it for good. `doc-restore` and `doc-finalize` now revalidate like `doc-save`, and an existing history entry can never be replaced by different bytes.
- **DEF-3** — `doc-finalize` overwrote a pre-existing file at the base path with no backup and no warning. It now compares that file against every digest recorded for the artifact and refuses on unrecognized content; `--accept-base-overwrite` approves the write, archives the superseded content under `.beave/history/<ID>-external-<timestamp>` and records the supersession in the `DOCUMENT_FINALIZED` event.

### Added

- `beave validate` now compares the ledger with the filesystem: history files against the hashes recorded in `events.jsonl`, the working file against `content_hash`, and the existence of the base file of a `PUBLISHED` artifact. The evidence of this damage was already in the ledger and nothing read it. `status`, `next`, `resume` and `context-pack` deliberately skip the audit so a drifted project stays readable.
- `doc-finalize --accept-base-overwrite`, the explicit human approval required by `DOCOP-001` § Finalization.
- `DOCUMENT_FINALIZED` events now carry `revision` and `hash`.

### Changed

- `doc-save` and `doc-restore` set the artifact status back to `DRAFT`: `state.json` no longer claims `PUBLISHED` while the current revision is unpublished.

## 0.2.0-alpha.3

### Added — the interview ledger

Every question Beave puts to you, and every answer you give, is now recorded:
`qa-ask` before the question, `qa-answer` for your words verbatim, `qa-settle` for
what Beave understood, what it replied and which records and documents changed.
`qa-close` defers, skips or invalidates a question with a reason;
`qa-supersede` corrects one without erasing it; `qa-log` reads it.

`QUESTION_ANSWER_HISTORY.md` appears at the root of every project and is readable
without any tool. It is generated: the record is `.beave/events.jsonl`, editing
the document changes nothing, `beave validate` says so, and
`beave qa-log --regenerate` repairs it.

Between the answer and its consequences the entry says **answered, not applied**.
That gap is deliberate: an interrupted turn must not look finished, and `resume`
reports it so the next agent completes that transaction before asking anything
new.

### Changed — `resume` says where to continue, in order

`resume` now prints the interview history and a frontier: integrity and
reconciliation first, then a human override, then the recorded exact next action,
then the gate, then an open question, then open decisions, and only last the
questionnaire catalog. A project that has a state does not restart its interview.

The skill now requires a host activated inside a Beave project to run
`beave resume` before it says anything — so *"use Beave and resume this project"*
is the whole instruction a user has to give. A provider's own session recovery
restores a conversation; this restores the project.

### Changed — an existing project gains the ledger without gaining a history

`beave migrate` opens the ledger on a project created before it existed and
records the instant from which history exists. Nothing is reconstructed: a
decision in a document is not evidence that a particular question was asked, and
Beave says which of the two it has.

## 0.2.0-alpha.2

### Fixed — the CLI could not be started by its own name

`0.2.0-alpha.1` shipped with `#!/usr/env node` as the first line of the entry
point. The path is `/usr/bin/env`; `/usr/env` exists on no platform. On Windows
the `.cmd` shim npm writes reads that line and fails with *"Impossibile trovare il
percorso specificato"*; on Linux and macOS the kernel fails the same way. After a
clean install `npx beave version` did not run, while
`node node_modules/@beavelab/beave/lib/bin/beave.js version` answered correctly —
the code was sound and only the first line was wrong.

Every check before that release ran the CLI through `node` or from the repository,
where a shebang is never consulted. That is how a defect on line 1 of the entry
point survived a full release inspection, and why this release adds a regression
test that installs the packed tarball into a clean directory and invokes it
through the shim npm actually creates, refusing to accept a direct `node` call as
evidence.

`0.2.0-alpha.1` is deprecated on the registry and remains published: an npm
version is immutable and was not overwritten.

### Clarified

`skills/beave/schemas/state-v3.schema.json` is the current schema.
`skills/beave/schemas/state.schema.json` is kept only as the historical v2 schema,
for migration and compatibility; the engine still reads `schema_version` 1 and 2.

## 0.2.0-alpha.1 — 2026-09-04

- Added Guided, Standard, and Expert interaction modes.
- Defined Resume as evidence-based continuation from durable state.
- Added human override and reconciliation events.
- Added schema v2 and an explicit v1 migration.
- Added a dependency-free Node CLI and npm/npx packaging.
- Added safe, explicit runtime skill installation with dry-run.
- Added the first website, runtime guide, and RexLab pilot contract.

## 0.1.0 — 2026-09-03

- Created the semantic skill, Python MVP, state/event model, context packs, validators, adapters, and portable Markdown export.
