# Research, Tools, Skills, and Services

## Decision order

1. Define the capability or uncertainty.
2. Determine whether local evidence answers it.
3. Choose research, experiment, or expert/user decision.
4. Compare implementation mechanisms.
5. Propose one option and alternatives.
6. Wait for approval before installation, authentication, or external mutation.

## Mechanism selection

| Mechanism | Prefer when | Main checks |
|---|---|---|
| Built-in agent capability | task is general and no durable special process is needed | reliability, permissions |
| Skill | a repeatable decision/workflow pattern improves agent behavior | trigger precision, scope, maintenance |
| Library/package | behavior belongs in product code | provenance, license, support, supply chain |
| CLI | deterministic local automation is valuable | platform support, exit codes, install scope |
| MCP server | live structured tool access is repeatedly needed | permissions, startup cost, data egress, write risk |
| Plugin/app connector | user account or external service capability is required | permissions, vendor trust, revocation |
| Browser automation | no stable semantic interface exists and UI work is authorized | fragility, account impact, confirmation |
| Custom adapter | project needs a stable boundary around an external provider | testing, fallback, ownership |

Prefer deferred/lazy activation for expensive or context-heavy tools. A tool being available is not evidence it is appropriate.

## Research plan

For each research stream record:

- decision supported;
- bounded question and non-goals;
- local inputs and external sources;
- whether workspace data leaves the machine;
- assigned agent/tool and required permissions;
- time/token/money budget;
- expected deliverable and confidence;
- stop condition and decision owner.

Parallelize research only when streams are independent. Synthesis remains one owned task that preserves disagreements and source quality.

## Source quality

- Prefer official documentation, standards, original research, provider terms, and primary repositories.
- Verify current versions, pricing, support, security, and legal terms at decision time.
- Separate sourced fact, inference, benchmark result, anecdote, and recommendation.
- Record uncertainty and the date of unstable facts.
- Do not paste large copyrighted sources into project artifacts; summarize and link.

## Software and stack proposal

Compare viable options against project constraints:

- platform and deployment fit;
- team skill and learning cost;
- maturity and maintenance;
- performance and scalability;
- security and privacy;
- licensing and commercial terms;
- testing, observability, migration, and exit path;
- agent/tool ecosystem;
- total cost and operational burden.

Use a prototype when evidence cannot resolve a material uncertainty. Define success and failure criteria before prototyping.

## AI and agents

Before enabling AI providers or cross-runtime agents, decide:

- exact task and evaluation dataset;
- local versus hosted processing;
- content and metadata egress;
- supported models and effort levels;
- cost/latency/context ceilings;
- prompt and output retention;
- fallback and failure behavior;
- human review and prohibited actions.

Do not treat prompt cache as durable project memory. Use files and handoffs for continuity.

## Graphs and indexes

Use codebase maps or knowledge graphs when they reduce discovery cost. Keep them derived, inspect health, ignore sensitive files, and cite canonical sources in conclusions. Do not make an always-on MCP, watcher, or hook the default.
