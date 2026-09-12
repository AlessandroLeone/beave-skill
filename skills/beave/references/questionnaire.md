# Adaptive Project Questionnaire

This is a coverage catalog. Ask only applicable, unanswered questions, in small conversational modules. The agent must propose a direction and wait after each module.

Apply a decision-value test before every question. Ask the user only when the answer can materially change intent, scope, priorities, risk tolerance, cost, behavior, or acceptance. Derive, measure, recommend, or mark non-applicable any internal metric or technical detail the host AI can resolve professionally. A catalog entry is not automatically a user question, and complete coverage does not mean asking every line.

## 0. Collaboration contract

Use [coverage-contract.md](coverage-contract.md) to track concerns beneath and beyond these modules. The catalog does not define the project's outer boundary. Survey all relevant disciplines before detailed design.

- Which interaction mode and explanation depth does the user prefer?
- Who decides product, architecture, budget, security, legal, and release questions?
- Which actions may the agent take without asking, and which always require approval?
- Where may durable answers, research, prompts, and generated artifacts be stored?
- Are external research, subagents, plugins, MCP servers, or cloud services allowed?

## 1. Project identity and purpose

- What is the working name and one-sentence purpose?
- What problem or opportunity exists, for whom, and why now?
- What observable outcome would make the project worthwhile?
- What happens if the project is not built?
- Is this an experiment, internal tool, commercial product, open-source project, client delivery, regulated system, or something else?
- What is explicitly not the project's purpose?

## 2. Users, stakeholders, and domain

- Who uses, buys, operates, administers, supports, or is affected by it?
- Which user is primary for the first milestone?
- What jobs, pains, current workarounds, skills, devices, languages, and accessibility needs do they have?
- Which stakeholders can block or approve delivery?
- What domain terms, rules, exceptions, and disputed definitions require a glossary?
- What user research, analytics, interviews, or evidence already exists?

## 3. Project type and operating environment

- Is it web/SaaS, desktop, mobile, API, CLI, library/SDK, plugin, data/AI, automation, game, embedded/IoT, content/design, infrastructure, or hybrid?
- Where does it run: browser, local machine, server, edge, store, private network, or multiple environments?
- Must it work offline, on-premises, cross-platform, multi-tenant, or in air-gapped environments?
- Is it greenfield, brownfield, migration, replacement, integration, prototype, or rescue?
- What existing systems, formats, workflows, brands, or repositories constrain it?

### Type-specific branches

For non-software work, describe the setting in its own terms: site, workshop, supply chain, organization, event, service or physical environment. Do not force it into an app/platform category.

For web/SaaS ask about tenancy, auth, billing, browser support, SEO, administration, and availability.  
For desktop/mobile ask about OS/device matrix, permissions, distribution, updates, local data, offline behavior, and app-store rules.  
For API/CLI/SDK ask about consumers, compatibility, versioning, errors, rate limits, discoverability, and examples.  
For data/AI ask about datasets, provenance, evaluation, model choice, inference location, human review, drift, and cost.  
For automation/integration ask about triggers, idempotency, retries, credentials, reconciliation, rate limits, and manual override.  
For embedded/IoT ask about hardware, power, connectivity, safety, firmware update, manufacturing, and physical recovery.  
For content/design ask about audience, formats, brand system, approval, localization, rights, accessibility, and publishing channels.

## 4. Scope, capabilities, and priorities

Extend the earlier type-specific investigation where applicable:

- Physical infrastructure/construction: existing conditions and surveys, design disciplines/interfaces, site/access constraints, materials, equipment, suppliers, sequence, inspections, commissioning and maintenance. Identify responsible professionals and approvals; never invent measurements or treat AI prose as certified engineering evidence.
- Manufactured products: specifications/tolerances, prototypes, materials/components, sourcing and lead times, tooling, assembly, capacity, quality inspection, logistics, repair and disposal.
- Organizational/service projects: roles, procedures, staffing/capacity, training, stakeholder adoption, suppliers, continuity, quality, rollout and ongoing ownership.

These are starting lenses, not exhaustive domain checklists. Add disciplines and interfaces exposed by the project; each applicable obligation needs an owner, output and acceptance.

- What must a user be able to accomplish end to end?
- Which capability is the smallest useful first release?
- Which capabilities are must-have, should-have, later, experimental, and out of scope?
- Which workflows are happy path, edge case, administrative, recovery, and support paths?
- What must remain compatible with existing behavior or data?
- Which assumptions should be tested with a spike or prototype before commitment?
- What is the cost of being wrong for each major capability?

## 5. Experience, interface, and content

- Which interfaces exist: visual UI, voice, API, CLI, notifications, documents, or background behavior?
- What should users feel, understand, and trust at each critical step?
- What interaction density, guidance level, error recovery, empty state, and confirmation model is appropriate?
- Which design references are inspiration, constraints, or prohibited patterns?
- Is there a design system, brand, content voice, localization, responsive, or accessibility target?
- Which actions need preview, undo, history, approval, or explanation?
- How will usability and accessibility be verified with real users or assistive tools?

## 6. Data and state

- What entities, files, events, relationships, and lifecycles exist?
- What is the authoritative source for each datum?
- What enters, is derived, is cached, leaves, and must be deleted or retained?
- What volume, velocity, size, concurrency, consistency, and latency are expected now and later?
- Which imports, exports, migrations, backups, restores, and reconciliation paths are required?
- What identifiers, versioning, audit history, idempotency, and conflict rules are needed?
- What must never be lost, overwritten, duplicated, exposed, or silently changed?

## 7. Safety, security, privacy, and compliance

- What can cause financial, legal, privacy, physical, reputational, or data-loss harm?
- Which operations are destructive, irreversible, privileged, or externally visible?
- What threat actors, trust boundaries, secrets, permissions, and abuse cases matter?
- Which authentication, authorization, tenant isolation, encryption, logging, and redaction rules apply?
- What consent, retention, deletion, residency, copyright, licensing, or regulatory obligations exist?
- What are the dry-run, confirmation, rollback, quarantine, incident, and disaster-recovery expectations?
- Which severity blocks release, and who accepts residual risk?

## 8. Quality and non-functional requirements

- What does correct mean, and how will each must-have be demonstrated?
- Which user-visible availability, performance, capacity, responsiveness, or resource constraints materially affect feasibility or acceptance? Do not ask the user for arbitrary internal timings the AI can derive or measure.
- What reliability, recovery time, recovery point, durability, and offline behavior are required?
- What compatibility, portability, maintainability, observability, accessibility, and supportability are required?
- Which test levels are needed: unit, contract, integration, end-to-end, visual, performance, security, chaos, migration, or UAT?
- What environments and fixtures can safely reproduce failures?
- Which evidence must exist before a task, phase, milestone, and release are considered complete?

## 9. Architecture and boundaries

- What are the natural bounded contexts, components, trust zones, and ownership boundaries?
- Which interactions are synchronous, asynchronous, local, remote, event-driven, batch, or human-mediated?
- Which interfaces must be frozen before independent work begins?
- Where is state stored, who owns transactions, and how are partial failures recovered?
- Which scalability, extensibility, replaceability, and vendor-lock-in concerns matter?
- Which alternatives deserve comparison, prototype, or ADR?
- What architectural decisions remain intentionally deferred?

## 10. Technology and development environment

- Which technologies are mandated, preferred, prohibited, or inherited?
- Which operating systems, language/runtime versions, package managers, databases, and build tools are supported?
- What skills already exist on the team and what learning cost is acceptable?
- Which libraries are critical dependencies, and how will provenance, licenses, updates, and supply-chain risk be checked?
- How is local setup reproduced and verified on a clean machine?
- What editor, IDE, container, virtual environment, formatter, linter, generator, and task runner are desired?
- What baseline tests prove the starting environment is healthy?

## 11. Integrations, tools, AI, and automation

- Which external APIs, SaaS products, storage, identity, payments, analytics, messaging, or device services are required?
- What are their permissions, data egress, rate limits, costs, SLAs, failure modes, and fallback paths?
- Should a capability use a library, CLI, API, skill, plugin, MCP server, browser automation, or a custom adapter?
- Which tools should be deferred/lazy-loaded rather than always active?
- If AI is involved, what task, provider, model class, privacy boundary, evaluation set, latency, cost ceiling, fallback, and human oversight apply?
- Which actions may automation propose versus execute?
- How will integrations be mocked, sandboxed, monitored, and revoked?

## 12. Delivery, operations, and support

- Where is source controlled and what branch, review, commit, and release policy is desired?
- What environments exist and how are configuration and secrets separated?
- What CI checks, artifacts, deployments, migrations, feature flags, and rollback controls are required?
- Who monitors, responds to incidents, supports users, and owns operational changes?
- What logs, metrics, traces, alerts, dashboards, runbooks, backups, and restore drills are needed?
- What release cadence, maintenance window, deprecation, compatibility, and end-of-life policy applies?
- What is the recovery plan if a provider, deployment, migration, or release fails?

## 13. Commercial, legal, and governance

- Is there a budget, deadline, contract, pricing model, license, procurement, or funding constraint?
- What costs are fixed, variable, per-user, per-request, or operationally risky?
- Who owns code, data, models, designs, domains, accounts, and generated content?
- Which third-party licenses, terms of service, trademarks, or content rights must be reviewed?
- What analytics, experiments, telemetry, or user communication require consent?
- Which decisions require executive, client, legal, security, or compliance approval?
- How will scope change be proposed, approved, costed, and recorded?

## 14. Human team and multi-agent organization

- Who participates, with what expertise, availability, authority, and review responsibility?
- Is one agent sufficient, or do independent domains justify multiple agents?
- Should the topology be Lead+Advisor, Orchestrator+Workers, specialist pipeline, or hybrid?
- Which roles need stronger models or higher reasoning effort, and what are the cost/latency limits?
- Which agents may read/write which files, invoke which tools, access which networks, and communicate externally?
- Which tasks can run in parallel without shared writes or unfrozen interfaces?
- How are prompts, contracts, handoffs, decisions, conflicts, retries, and reviewer independence managed?
- When must an agent stop and escalate to the human?

## 15. Planning, milestones, risks, and success

- What is the complete agreed outcome and its terminal acceptance? What phases, including the first milestone, are needed to reach it?
- Which requirements, decisions, dependencies, experiments, and risks precede it?
- What phase granularity fits the project and the agent context limits?
- Which tasks are independent, sequential, contract-first, or human-gated?
- What are the top technical, product, operational, schedule, people, vendor, and adoption risks?
- What leading indicators reveal failure early?
- What are the kill, pivot, pause, and success criteria?
- What evidence closes each stage, authorizes dependent work and proves the agreed result complete?
- Which later details genuinely depend on future evidence, and what resolution work, owner and blocking point will settle them?
- What inputs, resources, responsibilities, outputs, verification, recovery and escalation does each executable work item require?

## 16. Final blueprint review

- Does the blueprint accurately reflect the user's intent in their own language?
- Are assumptions, deferred decisions, rejected options, and non-goals visible?
- Does every must-have map to a milestone and verification method?
- Are agent roles, permissions, dependencies, and integration order acceptable?
- Is the proposed artifact set useful rather than bureaucratic?
- Which files may now be created or updated?
- Does approval cover only the blueprint, or also foundation setup, implementation, publication, or deployment?
