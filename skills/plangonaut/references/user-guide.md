# Plangonaut User Guide

Plangonaut prepares a complete multidisciplinary project folder through the user's chosen AI host. The agent investigates, asks necessary questions, records decisions and specifies how to execute, verify, recover and finish the agreed outcome. No total cap on questions or documents limits applicable coverage.

## One method, two operating profiles

| Aspect | Semantic-only | Hybrid / programmatic |
|---|---|---|
| Method | Markdown skill/references or Portable Edition | The same method plus CLI |
| Meaning and questions | Host AI and human | Host AI and human |
| Project completeness | COV-001 and EXEC-001 | Identical COV-001 and EXEC-001 |
| Persistence | Approved host file tools or full documents delivered for manual saving | Supported engine operations plus host semantic work |
| Mechanical assurance | Host/manual review; no automatic engine guarantees | Implemented structural validation, versions, history and Resume |

Semantic-only is valid at any project size. Hybrid adds repeatable mechanics, not deeper thinking or more complete requirements. Neither profile proves completeness merely by creating files. Read [coverage-contract.md](coverage-contract.md) and [execution-package.md](execution-package.md).

Three things are distinct:
1. Plangonaut's distribution: source repository, Markdown skill, npm package or packaged CLI executable.
2. The user's project folder: specifications and operating instructions produced with Plangonaut. It need not be an npm project or Git repository.
3. Studio: optional desktop reader/editor and analysis app; its executable is not the CLI executable.

Installing only the skill makes it discoverable and does not activate Hybrid. npm/npx and verified CLI executables distribute programmatic capability, not a reasoning model. Check actual release availability and platform support; planned commands are not publication evidence.

## Start or resume

1. Provide the skill/references or Portable Edition and inspect existing project sources.
2. Establish missing collaboration decisions: interaction mode, persistence and owners. Reuse valid earlier answers.
3. Survey the outcome and disciplines; maintain the concern register. Ask unresolved questions in small turns without a total cap.
4. Save confirmed answers incrementally within authority. Build the EXEC-001 package and obtain outstanding consequential approvals.
5. Check the actual folder and issue a scoped readiness assessment. Manual delivery remains pending until saved files are checked.
6. When authorized, the same agent may continue or a different agent/runtime may consume the folder. No board review, Studio or model change is mandatory.

Guided asks one question per turn; Standard up to two related questions; Expert up to three with more technical discussion. Every mode covers applicable concerns and requires evidence appropriate to the risk.

## Resuming: what it looks like end to end

This is the whole point of the ledger, so here is the whole thing, with nothing
left out.

**1. Plangonaut asks.** Before the question reaches you, it is recorded:

```
plangonaut qa-ask --project-root . --id QNA-0007 \
  --question "Who approves a completed job, and before or after it syncs?" \
  --rationale "Module 2 cannot be recorded without the approval path." \
  --module 2 --owner Ada --agent codex/session-a --operation-id ask-7
```

**2. You answer.** Your words are recorded exactly, from a file so nothing is
reshaped by the shell:

```
plangonaut qa-answer --project-root . --id QNA-0007 \
  --answer-file answer.txt --owner Ada --operation-id answer-7
```

At this instant the answer is recorded and **not applied**. `plangonaut qa-log --open`
says so.

**3. Plangonaut records what it understood and what changed:**

```
plangonaut qa-settle --project-root . --id QNA-0007 \
  --interpretation "Supervisors approve after sync; offline jobs queue." \
  --reply-file reply.md \
  --consequences DEC-0007,REQ-0011 --documents docs/operating-model.md \
  --next-id QNA-0008 --next-question "What happens to a job rejected after sync?" \
  --owner Ada --operation-id settle-7
```

**4. The session ends.** A crash, a closed laptop, a context compaction, a
finished day. Nothing is saved on the way out because nothing needed saving: each
of the three steps was a transaction.

**5. A different agent opens the project.** Not the same tool, not the same
vendor, no access to the earlier conversation. It is handed the folder and one
sentence: *"use Plangonaut and resume this project"*.

**6. It runs `plangonaut resume --project-root .`** — because that is what being
activated inside a Plangonaut project means, not because you remembered to ask — and
reads:

```
## Interview history

- Recorded interactions: 7 (history available since 2026-03-02T09:14:51.402Z)
- Readable at: QUESTION_ANSWER_HISTORY.md
- Last completed interaction: QNA-0007 — Who approves a completed job, and before or after it syncs?
  - Module: 2
  - Records changed: DEC-0007, REQ-0011
  - Documents changed: docs/operating-model.md
- Planned, not asked: QNA-0008 — What happens to a job rejected after sync?

## Where to continue

**Start here.** Exact next action, as recorded: Record module 2, then open G2.
```

**7. It continues from QNA-0008.** It does not ask you again who approves a
completed job: that question is `ANSWERED`, its answer is in the ledger, and its
consequences are recorded. If the session had died between steps 2 and 3, Resume
would instead have said *"answered and not applied"* and the new agent would have
finished that transaction before asking anything.

The recovery your own tool offers — `codex resume`, `claude --resume` — restores a
conversation you had. This restores the project, to an agent that never had one.

## Using the CLI

Inspect `plangonaut help` and the installed version. From a built checkout use `node lib/bin/plangonaut.js help`. Establish authority and persistence before init.

### The first command: `init` and its owners file

This is the canonical description of the first executable command. Other surfaces point here instead of restating it.

`init` is the first command that writes anything, and it will not run until it knows who decides. It requires `--owners-file`: a small JSON file naming the five decision authorities the engine stores. There are exactly five, the names of the keys are fixed, and a sixth key is refused rather than quietly dropped.

| Key | The authority it names |
|---|---|
| `product` | scope and priorities: what the outcome is, and what it is not |
| `technical` | architecture, stack, technical feasibility |
| `budget` | money, time and resources that may be spent |
| `safety` | data, privacy, security, destructive and irreversible actions |
| `release` | publication, deployment, what reaches real users |

One person may hold several roles: write the same name in each key. A value may name a role or a body rather than an individual when that is who actually decides. Every key must be present and non-empty. Authorities the project needs beyond these five — compliance, legal, clinical sign-off — are recorded in a governed document and referenced from there; the engine stores five and refuses what it cannot keep, so nothing is lost silently.

A complete minimal `owners.json`, saved in the project folder it describes:

```json
{
  "product": "Ada Moreau",
  "technical": "Ada Moreau",
  "budget": "Ada Moreau",
  "safety": "Dr. Chen (external safety reviewer)",
  "release": "Ada Moreau"
}
```

`--owners-file` takes a path, absolute or relative to the current directory, so `--owners-file owners.json` is enough when the command runs from the project folder. The file is read once, at `init`. The names are copied into the recorded state and nothing re-reads the file afterwards; keeping it beside the project documents its input, and deleting it breaks nothing.

The whole first command, run from a project folder that already exists — `init` does not create the directory:

```
plangonaut init --project-root . --project-name "My project" --project-mode Genesis --interaction-mode Standard --owners-file owners.json --operation-id first-init-2026-09-11
```

From a built checkout, `node lib/bin/plangonaut.js` replaces `plangonaut`. `--project-mode` is one of Genesis, Adoption, Reconstruction, Evolution or Resume, defined under Modes in the skill instructions; `--interaction-mode` is Guided, Standard or Expert. `--operation-id` is yours to choose and must be 3 to 128 letters, numbers, `.`, `_`, `:` or `-`; reuse it only to retry the identical command. On success `init` prints the state location and sets the next action to `plangonaut next --project-root .`.

The refusals, verbatim, so they are recognisable before they are met:

> `Missing required option --owners-file`

> `Owners file requires product, technical, budget, safety, release` — a key is absent or its value is empty.

> `Owners file declares roles Plangonaut cannot store: <keys>. Recognised roles are product, technical, budget, safety, release. Record the other authorities in a governed document and reference them there; nothing was written.`

None of them writes anything. Fix the file and run the same command again.

The audited alpha exposes capabilities, init, status, next, resume, record, the typed ledger commands, the blocker ledger (`blocker-record`, `blocker-resolve`, `blocker-verify-none`), override, reconcile, re-record, gate, context-pack, validate, migrate, document operations, project-export/project-verify/project-import, install, verify-install and skill export. Read [engine-contract.md](engine-contract.md) for exact options and limitations. Structural gate checks do not replace semantic concern review.

### Recording what is holding the project up

Write a blocker down and it counts; leave it in your head and Plangonaut will say it does not know.

```
plangonaut blocker-record --project-root . --id BLK-HALL --title "The hall is not booked" \
  --reason "The venue has not answered in three weeks" --owner Ada --operation-id OP-1
```

When it is cleared, **resolve** it rather than deleting it — the record stays and gains how it
ended, because a blocker that happened and was cleared is part of the story of the project:

```
plangonaut blocker-resolve --project-root . --id BLK-HALL --resolution "Booked for 12 June" \
  --owner Ada --expected-revision 1 --operation-id OP-2
```

And there is a third command, which exists because of a distinction that is easy to lose. Resolving
the last blocker says something about *that blocker*. It does not say the project has none — nobody
looked. So after resolving, Plangonaut goes back to answering `UNKNOWN`, and if you have looked and there
is genuinely nothing open, say so and put your name to it:

```
plangonaut blocker-verify-none --project-root . --owner Ada --note "checked the venue thread" \
  --operation-id OP-3
```

Only then does `status` answer `NONE_VERIFIED`. It is refused while anything is still open, and it
names what. An empty list is not an answer, which is the whole reason these three commands exist.

If your project was created by an earlier alpha and has blockers written as plain sentences, they
stay exactly as they are. Plangonaut counts them as open — nothing ever recorded them as resolved — and
will not invent an owner or a date for them. To close one, record it properly first, so that closing
it leaves a trace.

Maintain COV-001 detail in indexed Markdown and link its confirmed records through the supported ledgers. `export` generates the Plangonaut skill or adapters; `project-export` creates the user's verified handoff package.

Give every mutating command a new caller-generated `--operation-id`; an exact retry is safe, while different inputs under the same ID are refused. Before `doc-save`, run `doc-diff` and pass its returned `confirmation_token` as `--confirm-token`. The token binds the approved preview to the actual save. Keep the complete project directory available during work; `project-export` creates a verified transfer package containing governed drafts, published documents, evidence, state and event history.

## If something was interrupted, or looks wrong

Three commands, and the differences between them matter.

**`plangonaut replay --project-root .`** rebuilds your project's state from its
recorded history and compares the two. It changes nothing. On a healthy project
it says so in one line:

```text
History replay: the state matches its history exactly (14 events from PROJECT_INITIALIZED, through revision 14).
```

On a project whose `state.json` was edited outside Plangonaut it names the fields:

```text
History replay: DIVERGED. The state on disk is not what its own events produce.
  decisions.0.title: rebuilt as "Bake weekly"
Repair it with: plangonaut replay --project-root . --repair --operation-id <id>
```

While that is true, Plangonaut refuses to write anything on top of it and `resume`
gives you no position rather than a position it cannot stand behind.

**`plangonaut replay --project-root . --repair --operation-id <id>`** puts the rebuilt
state back. It copies what was there into `.plangonaut/backups/` first — a repair
never means a loss — records the repair as an event, and regenerates the derived
documents. Run it when the state was damaged. If the edit was something you meant
to do, make the same change through the command that records it instead.

**`plangonaut recover --project-root .`** tells you whether an operation was
interrupted, and what finishing it would do. It changes nothing until you add
`--apply`, and you usually do not need to: recovery happens automatically on the
way into any command that touches the project, and it says so rather than passing
in silence.

It also names three kinds of damage that are *not* an interrupted write, and none
of them is resolved behind your back: a journal that cannot be read, a leftover
directory with no journal in it, and a last line of the history that was cut off
mid-write. Only the last has an automatic remedy — `--apply` removes that line
after copying the whole file into `.plangonaut/backups/` — because an append is the
last durable write of an operation, so a partial final line cannot be one that
finished.

**If `.plangonaut/state.json` has gone missing** and the history is still there, every
command says so and names the repair. That is the case the replay exists for:
`plangonaut replay --project-root . --repair --operation-id <id>` rebuilds the file.

### If Plangonaut says the project is in use

One project, one writer. Plangonaut takes a lock before it touches anything, so a
second command on the same project waits a few seconds and then tells you what it
is waiting behind — the command, the process, the machine and the moment it
started. Wait for the first one to finish and run yours again.

If a Plangonaut command was killed, the lock it was holding stays on disk. The next
command on the same machine sees that the process is gone, takes the lock over
and carries on: there is nothing for you to do. Three cases are never resolved for
you, because guessing would be how work gets lost — a lock held by a process that
is **still running**, a lock from **another machine**, and a lock Plangonaut **cannot
read**. `plangonaut unlock --project-root .` tells you which of those you are looking
at and changes nothing.

`--force` is for two of them and not the third. It releases a lock whose process
is **known to be gone**, and it releases a lock from **another machine** —
somebody has to be able to break a lock left on a shared folder by a laptop that
is not coming back, and this engine cannot ask that laptop anything. It refuses a
lock held by a live process here, a lock it cannot read, and a lock that does not
say which machine holds it: Plangonaut will not guess about a file it cannot reason
about, and a wrong guess there is somebody's work. For those, make sure no Plangonaut
command is running and delete the file yourself.

*An independent review released, with `--force`, a lock naming a process that was
running at that moment: the record had no `host` field, and "not this machine"
was being read as "another machine".*

### Projects older than this

A project created by an earlier Plangonaut has a history that records *digests* of
what changed rather than the changes themselves, so it cannot be replayed. That
project is not damaged — everything works, and `validate` still says
`Plangonaut state is valid.` — but it is told, every time, what it cannot prove:

```text
This project's history has no point the state can be rebuilt from.
Record a starting point with `plangonaut baseline …`
```

`plangonaut baseline --project-root . --reason "<why>" --owner <name> --operation-id
<id>` records that starting point. From there on the project is reproducible.
Everything before it stays in the file, exactly as it was, and is reported as
outside the proof. Nothing is invented to fill the gap, because a history nobody
recorded is not a history Plangonaut is willing to make up.

## Installation, history and recovery

Use a reviewed compatible package or source build. Preview installation destinations with --dry-run and preserve existing installed skills. See [runtime-compatibility.md](runtime-compatibility.md). A source repository does not prove a published npm package or built executable exists.

Semantic-only retains full canonical documents, coverage, decision history and next action through approved host/manual operations. Hybrid adds supported ledgers/events. Unsupported schema requires an explicit backed-up migration; never edit the version number to simulate one. Neither profile relies solely on chat memory.

After consequential changes, record the override, inspect affected work and reconcile meaning. Paid Studio assistance is optional and does not remove free semantic/CLI responsibilities. Preserve superseded decisions and unresolved discrepancies.

## Optional Studio

Base Studio is a local desktop app with clean IDE-style navigation, manual Markdown editing and faithful tree/graph/timeline analysis. File integrity and existing relationship views do not certify semantic consistency. Assisted cross-document review, change-impact analysis and reconciliation are future subscription workflows, not prerequisites for Plangonaut or execution.

Initialization does not launch future project agents. Execution authority, capabilities, physical actors, professional approvals and completion evidence remain explicit in the package.
