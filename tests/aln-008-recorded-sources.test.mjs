import { describe, it } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ageProject } from "./older-engine.mjs";

/**
 * ALN-008: the recorded sources `validate` was not re-verifying, and the governed
 * way to re-point one.
 *
 * Two defects, one mechanism:
 *
 *  * **B5** — `validate` re-hashed `modules[].evidence` and
 *    `human_overrides[].source` and left `gates[].evidence` alone. Deleting the
 *    file a gate was PASSED on left `beave validate` answering
 *    "Beave state is valid.", in both implementations, so the shared DOCOP-001
 *    corpus could not see the difference either. A gate is the record that says a
 *    phase may end.
 *  * **OD-012** — the refusal named a remedy ("re-record it against the current
 *    file") that no command performed. `override` only ever creates a new
 *    override; the only other route offered was restoring the old bytes, which
 *    discards a revision somebody wanted. This repository's own project sat
 *    refused on exactly that.
 *
 * Both are **ledger** rules, not document-operation rules. The DOCOP-001 scenario
 * format has `save`, `restore`, `finalize`, `mark_deletion`, `external_edit` and
 * `delete` and no way to record a gate or an override, and adding one would put a
 * phase-transition record inside a document-lifecycle contract. So they are pinned
 * here, in `docop::tests::a_gate_whose_evidence_changed_is_warned_about_and_a_gate_without_a_digest_is_not`
 * on the Rust side, and stated in `docs/contracts/ENGINE_AND_LEDGER_CONTRACT.md`.
 *
 * Every test in this file was run against a build of the previous `cli.ts`
 * compiled in the system temporary directory; the results are in the ALN-008
 * report. `BEAVE_CLI` exists for that: it is how this file is pointed at a
 * reverted engine without a second copy of the tests.
 */

const CLI = process.env.BEAVE_CLI ? path.resolve(process.env.BEAVE_CLI) : path.resolve("lib/bin/beave.js");
const owners = { product: "Ada", technical: "Ada", budget: "Ada", safety: "Ada", release: "Ada" };

function run(args, cwd) {
  const mutating = [
    "record", "override", "re-record", "reconcile", "decision", "requirement", "task",
    "dependency", "risk", "evidence", "agent", "checkpoint", "gate",
  ];
  if (mutating.includes(args[0]) && !args.includes("--operation-id")) {
    args = [...args, "--operation-id", `OP-${crypto.randomUUID()}`];
  }
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function readState(root) {
  return JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
}

function events(root) {
  return fs
    .readFileSync(path.join(root, ".beave", "events.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function project(name = "ALN008") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-aln008-"));
  fs.writeFileSync(path.join(root, "owners.json"), JSON.stringify(owners));
  const result = run([
    "init", "--project-root", ".", "--project-name", name, "--project-mode", "Genesis",
    "--interaction-mode", "Standard", "--owners-file", "owners.json",
    "--operation-id", `OP-init-${name}`,
  ], root);
  assert.strictEqual(result.status, 0, result.stderr);
  return root;
}

/** A project carrying one gate, PASSED against a real evidence file. */
function projectWithGate(name, evidence = "the acceptance record\n") {
  const root = project(name);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "answers.md"), "the recorded answer\n");
  assert.strictEqual(
    run(["record", "--project-root", ".", "--module", "1", "--status", "CONFIRMED",
      "--answer-file", "docs/answers.md", "--owner", "Ada"], root).status,
    0,
  );
  fs.writeFileSync(path.join(root, "docs", "gate-1.md"), evidence);
  const gate = run(["gate", "--project-root", ".", "--id", "G1", "--status", "PASSED",
    "--evidence-file", "docs/gate-1.md", "--owner", "Ada"], root);
  assert.strictEqual(gate.status, 0, gate.stderr);
  return root;
}

describe("ALN-008 B5: validate re-verifies the evidence a gate was passed on", () => {
  it("refuses when the file a gate was PASSED on is gone", () => {
    const root = projectWithGate("GateGone");
    assert.strictEqual(run(["validate", "--project-root", "."], root).status, 0);

    // The exact reproduction from the defect report: the gate stands, the reason
    // to believe it does not.
    fs.rmSync(path.join(root, "docs", "gate-1.md"));
    const result = run(["validate", "--project-root", "."], root);
    assert.strictEqual(result.status, 2, `expected a refusal, got:\n${result.stdout}`);
    assert.match(result.stderr, /gate G1 records evidence at docs\/gate-1\.md, which is missing or escapes the project root/);
    // A refusal that names no route out is how OD-012 happened. This one names a
    // command that exists.
    assert.match(result.stderr, /beave re-record --project-root \. --kind gate --id G1/);
  });

  it("refuses when the evidence a gate was PASSED on was revised", () => {
    const root = projectWithGate("GateDrift");
    fs.writeFileSync(path.join(root, "docs", "gate-1.md"), "the acceptance record, revised\n");
    const result = run(["validate", "--project-root", "."], root);
    assert.strictEqual(result.status, 2, `expected a refusal, got:\n${result.stdout}`);
    assert.match(
      result.stderr,
      /gate G1 recorded docs\/gate-1\.md with a digest that no longer matches the file\. Re-record it against the current file, or restore the recorded content\./,
    );
  });

  it("does not refuse a gate recorded before the record carried its evidence, and says so", () => {
    // The compatibility rule, and the whole reason B5 was not simply "add a check".
    // Widening this check last time (L26) invalidated every project written before
    // the rule. Both ALN-005 pilots hold gates in exactly the shape produced here.
    const root = projectWithGate("GateLegacy");
    const location = path.join(root, ".beave", "state.json");
    const state = JSON.parse(fs.readFileSync(location, "utf8"));
    for (const gate of state.gates) {
      delete gate.evidence;
      delete gate.evidence_sha256;
    }
    fs.writeFileSync(location, `${JSON.stringify(state, null, 2)}\n`);
    ageProject(root);

    // The file it was passed on is gone, and that is still not a failure: the
    // record never claimed a digest, so there is nothing to contradict.
    fs.rmSync(path.join(root, "docs", "gate-1.md"));
    const result = run(["validate", "--project-root", "."], root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /Beave state is valid\./);
    // Silently skipping is what let the defect live. The skip is reported.
    assert.match(result.stdout, /1 of 1 gate record carr(y|ies) no evidence digest, so validate re-verified nothing for them: G1/);
  });

  it("says nothing about gaps when every gate record carries a digest", () => {
    const root = projectWithGate("GateComplete");
    const result = run(["validate", "--project-root", "."], root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /carry no evidence digest/);
  });

  it("never reconstructs a gate digest from the GATE_UPDATED events", () => {
    // The events do carry `evidence_sha256`, so a digest for a pre-rule gate is
    // technically recoverable. Measured on the two ALN-005 pilots, four of the five
    // recorded GATE_UPDATED events point at a digest the file no longer has, and
    // two of those are superseded outcomes. Reconstructing from history would fail
    // projects for revisions that were wanted — the L26 mistake, repeated.
    const root = projectWithGate("GateHistory");
    const recorded = events(root).find((event) => event.type === "GATE_UPDATED");
    assert.ok(recorded?.evidence_sha256, "the event has always carried the digest");

    const location = path.join(root, ".beave", "state.json");
    const state = JSON.parse(fs.readFileSync(location, "utf8"));
    for (const gate of state.gates) {
      delete gate.evidence;
      delete gate.evidence_sha256;
    }
    fs.writeFileSync(location, `${JSON.stringify(state, null, 2)}\n`);
    ageProject(root);
    fs.writeFileSync(path.join(root, "docs", "gate-1.md"), "moved on, legitimately\n");

    const result = run(["validate", "--project-root", "."], root);
    assert.strictEqual(result.status, 0, `history must not be re-verified:\n${result.stderr}`);
  });

  it("does not turn gate drift into a refusal of every other operation", () => {
    // `recordedDigestErrors` belongs to `validate` and not to `commitState` for
    // this reason: a project whose evidence advanced is still a project the user
    // may work in. The Rust side asserts the same thing about `integrity_errors`.
    const root = projectWithGate("GateNonBlocking");
    fs.writeFileSync(path.join(root, "docs", "gate-1.md"), "revised\n");
    const decision = run(["decision", "--project-root", ".", "--id", "DEC-1", "--title", "Still working",
      "--status", "APPROVED", "--owner", "Ada"], root);
    assert.strictEqual(decision.status, 0, decision.stderr);
  });
});

describe("ALN-008 OD-012: re-record, the governed way to re-point a recorded source", () => {
  /** A project with one OPEN override whose source file has since been revised. */
  function projectWithDriftedOverride(name) {
    const root = project(name);
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs", "direction.md"), "the direction as given\n");
    const recorded = run(["override", "--project-root", ".", "--instruction-file", "docs/direction.md",
      "--owner", "Ada", "--reason", "human direction"], root);
    assert.strictEqual(recorded.status, 0, recorded.stderr);
    fs.writeFileSync(path.join(root, "docs", "direction.md"), "the direction, revised on the next day\n");
    return root;
  }

  it("re-points an override at the revised file, keeping the path, digest, reason, authority and event", () => {
    const root = projectWithDriftedOverride("OverrideDrift");
    const before = readState(root).human_overrides[0];

    const refused = run(["validate", "--project-root", "."], root);
    assert.strictEqual(refused.status, 2, refused.stdout);
    assert.match(refused.stderr, new RegExp(`override ${before.id} recorded`));

    const result = run(["re-record", "--project-root", ".", "--kind", "override", "--id", before.id,
      "--source-file", "docs/direction.md", "--owner", "Ada",
      "--reason", "the direction document was revised during closure"], root);
    assert.strictEqual(result.status, 0, result.stderr);

    const after = readState(root).human_overrides[0];
    const bytes = fs.readFileSync(path.join(root, "docs", "direction.md"));
    // Never edited by hand: the stored digest is the file's.
    assert.strictEqual(after.source_sha256, sha256(bytes));
    assert.notStrictEqual(after.source_sha256, before.source_sha256);

    assert.strictEqual(after.source_history.length, 1);
    const superseded = after.source_history[0];
    assert.strictEqual(superseded.path, before.source);
    assert.strictEqual(superseded.sha256, before.source_sha256);
    assert.strictEqual(superseded.superseded_by, "Ada");
    assert.strictEqual(superseded.reason, "the direction document was revised during closure");

    const event = events(root).at(-1);
    assert.strictEqual(event.type, "RECORDED_SOURCE_UPDATED");
    assert.strictEqual(event.kind, "override");
    assert.strictEqual(event.target_id, before.id);
    assert.strictEqual(event.previous_source_sha256, before.source_sha256);
    assert.strictEqual(event.source_sha256, after.source_sha256);
    assert.strictEqual(event.owner, "Ada");
    assert.strictEqual(event.event_id, superseded.event_id);
    assert.strictEqual(event.state_revision, readState(root).revision);

    // The reason the whole thing exists.
    assert.strictEqual(run(["validate", "--project-root", "."], root).status, 0);
    // And the override itself is untouched otherwise: this changes provenance, not
    // governance. It does not reopen, reconcile or re-authorise anything.
    assert.strictEqual(after.status, before.status);
    assert.strictEqual(after.owner, before.owner);
    assert.strictEqual(after.reason, before.reason);
    assert.strictEqual(after.created_at, before.created_at);
  });

  it("works while the project is BLOCKED on that very override", () => {
    // An OPEN override sets `needs_reconciliation`. If the repair were behind
    // `assertNotBlocked`, the block would be the thing preventing its own removal.
    const root = projectWithDriftedOverride("OverrideBlocked");
    assert.strictEqual(readState(root).needs_reconciliation, true);
    const id = readState(root).human_overrides[0].id;
    const result = run(["re-record", "--project-root", ".", "--kind", "override", "--id", id,
      "--source-file", "docs/direction.md", "--owner", "Ada", "--reason", "revised"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(readState(root).needs_reconciliation, true, "a repair must not silently unblock the project");
  });

  it("attaches evidence to a gate that never recorded a digest", () => {
    // The governed migration for a pre-rule gate. Demonstrated on real projects:
    // both ALN-005 pilots were exported, imported and migrated this way.
    const root = projectWithGate("GateMigration");
    const location = path.join(root, ".beave", "state.json");
    const state = JSON.parse(fs.readFileSync(location, "utf8"));
    for (const gate of state.gates) {
      delete gate.evidence;
      delete gate.evidence_sha256;
    }
    fs.writeFileSync(location, `${JSON.stringify(state, null, 2)}\n`);
    ageProject(root);

    const result = run(["re-record", "--project-root", ".", "--kind", "gate", "--id", "G1",
      "--source-file", "docs/gate-1.md", "--owner", "Ada",
      "--reason", "ALN-008 migration: attach the file G1 was passed on"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /was: <nothing recorded>/);

    const gate = readState(root).gates[0];
    assert.strictEqual(gate.evidence, "docs/gate-1.md");
    assert.strictEqual(gate.evidence_sha256, sha256(fs.readFileSync(path.join(root, "docs", "gate-1.md"))));
    // "There was nothing recorded" and "the previous digest matched" must not look
    // alike in the history.
    assert.strictEqual(gate.source_history[0].path, null);
    assert.strictEqual(gate.source_history[0].sha256, null);

    const validated = run(["validate", "--project-root", "."], root);
    assert.strictEqual(validated.status, 0, validated.stderr);
    assert.doesNotMatch(validated.stdout, /carry no evidence digest/);

    // And from here the gate is held to its evidence like any other.
    fs.rmSync(path.join(root, "docs", "gate-1.md"));
    assert.strictEqual(run(["validate", "--project-root", "."], root).status, 2);
  });

  it("refuses a re-record that would change nothing", () => {
    const root = projectWithGate("NoOpReRecord");
    const result = run(["re-record", "--project-root", ".", "--kind", "gate", "--id", "G1",
      "--source-file", "docs/gate-1.md", "--owner", "Ada", "--reason", "no change"], root);
    assert.strictEqual(result.status, 2, result.stdout);
    assert.match(result.stderr, /already records docs\/gate-1\.md at that digest\. There is nothing to re-record; no changes written\./);
    assert.strictEqual(events(root).at(-1).type, "GATE_UPDATED", "no event may be written for a refused operation");
  });

  it("refuses an unknown kind, an unknown record, an empty reason and an unknown owner", () => {
    const root = projectWithGate("ReRecordRefusals");
    const base = ["re-record", "--project-root", ".", "--source-file", "docs/gate-1.md", "--owner", "Ada", "--reason", "why"];

    const kind = run([...base, "--kind", "module", "--id", "1"], root);
    assert.strictEqual(kind.status, 2);
    assert.match(kind.stderr, /Unsupported --kind: module\. Beave can re-record the source of an override or the evidence of a gate\./);

    const missingGate = run([...base, "--kind", "gate", "--id", "G7"], root);
    assert.strictEqual(missingGate.status, 2);
    assert.match(missingGate.stderr, /Gate not found: G7\. Nothing was written\./);

    const missingOverride = run([...base, "--kind", "override", "--id", "OVR-000000000000"], root);
    assert.strictEqual(missingOverride.status, 2);
    assert.match(missingOverride.stderr, /Override not found: OVR-000000000000\. Nothing was written\./);

    const emptyReason = run(["re-record", "--project-root", ".", "--kind", "gate", "--id", "G1",
      "--source-file", "docs/gate-1.md", "--owner", "Ada", "--reason", "   "], root);
    assert.strictEqual(emptyReason.status, 2);
    assert.match(emptyReason.stderr, /--reason cannot be empty\./);

    const stranger = run(["re-record", "--project-root", ".", "--kind", "gate", "--id", "G1",
      "--source-file", "docs/gate-1.md", "--owner", "Somebody Else", "--reason", "why"], root);
    assert.strictEqual(stranger.status, 2);
    assert.match(stranger.stderr, /Owner is not one of the confirmed decision owners/);

    // Gate evidence obeys the containment rule `beave gate` already enforces,
    // unchanged and shared with it: inside the project, outside `.beave`. The
    // wording for a path that escapes the root is inherited from `verifiedEvidence`
    // and used to be poor: it talked about `.beave` when the real fault is that the
    // path leaves the project. `safeArtifactPath` answers no to two unrelated
    // questions and every caller reported the second, so somebody who passed an
    // absolute path was told about a directory they had not mentioned. The refusal
    // now names the reason it actually refused for.
    const outside = run(["re-record", "--project-root", ".", "--kind", "gate", "--id", "G1",
      "--source-file", path.join(os.tmpdir(), "definitely-not-in-this-project.md"),
      "--owner", "Ada", "--reason", "why"], root);
    assert.strictEqual(outside.status, 2);
    assert.match(outside.stderr, /Evidence must be a path inside the project, written relative to its root/);
    assert.doesNotMatch(outside.stderr, /reserved \.beave directory/,
      "a path that escapes the root has nothing to do with .beave, and saying so sends the reader to the wrong fix");

    // The other branch of the same guard, pinned so the two reasons cannot collapse
    // back into one message: a path inside the ledger's own directory is refused for
    // a different reason and has to say so.
    fs.mkdirSync(path.join(root, ".beave", "smuggled"), { recursive: true });
    fs.writeFileSync(path.join(root, ".beave", "smuggled", "evidence.md"), "inside the ledger\n");
    const reserved = run(["re-record", "--project-root", ".", "--kind", "gate", "--id", "G1",
      "--source-file", ".beave/smuggled/evidence.md", "--owner", "Ada", "--reason", "why"], root);
    assert.strictEqual(reserved.status, 2);
    assert.match(reserved.stderr, /must stay outside the reserved \.beave directory/);

    const missingFile = run(["re-record", "--project-root", ".", "--kind", "gate", "--id", "G1",
      "--source-file", "docs/never-written.md", "--owner", "Ada", "--reason", "why"], root);
    assert.strictEqual(missingFile.status, 2);
    assert.match(missingFile.stderr, /Evidence must be an existing file inside the project root/);

    const stateAfter = readState(root);
    assert.strictEqual(stateAfter.gates[0].evidence_sha256, sha256(fs.readFileSync(path.join(root, "docs", "gate-1.md"))));
    assert.strictEqual(stateAfter.gates[0].source_history, undefined, "a refused re-record leaves no history entry");
  });

  it("refuses an option it cannot store", () => {
    const root = projectWithGate("ReRecordOptions");
    const result = run(["re-record", "--project-root", ".", "--kind", "gate", "--id", "G1",
      "--source-file", "docs/gate-1.md", "--owner", "Ada", "--reason", "why",
      "--instruction-file", "docs/gate-1.md"], root);
    assert.strictEqual(result.status, 2, result.stdout);
    assert.match(result.stderr, /Unknown option for re-record: --instruction-file/);
  });

  it("treats an identical retry as a retry and a changed one as an error", () => {
    const root = projectWithGate("ReRecordIdempotency");
    fs.writeFileSync(path.join(root, "docs", "gate-1.md"), "revised once\n");
    const args = ["re-record", "--project-root", ".", "--kind", "gate", "--id", "G1",
      "--source-file", "docs/gate-1.md", "--owner", "Ada", "--reason", "revised",
      "--operation-id", "OP-rerecord-1"];
    assert.strictEqual(run(args, root).status, 0);
    const revision = readState(root).revision;

    const retry = run(args, root);
    assert.strictEqual(retry.status, 0, retry.stderr);
    assert.match(retry.stdout, /Idempotent retry: re-record already applied\./);
    assert.strictEqual(readState(root).revision, revision, "a retry must not write a second event");

    const reused = run(["re-record", "--project-root", ".", "--kind", "gate", "--id", "G1",
      "--source-file", "docs/gate-1.md", "--owner", "Ada", "--reason", "a different reason",
      "--operation-id", "OP-rerecord-1"], root);
    assert.strictEqual(reused.status, 2, reused.stdout);
    assert.match(reused.stderr, /was already used with different input/);
  });

  it("is recoverable like every other mutation: event, backup, and a cleared transaction", () => {
    const root = projectWithGate("ReRecordRecovery");
    fs.writeFileSync(path.join(root, "docs", "gate-1.md"), "revised\n");
    assert.strictEqual(
      run(["re-record", "--project-root", ".", "--kind", "gate", "--id", "G1",
        "--source-file", "docs/gate-1.md", "--owner", "Ada", "--reason", "revised"], root).status,
      0,
    );
    const transactions = path.join(root, ".beave", "transactions");
    assert.ok(
      !fs.existsSync(transactions) || fs.readdirSync(transactions).length === 0,
      "a completed re-record leaves no open transaction",
    );
    const backups = fs.readdirSync(path.join(root, ".beave", "backups"));
    assert.ok(backups.some((name) => name.startsWith("state.json.")), "the previous state must stay recoverable");
    assert.strictEqual(events(root).at(-1).type, "RECORDED_SOURCE_UPDATED");
  });

  it("is listed in help, so the remedy the refusal names is discoverable", () => {
    const result = run(["help"], os.tmpdir());
    assert.strictEqual(result.status, 0);
    assert.match(result.stdout, /re-record --project-root \. --kind override\|gate --id OVR-ID\|G2 --source-file FILE --owner NAME --reason TEXT/);
  });
});
