import { test, describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CLI = path.resolve("lib/bin/beave.js");

function runCli(args, cwd) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("IMP-006 Semantic Scenarios and Discovery Tests", () => {
  it("exports portable markdown containing the canonical source digest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-test-semantic-1-"));
    const res = runCli(["export", "--target", "portable", "--output-dir", root], root);
    assert.strictEqual(res.status, 0);
    
    const portableFile = path.join(root, "beave-portable.md");
    assert.ok(fs.existsSync(portableFile));
    const content = fs.readFileSync(portableFile, "utf8");
    
    assert.ok(content.includes("<!-- Canonical source digest: "));
    assert.ok(content.includes("# Beave — Portable Semantic Edition"));
  });

  it("installs an adapter and verifies its integrity", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-test-semantic-2-"));
    
    // Install codex locally
    let res = runCli(["install", "--target", "codex", "--scope", "project", "--project-root", root], root);
    assert.strictEqual(res.status, 0);
    
    const dest = path.join(root, ".agents", "skills", "beave");
    assert.ok(fs.existsSync(dest));
    assert.ok(fs.existsSync(path.join(dest, "beave-adapter.json")));
    assert.ok(fs.existsSync(path.join(dest, "SKILL.md")));
    
    // Verify installation (should pass)
    res = runCli(["verify-install", "--target", "codex", "--scope", "project", "--project-root", root], root);
    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes("is pristine and matches original source"));
  });

  it("rejects drift when a file in the installed skill is manually modified", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-test-semantic-3-"));
    
    // Install claude locally
    runCli(["install", "--target", "claude", "--scope", "project", "--project-root", root], root);
    
    const dest = path.join(root, ".claude", "skills", "beave");
    const skillMd = path.join(dest, "SKILL.md");
    
    // Manual modification (Drift)
    fs.appendFileSync(skillMd, "\n<!-- unauthorized edit -->");
    
    // Verify installation (should fail)
    const res = runCli(["verify-install", "--target", "claude", "--scope", "project", "--project-root", root], root);
    assert.strictEqual(res.status, 2);
    assert.ok(res.stderr.includes("Drift detected in installed skill at"));
  });
});
