# Beave Engine Contract

The engine is a deterministic assistant to the semantic skill. It governs process state; it does not replace product judgment.

## Authority boundary

The agent and user own interpretation, recommendations, trade-offs, and consequential decisions. The engine may validate structure and transition preconditions, but it must never infer an approval, resolve `NEEDS USER DECISION`, choose a product direction, or perform external actions.

## Canonical runtime

- TypeScript/Node core compiled for Node 24 LTS; Node 22 is transitional compatibility while supported upstream.
- The distributable CLI has no mandatory runtime dependencies.
- No network, API keys, model providers, daemon, telemetry, or background watcher.
- All project state stays under the approved `.beave/` directory.
- Read-only commands do not create state.

The bundled Python 3.11 engine is a frozen alpha compatibility bridge. It receives no new independent behavior and is removed before beta only after Node parity and saved-state migration evidence.

## Commands

Run `beave <command> --help`, or `node bin/beave.mjs <command> --help` from the alpha source workspace.

| Command | Purpose | Writes |
|---|---|---|
| `capabilities` | report whether the local MVP can run | no |
| `init` | create approved project state after Gate G0 | `.beave/` only |
| `status` | show phase, gate, coverage, blockers, and next action | no |
| `next` | select the next unanswered module and print up to three questions | no |
| `resume` | validate durable state and print the bounded restart context plus active questions | no |
| `record` | record one module outcome from an answer file | `.beave/` only |
| `override` | append a human correction and require impact reconciliation | `.beave/` only |
| `reconcile` | close one override with evidence and a new exact next action | `.beave/` only |
| `context-pack` | print or persist a bounded resume/worker context | optional `.beave/context/` |
| `validate` | validate state and event consistency | no |
| `migrate` | apply one explicit, supported schema migration with backup and event evidence | `.beave/` only |
| `export` | generate the portable Markdown or one runtime adapter | approved output only |

The complete target additionally includes stable ledgers for decisions, requirements, artifacts, tasks, dependencies, gates, risks, evidence, future-agent definitions and checkpoints, plus governed `diff`, `save`, `history`, `backup`, `restore`, `finalize`, `audit`, `app`/`launch`, and explicit `update` operations. Until those commands pass their contract fixtures, the CLI must identify them as unavailable rather than imply enforcement.

## State contract

`.beave/state.json` is the current materialized view. `.beave/events.jsonl` is the append-only decision/event history. The state includes:

- schema version and Beave version;
- project identity and Genesis mode;
- lifecycle state and current gate;
- interaction mode and human decision owners;
- questionnaire status for modules 0–16;
- human overrides and whether reconciliation is still required;
- exact next action, blockers, risks, and evidence references;
- timestamps and source paths.

Every state-changing command validates input before writing. Existing state is copied to a timestamped backup, a new file is flushed in the same directory, and only then promoted atomically. The engine never cleans backups automatically.

Each mutation increments `revision`; the corresponding event carries `state_revision`, and state records `last_event_id`. Validation rejects duplicate/out-of-order events and a latest event that does not match the materialized state. Cross-file writes cannot be one filesystem transaction: a crash between event and state leaves visible divergence and blocks Resume until repaired from preserved evidence.

## Context budget

Context packs include only the current lifecycle position, active module, optional sanitized module summaries, blockers, risks, authoritative evidence references, open overrides, and exact next action. Raw chat histories and unrelated documents are excluded. Full answers remain external evidence files; only an explicitly supplied summary may enter the pack.

The alpha state machine covers Gate G0, questionnaire progress, and transition to G2. Deterministic task/dependency ledgers and transitions G3–G12 are future work; the semantic skill and repository instructions govern those gates in the meantime.

## Failure behavior

- Missing or invalid state: stop with a non-zero exit code and remediation text.
- Unsupported schema version: stop; never rewrite automatically.
- Existing output: preserve it through a backup or require a distinct path.
- Requested path outside the approved boundary: reject it.
- Unknown runtime feature: degrade to semantic instructions; never claim native support.

## Versioning

Schema changes require an explicit migration command and fixtures for the previous version. The engine never auto-migrates. Generated files carry the Beave version and source digest so drift can be detected.

## Resume contract

Resume is evidence-based recovery, not model memory. It validates `.beave/state.json`, checks the recorded project root and events, emits a bounded context pack, and points to the earliest active module or reconciliation. The agent must then compare referenced canonical sources with the current workspace before acting.

## Human override contract

`override` records the user's instruction, source digest, owner, reason, and timestamp. It sets `needs_reconciliation=true` and blocks normal continuation until the agent identifies and updates affected downstream work. `reconcile` closes the override only against a durable evidence file and records the next action. History is retained in `events.jsonl` and state backups.
