import { describe, it } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ageProject } from "./older-engine.mjs";

/**
 * ALN-008 / D5 / FR-024 — progress forecast and rework-loop detection in the engine.
 *
 * The requirement is `docs/decisions/2026-09-10-progress-forecast-and-loop-detection.md`
 * and `planning/CLAUDE_PROGRESS_FORECAST_ADDENDUM.md`. The observed defect is an
 * agent that announces "one operation remains" and is contradicted by a
 * verification that had not run yet: literally true against the plan it holds, and
 * misleading anyway, because the plan does not contain the work the verification is
 * about to create.
 *
 * Each `describe` below is one of the behavioural scenarios the decision-maker
 * named. Every test in this file was run against a build of the previous `cli.ts`
 * compiled in the system temporary directory, and every one of them fails there;
 * the counts are in the ALN-008 CORE-D5 report. `BEAVE_CLI` exists for that: it is
 * how this file is pointed at a reverted engine without a second copy of the tests.
 */

const CLI = process.env.PLANGONAUT_CLI ? path.resolve(process.env.PLANGONAUT_CLI) : path.resolve("lib/bin/plangonaut.js");
const SCHEMA = path.resolve("skills/plangonaut/schemas/state-v3.schema.json");
const owners = { product: "Ada", technical: "Ada", budget: "Ada", safety: "Ada", release: "Ada" };

function run(args, cwd) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function readState(root) {
  return JSON.parse(fs.readFileSync(path.join(root, ".plangonaut", "state.json"), "utf8"));
}

function events(root) {
  return fs
    .readFileSync(path.join(root, ".plangonaut", "events.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function project(name = "D5") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-d5-"));
  fs.writeFileSync(path.join(root, "owners.json"), JSON.stringify(owners));
  const result = run([
    "init", "--project-root", ".", "--project-name", name, "--project-mode", "Genesis",
    "--interaction-mode", "Standard", "--owners-file", "owners.json",
    "--operation-id", `OP-init-${name}`,
  ], root);
  assert.strictEqual(result.status, 0, result.stderr);
  return root;
}

/**
 * One forecast. Everything the contract marks required is required here too, so a
 * test that forgets one gets a refusal rather than a silently narrower record.
 */
function forecast(root, options) {
  const args = ["forecast", "--project-root", "."];
  for (const [key, value] of Object.entries(options)) {
    if (key === "operationId" || value === undefined) continue;
    args.push(`--${key}`, String(value));
  }
  args.push("--operation-id", options.operationId ?? `OP-${crypto.randomUUID()}`);
  return run(args, root);
}

const BASE = {
  owner: "Ada",
  phase: "definizione requisiti e vincoli",
  "known-work": "4 aree aperte",
  "conditional-work": "fino a 8 domande aggiuntive se emergono obblighi normativi",
  questions: "12-20",
  operations: "3-5",
  cycles: "1-2",
  confidence: "MEDIA",
  "confidence-reason": "due responsabili non sono ancora identificati",
  "cycle-state": "REGOLARE",
};

describe("D5 scenario 1: a forecast that grows between two updates keeps the reason", () => {
  it("records the growth, keeps the cause, and derives the growth signal", () => {
    const root = project("Expansion");
    assert.strictEqual(forecast(root, BASE).status, 0);

    const grown = forecast(root, {
      ...BASE,
      "known-work": "6 aree aperte",
      questions: "20-32",
      "change-reason": "+8 domande per il nuovo mercato UE",
    });
    assert.strictEqual(grown.status, 0, grown.stderr);

    const state = readState(root);
    assert.strictEqual(state.progress_forecast.questions.min, 20);
    assert.strictEqual(state.progress_forecast.questions.max, 32);
    // The reason a forecast grew is kept on the record, not only announced once.
    assert.strictEqual(state.progress_forecast.change_reason, "+8 domande per il nuovo mercato UE");
    // And the previous value is still readable, in order.
    assert.strictEqual(state.forecast_history.length, 1);
    assert.strictEqual(state.forecast_history[0].questions.max, 20);
    assert.strictEqual(state.forecast_history[0].change_reason, null, "the first forecast changed nothing");

    const codes = state.progress_forecast.signals.map((signal) => signal.code);
    assert.ok(codes.includes("RESIDUAL_GREW_WITHOUT_PHASE_CLOSING"), codes.join(","));
    assert.match(grown.stdout, /The residual grew from 27 to 39 without a phase closing/);
    assert.match(grown.stdout, /It has now grown for 1 consecutive forecast\./);
  });

  it("does not raise the growth signal when the phase closed", () => {
    // Growth is normal when the project moved on. The signal is about growth that
    // buys nothing, which is why "without a phase closing" is part of it.
    const root = project("ExpansionClosed");
    assert.strictEqual(forecast(root, BASE).status, 0);
    const moved = forecast(root, {
      ...BASE,
      phase: "progettazione",
      questions: "20-32",
      "change-reason": "la fase di intervista si è chiusa e la progettazione ha aperto altro lavoro",
    });
    assert.strictEqual(moved.status, 0, moved.stderr);
    const codes = readState(root).progress_forecast.signals.map((signal) => signal.code);
    assert.ok(!codes.includes("RESIDUAL_GREW_WITHOUT_PHASE_CLOSING"), codes.join(","));
    assert.ok(!codes.includes("SAME_PHASE_WIDER_RANGE"), codes.join(","));
  });

  it("raises the widening signal when the same phase carries a wider range", () => {
    const root = project("Widening");
    assert.strictEqual(forecast(root, { ...BASE, questions: "12-14" }).status, 0);
    const wider = forecast(root, {
      ...BASE,
      questions: "12-24",
      "change-reason": "la stima è meno certa di prima",
    });
    assert.strictEqual(wider.status, 0, wider.stderr);
    assert.match(
      wider.stdout,
      /Two consecutive forecasts carry the same phase \("definizione requisiti e vincoli"\) and a wider range: questions 12-14 became 12-24\./,
    );
  });
});

describe("D5 scenario 2: work conditional on a verification that has not run", () => {
  it("keeps conditional work separate from known work, in the record and in resume", () => {
    const root = project("Conditional");
    const recorded = forecast(root, {
      ...BASE,
      "known-work": "1 operazione pianificata: chiudere il modulo 4",
      "conditional-work": "la revisione di sicurezza non è ancora stata eseguita e può generare correzioni",
    });
    assert.strictEqual(recorded.status, 0, recorded.stderr);

    const entry = readState(root).progress_forecast;
    assert.strictEqual(entry.known_work, "1 operazione pianificata: chiudere il modulo 4");
    assert.strictEqual(
      entry.conditional_work,
      "la revisione di sicurezza non è ancora stata eseguita e può generare correzioni",
    );
    assert.notStrictEqual(entry.known_work, entry.conditional_work);

    // The distinction has to survive into what a fresh agent reads, or it does not
    // exist: this is the field that stops the previous step being called "last".
    const resumed = run(["resume", "--project-root", "."], root);
    assert.strictEqual(resumed.status, 0, resumed.stderr);
    assert.match(resumed.stdout, /- Known work remaining: 1 operazione pianificata: chiudere il modulo 4/);
    assert.match(resumed.stdout, /- Conditional work: la revisione di sicurezza non è ancora stata eseguita e può generare correzioni/);
  });
});

describe("D5 scenario 3: two cycles on the same defect family raise a loop signal", () => {
  /** A task that was DONE, came back, was DONE again, and came back again. */
  function projectWithReopenedTask(name) {
    const root = project(name);
    const statuses = [["READY", null], ["DONE", 1], ["IN_PROGRESS", 2], ["DONE", 3], ["IN_PROGRESS", 4]];
    for (const [status, expected] of statuses) {
      const args = ["task", "--project-root", ".", "--id", "TSK-SEAL", "--title", "the sealing defect",
        "--status", status, "--owner", "Ada", "--operation-id", `OP-${crypto.randomUUID()}`];
      if (expected !== null) args.push("--expected-revision", String(expected));
      const result = run(args, root);
      assert.strictEqual(result.status, 0, result.stderr);
    }
    return root;
  }

  it("derives the signal from the recorded status history, naming the record", () => {
    const root = projectWithReopenedTask("Reopened");
    const recorded = forecast(root, { ...BASE, phase: "correzioni" });
    assert.strictEqual(recorded.status, 0, recorded.stderr);
    assert.match(
      recorded.stdout,
      /Work declared finished returned after two correction cycles: TSK-SEAL reopened 2 times\./,
    );
    const signal = readState(root).progress_forecast.signals.find(
      (item) => item.code === "DEFECT_FAMILY_REOPENED_AFTER_TWO_CYCLES",
    );
    assert.ok(signal, "the signal must be stored, not only printed");
    assert.strictEqual(signal.implies_cycle_state, "RISCHIO_LOOP");
    assert.strictEqual(signal.detail.records["TSK-SEAL"], 2);
  });

  it("does not raise it after one cycle", () => {
    // Reopening once is a correction. The requirement is two.
    const root = project("ReopenedOnce");
    for (const [status, expected] of [["DONE", null], ["IN_PROGRESS", 1]]) {
      const args = ["task", "--project-root", ".", "--id", "TSK-SEAL", "--title", "the sealing defect",
        "--status", status, "--owner", "Ada", "--operation-id", `OP-${crypto.randomUUID()}`];
      if (expected !== null) args.push("--expected-revision", String(expected));
      assert.strictEqual(run(args, root).status, 0);
    }
    assert.strictEqual(forecast(root, BASE).status, 0);
    const codes = readState(root).progress_forecast.signals.map((item) => item.code);
    assert.ok(!codes.includes("DEFECT_FAMILY_REOPENED_AFTER_TWO_CYCLES"), codes.join(","));
  });

  it("records the status a ledger record moved to, which is where the signal comes from", () => {
    // The transition history existed nowhere before this: the event carried the id,
    // the revision and the owner, and the state carried only the latest value.
    const root = projectWithReopenedTask("StatusHistory");
    const taskEvents = events(root).filter((event) => event.type?.startsWith("TASK_"));
    assert.strictEqual(taskEvents.length, 5);
    assert.deepStrictEqual(
      taskEvents.map((event) => event.record_status),
      ["READY", "DONE", "IN_PROGRESS", "DONE", "IN_PROGRESS"],
    );
  });

  it("says that reopening is not observable when no event recorded a status", () => {
    // Every project written before ALN-008 is in this shape. An absent signal must
    // read as "not observable here", never as "did not happen".
    const root = projectWithReopenedTask("StatusHistoryStripped");
    const location = path.join(root, ".plangonaut", "events.jsonl");
    const stripped = fs
      .readFileSync(location, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const event = JSON.parse(line);
        delete event.record_status;
        return JSON.stringify(event);
      })
      .join("\n");
    fs.writeFileSync(location, `${stripped}\n`);

    const recorded = forecast(root, BASE);
    assert.strictEqual(recorded.status, 0, recorded.stderr);
    assert.match(recorded.stdout, /Reopening signals are not observable in this project/);
    assert.match(recorded.stdout, /Absence of that signal here is not evidence of absence\./);
    assert.strictEqual(readState(root).progress_forecast.derived.status_history_events, 0);
  });
});

describe("D5 scenario 4: a forecast that changes keeps the cause of the change", () => {
  it("refuses a later forecast without --change-reason and writes nothing", () => {
    const root = project("ChangeReason");
    assert.strictEqual(forecast(root, BASE).status, 0);
    const before = readState(root);

    const refused = forecast(root, { ...BASE, questions: "20-32" });
    assert.strictEqual(refused.status, 2, refused.stdout);
    assert.match(refused.stderr, /--change-reason is required: this project already recorded a progress forecast on/);
    assert.match(refused.stderr, /a forecast that changes without its cause cannot explain itself later/);
    assert.match(refused.stderr, /Nothing was written\./);

    const after = readState(root);
    assert.strictEqual(after.revision, before.revision, "a refused forecast must not move the revision");
    assert.strictEqual(after.progress_forecast.questions.max, 20);
    assert.strictEqual(events(root).at(-1).type, "PROGRESS_FORECAST_RECORDED");
    assert.strictEqual(events(root).filter((event) => event.type === "PROGRESS_FORECAST_RECORDED").length, 1);
  });

  it("refuses --change-reason on the first forecast, because there is nothing it changed from", () => {
    const root = project("FirstChangeReason");
    const refused = forecast(root, { ...BASE, "change-reason": "nothing preceded this" });
    assert.strictEqual(refused.status, 2, refused.stdout);
    assert.match(refused.stderr, /this is the first forecast for this project, so there is nothing it changed from/);
    assert.strictEqual(readState(root).progress_forecast, undefined);
  });

  it("keeps every previous forecast in order, each with its own cause", () => {
    const root = project("History");
    assert.strictEqual(forecast(root, BASE).status, 0);
    assert.strictEqual(forecast(root, { ...BASE, questions: "16-24", "change-reason": "prima causa" }).status, 0);
    assert.strictEqual(forecast(root, { ...BASE, questions: "18-26", "change-reason": "seconda causa" }).status, 0);

    const state = readState(root);
    assert.deepStrictEqual(
      state.forecast_history.map((entry) => entry.change_reason),
      [null, "prima causa"],
    );
    assert.strictEqual(state.progress_forecast.change_reason, "seconda causa");
    assert.deepStrictEqual(
      [...state.forecast_history.map((entry) => entry.state_revision), state.progress_forecast.state_revision],
      [2, 3, 4],
    );
  });

  it("refuses a stale forecast when --expected-revision does not match", () => {
    const root = project("Stale");
    assert.strictEqual(forecast(root, BASE).status, 0);
    const stale = forecast(root, { ...BASE, "change-reason": "x", "expected-revision": "99" });
    assert.strictEqual(stale.status, 2, stale.stdout);
    assert.match(stale.stderr, /Stale progress forecast: expected revision 2\. No changes written\./);

    const fresh = forecast(root, { ...BASE, "change-reason": "x", "expected-revision": "2" });
    assert.strictEqual(fresh.status, 0, fresh.stderr);
  });
});

describe("D5 scenario 5: resume returns the forecast without the chat", () => {
  it("returns forecast, confidence, cycle state and provenance", () => {
    const root = project("Resume");
    assert.strictEqual(forecast(root, BASE).status, 0);
    assert.strictEqual(
      forecast(root, { ...BASE, "cycle-state": "IN_ESPANSIONE", "change-reason": "il perimetro si è allargato" }).status,
      0,
    );
    const entry = readState(root).progress_forecast;

    const resumed = run(["resume", "--project-root", "."], root);
    assert.strictEqual(resumed.status, 0, resumed.stderr);
    assert.match(resumed.stdout, /## Progress forecast/);
    assert.match(resumed.stdout, /- Phase: definizione requisiti e vincoli/);
    assert.match(resumed.stdout, /- Questions: 12-20/);
    assert.match(resumed.stdout, /- Confidence: MEDIA — due responsabili non sono ancora identificati/);
    assert.match(resumed.stdout, /- Cycle state, as recorded by the caller: IN_ESPANSIONE/);
    // Provenance: who, when, at which revision, and why it changed.
    assert.ok(resumed.stdout.includes(`- Recorded by Ada at ${entry.recorded_at}, state revision ${entry.state_revision}`));
    assert.match(resumed.stdout, /- Why it changed: il perimetro si è allargato/);
  });

  it("carries the forecast and the recent history into context-pack", () => {
    const root = project("ContextPack");
    assert.strictEqual(forecast(root, BASE).status, 0);
    assert.strictEqual(forecast(root, { ...BASE, questions: "16-24", "change-reason": "prima causa" }).status, 0);

    const pack = run(["context-pack", "--project-root", "."], root);
    assert.strictEqual(pack.status, 0, pack.stderr);
    assert.match(pack.stdout, /## Progress forecast/);
    assert.match(pack.stdout, /- Questions: 16-24/);
    assert.match(pack.stdout, /## Progress forecast history/);
    assert.match(pack.stdout, /questions 12-20.*first forecast recorded for this project/);
  });

  it("reads the recorded forecast when no writing option is given", () => {
    const root = project("ReadMode");
    assert.strictEqual(forecast(root, BASE).status, 0);
    const read = run(["forecast", "--project-root", "."], root);
    assert.strictEqual(read.status, 0, read.stderr);
    assert.match(read.stdout, /- Phase: definizione requisiti e vincoli/);
    // A read writes nothing.
    const before = readState(root).revision;
    assert.strictEqual(run(["forecast", "--project-root", "."], root).status, 0);
    assert.strictEqual(readState(root).revision, before);
  });
});

describe("D5 scenario 6: a project that never recorded a forecast says so", () => {
  it("shows no zero, no default and no empty range anywhere it surfaces", () => {
    const root = project("NeverRecorded");
    const state = readState(root);
    assert.ok(!("progress_forecast" in state), "an unrecorded forecast is absent, not an empty object");

    const read = run(["forecast", "--project-root", "."], root);
    assert.strictEqual(read.status, 0, read.stderr);
    assert.match(
      read.stdout,
      /No progress forecast has ever been recorded for this project\. That is not zero remaining work, not a default and not a measurement: nothing was recorded\./,
    );
    // A refusal or a gap has to name the way out.
    assert.match(read.stdout, /Record one with: plangonaut forecast --project-root \. --owner NAME/);

    const resumed = run(["resume", "--project-root", "."], root);
    assert.match(resumed.stdout, /No progress forecast has ever been recorded for this project\./);
    assert.match(resumed.stdout, /Record one with: plangonaut forecast/);

    const status = JSON.parse(run(["status", "--project-root", "."], root).stdout);
    assert.strictEqual(status.progress_forecast.recorded, false);
    assert.match(status.progress_forecast.note, /nothing was recorded/);

    for (const output of [read.stdout, resumed.stdout, JSON.stringify(status)]) {
      assert.doesNotMatch(output, /0-0/, "an empty range would read like a measurement nobody made");
      assert.doesNotMatch(output, /"questions":\s*\{/, "no range may be reported for a forecast nobody recorded");
    }
  });
});

describe("D5: no percentage is stored anywhere", () => {
  it("refuses a percentage on the command line and names the rule", () => {
    const root = project("Percentage");
    const refused = forecast(root, { ...BASE, questions: "60%" });
    assert.strictEqual(refused.status, 2, refused.stdout);
    assert.match(refused.stderr, /--questions does not take a percentage\./);
    assert.match(refused.stderr, /A percentage whose denominator can still change is presented as a fact and is not one/);
    assert.match(refused.stderr, /Nothing was written\./);
    assert.strictEqual(readState(root).progress_forecast, undefined);
  });

  it("stores a single number as a known quantity, not as a guess", () => {
    const root = project("KnownQuantity");
    const recorded = forecast(root, { ...BASE, questions: "4" });
    assert.strictEqual(recorded.status, 0, recorded.stderr);
    assert.deepStrictEqual(readState(root).progress_forecast.questions, { min: 4, max: 4 });
    assert.match(recorded.stdout, /Questions: 4 \(known\)/);
  });

  it("keeps no percentage field in the stored state or the event", () => {
    const root = project("NoPercentField");
    assert.strictEqual(forecast(root, BASE).status, 0);
    const entry = readState(root).progress_forecast;
    const event = events(root).at(-1);
    for (const subject of [entry, event]) {
      assert.doesNotMatch(JSON.stringify(Object.keys(subject)), /percent|pct/i);
    }
  });

  it("refuses an inverted or unparseable range", () => {
    const root = project("BadRange");
    const inverted = forecast(root, { ...BASE, operations: "9-2" });
    assert.strictEqual(inverted.status, 2, inverted.stdout);
    assert.match(inverted.stderr, /--operations has an inverted range: 9-2\. The lower bound must not exceed the upper bound\./);

    const nonsense = forecast(root, { ...BASE, cycles: "some" });
    assert.strictEqual(nonsense.status, 2, nonsense.stdout);
    assert.match(nonsense.stderr, /--cycles must be a range like 3-8, or a single number when the quantity is known; received some\./);
  });
});

describe("D5: the engine names a disagreement instead of settling it", () => {
  it("records the caller's cycle state unchanged and says the signals contradict it", () => {
    const root = project("Disagreement");
    assert.strictEqual(forecast(root, BASE).status, 0);
    const grown = forecast(root, {
      ...BASE,
      questions: "20-40",
      "cycle-state": "REGOLARE",
      "change-reason": "altre aree aperte",
    });
    assert.strictEqual(grown.status, 0, grown.stderr);

    // Recorded exactly as supplied. Not corrected.
    assert.strictEqual(readState(root).progress_forecast.cycle_state, "REGOLARE");
    // And not accepted in silence.
    assert.match(grown.stdout, /Derived signals disagree with the recorded cycle state\./);
    assert.match(grown.stdout, /Recorded by the caller: REGOLARE/);
    assert.match(grown.stdout, /Derived by the engine from recorded data: RISCHIO_LOOP/);
    assert.match(
      grown.stdout,
      /The recorded cycle state was NOT changed\. Plangonaut does not overwrite a person's judgement and does not accept it in silence either; the signals are stored beside it in progress_forecast\.signals\./,
    );

    // The disagreement travels with the folder, not only with the terminal of
    // whoever ran the command.
    const resumed = run(["resume", "--project-root", "."], root);
    assert.match(resumed.stdout, /Derived signals disagree with the recorded cycle state\./);
    const status = JSON.parse(run(["status", "--project-root", "."], root).stdout);
    assert.strictEqual(status.progress_forecast.cycle_state, "REGOLARE");
    assert.strictEqual(status.progress_forecast.derived_cycle_state, "RISCHIO_LOOP");
  });

  it("says nothing when the caller already recorded a state at least as strong", () => {
    const root = project("NoDisagreement");
    assert.strictEqual(forecast(root, BASE).status, 0);
    const grown = forecast(root, {
      ...BASE,
      questions: "20-40",
      "cycle-state": "RISCHIO_LOOP",
      "change-reason": "altre aree aperte",
    });
    assert.strictEqual(grown.status, 0, grown.stderr);
    assert.doesNotMatch(grown.stdout, /Derived signals disagree/);
    assert.ok(grown.stdout.includes("RESIDUAL_GREW_WITHOUT_PHASE_CLOSING"), "the signal is still reported");
  });
});

describe("D5: operations that produce nothing", () => {
  it("raises the signal when operations repeat with no evidence and no fall in findings", () => {
    const root = project("Spinning");
    assert.strictEqual(
      run(["risk", "--project-root", ".", "--id", "RSK-1", "--title", "open finding", "--severity", "HIGH",
        "--status", "IDENTIFIED", "--owner", "Ada", "--operation-id", "OP-risk"], root).status,
      0,
    );
    assert.strictEqual(forecast(root, { ...BASE, phase: "correzioni" }).status, 0);
    for (const id of ["DEC-1", "DEC-2", "DEC-3"]) {
      assert.strictEqual(
        run(["decision", "--project-root", ".", "--id", id, "--title", "another pass", "--status", "PROPOSED",
          "--owner", "Ada", "--operation-id", `OP-${id}`], root).status,
        0,
      );
    }
    const again = forecast(root, { ...BASE, phase: "correzioni", "change-reason": "nulla si è chiuso" });
    assert.strictEqual(again.status, 0, again.stderr);
    assert.match(
      again.stdout,
      /3 operations were recorded since the previous forecast, no evidence record was added, and open blockers plus findings did not fall \(1 before, 1 now\)\./,
    );
  });

  it("does not raise it when there is nothing open to reduce", () => {
    // Without this guard the signal fires on every healthy project, and a warning
    // that is always on is not a warning.
    const root = project("NothingOpen");
    assert.strictEqual(forecast(root, BASE).status, 0);
    for (const id of ["DEC-1", "DEC-2", "DEC-3"]) {
      assert.strictEqual(
        run(["decision", "--project-root", ".", "--id", id, "--title", "ordinary progress", "--status", "APPROVED",
          "--owner", "Ada", "--operation-id", `OP-${id}`], root).status,
        0,
      );
    }
    const again = forecast(root, { ...BASE, "change-reason": "avanzamento normale" });
    assert.strictEqual(again.status, 0, again.stderr);
    const codes = readState(root).progress_forecast.signals.map((signal) => signal.code);
    assert.ok(!codes.includes("OPERATIONS_WITHOUT_A_FALL_IN_BLOCKERS_OR_FINDINGS"), codes.join(","));
  });
});

describe("D5: what the engine counts for itself", () => {
  it("derives counts from the ledgers and takes none of them from the caller", () => {
    const root = project("Derived");
    assert.strictEqual(
      run(["risk", "--project-root", ".", "--id", "RSK-1", "--title", "open finding", "--severity", "HIGH",
        "--status", "IDENTIFIED", "--owner", "Ada", "--operation-id", "OP-risk"], root).status,
      0,
    );
    assert.strictEqual(
      run(["task", "--project-root", ".", "--id", "TSK-1", "--title", "one task", "--status", "READY",
        "--owner", "Ada", "--operation-id", "OP-task"], root).status,
      0,
    );
    assert.strictEqual(forecast(root, BASE).status, 0);

    const derived = readState(root).progress_forecast.derived;
    assert.strictEqual(derived.open_blockers, 0);
    assert.strictEqual(derived.open_overrides, 0);
    assert.strictEqual(derived.open_findings, 1);
    assert.strictEqual(derived.tasks_by_status.READY, 1);
    assert.strictEqual(derived.tasks_by_status.DONE, 0);
    // G1 is current, so G1..G12 remain. G0 is passed by `init` and never written as
    // a gate record, which is why this is counted from `current_gate`.
    assert.strictEqual(derived.gates_remaining, 12);
    assert.strictEqual(derived.unresolved_modules.length, 16);

    // No option can write any of it.
    const refused = forecast(root, { ...BASE, "change-reason": "x", derived: "{}" });
    assert.strictEqual(refused.status, 2, refused.stdout);
    assert.match(refused.stderr, /Unknown option for forecast: --derived/);
  });
});

describe("D5: the record behaves like every other governed mutation", () => {
  it("writes one PROGRESS_FORECAST_RECORDED event carrying the whole entry", () => {
    const root = project("Event");
    assert.strictEqual(forecast(root, { ...BASE, operationId: "OP-forecast-1" }).status, 0);
    const event = events(root).at(-1);
    assert.strictEqual(event.type, "PROGRESS_FORECAST_RECORDED");
    assert.strictEqual(event.owner, "Ada");
    assert.strictEqual(event.confidence, "MEDIA");
    assert.strictEqual(event.cycle_state, "REGOLARE");
    assert.deepStrictEqual(event.questions, { min: 12, max: 20 });
    assert.strictEqual(event.change_reason, null);
    assert.strictEqual(event.previous_state_revision, null);
    assert.strictEqual(event.state_revision, readState(root).revision);
    assert.strictEqual(event.operation_id, "OP-forecast-1");
  });

  it("treats an identical retry as a retry and a changed one as an error", () => {
    const root = project("Idempotency");
    assert.strictEqual(forecast(root, { ...BASE, operationId: "OP-forecast-1" }).status, 0);
    const revision = readState(root).revision;

    const retry = forecast(root, { ...BASE, operationId: "OP-forecast-1" });
    assert.strictEqual(retry.status, 0, retry.stderr);
    assert.match(retry.stdout, /Idempotent retry: forecast already applied\./);
    assert.strictEqual(readState(root).revision, revision, "a retry must not write a second event");

    const reused = forecast(root, { ...BASE, questions: "1-2", operationId: "OP-forecast-1" });
    assert.strictEqual(reused.status, 2, reused.stdout);
    assert.match(reused.stderr, /was already used with different input/);
  });

  it("is recoverable: event, backup, and a cleared transaction", () => {
    const root = project("Recovery");
    assert.strictEqual(forecast(root, BASE).status, 0);
    const transactions = path.join(root, ".plangonaut", "transactions");
    assert.ok(
      !fs.existsSync(transactions) || fs.readdirSync(transactions).length === 0,
      "a completed forecast leaves no open transaction",
    );
    assert.ok(
      fs.readdirSync(path.join(root, ".plangonaut", "backups")).some((name) => name.startsWith("state.json.")),
      "the previous state must stay recoverable",
    );
  });

  it("refuses an unknown owner and an option it cannot store", () => {
    const root = project("Refusals");
    const stranger = forecast(root, { ...BASE, owner: "Somebody Else" });
    assert.strictEqual(stranger.status, 2, stranger.stdout);
    assert.match(stranger.stderr, /Owner is not one of the confirmed decision owners/);

    const unknown = forecast(root, { ...BASE, "next-action": "x" });
    assert.strictEqual(unknown.status, 2, unknown.stdout);
    assert.match(unknown.stderr, /Unknown option for forecast: --next-action/);
  });

  it("records a forecast while the project is BLOCKED on an override", () => {
    // BLOCCATO is one of the four cycle states. A command that refused while the
    // project was blocked could never record the state that says it is blocked.
    const root = project("Blocked");
    fs.writeFileSync(path.join(root, "direction.md"), "the direction as given\n");
    assert.strictEqual(
      run(["override", "--project-root", ".", "--instruction-file", "direction.md", "--owner", "Ada",
        "--reason", "human direction", "--operation-id", "OP-override"], root).status,
      0,
    );
    assert.strictEqual(readState(root).needs_reconciliation, true);

    const recorded = forecast(root, { ...BASE, "cycle-state": "BLOCCATO" });
    assert.strictEqual(recorded.status, 0, recorded.stderr);
    assert.strictEqual(readState(root).progress_forecast.cycle_state, "BLOCCATO");
    assert.strictEqual(readState(root).progress_forecast.derived.open_overrides, 1);
    assert.strictEqual(readState(root).needs_reconciliation, true, "recording a forecast must not unblock anything");
  });

  it("does not touch the exact next action, the lifecycle or the gate", () => {
    const root = project("NoSideEffects");
    const before = readState(root);
    assert.strictEqual(forecast(root, BASE).status, 0);
    const after = readState(root);
    assert.strictEqual(after.exact_next_action, before.exact_next_action);
    assert.strictEqual(after.lifecycle_state, before.lifecycle_state);
    assert.strictEqual(after.current_gate, before.current_gate);
    assert.deepStrictEqual(after.modules, before.modules);
  });

  it("is listed in help, so the command the gap message names is discoverable", () => {
    const result = run(["help"], os.tmpdir());
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /forecast --project-root \. --owner NAME --phase TEXT --known-work TEXT/);
    assert.match(result.stdout, /reads the recorded forecast; ranges only, never a percentage/);
  });
});

describe("D5: the stored record matches the published schema", () => {
  it("carries every field the schema requires and no field it forbids", () => {
    const root = project("SchemaShape");
    assert.strictEqual(forecast(root, BASE).status, 0);
    assert.strictEqual(forecast(root, { ...BASE, questions: "13-21", "change-reason": "una causa" }).status, 0);

    const schema = JSON.parse(fs.readFileSync(SCHEMA, "utf8"));
    const definition = schema.$defs.progress_forecast;
    assert.ok(definition, "the schema must define progress_forecast");
    assert.strictEqual(definition.additionalProperties, false);
    assert.ok(schema.properties.progress_forecast, "state must declare progress_forecast");
    assert.ok(schema.properties.forecast_history, "state must declare forecast_history");
    // Optional, deliberately: a project that never recorded one is still valid.
    assert.ok(!schema.required.includes("progress_forecast"));
    assert.ok(!schema.required.includes("forecast_history"));

    const state = readState(root);
    for (const entry of [state.progress_forecast, ...state.forecast_history]) {
      for (const key of definition.required) assert.ok(key in entry, `missing ${key}`);
      for (const key of Object.keys(entry)) assert.ok(key in definition.properties, `undeclared ${key}`);
    }
    assert.strictEqual(run(["validate", "--project-root", "."], root).status, 0);
  });

  it("refuses a hand-edited forecast that carries a percentage or a broken range", () => {
    const root = project("HandEdited");
    assert.strictEqual(forecast(root, BASE).status, 0);
    const location = path.join(root, ".plangonaut", "state.json");

    const withPercentage = readState(root);
    withPercentage.progress_forecast.percent_complete = 60;
    fs.writeFileSync(location, `${JSON.stringify(withPercentage, null, 2)}\n`);
    const refusedPercentage = run(["validate", "--project-root", "."], root);
    assert.strictEqual(refusedPercentage.status, 2, refusedPercentage.stdout);
    assert.match(refusedPercentage.stderr, /progress_forecast\.percent_complete stores a percentage, which a forecast may never carry/);

    const broken = readState(root);
    delete broken.progress_forecast.percent_complete;
    broken.progress_forecast.questions = { min: 9, max: 2 };
    fs.writeFileSync(location, `${JSON.stringify(broken, null, 2)}\n`);
    const refusedRange = run(["validate", "--project-root", "."], root);
    assert.strictEqual(refusedRange.status, 2, refusedRange.stdout);
    assert.match(refusedRange.stderr, /progress_forecast\.questions must be a range \{min,max\} of non-negative integers with min <= max/);
  });

  it("keeps a project that never recorded a forecast valid, and migrates one without inventing a value", () => {
    const root = project("Migration");
    const location = path.join(root, ".plangonaut", "state.json");
    const state = readState(root);
    assert.strictEqual(run(["validate", "--project-root", "."], root).status, 0, "absent fields are valid");

    // A v2 project, migrated: the history is created empty and no forecast is
    // invented for it.
    state.schema_version = 2;
    delete state.forecast_history;
    fs.writeFileSync(location, `${JSON.stringify(state, null, 2)}\n`);
    // A v2 state under a v3 history is not a project any engine ever wrote. Age
    // the events too, so the fixture is the thing it is standing in for.
    ageProject(root);
    const migrated = run(["migrate", "--project-root", ".", "--operation-id", "OP-migrate"], root);
    assert.strictEqual(migrated.status, 0, migrated.stderr);
    const after = readState(root);
    assert.deepStrictEqual(after.forecast_history, []);
    assert.strictEqual(after.progress_forecast, undefined, "migration must not invent a forecast nobody recorded");
    assert.strictEqual(run(["validate", "--project-root", "."], root).status, 0);
    assert.match(run(["forecast", "--project-root", "."], root).stdout, /No progress forecast has ever been recorded/);
  });
});
