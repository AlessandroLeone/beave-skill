import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../lib/cli.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(os.tmpdir(), "beave-tests-node");

function fixture(name) {
  fs.mkdirSync(fixtureRoot, { recursive: true });
  return fs.mkdtempSync(path.join(fixtureRoot, `${name}-`));
}

async function invoke(...args) {
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values) => stdout.push(values.join(" "));
  console.error = (...values) => stderr.push(values.join(" "));
  try {
    const status = await main(args);
    return { status, stdout: `${stdout.join("\n")}\n`, stderr: `${stderr.join("\n")}\n` };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function run(...args) {
  if (["record","override","reconcile","decision","requirement","task","dependency","risk","evidence","agent","checkpoint","gate","doc-save","doc-mark-deletion","doc-restore","doc-finalize"].includes(args[0]) && !args.includes("--operation-id")) args = [...args, "--operation-id", `OP-${crypto.randomUUID()}`];
  const result = await invoke(...args);
  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  return result.stdout;
}

async function initialize(project, mode = "Standard") {
  const owners = path.join(project, "owners.json");
  fs.writeFileSync(owners, JSON.stringify({ product: "User", technical: "User", budget: "User", safety: "User", release: "User" }));
  await run("init", "--project-root", project, "--project-name", "Fixture", "--project-mode", "Resume", "--interaction-mode", mode, "--owners-file", owners, "--operation-id", `OP-init-${mode}`);
}

test("capabilities are dependency-free", async () => {
  const output = JSON.parse(await run("capabilities"));
  assert.deepEqual(output.external_dependencies, []);
  assert.deepEqual(output.interaction_modes, ["Guided", "Standard", "Expert"]);
});

test("init, resume, override, reconcile and validate", async () => {
  const project = fixture("lifecycle");
  await initialize(project, "Expert");
  // The heading was renamed after the ALN-005 handoff test: a fresh recipient read
  // "Resume questions" as the next action and went to interview the user about a
  // module the dossier had closed. Assert the two things that matter: the recorded
  // next action is present, and the prompts are labelled as catalog prompts.
  const resumed = await run("resume", "--project-root", project);
  assert.match(resumed, /Exact next action:/);
  assert.match(resumed, /Catalog questions for the active module/);
  assert.match(resumed, /The recorded exact next action above prevails/);
  const instruction = path.join(project, "override.md");
  fs.writeFileSync(instruction, "Change the target user.");
  const recorded = await run("override", "--project-root", project, "--instruction-file", instruction, "--owner", "User");
  const id = recorded.match(/OVR-[a-f0-9]{12}/)?.[0];
  assert.ok(id);
  assert.equal(JSON.parse(await run("status", "--project-root", project)).needs_reconciliation, true);
  // Blocked, and non-zero while saying so: a caller checking the exit code must
  // not see success on an output headed "Resume blocked".
  const blocked = await invoke("resume", "--project-root", project);
  assert.strictEqual(blocked.status, 2, blocked.stdout);
  assert.match(blocked.stdout, /Resume blocked/);
  assert.match(blocked.stderr, /open human override has to be reconciled/);
  const blockedAnswer = path.join(project, "blocked.md");
  fs.writeFileSync(blockedAnswer, "Must not be recorded yet.");
  const blockedRecord = await invoke("record", "--project-root", project, "--module", "1", "--status", "CONFIRMED", "--answer-file", blockedAnswer, "--owner", "User");
  assert.equal(blockedRecord.status, 2);
  const evidence = path.join(project, "reconciled.md");
  fs.writeFileSync(evidence, "Product brief updated.");
  await run("reconcile", "--project-root", project, "--override-id", id, "--evidence-file", evidence, "--owner", "User", "--next-action", "Continue module 1.");
  assert.equal(JSON.parse(await run("status", "--project-root", project)).needs_reconciliation, false);
  assert.match(await run("validate", "--project-root", project), /valid/);
});

test("validation detects state and event divergence", async () => {
  const project = fixture("divergence");
  await initialize(project);
  const statePath = path.join(project, ".beave", "state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.revision += 1;
  fs.writeFileSync(statePath, JSON.stringify(state));
  const result = await invoke("validate", "--project-root", project);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /state revision does not match/);
});

test("installer supports dry-run and refuses silent overwrite", async () => {
  const project = fixture("install");
  const preview = await run("install", "--target", "all", "--scope", "project", "--project-root", project, "--dry-run");
  assert.match(preview, /Would install codex/);
  assert.equal(fs.existsSync(path.join(project, ".agents")), false);
  await run("install", "--target", "all", "--scope", "project", "--project-root", project);
  assert.ok(fs.existsSync(path.join(project, ".agents", "skills", "beave", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(project, ".claude", "skills", "beave", "SKILL.md")));
  const conflict = await invoke("install", "--target", "codex", "--scope", "project", "--project-root", project);
  assert.equal(conflict.status, 2);
  assert.match(conflict.stderr, /Refusing to overwrite/);
});
