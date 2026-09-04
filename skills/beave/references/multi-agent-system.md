# Multi-Agent System Design

This reference describes a future agent system that Beave may recommend and write into the initialized project. Beave's own procedure uses one host AI model in conversation with the user. It does not spawn, execute, or orchestrate these project agents.

Design the future organization as carefully as the project itself. Multiple agents are an option, not a success metric. The output is a reviewed package of prompts, roles, permissions, dependencies, contracts, handoffs, and execution instructions for a later AI session.

## Topology selection

| Situation | Recommended topology |
|---|---|
| Small, tightly coupled, low-risk work | One lead agent, optional final reviewer |
| Routine execution with occasional hard decisions | Execute agent + stronger read-only advisor |
| Several independent specialist domains | Orchestrator + bounded specialist workers + integrator |
| Sequential contract-dependent domains | Specialist pipeline with explicit producer/consumer gates |
| High-risk or regulated work | Orchestrator + workers + independent safety/quality reviewers + human approval |

Recommend a future topology only after assessing domain count, file overlap, contract maturity, risk, runtime concurrency, model availability, latency, and budget.

Concurrency accounting must include every agent active at the same time, including orchestrator, integrator, and reviewers. If a lead releases its slot while workers run, state that scheduling assumption explicitly; never present more simultaneous agents than the runtime permits.

## Human position

Name the human roles explicitly:

- **Sponsor/Product authority:** owns purpose, priorities, acceptance, and budget.
- **Technical authority:** approves architecture and engineering risk when different from sponsor.
- **Safety/Release authority:** accepts residual risk and authorizes external impact.

An agent may advise all three roles but cannot silently assume them.

## Agent role catalog

Define only justified future project roles:

- **Genesis Lead:** runs interview, synthesis, gates, and durable state.
- **Orchestrator:** builds dependency graph, assigns work, limits WIP, verifies handbacks.
- **Advisor:** stronger read-only reasoning for ambiguity, architecture, or risk.
- **Domain Researcher:** answers a bounded research question with sources and uncertainty.
- **Product/Domain Analyst:** maintains users, workflows, glossary, and requirement traceability.
- **System Architect:** boundaries, interfaces, data flows, ADRs, and non-functional trade-offs.
- **UX/Content Specialist:** interaction, accessibility, language, and design contracts.
- **Security/Privacy/Safety Reviewer:** threat, data, destructive operations, compliance, and release blockers.
- **Implementation Worker:** one bounded task against approved contracts.
- **QA/Verification Agent:** acceptance matrix, fault injection, and evidence; does not trust implementer claims.
- **Integrator:** resolves cross-task compatibility in dependency order.
- **Operations/Release Agent:** deployment, migration, rollback, observability, and runbooks.
- **Context Steward/Auditor:** handoffs, drift, stale artifacts, permissions, and cleanup recommendations.

## Agent card

Every role definition includes:

- mission and terminal condition;
- task IDs and requirements served;
- authoritative inputs and context budget;
- allowed and forbidden paths;
- tools, skills, MCP, network, credentials, and external-write permissions;
- model class and effort rationale;
- decisions it may make and decisions reserved for humans;
- outputs, contract versions, verification, reviewer, and handoff path;
- escalation triggers and maximum retries.

Use logical bounded contexts until the repository layout has been observed or approved. Never invent physical paths such as `/api`, `/web`, or `/db` and present them as established ownership boundaries.

## Relationship protocol to encode in project artifacts

1. The orchestrator owns assignment and dependency order, not product truth.
2. A producer publishes a versioned contract before an independent consumer starts.
3. Workers never infer missing interface names or overwrite another worker's ownership area.
4. Agent-to-agent information passes through named artifacts or explicit messages with provenance.
5. Reviewers receive requirements and actual outputs, not the implementer's private reasoning.
6. Conflicting recommendations are presented to the authorized decision owner with evidence and trade-offs.
7. The integrator may reconcile implementation details but cannot alter approved behavior.
8. The context steward records state; it does not mark work complete without verification.

## Parallelism and waves for later execution

Parallel work is safe only when all are true:

- tasks have no unresolved dependency edge;
- write scopes do not overlap, or a merge owner and stable interface exist;
- shared contracts are approved at the required maturity;
- agents do not mutate the same external system;
- integration and full-suite verification are scheduled after the wave.

Otherwise use sequential execution. Prefer fewer agents over coordination overhead.

## Model and effort routing recommendations

Ask which models and effort levels the runtime supports. Route by risk:

- routine inventory and mechanical edits → efficient model, low/medium effort;
- bounded implementation and tests → engineering model, medium/high effort;
- architecture, safety, complex debugging, synthesis, and final review → strongest approved model, high or logical ultra profile;
- independent review should not use a weaker capability than the risk demands.

Record cost, latency, context, and privacy consequences. Never pass a logical effort label to a runtime that does not support it.

## Worker prompt artifact

```markdown
# Work item: [ID — outcome]

Role and terminal condition:
Read first:
Requirements/contracts:
Allowed scope:
Forbidden scope:
Decisions allowed / human-only:
Tools and permissions:
Deliverables:
Verification evidence:
Escalate when:
Handback format:
```

Save one reviewed prompt artifact for each justified role. Do not include entire chat histories. Give the minimum complete context needed for the task. Generation of this artifact does not create or start the agent.

## Review lanes

- **Requirement review:** does the output match approved intent?
- **Technical review:** is the implementation correct and maintainable?
- **Safety/security review:** are threats, permissions, data, and rollback controlled?
- **Integration review:** do contracts and consumers agree?
- **Human acceptance:** does the outcome solve the intended problem?

Combine lanes for low-risk work; keep them independent when consequences justify it.
