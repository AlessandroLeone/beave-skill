import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ageProject } from "./older-engine.mjs";

/**
 * ALN-015 — the blocker ledger, and the difference between zero and unknown.
 *
 * `state.blockers` existed in the schema, was read by `resume`, the forecast,
 * the gate and Studio, and **no command wrote it**. So `[]` meant "this project
 * has no blockers" and "nobody in this system can record one" at the same time,
 * and the only honest thing `status` could answer was UNKNOWN.
 *
 * What these tests hold to is the distinction that made the field worth having:
 * *resolving the last blocker* and *looking and finding none* are two different
 * statements, and only the second one is `NONE_VERIFIED`. A ledger that slid
 * from the first to the second would be the empty array all over again, wearing
 * a better name.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "lib", "bin", "plangonaut.js");

let counter = 0;

function plangonaut(cwd, args) {
  counter += 1;
  const full = [...args];
  if (!full.includes("--operation-id")) full.push("--operation-id", `BLKOP${counter}-${Date.now()}`);
  const result = spawnSync(process.execPath, [CLI, ...full], { cwd, encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}`.trim(), stdout: result.stdout };
}

function ok(cwd, args) {
  const result = plangonaut(cwd, args);
  assert.strictEqual(result.status, 0, `expected success from ${args[0]}:\n${result.out}`);
  return result.stdout;
}

function project(t, name = "Blockers") {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-blk-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "project");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "owners.json"),
    JSON.stringify({ product: "Ada", technical: "Ada", budget: "Ada", safety: "Ada", release: "Ada" }),
  );
  ok(root, [
    "init", "--project-root", root, "--project-name", name,
    "--project-mode", "Genesis", "--interaction-mode", "Standard",
    "--owners-file", path.join(root, "owners.json"),
  ]);
  return root;
}

const statePath = (root) => path.join(root, ".plangonaut", "state.json");
const readState = (root) => JSON.parse(fs.readFileSync(statePath(root), "utf8"));
const status = (root) => JSON.parse(ok(root, ["status", "--project-root", root]));

const recordOne = (root, id = "BLK-HALL", extra = []) =>
  plangonaut(root, [
    "blocker-record", "--project-root", root, "--id", id,
    "--title", "The hall is not booked",
    "--reason", "The venue has not answered in three weeks",
    "--owner", "Ada", ...extra,
  ]);

test("a recorded blocker is in the ledger, with everything it needs to be one", (t) => {
  const root = project(t);
  const recorded = recordOne(root);
  assert.strictEqual(recorded.status, 0, recorded.out);
  assert.match(recorded.out, /Recorded blocker BLK-HALL at revision 1/);

  const [entry] = readState(root).blockers;
  assert.strictEqual(entry.id, "BLK-HALL");
  assert.strictEqual(entry.title, "The hall is not booked");
  assert.strictEqual(entry.reason, "The venue has not answered in three weeks");
  assert.strictEqual(entry.status, "OPEN");
  assert.strictEqual(entry.owner, "Ada");
  assert.match(entry.recorded_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.strictEqual(entry.revision, 1);

  // And the event, because a ledger entry with no event is a value somebody
  // typed rather than a change the engine can replay.
  const events = fs
    .readFileSync(path.join(root, ".plangonaut", "events.jsonl"), "utf8")
    .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const event = events.at(-1);
  assert.strictEqual(event.type, "BLOCKER_RECORDED");
  assert.strictEqual(event.ledger_id, "BLK-HALL");
  assert.strictEqual(event.record_status, "OPEN");
  assert.strictEqual(event.owner, "Ada");
});

test("evidence is attached by digest, and refused when it is not a real file", (t) => {
  const root = project(t);
  fs.writeFileSync(path.join(root, "email.md"), "No answer from the venue.\n");
  const withEvidence = recordOne(root, "BLK-HALL", ["--evidence-file", path.join(root, "email.md")]);
  assert.strictEqual(withEvidence.status, 0, withEvidence.out);
  const [entry] = readState(root).blockers;
  assert.strictEqual(entry.evidence.path, "email.md");
  assert.match(entry.evidence.sha256, /^[a-f0-9]{64}$/);

  const missing = recordOne(root, "BLK-GONE", ["--evidence-file", path.join(root, "nope.md")]);
  assert.notStrictEqual(missing.status, 0);
  assert.strictEqual(readState(root).blockers.length, 1, "a refused record wrote nothing");
});

test("the same operation twice records one blocker, not two", (t) => {
  const root = project(t);
  const id = "OP-RETRY-ONCE";
  const first = recordOne(root, "BLK-HALL", ["--operation-id", id]);
  assert.strictEqual(first.status, 0, first.out);
  const revisionAfterFirst = readState(root).revision;

  const second = recordOne(root, "BLK-HALL", ["--operation-id", id]);
  assert.strictEqual(second.status, 0, second.out);
  assert.match(second.out, /Idempotent retry/);

  const state = readState(root);
  assert.strictEqual(state.blockers.length, 1, "a retry created a second entry");
  assert.strictEqual(state.revision, revisionAfterFirst, "a retry advanced the revision");
});

test("resolving keeps the record, and says how it ended", (t) => {
  const root = project(t);
  recordOne(root);

  const resolved = plangonaut(root, [
    "blocker-resolve", "--project-root", root, "--id", "BLK-HALL",
    "--resolution", "Booked for 12 June", "--owner", "Ada", "--expected-revision", "1",
  ]);
  assert.strictEqual(resolved.status, 0, resolved.out);
  assert.match(resolved.out, /The record is kept/);

  const state = readState(root);
  assert.strictEqual(state.blockers.length, 1, "resolving deleted the record");
  const [entry] = state.blockers;
  assert.strictEqual(entry.status, "RESOLVED");
  assert.strictEqual(entry.resolution, "Booked for 12 June");
  assert.strictEqual(entry.resolved_by, "Ada");
  assert.match(entry.resolved_at, /^\d{4}-\d{2}-\d{2}T/);
  // The original account survives the closing of it.
  assert.strictEqual(entry.reason, "The venue has not answered in three weeks");
  assert.strictEqual(entry.recorded_at, entry.recorded_at);

  // And it is still visible to a person, marked as history rather than dropped.
  const pack = ok(root, ["resume", "--project-root", root]);
  assert.match(pack, /RESOLVED: BLK-HALL/);
  assert.match(pack, /Booked for 12 June/);
});

test("a stale expected-revision is refused, and writes nothing", (t) => {
  const root = project(t);
  recordOne(root);
  const stale = plangonaut(root, [
    "blocker-resolve", "--project-root", root, "--id", "BLK-HALL",
    "--resolution", "x", "--owner", "Ada", "--expected-revision", "7",
  ]);
  assert.notStrictEqual(stale.status, 0);
  assert.match(stale.out, /expected revision 1/);
  assert.strictEqual(readState(root).blockers[0].status, "OPEN");
});

test("resolving a blocker that was never recorded is refused", (t) => {
  const root = project(t);
  recordOne(root);
  const nothing = plangonaut(root, [
    "blocker-resolve", "--project-root", root, "--id", "BLK-NOPE",
    "--resolution", "done", "--owner", "Ada", "--expected-revision", "1",
  ]);
  assert.notStrictEqual(nothing.status, 0);
  assert.match(nothing.out, /No blocker BLK-NOPE is recorded/);
  assert.match(nothing.out, /Nothing was written/);
  // It names what *is* there rather than only what is not.
  assert.match(nothing.out, /BLK-HALL/);
});

test("verify-none is refused while anything is open, and says which", (t) => {
  const root = project(t);
  recordOne(root);
  const refused = plangonaut(root, ["blocker-verify-none", "--project-root", root, "--owner", "Ada"]);
  assert.notStrictEqual(refused.status, 0);
  assert.match(refused.out, /1 blocker is open/);
  assert.match(refused.out, /BLK-HALL/);
  assert.strictEqual(readState(root).blockers_none_verified ?? null, null, "a refused verification was written anyway");
});

test("UNKNOWN, then RECORDED, then UNKNOWN, and NONE_VERIFIED only when somebody says so", (t) => {
  const root = project(t);

  // Nothing recorded and nobody has looked. The empty ledger proves nothing, and
  // this is the whole reason the field exists.
  const fresh = status(root);
  assert.strictEqual(fresh.blockers_assurance, "UNKNOWN");
  assert.strictEqual(fresh.blockers, null, "an empty array reads as a verified absence");
  assert.strictEqual(fresh.blockers_recorded, false);
  assert.strictEqual(fresh.open_blockers, 0);

  recordOne(root);
  const open = status(root);
  assert.strictEqual(open.blockers_assurance, "RECORDED");
  assert.strictEqual(open.open_blockers, 1);
  assert.strictEqual(open.blockers.length, 1);

  ok(root, [
    "blocker-resolve", "--project-root", root, "--id", "BLK-HALL",
    "--resolution", "Booked for 12 June", "--owner", "Ada", "--expected-revision", "1",
  ]);

  /*
   * The step this whole ledger is built around.
   *
   * Resolving the last blocker is a statement about that blocker. "None is
   * open" is a statement about the project, and nobody has made it — so the
   * answer goes back to UNKNOWN rather than sliding into NONE_VERIFIED. A
   * ledger that made that slide would be `[]` again with a better name.
   */
  const cleared = status(root);
  assert.strictEqual(cleared.blockers_assurance, "UNKNOWN");
  assert.strictEqual(cleared.open_blockers, 0);
  assert.strictEqual(cleared.blockers_recorded, true, "the resolved record is still in the ledger");
  assert.strictEqual(cleared.blockers.length, 1);

  ok(root, ["blocker-verify-none", "--project-root", root, "--owner", "Ada", "--note", "checked the venue thread"]);
  const verified = status(root);
  assert.strictEqual(verified.blockers_assurance, "NONE_VERIFIED");
  assert.strictEqual(verified.blockers_verified_none.by, "Ada");
  assert.strictEqual(verified.blockers_verified_none.note, "checked the venue thread");
  assert.ok(Number.isInteger(verified.blockers_verified_none.state_revision));
});

test("a verification does not survive the next blocker", (t) => {
  const root = project(t);
  ok(root, ["blocker-verify-none", "--project-root", root, "--owner", "Ada"]);
  assert.strictEqual(status(root).blockers_assurance, "NONE_VERIFIED");

  recordOne(root);
  const after = status(root);
  assert.strictEqual(after.blockers_assurance, "RECORDED");
  assert.strictEqual(after.blockers_verified_none, null, "a stale verification outlived the ledger changing");
  assert.strictEqual(readState(root).blockers_none_verified, null);
});

test("the whole ledger replays, and validate agrees with it", (t) => {
  const root = project(t);
  recordOne(root);
  ok(root, [
    "blocker-resolve", "--project-root", root, "--id", "BLK-HALL",
    "--resolution", "Booked for 12 June", "--owner", "Ada", "--expected-revision", "1",
  ]);
  ok(root, ["blocker-verify-none", "--project-root", root, "--owner", "Ada"]);

  const verified = ok(root, ["replay", "--project-root", root, "--verify"]);
  assert.match(verified, /matches its history exactly/);
  assert.match(ok(root, ["validate", "--project-root", root]), /Plangonaut state is valid/);

  // Rebuilt from the events alone, the ledger comes back the same — which is the
  // real test: the records live in the state patches, not in a reducer that
  // could be forgotten.
  const before = JSON.stringify(readState(root).blockers);
  const verification = JSON.stringify(readState(root).blockers_none_verified);
  ok(root, ["replay", "--project-root", root, "--repair", "--operation-id", "OP-REPLAY-BLK"]);
  assert.strictEqual(JSON.stringify(readState(root).blockers), before);
  assert.strictEqual(JSON.stringify(readState(root).blockers_none_verified), verification);
});

test("a project from an older alpha keeps its free-text blockers, and they count as open", (t) => {
  const root = project(t);

  /*
   * A project an alpha.3 engine really could have written: the replay fields are
   * stripped from its events, so there is no digest to contradict, and the state
   * carries the only shape a blocker had then — a sentence somebody typed.
   */
  ageProject(root);
  const aged = readState(root);
  aged.blockers = ["The hall is not booked", "Nobody has signed the insurance"];
  fs.writeFileSync(statePath(root), JSON.stringify(aged, null, 2));

  // It opens, and it is valid: a legacy string is not an error.
  assert.match(ok(root, ["validate", "--project-root", root]), /Plangonaut state is valid/);

  const reported = status(root);
  assert.strictEqual(reported.blockers_assurance, "RECORDED");
  assert.strictEqual(reported.open_blockers, 2, "a blocker with no recorded status is not a resolved one");
  assert.deepStrictEqual(reported.blockers, ["The hall is not booked", "Nobody has signed the insurance"]);

  // Nothing is invented for it: no owner, no date, no status appear from nowhere.
  const pack = ok(root, ["resume", "--project-root", root]);
  assert.match(pack, /no owner, no date, and no recorded status/);

  // It cannot be resolved by an id it never had, and the refusal says what to do.
  const byId = plangonaut(root, [
    "blocker-resolve", "--project-root", root, "--id", "BLK-HALL",
    "--resolution", "x", "--owner", "Ada", "--expected-revision", "1",
  ]);
  assert.notStrictEqual(byId.status, 0);
  assert.match(byId.out, /free text before the ledger existed/);

  // And it holds `verify-none` shut, which is the point of counting it as open.
  const refused = plangonaut(root, ["blocker-verify-none", "--project-root", root, "--owner", "Ada"]);
  assert.notStrictEqual(refused.status, 0);
  assert.match(refused.out, /2 blockers are open/);

  // A new record joins them without touching them.
  assert.strictEqual(recordOne(root, "BLK-NEW").status, 0);
  const mixed = readState(root).blockers;
  assert.strictEqual(mixed.length, 3);
  assert.strictEqual(mixed[0], "The hall is not booked");
  assert.strictEqual(mixed[1], "Nobody has signed the insurance");
  assert.strictEqual(mixed[2].id, "BLK-NEW");
});

test("the forecast counts open blockers only, and says what its zero is worth", (t) => {
  const root = project(t);
  fs.writeFileSync(path.join(root, "why.md"), "First forecast.\n");
  const record = () =>
    ok(root, [
      "forecast", "--project-root", root, "--owner", "Ada", "--phase", "INTERVIEW",
      "--known-work", "Le domande del modulo 1", "--conditional-work", "Dipende dalle risposte",
      "--questions", "10-30", "--operations", "20-60", "--cycles", "2-5",
      "--confidence", "BASSA", "--confidence-reason", "Una sola domanda risposta",
      "--cycle-state", "REGOLARE",
      ...(fs.existsSync(path.join(root, ".seen")) ? ["--change-reason", "again"] : []),
    ]);
  record();
  fs.writeFileSync(path.join(root, ".seen"), "");

  assert.match(
    ok(root, ["forecast", "--project-root", root]),
    /open blockers 0 \(nothing is recorded and nobody has verified it, so this is not a verified zero\)/,
  );

  recordOne(root);
  record();
  assert.match(ok(root, ["forecast", "--project-root", root]), /open blockers 1/);

  ok(root, [
    "blocker-resolve", "--project-root", root, "--id", "BLK-HALL",
    "--resolution", "Booked", "--owner", "Ada", "--expected-revision", "1",
  ]);
  record();
  assert.match(
    ok(root, ["forecast", "--project-root", root]),
    /open blockers 0 \(every recorded blocker is resolved, but nobody has verified since that none is open\)/,
  );

  ok(root, ["blocker-verify-none", "--project-root", root, "--owner", "Ada"]);
  record();
  assert.match(ok(root, ["forecast", "--project-root", root]), /open blockers 0 \(verified by Ada at /);
});

test("a state that claims a verification while a blocker is open is not valid", (t) => {
  const root = project(t);
  ageProject(root);
  const state = readState(root);
  state.blockers = [
    {
      id: "BLK-X", title: "t", reason: "r", status: "OPEN", owner: "Ada",
      recorded_at: "2026-01-01T00:00:00.000Z", revision: 1, updated_at: "2026-01-01T00:00:00.000Z",
    },
  ];
  state.blockers_none_verified = { at: "2026-01-02T00:00:00.000Z", by: "Ada", state_revision: 2, event_id: "e" };
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2));

  const validated = plangonaut(root, ["validate", "--project-root", root]);
  assert.notStrictEqual(validated.status, 0);
  assert.match(validated.out, /blockers_none_verified says no blocker is open, and 1 are/);
});
