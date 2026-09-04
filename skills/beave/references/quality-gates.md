# Quality and Governance Gates

Grade each applicable gate `PASS`, `WARN`, `BLOCKED`, or `NOT APPLICABLE`. Cite fresh evidence and the responsible owner.

## Genesis gates

### G0 — Authority

Workspace, instructions, decision owners, protected assets, persistence, external access, mutation, and publication authority are explicit.

### G1 — Intent

Problem, users, outcome, success, non-goals, project type, and first milestone are confirmed.

### G2 — Coverage

All applicable interview modules are confirmed, deferred with owners, or marked non-applicable with reasons. Contradictions are resolved.

### G3 — Evidence

Required research is complete, current sources are cited, experiments have criteria/results, and uncertainty remains visible.

### G4 — Blueprint

Requirements, architecture, UX, data, safety, quality, delivery, risks, and roadmap are internally consistent and user-approved.

### G5 — Agent system

Topology, roles, model/effort routing, permissions, context, ownership, dependencies, reviewers, budgets, escalation, and handoffs are approved.

### G6 — Foundation

Canonical sources, state, environment, repository baseline, safe configuration, contracts, tasks, and verification commands exist and are reproducible.

### G7 — Plan

The next milestone has context-sized tasks, dependency waves, requirement coverage, exact acceptance evidence, and user approval.

## Delivery gates

### G8 — Task completion

Fresh targeted tests pass, actual diffs/artifacts match the task, important review findings are closed, and state/handoff are updated.

### G9 — Integration

Contracts and consumers agree, full relevant suites pass, migrations and rollback are tested, and cross-task conflicts are resolved.

### G10 — Human acceptance

The authorized user validates critical workflows, UX, content, and outcomes not provable by automation.

### G11 — Release

Security/safety, data, legal, operational, backup, migration, rollback, observability, support, version, and publication authority are satisfied.

### G12 — Operations

Outcome metrics, incidents, costs, dependencies, feedback, maintenance, and audit cadence have owners and thresholds.

## Evidence rule

Before any success claim:

1. name the command, artifact, review, or user confirmation that proves it;
2. obtain fresh complete evidence;
3. read failures, warnings, exit status, and skipped scope;
4. compare evidence to the requirement, not merely to tool success;
5. state the actual status.

An agent report is not independent evidence. A linter is not a build. Passing tests do not prove unmet product requirements.

## Repair and escalation

- Define maximum repair attempts before execution.
- Fix one causal layer at a time and rerun affected evidence.
- If failure reveals a wrong requirement or architecture, return to Blueprint or Plan.
- Never replace a failed dependency with a similarly named package without verification and approval.
- On exhaustion, mark `BLOCKED`, preserve evidence, identify the owner, and state the exact unblock condition.

## Final audit

Before declaring the project or milestone complete, verify:

- requirement-to-evidence coverage;
- unresolved decisions and accepted risks;
- documentation and implementation drift;
- agent/tool permission drift;
- recovery and rollback viability;
- reproducibility from a clean environment;
- user approval of the delivered outcome.
