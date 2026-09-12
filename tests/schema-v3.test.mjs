import { describe, it } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

const CLI_PATH = path.resolve("lib", "bin", "beave.js");

function runCli(args, cwd) {
  if (["record","override","reconcile","decision","requirement","task","dependency","risk","evidence","agent","checkpoint","gate","doc-save","doc-mark-deletion","doc-restore","doc-finalize"].includes(args[0]) && !args.includes("--operation-id")) args = [...args, "--operation-id", `OP-${crypto.randomUUID()}`];
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args.join(" ")}`, { cwd, encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    console.error(`CLI failed in test. Status: ${error.status}\nStdout: ${error.stdout}\nStderr: ${error.stderr || error.message}`);
    return { status: error.status, stdout: error.stdout, stderr: error.stderr || error.message };
  }
}

describe("Schema v3 Ledgers", () => {
  it("initializes a valid v3 state", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-test-v3-"));
    const ownersFile = path.join(root, "owners.json");
    fs.writeFileSync(ownersFile, JSON.stringify({ product: "A", technical: "B", budget: "C", safety: "D", release: "E" }));

    const res = runCli(["init", "--project-root", ".", "--project-name", "TestV3", "--project-mode", "Genesis", "--interaction-mode", "Standard", "--owners-file", "owners.json", "--operation-id", "OP-init-schema-v3"], root);
    assert.strictEqual(res.status, 0);

    const state = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
    assert.strictEqual(state.schema_version, 3);
    assert.ok(Array.isArray(state.decisions));
    assert.ok(Array.isArray(state.tasks));
    assert.ok(Array.isArray(state.requirements));
    assert.ok(Array.isArray(state.dependencies));
    
    // validate
    const val = runCli(["validate", "--project-root", "."], root);
    assert.strictEqual(val.status, 0);
  });

  it("detects dependency cycles", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-test-v3-cycle-"));
    const ownersFile = path.join(root, "owners.json");
    fs.writeFileSync(ownersFile, JSON.stringify({ product: "A", technical: "B", budget: "C", safety: "D", release: "E" }));

    runCli(["init", "--project-root", ".", "--project-name", "TestV3Cycle", "--project-mode", "Genesis", "--interaction-mode", "Standard", "--owners-file", "owners.json", "--operation-id", "OP-init-schema-cycle"], root);

    // artificially inject a cycle
    const stateFile = path.join(root, ".beave", "state.json");
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    state.dependencies.push(
      { id: "DEP-001", from: "TSK-A", to: "TSK-B", type: "REQUIRES" },
      { id: "DEP-002", from: "TSK-B", to: "TSK-C", type: "REQUIRES" },
      { id: "DEP-003", from: "TSK-C", to: "TSK-A", type: "REQUIRES" }
    );
    fs.writeFileSync(stateFile, JSON.stringify(state));

    const val = runCli(["validate", "--project-root", "."], root);
    assert.strictEqual(val.status, 2);
    assert.ok(val.stderr.includes("Cycle detected involving node TSK-A"));
  });

  it("migrates from v2 to v3 correctly", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-test-v3-migrate-"));
    const beaveDir = path.join(root, ".beave");
    fs.mkdirSync(beaveDir);

    const v2State = {
      schema_version: 2,
      beave_version: "0.2.0-alpha.1",
      project: { name: "V2Project", root: root, mode: "Genesis" },
      interaction_mode: "Standard",
      decision_owners: { product: "A", technical: "B", budget: "C", safety: "D", release: "E" },
      lifecycle_state: "INTERVIEW",
      current_gate: "G1",
      modules: Array.from({ length: 17 }, (_, index) => ({ id: index, title: `M${index}`, status: "NOT STARTED" })),
      human_overrides: [],
      needs_reconciliation: false,
      revision: 1,
      last_event_id: "EVENT-V2",
      exact_next_action: "test",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    fs.writeFileSync(path.join(beaveDir, "state.json"), JSON.stringify(v2State));
    fs.writeFileSync(path.join(beaveDir, "events.jsonl"), JSON.stringify({ event_id: "EVENT-V2", type: "INIT", at: v2State.updated_at, state_revision: 1 }) + "\n");

    const mig = runCli(["migrate", "--project-root", ".", "--operation-id", "OP-migrate-v2-v3"], root);
    assert.strictEqual(mig.status, 0);

    const v3State = JSON.parse(fs.readFileSync(path.join(beaveDir, "state.json"), "utf8"));
    assert.strictEqual(v3State.schema_version, 3);
    assert.ok(Array.isArray(v3State.decisions));
    assert.ok(Array.isArray(v3State.tasks));
    const backups = fs.readdirSync(path.join(beaveDir, "backups"));
    assert.ok(backups.some((name) => name.startsWith("state.json.")));
    // `events.jsonl` is appended to, and this used to assert a copy of it existed.
    // A copy of an append-only file protects nothing — every prior byte is still
    // in the file afterwards — and copying the whole log on every mutation is why
    // `.beave/backups` reached 104 MB against 220 KB of documents on the ALN-005
    // pilot A project. What matters is that the prior content survived.
    const events = fs.readFileSync(path.join(beaveDir, "events.jsonl"), "utf8").trim().split(/\r?\n/).map(JSON.parse);
    assert.ok(events.length > 1, "the pre-migration events must still be there");
    // The v2 ledger opened with its own event type; whatever it was, the migration
    // appended after it rather than replacing it.
    assert.notStrictEqual(events[0].type, "STATE_MIGRATED");
    assert.strictEqual(events.at(-1).from_schema, 2);
    assert.strictEqual(events.at(-1).to_schema, 3);
    assert.strictEqual(events.at(-1).operation_id, "OP-migrate-v2-v3");
    const retry = runCli(["migrate", "--project-root", ".", "--operation-id", "OP-migrate-v2-v3"], root);
    assert.strictEqual(retry.status, 0, retry.stderr);
    assert.match(retry.stdout, /Idempotent retry/);
  });
});
