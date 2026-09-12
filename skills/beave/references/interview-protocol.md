# Interview Protocol

## First exchange

After read-only discovery, reuse valid recorded collaboration decisions. Ask only missing or changed G0 information; for a new collaboration establish:

1. Do you want Guided, Standard, or Expert interaction?
2. Should answers be persisted during the interview, and in which approved location?
3. Who has final authority for product, technical, budget, safety, and release decisions?

Recommend Guided when the user benefits from one question at a time, Standard for most projects, and Expert when the project is high-risk, architecture-heavy, regulated, or explicitly requires exhaustive challenge. Existing briefs are always mined before asking; they do not define a separate interaction mode.

G0 is mandatory; repeated collection of valid answers is not. Before G0 is established, avoid platform, features, stack, architecture, integrations or agent design. Respect the chosen per-turn limits and wait for required answers.

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

Maintain COV-001 concerns with provenance, artifacts and blocking points beneath these aggregate module statuses. Do not close a concern because its module has a label. Track each module as:

- `NOT STARTED`
- `IN DISCUSSION`
- `CONFIRMED`
- `PARTIAL`
- `DEFERRED`
- `NOT APPLICABLE`
- `BLOCKED`

For every confirmed module record source, decision owner, date, affected requirements/decisions, and whether research is still needed.

## Operational forecast

Every substantial update ends with a short `Operational forecast` block: a group of answers recorded, a module closed, a suite run, a correction cycle finished. It exists because the residual a plan can see is not the residual that exists — the plan does not contain the work a verification is about to create.

State, in the user's vocabulary:

- **Phase:** the current lifecycle state.
- **Known work:** what remains and is already identified.
- **Conditional work:** what will exist only if a verification, an answer or a decision turns out a particular way, with the condition named.
- **Quantities:** observable ones — questions, question groups, task groups, suites, reviews, decisions — expressed as **ranges**. A single number only when the quantity is known, and then say that it is known.
- **Confidence:** `ALTA`, `MEDIA` or `BASSA`, with the reason for it. The reason is the useful half; a bare label is not a forecast.
- **Cycle state:** `REGOLARE`, `IN_ESPANSIONE`, `RISCHIO_LOOP` or `BLOCCATO`.
- **Change:** the difference from the previous forecast and its cause.

Never a completion percentage while its denominator can still change, and never a duration unless there is a basis for one. A number invented to sound precise is worse than a wide range, because it will be believed.

During the interview also state which areas are covered and which are still open, which questions are conditional on future answers, and why the estimate could grow or shrink. During implementation, verification and correction also state the verifications still to run and how many of them can open new work, the correction cycles already spent and the limit of the next one, the dependencies on other agents, tools or human decisions, and the concrete condition that would mean completion.

The conversation shows the forecast; showing it does not store it. Keep it in one canonical place ([artifacts-and-traceability.md](artifacts-and-traceability.md)), and record it through the engine when Hybrid is active ([engine-contract.md](engine-contract.md)).

### The last-step rule

**While a verification able to generate new work is outstanding, do not say "last operation", "final step", "almost finished" or any equivalent. Say that this is the last operation currently planned, and that the next review may generate corrections.**

This is binding and is not a matter of tone. It holds even when the claim is literally correct against the plan in hand, because the plan is exactly what does not yet contain the corrections. A gate that can fail, a suite that has not run and a review that has not happened are each such a verification.

### Loop risk

Raise at least `RISCHIO_LOOP` when any of these holds:

- the same family of defects returns after two correction cycles;
- the residual forecast grows across two consecutive updates without a phase closing;
- two consecutive forecasts carry the same phase and a wider range;
- operations repeat without producing new evidence or reducing blockers and findings;
- two consecutive verifications reopen work previously declared finished;
- a final step was announced more than once and work was then added.

The engine derives the first four from recorded history and returns them beside the forecast; watch them yourself in Semantic-only, and reconcile your judgement with its signals in Hybrid ([engine-contract.md](engine-contract.md)). **The last two are yours alone.** They are about the conversation and not about the data: no ledger records that a step was called the last one, and the engine must not pretend to see it.

### When the engine contradicts you

`beave forecast` never overwrites the cycle state you declared. When a derived signal disagrees with it, the command records the signal beside your judgement and says so on stdout.

That output is addressed to you, and it carries an obligation. **Do not record the same cycle state again without answering the signal.** Either say why the signal is wrong for this project — a residual that grew because scope was deliberately widened is not a loop — or accept it and record the state it implies. Recording `REGOLARE` a second time over a standing `RISCHIO_LOOP` signal, with nothing said about it, turns the disagreement into noise the engine will keep printing and nobody will keep reading.

The signal names what it observed. Quote that sentence to the person rather than paraphrasing it: it is the difference between a claim you are making and a measurement the ledger supports.

Raising the signal is not stopping. An important project is not halted because work grew; the growth is made visible early enough for the person to decide. Show:

1. the observed cause;
2. what genuinely closed;
3. what keeps reopening;
4. the limit of the next cycle;
5. a recommended choice between a bounded cycle, a method review, a checkpoint and a stop.

Then wait for the decision, as at any other gate.

## Cognitive-load controls

Use the interaction mode confirmed at Gate G0:

- Guided: one question at a time with explanations;
- Standard: up to two related questions with balanced depth;
- Expert: up to three related questions with more technical discussion and explicit challenge; evidence follows project risk in every mode.

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
