# Execution package and handoff

**Contract:** EXEC-001, version 1.0.0. A provider-neutral information contract, not an implemented archive command or a fixed directory layout.

Read before selecting artifacts, planning work, preparing agent prompts and handing off. The output is the user's project folder, distinct from Beave's own installed skill/package/repository. Semantic-only and Hybrid must meet the same information requirements.

## Required information roles

Choose filenames and granularity for the actual project. Reuse suitable sources and show the file plan. Every applicable role below must be addressable; several roles may share a file, or one role may require many documents. No fixed document count is a minimum or maximum.

| Information | Required contents |
|---|---|
| Entry point | Purpose, current approved outcome, reading order, source precedence, current position, permitted first action and known blockers |
| Coverage and decisions | COV-001 register, domain vocabulary, evidence, assumptions, rejected/superseded choices, ownership and approval scope |
| Definition and specifications | Requirements, constraints, interfaces, domain/technical specifications, measurable acceptance and exclusions |
| Resources and organization | People/organizations, agents if useful, skills, equipment/materials, tools, environments, procurement, budget/schedule assumptions and availability |
| Execution strategy | Whole-outcome phases, dependencies, coordination, integration, change procedure, work definitions and future-dependent resolution work |
| Assurance and exceptions | Verification methods, reviewers, acceptance evidence, failed-check handling, retries, escalation, recovery and stop conditions |
| Delivery and operation | Handover outputs, acceptance authority, release/commissioning, support, maintenance, monitoring and end-of-life as applicable |
| Current state and history | Exact next action, completed work with evidence, open work, revision/decision history and resume instructions |

Trace requirements forward to artifacts, work and verification; trace work backward to a requirement or explicit enabling purpose. A summary does not substitute for the linked specification. Mark obsolete documents clearly so a recipient cannot mistake an earlier plan for the active one.

## Work definition

For each executable item specify:

- objective, requirement/concern IDs and terminal condition;
- authoritative inputs, versions, paths or bounded physical/domain context;
- prerequisites, dependencies and entry checks;
- responsible agent/person/organization, reviewer and integration owner where relevant;
- permitted actions, tools, resources and decisions; human-only actions and capabilities not available to the runtime;
- procedure or constraints sufficient for competent execution, expected outputs and interfaces;
- verification procedure and evidence that demonstrates success, including who accepts it;
- failure modes, bounded repair/retry, escalation, recovery/rollback or justified irreversibility;
- handback, checkpoint and how downstream work becomes eligible.

Specify the whole route to the agreed result. Decompose work far enough that execution does not require inventing missing product design. Do not pretend to know measurements, discoveries or supplier results that only later work can establish: create a resolution work item with inputs, method, owner, acceptance, dependent updates and a gate before affected work. Future detail must have an executable path to resolution, not a placeholder.

For agent systems, supplement with [multi-agent-system.md](multi-agent-system.md): assignment ownership, concurrency, file/resource boundaries, communication, conflicts, review and integration. A graph-loop executor needs dependency eligibility, claims, verification and retry/stop rules; a diagram alone does not supply an execution protocol. Do not assume that a named runtime supports a desired graph, model or tool.

## Same agent or a fresh recipient

Initialization prepares the system and does not itself launch future project agents. Once preparation and execution authority are satisfied, the same agent may switch to execution or a different agent/runtime may consume the folder. No new chat, different provider, board review, Studio or subscription is required.

The recipient reads the entry point, current state and applicable sources, checks available capabilities and prerequisites, then performs the first authorized eligible action. It does not repeat settled discovery merely because the model changed. It must reopen contradictions or missing facts rather than treating the folder as unquestionable truth.

## Folder acceptance

Check the actual delivered files, not a list of intended filenames:

1. Reading order and source precedence resolve to existing current documents; referenced inputs are included or have an explicit accessible location, owner and prerequisite for access. Secrets stay outside the package with authorized access procedures.
2. The outcome, first action, remaining route, dependencies, roles, authority, acceptance, recovery and completion conditions can be located without the chat.
3. No dangling relation, contradictory active decision, unowned blocker, placeholder specification or false implementation claim is hidden by formatting or a passing CLI command. Every number the folder states as fact, and especially every number a first action is accepted against, names the measurement it came from and the scope that measurement covered: a value measured on a sample is not restated as a property of the whole.
4. Produce the COV-001 readiness assessment, named scope, unresolved items and approval evidence. Human review grants only its stated authority.
5. If delivery/persistence is unavailable, provide the full documents and index for manual saving and mark folder acceptance pending until the saved files are checked. A compact state block alone is not a complete project folder.

When testing the method, give the folder to a recipient without the authoring chat and ask it to locate the route, first action and restrictions. Test same-agent continuation too. Record missing context and invented choices. A desk check is not a completed execution pilot; only claim outcomes actually exercised.

## Mechanical versus semantic assurance

The CLI can check supported structural invariants and preserve versions. Meaning, sufficiency, contradictions and domain adequacy require agent/human judgment and appropriate evidence. A passing integrity check is not execution readiness; a favorable model review is not proof of working implementation. The current alpha does not implement a project-package export command: skill/adapter export must not be described as exporting this dossier.
