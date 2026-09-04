# Beave User Guide

Beave takes a project from an idea or an inconsistent workspace to an approved, traceable operating system. One host AI uses the skill with the user, then hands off complete documents, prompts, plans, gates, and durable memory to the AI environment that will execute the project.

## Choose the execution profile

Use **Hybrid** by default when the project will span several sessions, includes multiple agents or components, handles important data, needs audits or approval gates, or must resume deterministically. Hybrid still uses the semantic skill for dialogue and judgment; the local engine manages repeatable mechanics.

Use **Semantic-only** when the work is a small exploration, a single-session low-risk project, the environment cannot execute local code, the user declines persistence, or Beave is being used with an unsupported AI host. No npm package, executable, Python runtime, or library is required. The trade-off is manual state, coverage, resume, and drift control.

## Choose the interaction mode

| Mode | Best for | Rhythm |
|---|---|---|
| Guided | first-time users, cognitive-load reduction, ambiguous ideas | one question at a time with explanations |
| Standard | most professional projects | up to two related questions with balanced analysis |
| Expert | high-risk, complex, regulated, or architecture-heavy work | up to three questions, edge-case challenge, stronger gate evidence |

All modes inspect supplied documents first and all stop at human decision gates. Question limits are per turn; every mode continues until applicable coverage is complete or visibly deferred.

## Fast decision

| Condition | Profile |
|---|---|
| One session, one agent, reversible exploration | Semantic-only |
| Existing repository, more than one session | Hybrid |
| Multi-agent plan, contracts, safety gates, audit | Hybrid |
| No shell or local filesystem | Semantic-only |
| Beave CLI is available and no third-party runtime packages may be installed | Hybrid |
| Web-only AI without access to project state | Semantic-only |

## Start in Semantic-only

1. Attach or paste `beave-portable.md`, or make the `beave` skill discoverable in the host.
2. Ask the agent to use Beave for a new project, adoption, reconstruction, evolution, or resume.
3. Answer Gate G0: Guided/Standard/Expert, approved persistence, and decision owners.
4. Work one questionnaire module at a time.
5. At every gate, save the state block produced by the agent in a project file or handoff.
6. Use that state block plus canonical project documents to resume; do not rely on chat history alone.

Semantic-only can design a complete project. It cannot independently guarantee state consistency, coverage, ID uniqueness, context budgets, or export equivalence.

## Start in Hybrid

1. Confirm Gate G0 semantically before creating state.
2. Run `beave capabilities` (or `node bin/beave.mjs capabilities` in the alpha source workspace).
3. Prepare a small JSON file naming the product, technical, budget, safety, and release decision owners.
4. Run `beave init` against the project root with the confirmed project and interaction modes.
5. Use `beave next` to obtain only the active module and its next questions.
6. Put the user's confirmed answer in a UTF-8 file and use `beave record`; keep consequential approval in the canonical project documents too.
7. Use governed diff/save/history/backup/restore/finalize operations as they become available; until then, preserve the same rules with host tools and label the deterministic guarantee unavailable.
8. Use `beave context-pack` for a new session or bounded worker brief.
9. Use `beave resume` at the start of a later session; it validates state before printing the active frontier.
10. Use `beave override` when a human prompt changes prior work, then `beave reconcile` only after impacted artifacts are updated.
11. Run `beave validate` at every lifecycle gate and before claiming readiness.
12. Use `beave export` when distributing Beave or moving to another runtime.

The engine must not be initialized before the user approves where state may be written.

## Typical lifecycle

`INTAKE → DISCOVERY → INTERVIEW → RESEARCH → BLUEPRINT → FOUNDATION → PLAN → EXECUTE → VERIFY → RELEASE → OPERATE`

Not every project needs the same number of files or agents. Beave scales artifact depth and review lanes to risk. A failed gate returns to the earliest invalid assumption or artifact.

## Designing the project's future agents

- Beave does not spawn or run the project agents during initialization.
- Design topology and ownership before the later execution system delegates work.
- Give workers a context pack, authoritative sources, exact scope, output, verification, and escalation rule.
- Parallelize only independent work with non-overlapping writes or frozen interfaces.
- Keep one integrator for shared state, decision logs, roadmaps, and release artifacts.
- Use an independent reviewer for consequences that justify it.
- Save agent roles, prompts, permissions, dependencies, contracts, order, and handoffs in the project.
- Treat native subagent/model routing as a capability of the later execution host, not a guarantee or runtime action of Beave itself.

## Installation and distribution

- **Engine CLI:** the npm package exposes `beave`. During development run `npm install -g <path-to-beavelab>`; after a public package exists use its published package name. `npx <package> <command>` runs it without a permanent global install.
- **Windows PATH:** `npm config get prefix` shows the directory containing `beave.cmd`; that directory must be present in `PATH`.
- **Codex:** place the canonical folder at `.agents/skills/beave/` in a repository or user skill directory.
- **Gemini CLI:** the same `.agents/skills/beave/` path is supported; `.gemini/skills/beave/` is also valid, and `gemini skills link <path>` is suitable during development.
- **Claude Code:** generate or copy the Claude adapter to `.claude/skills/beave/`.
- **AGY:** expose the workspace skill through the approved project context and permissions.
- **Other AI:** use the generated `beave-portable.md`.

Do not keep manually edited runtime copies. Change canonical content, run tests, then regenerate adapters.

## Resume and handoff

Hybrid resume reads `.beave/state.json` and `events.jsonl`, validates them against the workspace, reports open human overrides, and produces the exact next module or gate. Semantic-only resume starts from the latest state block or handoff and re-verifies referenced files. Neither mode treats prompt cache as durable memory.

Resume can go as deep as the project's artifacts and gates allow. It can drive contracts, architecture, agent briefs, tasks, evidence, review and design freeze, but it cannot manufacture missing domain facts or decide `NEEDS USER DECISION` items. Those remain explicit human gates.

## Safety

- Keep secrets, private paths, and raw sensitive content out of state and context packs.
- Do not grant network, credentials, publication, deployment, commit, push, purchase, or destructive permissions implicitly.
- Use answer files instead of complex shell arguments for long or sensitive text.
- Test destructive workflows only with disposable fixtures.
- Preserve original documents and previous state versions.

## Troubleshooting

- **Skill not found:** verify the runtime-specific directory and refresh/restart skill discovery.
- **Engine unavailable:** continue Semantic-only; do not install an unrelated package with a similar name.
- **Invalid state:** run `validate`, preserve the failing files, and restore only from a known Beave backup.
- **Unsupported schema:** use the matching Beave version or an explicit migration; do not edit version numbers by hand.
- **Adapter drift:** regenerate from canonical sources and compare source digests.
- **Too much context:** generate a fresh context pack for only the active module or worker.

## What Beave does not do

Beave does not execute the user's project, launch its future agents, authorize itself, provide durable memory through model cache, guarantee identical runtime features, or replace source control, testing, human review, and release ownership. The Beave-enabled AI collaborates on decisions and recommendations, but consequential outcomes remain visibly confirmed by the user.
