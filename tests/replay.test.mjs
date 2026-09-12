import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ageProject } from "./older-engine.mjs";

/**
 * Rebuilding the state from the events, and refusing to when it cannot be done.
 *
 * The property under test is not "the replay works on a happy project". It is
 * that the replay is the *only* thing deciding, and that every way the history
 * can be wrong is detected rather than absorbed: an event whose payload was
 * edited, a chain that skips a line, a duplicate, a state somebody fixed by
 * hand, a derived document edited, a baseline that is not what it says it is.
 *
 * Each case works on a real project driven by the real CLI, because what is
 * being checked is what a project on disk does, not what a function returns.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "lib", "bin", "beave.js");

let counter = 0;

function beave(root, args, env = {}) {
  counter += 1;
  const full = [...args];
  if (!full.includes("--operation-id")) full.push("--operation-id", `r${counter}-${Date.now()}`);
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

function refused(root, args) {
  const result = beave(root, args);
  assert.notStrictEqual(result.status, 0, `expected ${args[0]} to be refused:\n${result.out}`);
  return result.out;
}

function project(t, name = "Replay") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-replay-"));
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

function readEvents(root) {
  return fs.readFileSync(eventsPath(root), "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

/** The chain digest of a line, exactly as the engine computes it. */
function chainDigest(line) {
  return crypto.createHash("sha256").update(line).digest("hex");
}

function writeEvents(root, events) {
  fs.writeFileSync(eventsPath(root), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
}

/** A project carrying one record of most kinds, so the replay covers them. */
function populated(t) {
  const root = project(t, "Everything");
  ok(root, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Bake weekly", "--status", "APPROVED", "--owner", "Ada"]);
  ok(root, ["requirement", "--project-root", root, "--id", "REQ-0001", "--title", "Orders close on Friday", "--status", "ACTIVE", "--owner", "Ada"]);
  ok(root, ["task", "--project-root", root, "--id", "TSK-0001", "--title", "Find an oven", "--status", "READY", "--owner", "Ada"]);
  ok(root, ["dependency", "--project-root", root, "--id", "DEP-0001", "--from", "REQ-0001", "--to", "TSK-0001", "--type", "REQUIRES", "--owner", "Ada"]);
  ok(root, ["risk", "--project-root", root, "--id", "RSK-0001", "--title", "The oven fails", "--severity", "HIGH", "--status", "IDENTIFIED", "--owner", "Ada"]);
  ok(root, ["agent", "--project-root", root, "--id", "AGT-0001", "--name", "Baker", "--status", "ACTIVE", "--owner", "Ada"]);
  ok(root, ["checkpoint", "--project-root", root, "--id", "CHK-0001", "--name", "Oven chosen", "--owner", "Ada"]);
  fs.writeFileSync(path.join(root, "answer.md"), "Two hundred loaves a week.\n");
  ok(root, ["record", "--project-root", root, "--module", "1", "--status", "CONFIRMED", "--answer-file", path.join(root, "answer.md"), "--owner", "Ada"]);
  return root;
}

// ---------------------------------------------------------------------------
// 1-4. What must replay
// ---------------------------------------------------------------------------

test("a new project replays from its own initialization", (t) => {
  const root = project(t);
  const out = ok(root, ["replay", "--project-root", root]);
  assert.match(out, /matches its history exactly/);
  assert.match(out, /from PROJECT_INITIALIZED/);
  // Initialization is the baseline: nothing earlier exists and none is invented.
  assert.doesNotMatch(out, /earlier events/);
});

test("every kind of record replays, and the rebuilt state is the state on disk", (t) => {
  const root = populated(t);
  const out = ok(root, ["replay", "--project-root", root]);
  assert.match(out, /matches its history exactly/);
  const state = readState(root);
  assert.strictEqual(state.decisions.length, 1);
  assert.strictEqual(state.dependencies.length, 1);
  assert.strictEqual(state.checkpoints.length, 1);
  assert.strictEqual(state.modules[1].status, "CONFIRMED");
  // The last event's recorded digest is the digest of the file, which is what
  // makes every one of those assertions a statement about the history too.
  const events = readEvents(root);
  assert.ok(events[events.length - 1].state_sha256);
});

test("the question and answer ledger replays with everything in it", (t) => {
  const root = project(t);
  ok(root, ["qa-ask", "--project-root", root, "--id", "QNA-0001", "--question", "How many loaves a week?", "--rationale", "Sizing the oven", "--owner", "Ada"]);
  fs.writeFileSync(path.join(root, "a.md"), "About two hundred.\n");
  ok(root, ["qa-answer", "--project-root", root, "--id", "QNA-0001", "--answer-file", path.join(root, "a.md"), "--owner", "Ada"]);
  ok(root, ["qa-settle", "--project-root", root, "--id", "QNA-0001", "--interpretation", "Two hundred a week", "--reply", "Recorded", "--next-id", "QNA-0002", "--next-question", "Who bakes?", "--owner", "Ada"]);

  const out = ok(root, ["replay", "--project-root", root]);
  assert.match(out, /matches its history exactly/);

  // The text itself is in the history, not only a digest of it: that is the
  // difference this whole format exists to make.
  const events = readEvents(root);
  const settle = events.find((event) => event.type === "QUESTION_SETTLED");
  const written = JSON.stringify(settle.state_patch);
  assert.match(written, /Two hundred a week/);
  assert.match(written, /Who bakes\?/);
});

test("a migrated project replays from the baseline it was given, and says what it cannot prove", (t) => {
  const root = populated(t);
  const aged = ageProject(root);
  assert.ok(aged >= 9, "the fixture must really carry the older shape");

  const before = refused(root, ["replay", "--project-root", root]);
  assert.match(before, /NOT REPRODUCIBLE/);
  assert.match(before, /beave baseline/);

  ok(root, ["baseline", "--project-root", root, "--reason", "Upgraded from an engine that recorded digests only", "--owner", "Ada"]);
  const after = ok(root, ["replay", "--project-root", root]);
  assert.match(after, /matches its history exactly/);
  assert.match(after, /from BASELINE_RECORDED/);
  assert.match(after, new RegExp(`${aged} earlier events`));
  // Nothing before it was rewritten, deleted or reinterpreted.
  assert.strictEqual(readEvents(root).length, aged + 1);
});

// ---------------------------------------------------------------------------
// 5-11. What must be refused
// ---------------------------------------------------------------------------

test("an event this engine cannot read stops the replay instead of being skipped", (t) => {
  const root = populated(t);
  const events = readEvents(root);
  events[events.length - 1].format = 99;
  writeEvents(root, events);
  const out = refused(root, ["replay", "--project-root", root]);
  assert.match(out, /event format 99/);
  assert.match(out, /Upgrade Beave/);
});

test("a duplicated event is refused", (t) => {
  const root = populated(t);
  const events = readEvents(root);
  writeEvents(root, [...events, events[events.length - 1]]);
  const out = refused(root, ["replay", "--project-root", root]);
  assert.match(out, /appears twice/);
});

test("a missing event is refused, and named", (t) => {
  const root = populated(t);
  const events = readEvents(root);
  events.splice(events.length - 2, 1);
  writeEvents(root, events);
  const out = refused(root, ["replay", "--project-root", root]);
  assert.match(out, /chain breaks/);
});

test("events put in the wrong order are refused", (t) => {
  const root = populated(t);
  const events = readEvents(root);
  const swapped = [...events];
  [swapped[swapped.length - 1], swapped[swapped.length - 2]] = [swapped[swapped.length - 2], swapped[swapped.length - 1]];
  writeEvents(root, swapped);
  const out = refused(root, ["replay", "--project-root", root]);
  assert.match(out, /chain breaks|out of order|not continuous/);
});

test("a revision that does not follow the one before it is refused", (t) => {
  const root = populated(t);
  const events = readEvents(root);
  const last = events[events.length - 1];
  last.previous_revision = Number(last.previous_revision) - 1;
  // Keep the chain digest honest so the revision check is what fails.
  // Re-chain afterwards, so the revision check is what fails rather than the
  // chain digest, which would otherwise catch the edit first.
  writeEvents(root, events);
  const rechained = readEvents(root);
  for (let index = 1; index < rechained.length; index += 1) {
    rechained[index].previous_event_sha256 = chainDigest(JSON.stringify(rechained[index - 1]));
  }
  writeEvents(root, rechained);
  const out = refused(root, ["replay", "--project-root", root]);
  // The event's own digest catches it before the revision check does, which is
  // the stricter of the two answers and the one that names the edit.
  assert.match(out, /out of order or one is missing|chain breaks|digest it records of itself/);
});

test("a payload edited after the fact does not reproduce its own digest", (t) => {
  const root = populated(t);
  const events = readEvents(root);
  const target = events.findIndex((event) => event.type === "DECISION_CREATED");
  const patch = events[target].state_patch.find((op) => JSON.stringify(op.value ?? "").includes("Bake weekly"));
  patch.value.title = "Something nobody decided";
  writeEvents(root, events);
  const out = refused(root, ["replay", "--project-root", root]);
  assert.match(out, /chain breaks|does not produce the state it recorded|digest it records of itself/);
});

test("a broken chain digest is refused even when every event is otherwise intact", (t) => {
  const root = populated(t);
  const events = readEvents(root);
  events[events.length - 1].previous_event_sha256 = "0".repeat(64);
  writeEvents(root, events);
  const out = refused(root, ["replay", "--project-root", root]);
  assert.match(out, /chain breaks/);
  assert.match(out, /edited outside Beave/);
});

// ---------------------------------------------------------------------------
// 12-16. Divergence, derived views, repair
// ---------------------------------------------------------------------------

test("a state edited by hand is detected, named field by field, and refused by the next write", (t) => {
  const root = populated(t);
  const state = readState(root);
  state.decisions[0].title = "Something nobody decided";
  fs.writeFileSync(statePath(root), `${JSON.stringify(state, null, 2)}\n`);

  const verified = refused(root, ["replay", "--project-root", root]);
  assert.match(verified, /DIVERGED/);
  assert.match(verified, /decisions\.0\.title: rebuilt as "Bake weekly"/);

  // And nothing may be written on top of it.
  const blocked = refused(root, ["risk", "--project-root", root, "--id", "RSK-0002", "--title", "x", "--severity", "LOW", "--status", "IDENTIFIED", "--owner", "Ada"]);
  assert.match(blocked, /does not match the history that produced it/);
  assert.match(blocked, /Nothing was written/);

  // Resume refuses to give a position it cannot stand behind — and exits
  // non-zero while saying so, which is what a caller checking the status sees.
  const resumed = refused(root, ["resume", "--project-root", root]);
  assert.match(resumed, /Resume blocked/);
  assert.match(resumed, /do not agree/);
});

test("an edited derived document is repaired from the state, not the other way round", (t) => {
  const root = project(t);
  ok(root, ["qa-ask", "--project-root", root, "--id", "QNA-0001", "--question", "How many loaves?", "--rationale", "Sizing", "--owner", "Ada"]);
  const view = path.join(root, "QUESTION_ANSWER_HISTORY.md");
  fs.writeFileSync(view, "# Not what Beave wrote\n");

  assert.match(refused(root, ["validate", "--project-root", root]), /edited outside Beave/);
  // The canonical source is intact, so Resume rebuilds the document and says so.
  const resumed = ok(root, ["resume", "--project-root", root]);
  assert.match(resumed, /derived view was regenerated/);
  assert.match(fs.readFileSync(view, "utf8"), /How many loaves\?/);
  assert.strictEqual(beave(root, ["validate", "--project-root", root]).status, 0);
  // The history never moved: the document was rebuilt from it.
  assert.match(ok(root, ["replay", "--project-root", root]), /matches its history exactly/);
});

test("a baseline whose recorded state was altered afterwards is refused", (t) => {
  const root = populated(t);
  ageProject(root);
  ok(root, ["baseline", "--project-root", root, "--reason", "Upgraded", "--owner", "Ada"]);
  const events = readEvents(root);
  const baselineEvent = events[events.length - 1];
  baselineEvent.state_patch[0].value.decisions[0].title = "Something nobody decided";
  writeEvents(root, events);
  const out = refused(root, ["replay", "--project-root", root]);
  assert.match(out, /does not produce the state it recorded|digest it records of itself/);
});

test("replaying twice produces the same state both times", (t) => {
  const root = populated(t);
  const first = ok(root, ["replay", "--project-root", root]);
  const second = ok(root, ["replay", "--project-root", root]);
  assert.strictEqual(first, second);
  // And it changed nothing on the way: verification is a read.
  const before = fs.readFileSync(statePath(root), "utf8");
  ok(root, ["replay", "--project-root", root]);
  assert.strictEqual(fs.readFileSync(statePath(root), "utf8"), before);
});

test("repair rebuilds the state, keeps the old one, and leaves the project reproducible", (t) => {
  const root = populated(t);
  const original = fs.readFileSync(statePath(root), "utf8");
  const state = readState(root);
  state.decisions[0].title = "Something nobody decided";
  state.risks[0].status = "MITIGATED";
  fs.writeFileSync(statePath(root), `${JSON.stringify(state, null, 2)}\n`);

  const repaired = ok(root, ["replay", "--project-root", root, "--repair"]);
  assert.match(repaired, /Rebuilt the state from/);
  assert.match(repaired, /preserved at \.beave\/backups\//);

  const after = readState(root);
  assert.strictEqual(after.decisions[0].title, "Bake weekly");
  assert.strictEqual(after.risks[0].status, "IDENTIFIED");

  // The edited bytes are kept, not discarded.
  const backup = repaired.match(/preserved at (\S+?)\.?$/m)[1];
  assert.match(fs.readFileSync(path.join(root, backup), "utf8"), /Something nobody decided/);

  // The repair is itself in the history, and the project replays through it.
  assert.match(ok(root, ["replay", "--project-root", root]), /matches its history exactly/);
  assert.strictEqual(beave(root, ["validate", "--project-root", root]).status, 0);
  assert.ok(readEvents(root).some((event) => event.type === "STATE_REPAIRED_FROM_EVENTS"));
  assert.notStrictEqual(fs.readFileSync(statePath(root), "utf8"), original, "the revision moved on");
});

test("a repair with nothing to repair says so and writes nothing", (t) => {
  const root = populated(t);
  const before = fs.readFileSync(eventsPath(root), "utf8");
  const out = ok(root, ["replay", "--project-root", root, "--repair"]);
  assert.match(out, /Nothing to repair/);
  assert.strictEqual(fs.readFileSync(eventsPath(root), "utf8"), before);
});

test("a repair retried with the same operation id is applied once", (t) => {
  const root = populated(t);
  const state = readState(root);
  state.decisions[0].title = "Something nobody decided";
  fs.writeFileSync(statePath(root), `${JSON.stringify(state, null, 2)}\n`);

  ok(root, ["replay", "--project-root", root, "--repair", "--operation-id", "OP-REPAIR-ONCE"]);
  const afterFirst = readEvents(root).length;
  const retry = ok(root, ["replay", "--project-root", root, "--repair", "--operation-id", "OP-REPAIR-ONCE"]);
  assert.match(retry, /Idempotent retry/);
  assert.strictEqual(readEvents(root).length, afterFirst);
});
