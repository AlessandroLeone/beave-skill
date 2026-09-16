import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * `"blockers": []` was an answer this engine had no right to give.
 *
 * In every language a consumer is written in, an empty array means *there are
 * none*. The truth was narrower: no Plangonaut command writes that ledger, so the
 * array was empty in exactly the same way for a project with no blockers and for
 * a project with ten that nobody had a way to record. `resume` said so in words
 * and the machine-readable output did not — the wrong way round, because a
 * person reading a paragraph can notice a caveat and a program reading an array
 * cannot.
 *
 * So the absence of knowledge has its own shape now, and the four states a
 * caller may need to tell apart are named rather than collapsed.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "lib", "bin", "plangonaut.js");

let counter = 0;

function plangonaut(cwd, args) {
  counter += 1;
  const full = [...args];
  if (!full.includes("--operation-id")) full.push("--operation-id", `BLK${counter}-${Date.now()}`);
  const result = spawnSync(process.execPath, [CLI, ...full], { cwd, encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}`.trim(), stdout: result.stdout };
}

function ok(cwd, args) {
  const result = plangonaut(cwd, args);
  assert.strictEqual(result.status, 0, `expected success from ${args[0]}:\n${result.out}`);
  return result.stdout;
}

function project(t, name = "Assurance") {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-blockers-"));
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

test("nothing recorded is reported as unknown, not as none", (t) => {
  const root = project(t);
  const status = JSON.parse(ok(root, ["status", "--project-root", root]));

  assert.strictEqual(status.blockers, null, "an empty array reads as a verified absence");
  assert.strictEqual(status.blockers_recorded, false);
  assert.strictEqual(status.blockers_assurance, "UNKNOWN");
  assert.match(status.blockers_note, /not evidence/);
});

test("recorded blockers are reported as recorded, with the entries", (t) => {
  const root = project(t);

  /*
   * This fixture used to be a hand edit of `state.json`, with a note saying it
   * would become a call to a real command when `ALN-015` arrived. It has.
   *
   * The hand edit is kept below, in the half of the test it still belongs to:
   * writing the ledger by hand puts the state out of step with its history, and
   * that remains a project whose blocker state cannot be reported as fact.
   */
  ok(root, [
    "blocker-record", "--project-root", root, "--id", "BLK-HALL",
    "--title", "The hall is not booked", "--reason", "The venue has not answered",
    "--owner", "Ada", "--operation-id", "OP-BLK-1",
  ]);
  const recorded = JSON.parse(ok(root, ["status", "--project-root", root]));
  assert.strictEqual(recorded.blockers_assurance, "RECORDED");
  assert.strictEqual(recorded.open_blockers, 1);
  assert.strictEqual(recorded.blockers.length, 1);
  assert.strictEqual(recorded.blockers[0].id, "BLK-HALL");

  // And the same content written by hand instead is still refused, because the
  // state no longer matches the history that produced it.
  const state = JSON.parse(fs.readFileSync(statePath(root), "utf8"));
  state.blockers.push("Nobody has signed the insurance");
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2));

  const status = plangonaut(root, ["status", "--project-root", root]);
  assert.strictEqual(status.status, 2, status.out);
  assert.match(status.out, /does not agree with its history/);

  // Rebuilt from the history, the hand-written entry is gone and the recorded
  // one — which has events behind it — comes back.
  ok(root, ["replay", "--project-root", root, "--repair", "--operation-id", "OP-REPAIR"]);
  const repaired = JSON.parse(ok(root, ["status", "--project-root", root]));
  assert.strictEqual(repaired.blockers.length, 1);
  assert.strictEqual(repaired.blockers[0].id, "BLK-HALL");
  assert.strictEqual(repaired.blockers_assurance, "RECORDED");
});

test("the four answers are distinguishable without reading prose", (t) => {
  const root = project(t);
  const status = JSON.parse(ok(root, ["status", "--project-root", root]));

  // A consumer can branch on one field, and every branch it must handle is named.
  assert.ok(["RECORDED", "NONE_VERIFIED", "UNKNOWN", "UNTRUSTED"].includes(status.blockers_assurance));
  assert.strictEqual(typeof status.blockers_recorded, "boolean");
  assert.ok("blockers" in status, "the legacy field must still be present, so a consumer sees the change rather than a missing key");
});

test("a project that is not governed does not report a blocker state at all", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-blockers-plain-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const status = plangonaut(base, ["status", "--project-root", base]);
  assert.notStrictEqual(status.status, 0);
  assert.doesNotMatch(status.out, /"blockers"/);
});

test("a project whose state does not match its history reports UNTRUSTED", (t) => {
  const root = project(t);
  const state = JSON.parse(fs.readFileSync(statePath(root), "utf8"));
  state.exact_next_action = "edited by hand";
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2));

  const status = plangonaut(root, ["status", "--project-root", root]);
  assert.strictEqual(status.status, 2);

  /*
   * This assertion used to be `doesNotMatch(/"blockers_assurance"/)`, and it was
   * right at the time: `UNTRUSTED` was in the published vocabulary and no
   * command could ever return it, because the one command that would have
   * refused such a project outright with a sentence.
   *
   * `ALN-016` gives that refusal a shape, and the fourth value is reachable. The
   * old assertion is not a regression this broke — it is the absence it closed.
   */
  const payload = JSON.parse(status.stdout);
  assert.strictEqual(payload.ok, false);
  assert.strictEqual(payload.error.kind, "PROJECT_STATE_UNTRUSTED");
  assert.strictEqual(payload.blockers_assurance, "UNTRUSTED");
});

test("the human outputs do not offer zero as proof either", (t) => {
  const root = project(t);

  /*
   * The sentence changed because the fact under it did.
   *
   * It read "No command writes this ledger today", which was the honest thing to
   * say while none did. What has to stay true is the part that was never about
   * the missing command: an empty ledger is still not evidence of an unblocked
   * project, and the output still says so and names what would make it evidence.
   */
  const resumed = ok(root, ["resume", "--project-root", root]);
  assert.match(resumed, /not evidence that the project has none/);
  assert.match(resumed, /blocker-verify-none/);

  fs.writeFileSync(path.join(root, "why.md"), "First forecast.\n");
  ok(root, [
    "forecast", "--project-root", root, "--owner", "Ada", "--phase", "INTERVIEW",
    "--known-work", "Le domande del modulo 1", "--conditional-work", "Dipende dalle risposte",
    "--questions", "10-30", "--operations", "20-60", "--cycles", "2-5",
    "--confidence", "BASSA", "--confidence-reason", "Una sola domanda risposta",
    "--cycle-state", "REGOLARE",
  ]);
  const forecast = ok(root, ["forecast", "--project-root", root]);
  // Same reason as above: still not a verified zero, no longer because nothing
  // can write the ledger — because nobody has.
  assert.match(forecast, /open blockers 0 \(nothing is recorded and nobody has verified it, so this is not a verified zero\)/);
});
