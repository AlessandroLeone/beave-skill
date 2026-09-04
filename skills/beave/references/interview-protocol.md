# Interview Protocol

## First exchange

After read-only discovery, introduce the provisional mode and ask:

1. Do you want Guided, Standard, or Expert interaction?
2. Should answers be persisted during the interview, and in which approved location?
3. Who has final authority for product, technical, budget, safety, and release decisions?

Recommend Guided when the user benefits from one question at a time, Standard for most projects, and Expert when the project is high-risk, architecture-heavy, regulated, or explicitly requires exhaustive challenge. Existing briefs are always mined before asking; they do not define a separate interaction mode.

This is Gate G0 and is mandatory. The first exchange must not ask about platform, features, stack, architecture, sync, integrations, agents, or implementation. Those belong to later modules. After asking the three collaboration-contract questions, stop and wait.

## Module loop

Use this exact conversational rhythm:

1. **Known:** no more than five observed or confirmed facts.
2. **Decision now:** explain why the current area affects downstream work.
3. **Recommendation:** one preferred option with trade-offs.
4. **Alternatives:** at most two meaningful alternatives.
5. **Questions:** one to three related questions, phrased in the user's vocabulary.
6. **Wait:** do not move to the next module or create final artifacts.
7. **Confirm:** restate the answer and its consequence; ask for correction.

If an answer introduces a contradiction, stop and resolve it before continuing. If the user does not know, propose a reversible assumption with an expiry or an experiment that can answer the question.

One to three questions is a per-turn cognitive-load limit, not a completeness limit. Repeat the module loop as many times as necessary. A complex project may legitimately require 150 or more questions across the full interview; a simple project still receives complete coverage of every applicable concern.

## Question quality

A useful question changes scope, architecture, safety, cost, experience, delivery, or orchestration. Do not ask:

- facts already available in files or tools;
- premature implementation trivia;
- several unrelated decisions in one sentence;
- questions with fake choices that lead to the same outcome;
- questions whose answer the agent has already silently assumed.

When offering options, include consequences. Recommend only when the evidence supports a preference.

## Trust calibration

Assume the user may accept a recommendation because it came from an AI. Adapt explanations to the user's demonstrated expertise, but never exploit deference or treat silence as informed approval. For consequential recommendations:

- label what is observed, inferred, assumed, or recommended;
- explain why the option fits this project and what could make it wrong;
- show meaningful alternatives and consequences;
- state uncertainty and research needs;
- obtain visible confirmation before recording the decision.

## Coverage ledger

Track each module as:

- `NOT STARTED`
- `IN DISCUSSION`
- `CONFIRMED`
- `PARTIAL`
- `DEFERRED`
- `NOT APPLICABLE`
- `BLOCKED`

For every confirmed module record source, decision owner, date, affected requirements/decisions, and whether research is still needed.

## Cognitive-load controls

Use the interaction mode confirmed at Gate G0:

- Guided: one question at a time with explanations;
- Standard: up to two related questions with balanced depth;
- Expert: up to three related questions, edge-case challenges, and stronger gate evidence.

Never reduce safety warnings, blockers, or verification evidence. Allow `pause`, `recap`, `back`, `defer`, and `why` at any time. When the user says the project is sufficient for now, close only the approved current milestone and record remaining applicable work as deferred future scope.

## When to research

Research only after defining the decision it should inform. Present:

- the research question;
- sources/data that would leave the workspace;
- expected cost or latency;
- whether subagents or external tools are proposed;
- the stopping condition.

Wait for authority when egress, paid services, authentication, or broad crawling is involved.

## Synthesis gate

Before drafting the blueprint, present:

- confirmed decisions;
- assumptions with expiry;
- deferred items and their owner;
- contradictions resolved;
- unresolved blockers;
- proposed artifact depth and file plan.

Wait for user approval. Approval of the synthesis does not authorize installation, implementation, commit, push, deployment, or release.
