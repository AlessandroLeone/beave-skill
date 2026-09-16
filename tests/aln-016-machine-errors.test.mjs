import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * ALN-016 — a refusal a program can branch on.
 *
 * "There is no Plangonaut project here" and "there is one and its records disagree"
 * were both exit 2 with an English sentence on stderr. They call for opposite
 * responses — offer to initialise, or offer to repair and read nothing as fact —
 * and the only way to tell them apart was to match the prose.
 *
 * The contract these tests hold is narrow on purpose: the JSON channel is JSON,
 * always, including when it fails; the kind is the field to switch on; and the
 * message is for people. A caller that reads `message` to decide anything is a
 * caller this change did not help.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "lib", "bin", "plangonaut.js");

let counter = 0;

function plangonaut(cwd, args) {
  counter += 1;
  const full = [...args];
  if (!full.includes("--operation-id")) full.push("--operation-id", `ERR${counter}-${Date.now()}`);
  const result = spawnSync(process.execPath, [CLI, ...full], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function project(t, name = "Errors") {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-err-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "project");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "owners.json"),
    JSON.stringify({ product: "Ada", technical: "Ada", budget: "Ada", safety: "Ada", release: "Ada" }),
  );
  const init = plangonaut(root, [
    "init", "--project-root", root, "--project-name", name,
    "--project-mode", "Genesis", "--interaction-mode", "Standard",
    "--owners-file", path.join(root, "owners.json"),
  ]);
  assert.strictEqual(init.status, 0, init.stderr);
  return root;
}

const statePath = (root) => path.join(root, ".plangonaut", "state.json");

test("an ordinary folder answers NOT_PLANGONAUT_PROJECT", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-plain-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const result = plangonaut(base, ["status", "--project-root", base]);
  assert.notStrictEqual(result.status, 0, "a refusal must not exit 0");

  const payload = JSON.parse(result.stdout);
  assert.strictEqual(payload.ok, false);
  assert.strictEqual(payload.error.kind, "NOT_PLANGONAUT_PROJECT");
  assert.strictEqual(payload.error.command, "status");
  assert.ok(payload.error.message.length > 0, "a person still gets a sentence");
  // Nothing about blockers: there is no ledger here to have an opinion about.
  assert.ok(!("blockers_assurance" in payload));
});

test("a path that is not a directory at all is the same kind", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-nodir-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const missing = path.join(base, "does-not-exist");

  const payload = JSON.parse(plangonaut(base, ["status", "--project-root", missing]).stdout);
  // A caller deciding whether to offer "set up Plangonaut here" must land in the same
  // branch for "an empty folder" and "a folder that is not there".
  assert.strictEqual(payload.error.kind, "NOT_PLANGONAUT_PROJECT");
});

test("a project whose state disagrees with its history answers PROJECT_STATE_UNTRUSTED", (t) => {
  const root = project(t);
  const state = JSON.parse(fs.readFileSync(statePath(root), "utf8"));
  state.exact_next_action = "edited by hand";
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2));

  const result = plangonaut(root, ["status", "--project-root", root]);
  assert.notStrictEqual(result.status, 0);

  const payload = JSON.parse(result.stdout);
  assert.strictEqual(payload.ok, false);
  assert.strictEqual(payload.error.kind, "PROJECT_STATE_UNTRUSTED");
  /*
   * The fourth value of the blocker vocabulary, reachable at last.
   *
   * `status` publishes RECORDED / NONE_VERIFIED / UNKNOWN / UNTRUSTED and could
   * never return the last one: the command that would report it refuses such a
   * project outright. A consumer that switches on the field now sees all four.
   */
  assert.strictEqual(payload.blockers_assurance, "UNTRUSTED");
});

test("a corrupt state file is untrusted, not missing", (t) => {
  const root = project(t);
  fs.writeFileSync(statePath(root), "{ this is not json");

  const payload = JSON.parse(plangonaut(root, ["status", "--project-root", root]).stdout);
  // The project is here. Something is wrong with it, which is a different thing
  // from it not existing, and the two lead to different offers.
  assert.strictEqual(payload.error.kind, "PROJECT_STATE_UNTRUSTED");
  assert.strictEqual(payload.blockers_assurance, "UNTRUSTED");
});

test("a state file deleted from under its own history is untrusted", (t) => {
  const root = project(t);
  fs.rmSync(statePath(root));

  const payload = JSON.parse(plangonaut(root, ["status", "--project-root", root]).stdout);
  assert.strictEqual(payload.error.kind, "PROJECT_STATE_UNTRUSTED");
  assert.match(payload.error.message, /replay/, "the way out is still named for the person");
});

test("everything else is COMMAND_FAILED, and the project is not blamed for it", (t) => {
  const root = project(t);
  const payload = JSON.parse(plangonaut(root, ["status", "--project-root", root, "--nonsense", "x"]).stdout);
  assert.strictEqual(payload.error.kind, "COMMAND_FAILED");
  assert.ok(!("blockers_assurance" in payload), "a bad option says nothing about the ledger");
});

test("the JSON channel is JSON, and nothing else is on it", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-clean-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const result = plangonaut(base, ["status", "--project-root", base]);

  // Parseable on its own, with no prefix and no trailing prose.
  assert.doesNotThrow(() => JSON.parse(result.stdout));
  assert.doesNotMatch(result.stdout, /PLANGONAUT ERROR/);

  /*
   * And nothing on stderr either.
   *
   * A caller that merges the streams — `2>&1`, which is what a great many
   * process wrappers do by default — must still be handed one parseable
   * document. Writing the sentence to stderr "because it is a different
   * channel" is how JSON output gets contaminated in practice.
   */
  assert.strictEqual(result.stderr.trim(), "", `stderr was not empty: ${result.stderr}`);
  assert.doesNotThrow(() => JSON.parse(`${result.stdout}${result.stderr}`));
});

test("a human command still gets a sentence, on stderr, unchanged", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-human-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  // `resume` is a human output and takes no --json, so it is untouched by this.
  const result = plangonaut(base, ["resume", "--project-root", base]);
  assert.strictEqual(result.status, 2);
  assert.match(result.stderr, /PLANGONAUT ERROR:/);
  assert.strictEqual(result.stdout.trim(), "", "a text command must not start emitting JSON");
});

test("--json on a command that takes it turns its refusals into documents too", (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-qalog-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));

  const result = plangonaut(base, ["qa-log", "--project-root", base, "--json"]);
  assert.notStrictEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.strictEqual(payload.error.kind, "NOT_PLANGONAUT_PROJECT");
  assert.strictEqual(payload.error.command, "qa-log");
  assert.strictEqual(result.stderr.trim(), "");
});

test("a healthy project is unchanged: success is not wrapped", (t) => {
  const root = project(t);
  const result = plangonaut(root, ["status", "--project-root", root]);
  assert.strictEqual(result.status, 0);
  const payload = JSON.parse(result.stdout);
  // The success shape is what every existing consumer already reads. Wrapping it
  // would have been a breaking change bought for symmetry alone.
  assert.strictEqual(payload.project, "Errors");
  assert.ok(!("error" in payload));
  assert.strictEqual(payload.blockers_assurance, "UNKNOWN");
});
