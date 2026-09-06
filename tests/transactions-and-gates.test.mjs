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

describe("Transactions and Gates (IMP-004)", () => {
  it("enforces G0-G12 gates sequentially", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-test-gates-"));
    fs.writeFileSync(path.join(root, "owners.json"), JSON.stringify({ product: "A", technical: "B", budget: "C", safety: "D", release: "E" }));
    
    // Init sets current_gate to G1
    let res = runCli(["init", "--project-root", ".", "--project-name", "GateTest", "--project-mode", "Genesis", "--interaction-mode", "Expert", "--owners-file", "owners.json"], root);
    assert.strictEqual(res.status, 0);

    // Try to pass G3 when at G1 (should fail)
    fs.writeFileSync(path.join(root, "evidence.md"), "test");
    res = runCli(["gate", "--project-root", ".", "--id", "G3", "--status", "PASSED", "--evidence-file", "evidence.md", "--owner", "B"], root);
    assert.strictEqual(res.status, 2);
    assert.ok(res.stderr.includes("Cannot process G3 before completing G1"));

    // Pass G1
    res = runCli(["gate", "--project-root", ".", "--id", "G1", "--status", "PASSED", "--evidence-file", "evidence.md", "--owner", "A"], root);
    assert.strictEqual(res.status, 0);

    const state = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
    assert.strictEqual(state.current_gate, "G2");
  });

  it("checks idempotency and prevents duplicate operations", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-test-idempotent-"));
    fs.writeFileSync(path.join(root, "owners.json"), JSON.stringify({ product: "A", technical: "B", budget: "C", safety: "D", release: "E" }));
    runCli(["init", "--project-root", ".", "--project-name", "IdemTest", "--project-mode", "Genesis", "--interaction-mode", "Expert", "--owners-file", "owners.json"], root);
    
    fs.writeFileSync(path.join(root, "instruction.txt"), "do this");
    const args = ["override", "--project-root", ".", "--instruction-file", "instruction.txt", "--owner", "A"];
    
    // First call succeeds
    let res = runCli(args, root);
    assert.strictEqual(res.status, 0);
    const rev1 = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8")).revision;

    // Second call is idempotent
    res = runCli(args, root);
    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes("Idempotent retry: override already applied"));
    const rev2 = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8")).revision;
    
    assert.strictEqual(rev1, rev2);
  });
  
  it("strictly blocks operations when needs_reconciliation is true", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-test-blocked-"));
    fs.writeFileSync(path.join(root, "owners.json"), JSON.stringify({ product: "A", technical: "B", budget: "C", safety: "D", release: "E" }));
    runCli(["init", "--project-root", ".", "--project-name", "BlockedTest", "--project-mode", "Genesis", "--interaction-mode", "Expert", "--owners-file", "owners.json"], root);
    
    // Trigger an override
    fs.writeFileSync(path.join(root, "instruction.txt"), "do this");
    runCli(["override", "--project-root", ".", "--instruction-file", "instruction.txt", "--owner", "A"], root);
    
    // Attempting a gate transition should fail
    fs.writeFileSync(path.join(root, "evidence.md"), "test");
    const res = runCli(["gate", "--project-root", ".", "--id", "G1", "--status", "PASSED", "--evidence-file", "evidence.md", "--owner", "A"], root);
    assert.strictEqual(res.status, 2);
    assert.ok(res.stderr.includes("State is BLOCKED pending human reconciliation"));
  });
});
