import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * What an interruption in the middle of a write leaves behind.
 *
 * `atomicWrite` makes one file replacement atomic and never made a *mutation*
 * atomic: an operation touches a document, a history entry, the event log, the
 * state and a derived view, and a sequence of atomic renames is still a
 * sequence. These tests kill the process at each point in that sequence and then
 * ask the next command what it finds.
 *
 * The kill is a real one. `BEAVE_FAULT_AT` makes the engine call `process.exit`,
 * so no `finally` runs, no rollback runs, nothing is cleaned up — which is the
 * whole point: a test that unwinds the stack is testing exception handling, not
 * interruption. Each case then asserts the four things that actually matter: the
 * project is valid, its state matches its own history, no event is duplicated,
 * and nothing half-done is presented as finished.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "lib", "bin", "beave.js");

let counter = 0;

function beave(root, args, env = {}) {
  counter += 1;
  const full = [...args];
  if (!full.includes("--operation-id")) full.push("--operation-id", `x${counter}-${Date.now()}`);
  const result = spawnSync(process.execPath, [CLI, ...full], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}`.trim() };
}

function ok(root, args, env) {
  const result = beave(root, args, env);
  assert.strictEqual(result.status, 0, `expected success from ${args[0]}:\n${result.out}`);
  return result.out;
}

function project(t, name = "Faults") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-txn-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "owners.json"),
    JSON.stringify({ product: "Ada", technical: "Ada", budget: "Ada", safety: "Ada", release: "Ada" }),
  );
  ok(root, [
    "init", "--project-root", root, "--project-name", name,
    "--project-mode", "Resume", "--interaction-mode", "Standard",
    "--owners-file", path.join(root, "owners.json"),
  ]);
  return root;
}

const statePath = (root) => path.join(root, ".beave", "state.json");
const eventsPath = (root) => path.join(root, ".beave", "events.jsonl");
const readState = (root) => JSON.parse(fs.readFileSync(statePath(root), "utf8"));
const readEvents = (root) =>
  fs.readFileSync(eventsPath(root), "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

/** The crash the engine performs when the label is armed. */
function crashAt(root, label, args) {
  const result = beave(root, args, { BEAVE_FAULT_AT: label });
  assert.strictEqual(result.status, 97, `the fault at ${label} did not fire:\n${result.out}`);
  return result;
}

/**
 * Everything that must hold after any interruption, whatever it resolved to.
 *
 * The next command is an ordinary one — `validate` — because recovery is not a
 * thing the user has to remember: it happens on the way into any command that
 * reads or writes the project.
 */
function assertConsistent(root) {
  const validated = beave(root, ["validate", "--project-root", root]);
  assert.strictEqual(validated.status, 0, `the project did not come back valid:\n${validated.out}`);

  const replayed = beave(root, ["replay", "--project-root", root]);
  assert.strictEqual(replayed.status, 0, `the state does not match its history:\n${replayed.out}`);

  const events = readEvents(root);
  const ids = events.map((event) => event.event_id);
  assert.strictEqual(new Set(ids).size, ids.length, "an event was duplicated");

  const revisions = events.map((event) => Number(event.state_revision));
  for (let index = 1; index < revisions.length; index += 1) {
    assert.strictEqual(revisions[index], revisions[index - 1] + 1, `revision ${revisions[index]} does not follow ${revisions[index - 1]}`);
  }
  assert.strictEqual(readState(root).revision, revisions[revisions.length - 1], "the state is not at the revision its last event records");

  // Nothing may be left claiming to be in progress.
  const transactions = path.join(root, ".beave", "transactions");
  const open = fs.existsSync(transactions) ? fs.readdirSync(transactions) : [];
  assert.deepStrictEqual(open, [], "an interrupted transaction was left behind");
  return { events, state: readState(root) };
}

// ---------------------------------------------------------------------------
// 1-9. A crash at each point of one ledger write
// ---------------------------------------------------------------------------

/**
 * The point of no return is the phase the journal moves to once the operation is
 * validated and its result is staged. Before it, an interruption is undone.
 * After it, it is completed from the staged content — the operation had already
 * been decided, and completing it is the only outcome that cannot lose it.
 */
const UNDONE = ["before-prepare", "after-journal"];
const COMPLETED = ["after-staged", "before-commit", "after-events", "after-state", "after-commit"];

for (const label of [...UNDONE, ...COMPLETED]) {
  test(`a crash at ${label} leaves a project the next command can put right`, (t) => {
    const root = project(t);
    crashAt(root, label, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Bake weekly", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-DEC"]);

    const { state, events } = assertConsistent(root);
    if (UNDONE.includes(label)) {
      assert.strictEqual(state.decisions.length, 0, "an operation that never took effect was applied anyway");
      assert.strictEqual(events.length, 1, "an event was written for an operation that was undone");
      assert.strictEqual(state.revision, 1);
    } else {
      assert.strictEqual(state.decisions.length, 1, "an operation past the point of no return was lost");
      assert.strictEqual(state.decisions[0].title, "Bake weekly");
      assert.strictEqual(events.length, 2);
      assert.strictEqual(state.revision, 2);
    }
  });
}

test("a crash while a derived document is being written is repaired from the state", (t) => {
  const root = project(t);
  ok(root, ["qa-ask", "--project-root", root, "--id", "QNA-0001", "--question", "How many loaves?", "--rationale", "Sizing", "--owner", "Ada"]);
  fs.writeFileSync(path.join(root, "a.md"), "About two hundred.\n");
  ok(root, ["qa-answer", "--project-root", root, "--id", "QNA-0001", "--answer-file", path.join(root, "a.md"), "--owner", "Ada"]);

  // The state records the digest of a document that was never written.
  crashAt(root, "after-state", [
    "qa-settle", "--project-root", root, "--id", "QNA-0001",
    "--interpretation", "Two hundred a week", "--reply", "Recorded",
    "--next-id", "QNA-0002", "--next-question", "Who bakes?", "--owner", "Ada",
  ]);

  const { state } = assertConsistent(root);
  assert.ok(state.interview_log[0].consequences_recorded_at, "the settlement was lost");
  assert.strictEqual(state.interview_log[1].id, "QNA-0002", "the next question was not opened with it");
  const document = fs.readFileSync(path.join(root, "QUESTION_ANSWER_HISTORY.md"), "utf8");
  assert.match(document, /Two hundred a week/);
  assert.match(document, /Who bakes\?/);
});

// ---------------------------------------------------------------------------
// 10. The retry
// ---------------------------------------------------------------------------

test("the same operation id retried after a crash applies once, and different input is refused", (t) => {
  const root = project(t);
  const args = ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Bake weekly", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-RETRY"];
  crashAt(root, "after-events", args);

  // Recovery completed it, so the retry must be a no-op rather than a second one.
  const retry = beave(root, args);
  assert.strictEqual(retry.status, 0, retry.out);
  const { state, events } = assertConsistent(root);
  assert.strictEqual(state.decisions.length, 1);
  assert.strictEqual(events.filter((event) => event.type === "DECISION_CREATED").length, 1);

  // The same id with different input is a different operation wearing the same
  // name, and is refused rather than silently recorded as the first one.
  const conflicting = beave(root, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Something else", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-RETRY"]);
  assert.notStrictEqual(conflicting.status, 0);
  assert.match(conflicting.out, /already used with different input/);
  assert.strictEqual(readState(root).decisions[0].title, "Bake weekly");
});

// ---------------------------------------------------------------------------
// A crash during a document operation, where more than the ledger moves
// ---------------------------------------------------------------------------

/** A governed save is two commands: the review, then the save it confirms. */
function saveDocument(root, content, operationId) {
  fs.writeFileSync(path.join(root, "draft.md"), content);
  const base = [
    "--project-root", root, "--id", "ART-0001",
    "--base-path", "docs/plan.md", "--content-file", path.join(root, "draft.md"), "--owner", "Ada",
  ];
  const preview = JSON.parse(ok(root, ["doc-diff", ...base]));
  return ["doc-save", ...base, "--confirm-token", preview.confirmation_token, "--operation-id", operationId];
}

test("a crash during a governed save leaves neither a half-written document nor a half-written ledger", (t) => {
  const root = project(t);
  ok(root, saveDocument(root, "The first plan.\n", "OP-SAVE-1"));
  assert.ok(fs.existsSync(path.join(root, "docs", "plan-v1.md")));

  crashAt(root, "after-events", saveDocument(root, "The second plan.\n", "OP-SAVE-2"));

  const { state } = assertConsistent(root);
  const artifact = state.artifacts[0];
  // Whatever the revision came out as, the file the ledger names is the file on
  // disk and its recorded digest describes it. That is the property; which of
  // the two revisions won is the journal's business, not the user's.
  const recorded = path.join(root, artifact.working_path);
  assert.ok(fs.existsSync(recorded), `the ledger names ${artifact.working_path}, which is not there`);
  const history = beave(root, ["doc-history", "--project-root", root, "--id", "ART-0001"]);
  assert.strictEqual(history.status, 0, history.out);
});

// ---------------------------------------------------------------------------
// What `recover` says when asked, and what it does when told
// ---------------------------------------------------------------------------

test("recover reports an interrupted operation without touching it, and finishes it when told", (t) => {
  const root = project(t);
  crashAt(root, "after-staged", ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Bake weekly", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-DEC"]);

  const before = fs.readFileSync(statePath(root), "utf8");
  const reported = ok(root, ["recover", "--project-root", root]);
  assert.match(reported, /DECISION_CREATED/);
  assert.match(reported, /phase\s+COMMITTING/);
  assert.match(reported, /would be\s+completed/);
  assert.match(reported, /Nothing was changed/);
  assert.strictEqual(fs.readFileSync(statePath(root), "utf8"), before, "inspection wrote something");

  const applied = ok(root, ["recover", "--project-root", root, "--apply"]);
  assert.match(applied, /1 interrupted operation resolved/);
  assertConsistent(root);
  assert.strictEqual(readState(root).decisions.length, 1);

  const again = ok(root, ["recover", "--project-root", root]);
  assert.match(again, /No interrupted operation/);
});

test("a receipt is left for every recovery, and it says which way it went", (t) => {
  const undone = project(t);
  crashAt(undone, "after-journal", ["decision", "--project-root", undone, "--id", "DEC-0001", "--title", "x", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-A"]);
  ok(undone, ["validate", "--project-root", undone]);
  const undoneReceipts = fs.readdirSync(path.join(undone, ".beave", "recovery"));
  assert.strictEqual(undoneReceipts.length, 1);
  assert.match(undoneReceipts[0], /\.rolled-back\.json$/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(undone, ".beave", "recovery", undoneReceipts[0]), "utf8")).outcome, "ABORTED");

  const completed = project(t);
  crashAt(completed, "after-events", ["decision", "--project-root", completed, "--id", "DEC-0001", "--title", "x", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-B"]);
  ok(completed, ["validate", "--project-root", completed]);
  const completedReceipts = fs.readdirSync(path.join(completed, ".beave", "recovery"));
  assert.strictEqual(completedReceipts.length, 1);
  assert.match(completedReceipts[0], /\.recovered\.json$/);
  const receipt = JSON.parse(fs.readFileSync(path.join(completed, ".beave", "recovery", completedReceipts[0]), "utf8"));
  assert.strictEqual(receipt.outcome, "RECOVERED");
  assert.ok(Array.isArray(receipt.actions));
});

test("Resume says an operation was recovered rather than absorbing it in silence", (t) => {
  const root = project(t);
  crashAt(root, "after-events", ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Bake weekly", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-DEC"]);

  const resumed = ok(root, ["resume", "--project-root", root]);
  assert.match(resumed, /An interrupted operation was recovered/);
  assert.match(resumed, /did not finish/);
  assert.match(resumed, /DECISION_CREATED/);

  // And the next Resume, on a project with nothing outstanding, does not.
  assert.doesNotMatch(ok(root, ["resume", "--project-root", root]), /An interrupted operation was recovered/);
});

// ---------------------------------------------------------------------------
// What an independent review reproduced, 2026-09-12
//
// Six findings. The first two shared one cause: seventeen commands asked "has
// this already happened?" before finishing an operation that had been
// interrupted, so the answer came from a history the project had not caught up
// with. The rest are each a promise this contract makes and did not keep.
// ---------------------------------------------------------------------------

const AFTER_THE_EVENT = ["after-events", "after-state", "after-commit"];
const BEFORE_THE_EVENT = ["after-staged", "before-commit"];

for (const label of AFTER_THE_EVENT) {
  test(`a retry after a crash at ${label} completes the operation instead of declaring a false success`, (t) => {
    const root = project(t);
    fs.writeFileSync(path.join(root, "gate.md"), "Evidence for G1.\n");
    // G1 asks for module 1 first. That is the ordinary prerequisite, not
    // anything to do with what this test is about.
    ok(root, ["record", "--project-root", root, "--module", "1", "--status", "CONFIRMED", "--answer-file", path.join(root, "gate.md"), "--owner", "Ada"]);
    const args = ["gate", "--project-root", root, "--id", "G1", "--status", "PASSED", "--evidence-file", path.join(root, "gate.md"), "--owner", "Ada", "--operation-id", "OP-GATE"];
    crashAt(root, label, args);

    /*
     * This used to print `Idempotent retry: gate already applied.` and exit 0
     * while `state.gates` was empty and the event was in the log: a success
     * reported over a project that `replay` called diverged in the same second.
     */
    const retry = beave(root, args);
    assert.strictEqual(retry.status, 0, retry.out);
    const { state, events } = assertConsistent(root);
    assert.strictEqual(state.gates.length, 1, "the retry reported success over a state that had not caught up");
    assert.strictEqual(events.filter((event) => event.type === "GATE_UPDATED").length, 1);
  });
}

for (const label of BEFORE_THE_EVENT) {
  test(`a retry after a crash at ${label} is a no-op rather than a failure`, (t) => {
    const root = project(t);
    const args = ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Bake weekly", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-DEC"];
    crashAt(root, label, args);

    // This used to recover *underneath* the retry and then fail on preconditions
    // the recovery had just satisfied: `Missing required option --expected-revision`.
    const retry = beave(root, args);
    assert.strictEqual(retry.status, 0, `a retry with identical input must be a no-op:\n${retry.out}`);
    assert.match(retry.out, /Idempotent retry/);
    const { state, events } = assertConsistent(root);
    assert.strictEqual(state.decisions.length, 1);
    assert.strictEqual(events.filter((event) => event.type === "DECISION_CREATED").length, 1);
  });
}

test("a retry after an interrupted settlement keeps the next question it promised", (t) => {
  const root = project(t);
  ok(root, ["qa-ask", "--project-root", root, "--id", "QNA-0001", "--question", "How many loaves?", "--rationale", "Sizing", "--owner", "Ada"]);
  fs.writeFileSync(path.join(root, "a.md"), "About two hundred.\n");
  ok(root, ["qa-answer", "--project-root", root, "--id", "QNA-0001", "--answer-file", path.join(root, "a.md"), "--owner", "Ada"]);

  const settle = [
    "qa-settle", "--project-root", root, "--id", "QNA-0001",
    "--interpretation", "Two hundred a week", "--reply", "Recorded",
    "--next-id", "QNA-0002", "--next-question", "Who bakes?", "--owner", "Ada", "--operation-id", "OP-SETTLE",
  ];
  crashAt(root, "after-events", settle);

  const retry = beave(root, settle);
  assert.strictEqual(retry.status, 0, retry.out);
  const { state } = assertConsistent(root);
  assert.ok(state.interview_log[0].consequences_recorded_at, "the settlement was lost by the retry");
  assert.strictEqual(state.interview_log[1].id, "QNA-0002");
  assert.match(state.exact_next_action, /QNA-0002/, "the promised next question vanished");
});

test("a journal past the point of no return with nothing staged changes nothing at all", (t) => {
  const root = project(t);
  crashAt(root, "after-staged", ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Bake weekly", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-DEC"]);

  const directory = path.join(root, ".beave", "transactions", fs.readdirSync(path.join(root, ".beave", "transactions"))[0]);
  fs.rmSync(path.join(directory, "staged-state.json"));

  const eventsBefore = fs.readFileSync(eventsPath(root), "utf8");
  const stateBefore = fs.readFileSync(statePath(root), "utf8");

  /*
   * This used to append the event and *then* read the staged state, so the event
   * was in the log when the read failed — and every command after it died on a
   * raw ENOENT with no message and no way out. The contract says it stops, names
   * the directory and changes nothing; now it does.
   */
  const refusedRun = beave(root, ["validate", "--project-root", root]);
  assert.notStrictEqual(refusedRun.status, 0);
  assert.match(refusedRun.out, /can neither be completed nor safely undone/);
  assert.match(refusedRun.out, /transactions/);
  assert.strictEqual(fs.readFileSync(eventsPath(root), "utf8"), eventsBefore, "the event log was written anyway");
  assert.strictEqual(fs.readFileSync(statePath(root), "utf8"), stateBefore, "the state was written anyway");

  // And the way out the message names actually works.
  fs.rmSync(directory, { recursive: true, force: true });
  assert.strictEqual(beave(root, ["validate", "--project-root", root]).status, 0);
});

test("a state file that is gone is rebuilt from the history, which is the case this is for", (t) => {
  const root = project(t);
  ok(root, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Bake weekly", "--status", "APPROVED", "--owner", "Ada"]);
  fs.rmSync(statePath(root));

  // Every command used to die on a raw ENOENT here, including the repair.
  const told = beave(root, ["validate", "--project-root", root]);
  assert.notStrictEqual(told.status, 0);
  assert.match(told.out, /state\.json is missing, and the event history is still here/);
  assert.match(told.out, /beave replay --project-root \. --repair/);

  const repaired = ok(root, ["replay", "--project-root", root, "--repair"]);
  assert.match(repaired, /Rebuilt the state from/);
  assert.match(repaired, /no state file to preserve/);
  assertConsistent(root);
  assert.strictEqual(readState(root).decisions[0].title, "Bake weekly");
});

test("an event edited without recomputing its own digest is caught", (t) => {
  const root = project(t);
  ok(root, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Bake weekly", "--status", "APPROVED", "--owner", "Ada"]);

  // Change a field the state patch does not carry — the owner on the event —
  // and re-chain, which used to be enough to pass. `payload_sha256` was written
  // on every event and read by nothing.
  const events = readEvents(root);
  events[events.length - 1].owner = "Somebody else";
  const rechained = events.map((event, index) => {
    if (index === 0) return event;
    return { ...event, previous_event_sha256: crypto.createHash("sha256").update(JSON.stringify(events[index - 1])).digest("hex") };
  });
  fs.writeFileSync(eventsPath(root), `${rechained.map((event) => JSON.stringify(event)).join("\n")}\n`);

  const out = beave(root, ["replay", "--project-root", root]);
  assert.notStrictEqual(out.status, 0);
  assert.match(out.out, /digest it records of itself/);
});

test("verification reports an operation waiting to be resolved instead of calling the project damaged", (t) => {
  const root = project(t);
  crashAt(root, "after-events", ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Bake weekly", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-DEC"]);

  // `replay --verify` does not recover, on purpose. It used to report DIVERGED
  // with no hint that the project was simply mid-operation.
  const verified = beave(root, ["replay", "--project-root", root, "--verify"]);
  assert.match(verified.out, /interrupted and (is|are) waiting to be resolved/);
  assert.match(verified.out, /beave recover --project-root \. --apply/);

  ok(root, ["recover", "--project-root", root, "--apply"]);
  assertConsistent(root);
});

test("a journal that cannot be read stops the project with a sentence, not a JSON error", (t) => {
  const root = project(t);
  crashAt(root, "after-staged", ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "x", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-DEC"]);
  const directory = path.join(root, ".beave", "transactions", fs.readdirSync(path.join(root, ".beave", "transactions"))[0]);
  fs.writeFileSync(path.join(directory, "journal.json"), "");

  const blocked = beave(root, ["validate", "--project-root", root]);
  assert.notStrictEqual(blocked.status, 0);
  assert.match(blocked.out, /journal of an interrupted operation cannot be read/);
  assert.doesNotMatch(blocked.out, /Unexpected end of JSON input/);

  // And `recover` names it rather than saying everything finished.
  const reported = ok(root, ["recover", "--project-root", root]);
  assert.match(reported, /UNREADABLE/);
  assert.doesNotMatch(reported, /No interrupted operation/);
});

test("a directory under transactions with no journal is reported, not ignored for ever", (t) => {
  const root = project(t);
  fs.mkdirSync(path.join(root, ".beave", "transactions", "orphan"), { recursive: true });
  const reported = ok(root, ["recover", "--project-root", root]);
  assert.match(reported, /NO_JOURNAL/);
  assert.match(reported, /Remove it by hand/);
  assert.doesNotMatch(reported, /No interrupted operation/);
});

test("a torn final line of the history has a bounded remedy, and a torn middle one does not", (t) => {
  const root = project(t);
  ok(root, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Bake weekly", "--status", "APPROVED", "--owner", "Ada"]);
  ok(root, ["risk", "--project-root", root, "--id", "RSK-0001", "--title", "Oven fails", "--severity", "HIGH", "--status", "IDENTIFIED", "--owner", "Ada"]);

  const whole = fs.readFileSync(eventsPath(root), "utf8");
  fs.writeFileSync(eventsPath(root), whole.slice(0, whole.length - 40));

  const reported = ok(root, ["recover", "--project-root", root]);
  assert.match(reported, /cut off mid-write/);
  assert.match(reported, /cannot be a completed one/);
  assert.strictEqual(fs.readFileSync(eventsPath(root), "utf8"), whole.slice(0, whole.length - 40), "inspection wrote something");

  const applied = ok(root, ["recover", "--project-root", root, "--apply"]);
  assert.match(applied, /Removed the torn final line/);
  assert.match(applied, /\.beave\/backups\//);
  // Two events left, the state at the revision the history now ends on, and a
  // project that works again.
  assert.strictEqual(readEvents(root).length, 2);
  ok(root, ["replay", "--project-root", root, "--repair"]);
  assertConsistent(root);

  // A malformed line with complete lines after it is damage nobody can undo.
  const other = project(t);
  ok(other, ["decision", "--project-root", other, "--id", "DEC-0001", "--title", "x", "--status", "APPROVED", "--owner", "Ada"]);
  const lines = fs.readFileSync(eventsPath(other), "utf8").split("\n").filter(Boolean);
  fs.writeFileSync(eventsPath(other), `${lines[0].slice(0, 20)}\n${lines[1]}\n`);
  const refusedMiddle = ok(other, ["recover", "--project-root", other]);
  assert.doesNotMatch(refusedMiddle, /cut off mid-write/);
});
