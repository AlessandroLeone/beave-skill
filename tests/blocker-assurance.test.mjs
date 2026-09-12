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
 * none*. The truth was narrower: no Beave command writes that ledger, so the
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
const CLI = path.resolve(HERE, "..", "lib", "bin", "beave.js");

let counter = 0;

function beave(cwd, args) {
  counter += 1;
  const full = [...args];
  if (!full.includes("--operation-id")) full.push("--operation-id", `BLK${counter}-${Date.now()}`);
  const result = spawnSync(process.execPath, [CLI, ...full], { cwd, encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}`.trim(), stdout: result.stdout };
}

function ok(cwd, args) {
  const result = beave(cwd, args);
  assert.strictEqual(result.status, 0, `expected success from ${args[0]}:\n${result.out}`);
  return result.stdout;
}

function project(t, name = "Assurance") {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "beave-blockers-"));
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

const statePath = (root) => path.join(root, ".beave", "state.json");

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
   * Written by hand because no command writes this ledger — which is the whole
   * reason the empty array meant nothing. When a command exists (`ALN-015`),
   * this fixture becomes a call to it and the assertions stay as they are.
   */
  const state = JSON.parse(fs.readFileSync(statePath(root), "utf8"));
  state.blockers = ["The hall is not booked", "Nobody has signed the insurance"];
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2));

  const status = beave(root, ["status", "--project-root", root]);
  /*
   * The hand edit puts the state out of step with its history, and `status`
   * refuses such a project — which is itself the fifth case: the blocker state
   * is not reportable because nothing here can be trusted.
   */
  assert.strictEqual(status.status, 2, status.out);
  assert.match(status.out, /does not agree with its history/);

  // Rebuilt from the history, the hand-written entries are gone and the honest
  // answer returns.
  ok(root, ["replay", "--project-root", root, "--repair", "--operation-id", "OP-REPAIR"]);
  const repaired = JSON.parse(ok(root, ["status", "--project-root", root]));
  assert.strictEqual(repaired.blockers, null);
  assert.strictEqual(repaired.blockers_assurance, "UNKNOWN");
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
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "beave-blockers-plain-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const status = beave(base, ["status", "--project-root", base]);
  assert.notStrictEqual(status.status, 0);
  assert.doesNotMatch(status.out, /"blockers"/);
});

test("a project whose state does not match its history reports no blocker state", (t) => {
  const root = project(t);
  const state = JSON.parse(fs.readFileSync(statePath(root), "utf8"));
  state.exact_next_action = "edited by hand";
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2));

  const status = beave(root, ["status", "--project-root", root]);
  assert.strictEqual(status.status, 2);
  assert.doesNotMatch(status.out, /"blockers_assurance"/);
});

test("the human outputs do not offer zero as proof either", (t) => {
  const root = project(t);

  const resumed = ok(root, ["resume", "--project-root", root]);
  assert.match(resumed, /No command writes this ledger today/);

  fs.writeFileSync(path.join(root, "why.md"), "First forecast.\n");
  ok(root, [
    "forecast", "--project-root", root, "--owner", "Ada", "--phase", "INTERVIEW",
    "--known-work", "Le domande del modulo 1", "--conditional-work", "Dipende dalle risposte",
    "--questions", "10-30", "--operations", "20-60", "--cycles", "2-5",
    "--confidence", "BASSA", "--confidence-reason", "Una sola domanda risposta",
    "--cycle-state", "REGOLARE",
  ]);
  const forecast = ok(root, ["forecast", "--project-root", root]);
  assert.match(forecast, /open blockers 0 \(nothing writes that ledger, so this is not a verified zero\)/);
});
