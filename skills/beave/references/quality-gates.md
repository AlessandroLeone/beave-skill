# Quality and Governance Gates

Grade each applicable gate `PASS`, `WARN`, `BLOCKED`, or `NOT APPLICABLE`. Cite fresh evidence and the responsible owner.

## Genesis gates

### G0 — Authority

Workspace, instructions, decision owners, protected assets, persistence, external access, mutation, and publication authority are explicit.

### G1 — Intent

Problem, users, outcome, success, non-goals, project type, and first milestone are confirmed.

### G2 — Coverage

Review the COV-001 concern register, including domains beyond the initial catalog. Resolved concerns carry evidence and applicable confirmation. Deferrals/blockers retain consequences, owners, resolution work and blocking points. Contradictions affecting the proposed scope block readiness. Module status does not substitute for concern coverage.

### G3 — Evidence

Required research is complete, current sources are cited, experiments have criteria/results, and uncertainty remains visible.

### G4 — Blueprint

Requirements, architecture, UX, data, safety, quality, delivery, risks, and roadmap are internally consistent and user-approved.

### G5 — Agent system

Topology, roles, model/effort routing, permissions, context, ownership, dependencies, reviewers, budgets, escalation, and handoffs are approved.

### G6 — Foundation

Canonical sources, state, environment, repository baseline, safe configuration, contracts, tasks, and verification commands exist and are reproducible.

### G7 — Plan

The whole agreed outcome has an EXEC-001 route, work definitions, dependency order, resources, roles, verification, recovery and completion conditions. Future-dependent detail has resolution work and blocking points. Record approval and COV-001 readiness scope; the next milestone alone does not establish whole-project readiness.

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

A recorded gate is only as good as the file it was passed on. In Hybrid, `validate` re-verifies that file and names the gates for which it could re-verify nothing; attach the missing evidence rather than reading the pass as proof, and decide between restoring and superseding when a digest no longer matches ([engine-contract.md](engine-contract.md)).

## Repair and escalation

- Define maximum repair attempts before execution.
- Count the cycles out loud: repeated cycles on one defect family are a loop signal and are reported as one ([interview-protocol.md](interview-protocol.md)).
- Fix one causal layer at a time and rerun affected evidence.
- If failure reveals a wrong requirement or architecture, return to Blueprint or Plan.
- Never replace a failed dependency with a similarly named package without verification and approval.
- On exhaustion, mark `BLOCKED`, preserve evidence, identify the owner, and state the exact unblock condition.

## Final audit

Use [execution-package.md](execution-package.md) for folder acceptance. CLI structure checks, semantic review and execution evidence are distinct. Neither a gate flag nor a favorable review proves future implementation works. A paused interview or bounded-stage handoff is not whole-project completion.

Before declaring the project or milestone complete, verify:

- requirement-to-evidence coverage;
- unresolved decisions and accepted risks;
- documentation and implementation drift;
- agent/tool permission drift;
- recovery and rollback viability;
- reproducibility from a clean environment;
- user approval of the delivered outcome.
