import { test, describe, it } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CLI = path.resolve("lib/bin/beave.js");

function runCli(args, cwd) {
  if (["doc-save","doc-mark-deletion","doc-restore","doc-finalize"].includes(args[0]) && !args.includes("--operation-id")) args = [...args, "--operation-id", `OP-${crypto.randomUUID()}`];
  if (args[0] === "doc-save" && !args.includes("--confirm-token")) {
    const preview = spawnSync(process.execPath, [CLI, "doc-diff", ...args.slice(1)], { cwd, encoding: "utf8" });
    if (preview.status === 0) args = [...args, "--confirm-token", JSON.parse(preview.stdout).confirmation_token];
  }
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("DOCOP-001 Document Operations (IMP-005)", () => {
  it("saves a document, progressing -vN suffix and backing up history", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-test-docop-1-"));
    fs.writeFileSync(path.join(root, "owners.json"), JSON.stringify({ product: "A", technical: "B", budget: "C", safety: "D", release: "E" }));
    runCli(["init", "--project-root", ".", "--project-name", "DocTest", "--project-mode", "Resume", "--interaction-mode", "Expert", "--owners-file", "owners.json", "--operation-id", "OP-init-doc-save"], root);
    
    fs.writeFileSync(path.join(root, "content-v1.txt"), "hello v1");
    let res = runCli(["doc-save", "--project-root", ".", "--id", "ART-00000000", "--base-path", "docs/design.md", "--content-file", "content-v1.txt", "--owner", "A"], root);
    assert.strictEqual(res.status, 0);
    
    // docs/design-v1.md should exist
    assert.strictEqual(fs.readFileSync(path.join(root, "docs/design-v1.md"), "utf8"), "hello v1");
    
    // Save v2
    fs.writeFileSync(path.join(root, "content-v2.txt"), "hello v2");
    res = runCli(["doc-save", "--project-root", ".", "--id", "ART-00000000", "--base-path", "docs/design.md", "--content-file", "content-v2.txt", "--owner", "A"], root);
    assert.strictEqual(res.status, 0);
    
    // docs/design-v2.md should exist, v1 should be in history
    assert.strictEqual(fs.readFileSync(path.join(root, "docs/design-v2.md"), "utf8"), "hello v2");
    assert.strictEqual(fs.existsSync(path.join(root, "docs/design-v1.md")), false);
    assert.strictEqual(fs.readFileSync(path.join(root, ".beave/history/ART-00000000-v1.md"), "utf8"), "hello v1");
  });

  it("detects external edits and prevents silent overwrites", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-test-docop-2-"));
    fs.writeFileSync(path.join(root, "owners.json"), JSON.stringify({ product: "A", technical: "B", budget: "C", safety: "D", release: "E" }));
    runCli(["init", "--project-root", ".", "--project-name", "DocTest", "--project-mode", "Resume", "--interaction-mode", "Expert", "--owners-file", "owners.json", "--operation-id", "OP-init-doc-drift"], root);
    
    fs.writeFileSync(path.join(root, "content-v1.txt"), "hello v1");
    runCli(["doc-save", "--project-root", ".", "--id", "ART-00000000", "--base-path", "docs/design.md", "--content-file", "content-v1.txt", "--owner", "A"], root);
    
    // External edit
    fs.writeFileSync(path.join(root, "docs/design-v1.md"), "hello v1 edited manually");
    
    // Save v2 should fail
    fs.writeFileSync(path.join(root, "content-v2.txt"), "hello v2");
    const res = runCli(["doc-save", "--project-root", ".", "--id", "ART-00000000", "--base-path", "docs/design.md", "--content-file", "content-v2.txt", "--owner", "A"], root);
    assert.strictEqual(res.status, 2);
    assert.ok(res.stderr.includes("External edit detected"));
  });

  it("finalizes a document and drops the -vN suffix", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-test-docop-3-"));
    fs.writeFileSync(path.join(root, "owners.json"), JSON.stringify({ product: "A", technical: "B", budget: "C", safety: "D", release: "E" }));
    runCli(["init", "--project-root", ".", "--project-name", "DocTest", "--project-mode", "Resume", "--interaction-mode", "Expert", "--owners-file", "owners.json", "--operation-id", "OP-init-doc-finalize"], root);
    
    fs.writeFileSync(path.join(root, "content-v1.txt"), "hello final");
    runCli(["doc-save", "--project-root", ".", "--id", "ART-00000000", "--base-path", "docs/design.md", "--content-file", "content-v1.txt", "--owner", "A"], root);
    
    const res = runCli(["doc-finalize", "--project-root", ".", "--id", "ART-00000000", "--owner", "A"], root);
    assert.strictEqual(res.status, 0);
    
    // docs/design.md should exist
    assert.strictEqual(fs.readFileSync(path.join(root, "docs/design.md"), "utf8"), "hello final");
    // v1 should be in history
    assert.strictEqual(fs.existsSync(path.join(root, "docs/design-v1.md")), false);
    assert.strictEqual(fs.readFileSync(path.join(root, ".beave/history/ART-00000000-v1.md"), "utf8"), "hello final");
  });

  it("restores a document from history as a new revision", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-test-docop-4-"));
    fs.writeFileSync(path.join(root, "owners.json"), JSON.stringify({ product: "A", technical: "B", budget: "C", safety: "D", release: "E" }));
    runCli(["init", "--project-root", ".", "--project-name", "DocTest", "--project-mode", "Resume", "--interaction-mode", "Expert", "--owners-file", "owners.json", "--operation-id", "OP-init-doc-restore"], root);
    
    fs.writeFileSync(path.join(root, "content-v1.txt"), "hello v1");
    runCli(["doc-save", "--project-root", ".", "--id", "ART-00000000", "--base-path", "docs/design.md", "--content-file", "content-v1.txt", "--owner", "A"], root);
    
    fs.writeFileSync(path.join(root, "content-v2.txt"), "hello v2");
    runCli(["doc-save", "--project-root", ".", "--id", "ART-00000000", "--base-path", "docs/design.md", "--content-file", "content-v2.txt", "--owner", "A"], root);
    
    const res = runCli(["doc-restore", "--project-root", ".", "--id", "ART-00000000", "--revision", "1", "--owner", "A"], root);
    assert.strictEqual(res.status, 0);
    
    // docs/design-v3.md should exist and have v1 content
    assert.strictEqual(fs.readFileSync(path.join(root, "docs/design-v3.md"), "utf8"), "hello v1");
    assert.strictEqual(fs.existsSync(path.join(root, "docs/design-v2.md")), false);
    assert.strictEqual(fs.readFileSync(path.join(root, ".beave/history/ART-00000000-v2.md"), "utf8"), "hello v2");
  });
});
