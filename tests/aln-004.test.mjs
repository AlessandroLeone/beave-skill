import { describe, it } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CLI = path.resolve("lib/bin/plangonaut.js");
const owners = { product: "A", technical: "B", budget: "C", safety: "D", release: "E" };

function run(args, cwd) {
  if (["record","override","reconcile","decision","requirement","task","dependency","risk","evidence","agent","checkpoint","gate","doc-save","doc-mark-deletion","doc-restore","doc-finalize"].includes(args[0]) && !args.includes("--operation-id")) args = [...args, "--operation-id", `OP-${crypto.randomUUID()}`];
  if (args[0] === "doc-save" && !args.includes("--confirm-token")) {
    const preview = spawnSync(process.execPath, [CLI, "doc-diff", ...args.slice(1)], { cwd, encoding: "utf8" });
    if (preview.status === 0) args = [...args, "--confirm-token", JSON.parse(preview.stdout).confirmation_token];
  }
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function project(name = "ALN004") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-aln004-"));
  fs.writeFileSync(path.join(root, "owners.json"), JSON.stringify(owners));
  const result = run(["init", "--project-root", ".", "--project-name", name, "--project-mode", "Genesis", "--interaction-mode", "Standard", "--owners-file", "owners.json", "--operation-id", `OP-init-${name.replace(/[^A-Za-z0-9._:-]/g, "-")}`], root);
  assert.strictEqual(result.status, 0, result.stderr);
  return root;
}

describe("ALN-004 deterministic closure", () => {
  it("preflights state and path collisions before touching document bytes", () => {
    const root = project("Preflight");
    fs.writeFileSync(path.join(root, "a.md"), "alpha");
    let preview = run(["doc-diff", "--project-root", ".", "--id", "ART-A", "--base-path", "docs/spec.md", "--content-file", "a.md", "--owner", "A"], root);
    let token = JSON.parse(preview.stdout).confirmation_token;
    let result = run(["doc-save", "--project-root", ".", "--id", "ART-A", "--base-path", "docs/spec.md", "--content-file", "a.md", "--owner", "A", "--confirm-token", token], root);
    assert.strictEqual(result.status, 0, result.stderr);
    const original = fs.readFileSync(path.join(root, "docs/spec-v1.md"), "utf8");
    fs.writeFileSync(path.join(root, "b.md"), "beta");
    preview = run(["doc-diff", "--project-root", ".", "--id", "ART-B", "--base-path", "docs/spec.md", "--content-file", "b.md", "--owner", "A"], root);
    token = JSON.parse(preview.stdout).confirmation_token;
    result = run(["doc-save", "--project-root", ".", "--id", "ART-B", "--base-path", "docs/spec.md", "--content-file", "b.md", "--owner", "A", "--confirm-token", token], root);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /(base_path collision|Refusing to overwrite untracked working file)/);
    assert.strictEqual(fs.readFileSync(path.join(root, "docs/spec-v1.md"), "utf8"), original);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(root, ".plangonaut/state.json"), "utf8")).artifacts.length, 1);
  });

  it("binds a caller operation ID to one normalized request", () => {
    const root = project("Operation IDs");
    const initArgs = ["init", "--project-root", ".", "--project-name", "Operation IDs", "--project-mode", "Genesis", "--interaction-mode", "Standard", "--owners-file", "owners.json", "--operation-id", "OP-init-Operation-IDs"];
    let result = run(initArgs, root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /Idempotent retry/);
    result = run([...initArgs.slice(0, 4), "Changed", ...initArgs.slice(5)], root);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /already used with different input/);
    const operation = "OP-CALLER-ONE";
    result = run(["decision", "--project-root", ".", "--id", "DEC-A", "--title", "First", "--status", "APPROVED", "--owner", "A", "--operation-id", operation], root);
    assert.strictEqual(result.status, 0, result.stderr);
    result = run(["decision", "--project-root", ".", "--id", "DEC-B", "--title", "Different", "--status", "APPROVED", "--owner", "A", "--operation-id", operation], root);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /already used with different input/);
  });

  it("recovers a state-only init crash before retrying the same initialization", () => {
    const root = project("Init crash");
    const statePath = path.join(root, ".plangonaut", "state.json");
    const eventsPath = path.join(root, ".plangonaut", "events.jsonl");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    const transaction = path.join(root, ".plangonaut", "transactions", state.last_event_id);
    fs.mkdirSync(transaction, { recursive: true });
    fs.writeFileSync(path.join(transaction, "manifest.json"), JSON.stringify({
      format: "plangonaut-file-transaction-v1",
      event_id: state.last_event_id,
      state_revision: 1,
      created_at: state.updated_at,
      files: [
        { path: ".plangonaut/state.json", existed: false, backup: null },
        { path: ".plangonaut/events.jsonl", existed: false, backup: null }
      ]
    }));
    fs.rmSync(eventsPath);
    const result = run(["init", "--project-root", ".", "--project-name", "Init crash", "--project-mode", "Genesis", "--interaction-mode", "Standard", "--owners-file", "owners.json", "--operation-id", "OP-init-Init-crash"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(eventsPath));
    assert.ok(fs.existsSync(path.join(root, ".plangonaut", "recovery", `${state.last_event_id}.rolled-back.json`)));
  });

  it("refuses gate advancement when governed document integrity is broken", () => {
    const root = project("Gate integrity");
    fs.writeFileSync(path.join(root, "draft.md"), "recorded");
    let preview = run(["doc-diff", "--project-root", ".", "--id", "ART-GATE", "--base-path", "docs/gate.md", "--content-file", "draft.md", "--owner", "A"], root);
    const token = JSON.parse(preview.stdout).confirmation_token;
    let result = run(["doc-save", "--project-root", ".", "--id", "ART-GATE", "--base-path", "docs/gate.md", "--content-file", "draft.md", "--owner", "A", "--confirm-token", token], root);
    assert.strictEqual(result.status, 0, result.stderr);
    fs.writeFileSync(path.join(root, "docs/gate-v1.md"), "tampered");
    fs.writeFileSync(path.join(root, "gate-evidence.md"), "reviewed");
    result = run(["gate", "--project-root", ".", "--id", "G1", "--status", "PASSED", "--evidence-file", "gate-evidence.md", "--owner", "A"], root);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /External edit detected/);
  });

  it("recovers an interrupted file transaction before validation", () => {
    const root = project("Crash recovery");
    fs.writeFileSync(path.join(root, "draft.md"), "safe");
    const preview = run(["doc-diff", "--project-root", ".", "--id", "ART-RECOVERY", "--base-path", "docs/recovery.md", "--content-file", "draft.md", "--owner", "A"], root);
    let result = run(["doc-save", "--project-root", ".", "--id", "ART-RECOVERY", "--base-path", "docs/recovery.md", "--content-file", "draft.md", "--owner", "A", "--confirm-token", JSON.parse(preview.stdout).confirmation_token], root);
    assert.strictEqual(result.status, 0, result.stderr);
    const tx = path.join(root, ".plangonaut", "transactions", "INTERRUPTED");
    fs.mkdirSync(tx, { recursive: true });
    const tracked = [".plangonaut/state.json", ".plangonaut/events.jsonl", "docs/recovery-v1.md"];
    const files = tracked.map((relative, index) => {
      fs.copyFileSync(path.join(root, relative), path.join(tx, `backup-${index}`));
      return { path: relative, existed: true, backup: `backup-${index}` };
    });
    const state = JSON.parse(fs.readFileSync(path.join(root, ".plangonaut/state.json"), "utf8"));
    fs.writeFileSync(path.join(tx, "manifest.json"), JSON.stringify({ format: "plangonaut-file-transaction-v1", event_id: "INTERRUPTED", state_revision: state.revision + 1, files }));
    fs.writeFileSync(path.join(root, "docs/recovery-v1.md"), "partial");
    result = run(["validate", "--project-root", "."], root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(fs.readFileSync(path.join(root, "docs/recovery-v1.md"), "utf8"), "safe");
    assert.ok(fs.existsSync(path.join(root, ".plangonaut/recovery/INTERRUPTED.rolled-back.json")));
  });
  it("creates and safely updates typed ledgers while rejecting stale writes and dangling links", () => {
    const root = project();
    let result = run(["decision", "--project-root", ".", "--id", "DEC-SCOPE", "--title", "Approve scope", "--status", "APPROVED", "--owner", "A"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    result = run(["requirement", "--project-root", ".", "--id", "REQ-HANDOFF", "--title", "Portable handoff", "--status", "ACTIVE", "--owner", "A"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    result = run(["task", "--project-root", ".", "--id", "TSK-EXPORT", "--title", "Build export", "--status", "READY", "--owner", "B"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    result = run(["dependency", "--project-root", ".", "--id", "DEP-HANDOFF", "--from", "REQ-HANDOFF", "--to", "TSK-EXPORT", "--type", "REQUIRES", "--owner", "B"], root);
    assert.strictEqual(result.status, 0, result.stderr);

    const before = fs.readFileSync(path.join(root, ".plangonaut", "state.json"), "utf8");
    result = run(["task", "--project-root", ".", "--id", "TSK-EXPORT", "--title", "Changed", "--status", "DONE", "--owner", "B", "--expected-revision", "9"], root);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /Stale task/);
    assert.strictEqual(fs.readFileSync(path.join(root, ".plangonaut", "state.json"), "utf8"), before);

    result = run(["dependency", "--project-root", ".", "--id", "DEP-MISSING", "--from", "REQ-NOT-THERE", "--to", "TSK-EXPORT", "--type", "REQUIRES", "--owner", "B"], root);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /missing from node/);
    assert.strictEqual(fs.readFileSync(path.join(root, ".plangonaut", "state.json"), "utf8"), before);

    fs.writeFileSync(path.join(root, "candidate.md"), "candidate");
    const preview = run(["doc-diff", "--project-root", ".", "--id", "ART-SOURCES", "--base-path", "docs/sources.md", "--content-file", "candidate.md", "--owner", "A"], root);
    result = run(["doc-save", "--project-root", ".", "--id", "ART-SOURCES", "--base-path", "docs/sources.md", "--content-file", "candidate.md", "--owner", "A", "--sources", "TSK-EXPORT", "--confirm-token", JSON.parse(preview.stdout).confirmation_token], root);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /sources must reference DEC\/EVD records/);
    assert.ok(!fs.existsSync(path.join(root, "docs/sources-v1.md")));
  });

  it("rejects empty gate evidence and gate completion without prerequisites", () => {
    const root = project();
    fs.writeFileSync(path.join(root, "empty.md"), "");
    let result = run(["gate", "--project-root", ".", "--id", "G1", "--status", "PASSED", "--evidence-file", "empty.md", "--owner", "A"], root);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /Evidence file is empty/);
    fs.writeFileSync(path.join(root, "gate.md"), "Human-reviewed purpose evidence.");
    result = run(["gate", "--project-root", ".", "--id", "G1", "--status", "PASSED", "--evidence-file", "gate.md", "--owner", "A"], root);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /module 1 must be resolved/);
  });

  it("returns a reviewable document diff and rejects stale revision/hash tokens", () => {
    const root = project();
    fs.writeFileSync(path.join(root, "first.md"), "alpha\n");
    let result = run(["doc-save", "--project-root", ".", "--id", "ART-SPEC", "--base-path", "docs/spec.md", "--content-file", "first.md", "--owner", "A", "--expected-revision", "0", "--expected-hash", "NEW"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    const saved = JSON.parse(result.stdout);
    assert.deepEqual(saved.diff, [{ kind: "added", text: "alpha" }]);
    fs.writeFileSync(path.join(root, "second.md"), "beta\n");
    result = run(["doc-diff", "--project-root", ".", "--id", "ART-SPEC", "--base-path", "docs/spec.md", "--content-file", "second.md", "--owner", "A", "--expected-revision", "1", "--expected-hash", saved.hash], root);
    assert.strictEqual(result.status, 0, result.stderr);
    const preview = JSON.parse(result.stdout);
    assert.deepEqual(preview.diff, [{ kind: "removed", text: "alpha" }, { kind: "added", text: "beta" }]);
    const before = fs.readFileSync(path.join(root, ".plangonaut", "state.json"), "utf8");
    result = run(["doc-save", "--project-root", ".", "--id", "ART-SPEC", "--base-path", "docs/spec.md", "--content-file", "second.md", "--owner", "A", "--expected-revision", "0", "--expected-hash", "NEW"], root);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /stale revision/);
    assert.strictEqual(fs.readFileSync(path.join(root, ".plangonaut", "state.json"), "utf8"), before);
  });

  it("exports, verifies, imports and resumes a portable project package", () => {
    const root = project("RoundTrip");
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "draft.md"), "# Approved plan\n");
    let result = run(["doc-save", "--project-root", ".", "--id", "ART-PLAN", "--base-path", "docs/plan.md", "--content-file", "draft.md", "--owner", "A"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    result = run(["doc-finalize", "--project-root", ".", "--id", "ART-PLAN", "--owner", "A"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    fs.writeFileSync(path.join(root, "notes.md"), "# Working notes\n");
    result = run(["doc-save", "--project-root", ".", "--id", "ART-NOTES", "--base-path", "docs/notes.md", "--content-file", "notes.md", "--owner", "A"], root);
    assert.strictEqual(result.status, 0, result.stderr);

    const packageDir = path.join(root, "handoff");
    result = run(["project-export", "--project-root", ".", "--output-dir", packageDir], root);
    assert.strictEqual(result.status, 0, result.stderr);
    result = run(["project-verify", "--package-dir", packageDir], root);
    assert.strictEqual(result.status, 0, result.stderr);

    const imported = path.join(root, "imported");
    result = run(["project-import", "--package-dir", packageDir, "--project-root", imported, "--operation-id", "OP-project-import-roundtrip"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    result = run(["project-import", "--package-dir", packageDir, "--project-root", imported, "--operation-id", "OP-project-import-roundtrip"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /Idempotent retry/);
    result = run(["resume", "--project-root", "."], imported);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(imported, "docs", "plan.md")));
    assert.ok(fs.existsSync(path.join(imported, "docs", "notes-v1.md")));

    // The recipient inherits the recorded revisions, not just a ledger that
    // mentions them. Without `history/` in the package, `doc-history` listed
    // revisions the recipient could not bring back and `doc-restore` answered
    // "History file for revision 1 not found" — true for the author, false for
    // whoever received the folder. Demonstrated in both ALN-005 pilots.
    const sourceHistory = fs.readdirSync(path.join(root, ".plangonaut", "history")).sort();
    assert.ok(sourceHistory.length > 0, "the exporting project must have history to carry");
    assert.deepEqual(
      fs.readdirSync(path.join(imported, ".plangonaut", "history")).sort(),
      sourceHistory,
      "every recorded revision must survive the handoff"
    );

    result = run(["doc-history", "--project-root", ".", "--id", "ART-PLAN"], imported);
    assert.strictEqual(result.status, 0, result.stderr);
    result = run(["doc-restore", "--project-root", ".", "--id", "ART-PLAN", "--revision", "1", "--owner", "A", "--operation-id", "OP-restore-after-import"], imported);
    assert.strictEqual(result.status, 0, `the recipient must be able to restore: ${result.stderr}`);

    fs.appendFileSync(path.join(packageDir, "files", "docs", "plan.md"), "tampered");
    result = run(["project-verify", "--package-dir", packageDir], root);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /(digest|byte count) mismatch/);
  });
});
