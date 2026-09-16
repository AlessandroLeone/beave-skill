# Design Inspiration and Deliberate Differences

## Superpowers

Primary sources:

- https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md
- https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md
- https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md
- https://github.com/obra/superpowers/blob/main/skills/dispatching-parallel-agents/SKILL.md
- https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md
- https://github.com/obra/superpowers/blob/main/skills/using-git-worktrees/SKILL.md

Adopted ideas:

- explore before design;
- incremental user approval;
- separate design from implementation plans;
- fresh bounded context per worker;
- parallelize only independent domains;
- independent requirement and quality review;
- verify before claiming completion;
- detect isolation before creating worktrees.

## GSD

Primary sources:

- https://github.com/gsd-build/get-shit-done/blob/main/docs/FEATURES.md
- https://github.com/gsd-build/get-shit-done/blob/main/docs/COMMANDS.md
- https://github.com/gsd-build/get-shit-done/blob/main/docs/CONFIGURATION.md

Adopted ideas:

- adaptive initialization questions;
- brownfield codebase mapping;
- requirements split by current, future, and out-of-scope;
- traceable phased roadmap;
- phase-level gray-area discussion;
- dependency waves and context-sized work;
- persistent state, resume, UAT, gap closure, and security gates.

## Plangonaut improvements

- a broader questionnaire covering purpose, domain, UX, data, safety, legal, economics, operations, tools, and agent governance;
- explicit propose → ask → wait protocol for every module;
- human decision ownership and separate approval scopes;
- artifact depth proportional to project risk instead of one fixed directory system;
- future multi-agent organization designed and saved before later execution, including permissions, model/effort, cost, context, conflict, and escalation; Plangonaut itself does not delegate;
- external egress and persistent-tool consent as first-class gates;
- evidence traceability from goals through requirements, decisions, tasks, tests, release, and operations;
- support for non-code and hybrid digital projects;
- no mandatory commit, worktree, service, or autonomous execution.

These sources are inspiration, not runtime dependencies. Plangonaut must remain usable when neither framework is installed.
