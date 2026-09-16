import { describe, it } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ageProject } from "./older-engine.mjs";

/**
 * The four engine blockers that stood between this repository and a first real
 * project: `reconcile` overwriting a human next action, `project-export` leaving
 * `reconciliation_evidence` behind, `\` in persisted relative paths, and the one
 * refusal that named no way out.
 *
 * Every test here is a behaviour, not a restatement of the implementation. Each
 * was checked against a reverted build kept outside this repository: the build
 * compiled, `plangonaut version` answered, and the test went red for the reason the
 * blocker describes.
 */

const CLI = path.resolve("lib/bin/plangonaut.js");
const owners = { product: "A", technical: "B", budget: "C", safety: "D", release: "E" };

function run(args, cwd) {
  const mutating = [
    "record", "override", "reconcile", "decision", "requirement", "task", "dependency",
    "risk", "evidence", "agent", "checkpoint", "gate", "doc-save", "doc-mark-deletion",
    "doc-restore", "doc-finalize", "migrate",
  ];
  if (mutating.includes(args[0]) && !args.includes("--operation-id")) {
    args = [...args, "--operation-id", `OP-${crypto.randomUUID()}`];
  }
  if (args[0] === "doc-save" && !args.includes("--confirm-token")) {
    const preview = spawnSync(process.execPath, [CLI, "doc-diff", ...args.slice(1)], { cwd, encoding: "utf8" });
    if (preview.status === 0) args = [...args, "--confirm-token", JSON.parse(preview.stdout).confirmation_token];
  }
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function project(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-fix-"));
  fs.writeFileSync(path.join(root, "owners.json"), JSON.stringify(owners));
  const result = run([
    "init", "--project-root", ".", "--project-name", name, "--project-mode", "Genesis",
    "--interaction-mode", "Standard", "--owners-file", "owners.json",
    "--operation-id", `OP-init-${name.replace(/[^A-Za-z0-9._:-]/g, "-")}`,
  ], root);
  assert.strictEqual(result.status, 0, result.stderr);
  return root;
}

/** A project carrying one PUBLISHED Markdown document, so `project-export` can run. */
function exportableProject(name) {
  const root = project(name);
  fs.writeFileSync(path.join(root, "doc.md"), "the plan\n");
  assert.strictEqual(
    run(["doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/plan.md", "--content-file", "doc.md", "--owner", "A"], root).status,
    0,
  );
  assert.strictEqual(run(["doc-finalize", "--project-root", ".", "--id", "ART-1", "--owner", "A"], root).status, 0);
  return root;
}

function state(root) {
  return JSON.parse(fs.readFileSync(path.join(root, ".plangonaut", "state.json"), "utf8"));
}

function events(root) {
  return fs.readFileSync(path.join(root, ".plangonaut", "events.jsonl"), "utf8")
    .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function lastReconciled(root) {
  return events(root).findLast((event) => event.type === "HUMAN_OVERRIDE_RECONCILED");
}

/** Record a human next action, then open an override against it. */
function humanActionThenOverride(root, sentence, file = "instruction.md") {
  assert.strictEqual(
    run(["checkpoint", "--project-root", ".", "--id", `CHK-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
         "--name", "H", "--owner", "A", "--next-action", sentence], root).status,
    0,
  );
  fs.writeFileSync(path.join(root, file), `a change of direction\n${file}\n`);
  const result = run(["override", "--project-root", ".", "--instruction-file", file, "--owner", "A"], root);
  assert.strictEqual(result.status, 0, result.stderr);
  return state(root).human_overrides.at(-1).id;
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// ---------------------------------------------------------------------------
// Blocker 1 — reconcile must not silently replace a human next action.
// ---------------------------------------------------------------------------

describe("blocker 1 — reconcile and a next action a person wrote", () => {
  it("does not mistake a human sentence for engine output merely because its prefix matches", () => {
    for (const [name, handoff] of [
      ["ProceedPrefix", "Proceed to G3. Ask Marco for written approval before ordering anything."],
      ["ReconcileDetailPrefix", "Reconcile OVR-deadbeef: identify impacted decisions, artifacts, tasks, agents, tests, and gates. Ask Marco before changing scope."],
      ["ReconcileBlockerPrefix", "Reconcile OVR-deadbeef before continuing. Wait for Marco's written approval."],
    ]) {
      const root = project(name);
      humanActionThenOverride(root, handoff);

      assert.strictEqual(
        state(root).exact_next_action,
        handoff,
        "a human suffix changes the instruction and must prevent automatic replacement",
      );
    }
  });

  it("writes the engine's own sentence when nothing human was recorded and none was supplied", () => {
    // `--next-action` used to be mandatory. That obligation is the defect's
    // origin: the operator did not replace the sentence because they wanted to,
    // they replaced it because the command would not run otherwise.
    const root = project("Generated");
    fs.writeFileSync(path.join(root, "instruction.md"), "change of direction\n");
    assert.strictEqual(run(["override", "--project-root", ".", "--instruction-file", "instruction.md", "--owner", "A"], root).status, 0);
    const overrideId = state(root).human_overrides[0].id;

    fs.writeFileSync(path.join(root, "evidence.md"), "what was done about it\n");
    const result = run(["reconcile", "--project-root", ".", "--override-id", overrideId,
                        "--evidence-file", "evidence.md", "--owner", "A"], root);
    assert.strictEqual(result.status, 0, result.stderr);

    const event = lastReconciled(root);
    assert.strictEqual(event.next_action_outcome, "generated");
    assert.strictEqual(event.next_action_provenance, "engine");
    assert.strictEqual(event.next_action_after, state(root).exact_next_action);
    assert.match(result.stdout, /The exact next action is now:/);
  });

  it("keeps the human sentence when no --next-action is supplied, and says so", () => {
    // The case the pilot needs and that did not exist: reconciling without
    // touching the instruction the recipient of the folder is told to obey.
    const root = project("Preserved");
    const handoff = "MARCO ESEGUE IL BACKUP. Nessuna AI puo farlo al posto suo.";
    const overrideId = humanActionThenOverride(root, handoff);
    assert.strictEqual(state(root).exact_next_action, handoff, "the override must not have destroyed it either");

    fs.writeFileSync(path.join(root, "evidence.md"), "what was done about it\n");
    const result = run(["reconcile", "--project-root", ".", "--override-id", overrideId,
                        "--evidence-file", "evidence.md", "--owner", "A"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(state(root).exact_next_action, handoff);
    assert.match(result.stdout, /written by a person and is kept unchanged/);
    assert.match(result.stdout, /--replace-human-next-action/);

    const event = lastReconciled(root);
    assert.strictEqual(event.next_action_outcome, "preserved");
    assert.strictEqual(event.next_action_before, handoff);
    assert.strictEqual(event.next_action_after, handoff);
    assert.strictEqual(event.next_action_provenance, "human");
    assert.strictEqual(state(root).human_overrides[0].status, "RECONCILED");
    assert.strictEqual(state(root).needs_reconciliation, false);
  });

  it("refuses a different --next-action without the flag, and writes nothing", () => {
    const root = project("RefusedReplace");
    const handoff = "ELENA ACCETTA IL BACKUP. Quattro verifiche, tutte e quattro devono tornare.";
    const overrideId = humanActionThenOverride(root, handoff);
    const before = state(root);

    fs.writeFileSync(path.join(root, "evidence.md"), "what was done about it\n");
    const refused = run(["reconcile", "--project-root", ".", "--override-id", overrideId,
                         "--evidence-file", "evidence.md", "--owner", "A", "--next-action", "SOMETHING ELSE"], root);
    assert.strictEqual(refused.status, 2, refused.stdout);
    assert.match(refused.stderr, /Refusing to replace the exact next action/);
    assert.match(refused.stderr, /--replace-human-next-action/);
    assert.match(refused.stderr, /is still OPEN/);

    const after = state(root);
    assert.strictEqual(after.exact_next_action, handoff);
    assert.strictEqual(after.revision, before.revision, "a refusal writes nothing");
    assert.strictEqual(after.human_overrides[0].status, "OPEN");
    assert.strictEqual(after.needs_reconciliation, true);
    assert.strictEqual(events(root).some((event) => event.type === "HUMAN_OVERRIDE_RECONCILED"), false);
  });

  it("replaces when the flag says so, and keeps the replaced sentence in the ledger", () => {
    const root = project("ExplicitReplace");
    const handoff = "PAOLO NON ORDINA NULLA, nemmeno un campione.";
    const overrideId = humanActionThenOverride(root, handoff);

    fs.writeFileSync(path.join(root, "evidence.md"), "what was done about it\n");
    const result = run(["reconcile", "--project-root", ".", "--override-id", overrideId,
                        "--evidence-file", "evidence.md", "--owner", "A",
                        "--next-action", "DELIBERATELY REPLACED", "--replace-human-next-action"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(state(root).exact_next_action, "DELIBERATELY REPLACED");
    assert.match(result.stdout, /was replaced, as --replace-human-next-action asked/);

    const event = lastReconciled(root);
    assert.strictEqual(event.next_action_outcome, "replaced");
    // The point of the whole record: the recipient of the folder can read what
    // was replaced and by whom, without the backups, which do not travel.
    assert.strictEqual(event.next_action_before, handoff);
    assert.strictEqual(event.next_action_after, "DELIBERATELY REPLACED");
    assert.strictEqual(event.next_action_provenance, "human");
  });

  it("treats a --next-action identical to the recorded one as no replacement at all", () => {
    const root = project("SameSentence");
    const handoff = "CHIARA RECUPERA LA POLIZZA presso la contabile.";
    const overrideId = humanActionThenOverride(root, handoff);

    fs.writeFileSync(path.join(root, "evidence.md"), "what was done about it\n");
    const result = run(["reconcile", "--project-root", ".", "--override-id", overrideId,
                        "--evidence-file", "evidence.md", "--owner", "A", "--next-action", handoff], root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(state(root).exact_next_action, handoff);
    assert.strictEqual(lastReconciled(root).next_action_outcome, "preserved");
    assert.match(result.stdout, /You supplied the same sentence, so nothing was replaced/);
  });

  it("records blocked_by_open_override when another override is still open", () => {
    const root = project("StillOpen");
    const handoff = "HUMAN: do not proceed without the client.";
    const first = humanActionThenOverride(root, handoff, "one.md");
    fs.writeFileSync(path.join(root, "two.md"), "a second change of direction\n");
    assert.strictEqual(run(["override", "--project-root", ".", "--instruction-file", "two.md", "--owner", "A"], root).status, 0);
    const second = state(root).human_overrides[1].id;

    fs.writeFileSync(path.join(root, "evidence.md"), "what was done\n");
    const result = run(["reconcile", "--project-root", ".", "--override-id", first,
                        "--evidence-file", "evidence.md", "--owner", "A", "--next-action", "OPERATOR ASKED FOR THIS"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(state(root).exact_next_action, `Reconcile ${second} before continuing.`);

    const event = lastReconciled(root);
    assert.strictEqual(event.next_action_outcome, "blocked_by_open_override");
    assert.strictEqual(event.next_action_before, handoff);
    assert.strictEqual(event.next_action_after, `Reconcile ${second} before continuing.`);
    assert.match(result.stdout, /was NOT recorded in state/);
  });

  it("is idempotent on a retry with the same --operation-id", () => {
    const root = project("Retry");
    const handoff = "HUMAN: the survey happens on site, not in a conversation.";
    const overrideId = humanActionThenOverride(root, handoff);
    fs.writeFileSync(path.join(root, "evidence.md"), "what was done about it\n");

    const args = ["reconcile", "--project-root", ".", "--override-id", overrideId,
                  "--evidence-file", "evidence.md", "--owner", "A", "--operation-id", "OP-RECONCILE-ONCE"];
    const first = run(args, root);
    assert.strictEqual(first.status, 0, first.stderr);
    const afterFirst = state(root);

    const retry = run(args, root);
    assert.strictEqual(retry.status, 0, retry.stderr);
    assert.match(retry.stdout, /Idempotent retry: reconcile already applied/);

    const afterRetry = state(root);
    assert.strictEqual(afterRetry.revision, afterFirst.revision, "a retry must not advance the revision");
    assert.strictEqual(afterRetry.exact_next_action, handoff);
    assert.strictEqual(
      events(root).filter((event) => event.type === "HUMAN_OVERRIDE_RECONCILED").length,
      1,
      "a retry must not append a second event",
    );
  });

  it("carries the preserved sentence through resume, context-pack and the package round trip", () => {
    const root = exportableProject("PreservedRoundTrip");
    const handoff = "MARCO AUTORIZZA L AVVIO. Nessuna AI la scrive al posto suo.";
    const overrideId = humanActionThenOverride(root, handoff);
    fs.writeFileSync(path.join(root, "evidence.md"), "what was done about it\n");
    assert.strictEqual(
      run(["reconcile", "--project-root", ".", "--override-id", overrideId, "--evidence-file", "evidence.md", "--owner", "A"], root).status,
      0,
    );

    const resumed = run(["resume", "--project-root", "."], root);
    assert.strictEqual(resumed.status, 0, resumed.stderr);
    assert.ok(resumed.stdout.includes(handoff), "resume must carry the human sentence");
    const pack = run(["context-pack", "--project-root", "."], root);
    assert.strictEqual(pack.status, 0, pack.stderr);
    assert.ok(pack.stdout.includes(handoff), "the context pack must carry it");

    const pkg = path.join(tempDir("plangonaut-fix-pkg-"), "pkg");
    assert.strictEqual(run(["project-export", "--project-root", ".", "--output-dir", pkg], root).status, 0);
    assert.strictEqual(run(["project-verify", "--package-dir", pkg], root).status, 0);
    const destination = path.join(tempDir("plangonaut-fix-dst-"), "delivered");
    assert.strictEqual(run(["project-import", "--package-dir", pkg, "--project-root", destination, "--operation-id", "OP-IMPORT-PRESERVED"], root).status, 0);

    assert.strictEqual(state(destination).exact_next_action, handoff);

    /*
     * The delivered *ledger* still says what happened to the override. The
     * delivered *event log* no longer does, and that is a deliberate cost of
     * ALN-014: the exporter's log recorded the exporter's absolute path, so a
     * package carries one origin event holding the whole state instead of the
     * log that produced it. The state-level record — who overrode, that it was
     * reconciled, and against which evidence — travels; the event-level detail
     * `next_action_outcome` stays with the exporting project.
     *
     * This test asserts both halves, so the day somebody restores the full log
     * to the package it fails and is read again rather than passing quietly.
     */
    const override = state(destination).human_overrides.at(-1);
    assert.strictEqual(override.status, "RECONCILED");
    assert.ok(override.reconciliation_evidence, "the delivered ledger lost the reconciliation evidence");
    assert.deepStrictEqual(
      events(destination).map((event) => event.type),
      ["PROJECT_PACKAGE_EXPORTED", "PROJECT_PACKAGE_IMPORTED"],
      "the package carried more than the portable origin",
    );

    // And it is the exporting project that keeps the detail.
    const kept = events(root).findLast((event) => event.type === "HUMAN_OVERRIDE_RECONCILED");
    assert.strictEqual(kept.next_action_outcome, "preserved");
    assert.strictEqual(kept.next_action_before, handoff);
  });
});

// ---------------------------------------------------------------------------
// Blocker 3 — reconciliation_evidence must travel with the package.
// ---------------------------------------------------------------------------

describe("blocker 3 — the package carries the reconciliation evidence", () => {
  function reconciledExportable(name, evidenceRelative = "evidence/reconciliation.md") {
    const root = exportableProject(name);
    fs.writeFileSync(path.join(root, "instruction.md"), "a change of direction\n");
    assert.strictEqual(run(["override", "--project-root", ".", "--instruction-file", "instruction.md", "--owner", "A"], root).status, 0);
    const overrideId = state(root).human_overrides[0].id;
    fs.mkdirSync(path.join(root, path.dirname(evidenceRelative)), { recursive: true });
    fs.writeFileSync(path.join(root, evidenceRelative), "what was done about the override\n");
    const result = run(["reconcile", "--project-root", ".", "--override-id", overrideId,
                        "--evidence-file", evidenceRelative, "--owner", "A"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    return { root, overrideId, evidenceRelative };
  }

  it("exports the file whose digest the ledger carries, and imports it back", () => {
    const { root, evidenceRelative } = reconciledExportable("Blocker3RoundTrip");
    const recorded = state(root).human_overrides[0];
    assert.strictEqual(recorded.reconciliation_evidence, "evidence/reconciliation.md");

    const pkg = path.join(tempDir("plangonaut-fix-pkg-"), "pkg");
    assert.strictEqual(run(["project-export", "--project-root", ".", "--output-dir", pkg], root).status, 0);
    const entry = path.join(pkg, "files", "evidence", "reconciliation.md");
    assert.ok(fs.existsSync(entry), "the package must contain the reconciliation evidence");
    assert.strictEqual(
      crypto.createHash("sha256").update(fs.readFileSync(entry)).digest("hex"),
      recorded.reconciliation_sha256,
      "and it must be the file the ledger hashed",
    );
    assert.strictEqual(run(["project-verify", "--package-dir", pkg], root).status, 0);

    const destination = path.join(tempDir("plangonaut-fix-dst-"), "delivered");
    assert.strictEqual(run(["project-import", "--package-dir", pkg, "--project-root", destination, "--operation-id", "OP-IMPORT-B3"], root).status, 0);
    const restored = path.join(destination, evidenceRelative);
    assert.ok(fs.existsSync(restored), "import must put it back where the ledger points");
    assert.strictEqual(
      crypto.createHash("sha256").update(fs.readFileSync(restored)).digest("hex"),
      recorded.reconciliation_sha256,
    );
    assert.strictEqual(run(["validate", "--project-root", "."], destination).status, 0);
  });

  it("project-verify refuses a package the evidence was removed from", () => {
    const { root } = reconciledExportable("Blocker3Missing");
    const pkg = path.join(tempDir("plangonaut-fix-pkg-"), "pkg");
    assert.strictEqual(run(["project-export", "--project-root", ".", "--output-dir", pkg], root).status, 0);

    // Removed from the package as a recipient would receive it: the manifest entry
    // goes with the file, so the only thing left claiming it is the ledger.
    const manifestPath = path.join(pkg, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.files = manifest.files.filter((item) => item.path !== "files/evidence/reconciliation.md");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    fs.rmSync(path.join(pkg, "files", "evidence", "reconciliation.md"));

    const verified = run(["project-verify", "--package-dir", pkg], root);
    assert.strictEqual(verified.status, 2, verified.stdout);
    assert.match(verified.stderr, /missing the reconciliation evidence/);
    assert.match(verified.stderr, /Safe next action: reject this package and return to the source project/);
    assert.match(verified.stderr, /project-export/);
    assert.match(verified.stderr, /Do not edit the rejected package or its manifest/);
  });

  it("project-verify refuses a package the evidence was altered in", () => {
    const { root } = reconciledExportable("Blocker3Altered");
    const pkg = path.join(tempDir("plangonaut-fix-pkg-"), "pkg");
    assert.strictEqual(run(["project-export", "--project-root", ".", "--output-dir", pkg], root).status, 0);

    const target = path.join(pkg, "files", "evidence", "reconciliation.md");
    const altered = "what was done about the override, rewritten by somebody else\n";
    fs.writeFileSync(target, altered);
    // The manifest is updated too, so the only check that can still notice is the
    // one that compares the package against the digest the ledger recorded.
    const manifestPath = path.join(pkg, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const item of manifest.files) {
      if (item.path !== "files/evidence/reconciliation.md") continue;
      item.sha256 = crypto.createHash("sha256").update(altered).digest("hex");
      item.bytes = Buffer.byteLength(altered);
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const verified = run(["project-verify", "--package-dir", pkg], root);
    assert.strictEqual(verified.status, 2, verified.stdout);
    assert.match(verified.stderr, /Reconciliation evidence digest mismatch/);
    assert.match(verified.stderr, /Safe next action: reject this package and return to the source project/);
    assert.match(verified.stderr, /project-verify on that new package/);
  });

  it("refuses to export a project whose reconciliation evidence has gone missing", () => {
    const { root, evidenceRelative } = reconciledExportable("Blocker3Gone");
    fs.rmSync(path.join(root, evidenceRelative));
    const pkg = path.join(tempDir("plangonaut-fix-pkg-"), "pkg");
    const result = run(["project-export", "--project-root", ".", "--output-dir", pkg], root);
    assert.strictEqual(result.status, 2, result.stdout);
    assert.match(result.stderr, /records reconciliation evidence at evidence\/reconciliation\.md, and that file is missing/);
    assert.strictEqual(fs.existsSync(pkg), false, "a refused export leaves nothing behind");
  });

  it("refuses reconciliation evidence that is not confined to the project", () => {
    // The write-time guard: an unconfined path is how a ledger came to record the
    // digest of a document no package could ever contain.
    const root = exportableProject("Blocker3Unconfined");
    fs.writeFileSync(path.join(root, "instruction.md"), "a change of direction\n");
    assert.strictEqual(run(["override", "--project-root", ".", "--instruction-file", "instruction.md", "--owner", "A"], root).status, 0);
    const overrideId = state(root).human_overrides[0].id;

    const outside = path.join(tempDir("plangonaut-fix-outside-"), "elsewhere.md");
    fs.writeFileSync(outside, "kept somewhere the folder cannot reach\n");
    const escaped = run(["reconcile", "--project-root", ".", "--override-id", overrideId,
                         "--evidence-file", outside, "--owner", "A"], root);
    assert.strictEqual(escaped.status, 2, escaped.stdout);
    assert.match(escaped.stderr, /Reconciliation evidence must be a path inside the project/);
    assert.strictEqual(state(root).human_overrides[0].status, "OPEN", "nothing was written");

    // And the reserved directory is refused for the same reason: `files/` in the
    // package cannot hold it, so the digest would travel without the document.
    const reserved = path.join(root, ".plangonaut", "smuggled.md");
    fs.writeFileSync(reserved, "inside the reserved directory\n");
    const inReserved = run(["reconcile", "--project-root", ".", "--override-id", overrideId,
                            "--evidence-file", reserved, "--owner", "A"], root);
    assert.strictEqual(inReserved.status, 2, inReserved.stdout);
    assert.match(inReserved.stderr, /reserved \.plangonaut and \.beave directories/);
    assert.strictEqual(state(root).human_overrides[0].status, "OPEN");
  });

  it("refuses a package whose manifest claims an unsafe reconciliation path", () => {
    // A hand-built package is what a recipient actually receives: the check has to
    // hold against a manifest nobody in this process produced.
    const { root } = reconciledExportable("Blocker3Forged");
    const pkg = path.join(tempDir("plangonaut-fix-pkg-"), "pkg");
    assert.strictEqual(run(["project-export", "--project-root", ".", "--output-dir", pkg], root).status, 0);

    const embedded = path.join(pkg, "state", "state.json");
    const forged = JSON.parse(fs.readFileSync(embedded, "utf8"));
    forged.human_overrides[0].reconciliation_evidence = "../outside/reconciliation.md";
    const bytes = `${JSON.stringify(forged, null, 2)}\n`;
    fs.writeFileSync(embedded, bytes);
    const manifestPath = path.join(pkg, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const item of manifest.files) {
      if (item.path !== "state/state.json") continue;
      item.sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      item.bytes = Buffer.byteLength(bytes);
    }
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const verified = run(["project-verify", "--package-dir", pkg], root);
    assert.strictEqual(verified.status, 2, verified.stdout);
    assert.match(verified.stderr, /unsafe reconciliation evidence path/);
  });

  it("refuses when two overrides claim the same evidence path with different content", () => {
    // The collision a flat package cannot represent: one entry, two digests. The
    // ledger claims both, so the package can satisfy at most one of them.
    const root = exportableProject("Blocker3Collision");
    fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
    for (const [index, contents] of [["one", "first account\n"], ["two", "second account\n"]]) {
      fs.writeFileSync(path.join(root, `instruction-${index}.md`), `change ${index}\n`);
      assert.strictEqual(run(["override", "--project-root", ".", "--instruction-file", `instruction-${index}.md`, "--owner", "A"], root).status, 0);
      const open = state(root).human_overrides.filter((item) => item.status === "OPEN");
      fs.writeFileSync(path.join(root, "evidence", "shared.md"), contents);
      // The second reconcile is only reachable once the first override is closed,
      // and the two are closed in order, each against a different content of the
      // same path.
      const result = run(["reconcile", "--project-root", ".", "--override-id", open[0].id,
                          "--evidence-file", "evidence/shared.md", "--owner", "A"], root);
      assert.strictEqual(result.status, 0, result.stderr);
    }
    const recorded = state(root).human_overrides;
    assert.notStrictEqual(recorded[0].reconciliation_sha256, recorded[1].reconciliation_sha256);

    const pkg = path.join(tempDir("plangonaut-fix-pkg-"), "pkg");
    const result = run(["project-export", "--project-root", ".", "--output-dir", pkg], root);
    assert.strictEqual(result.status, 2, result.stdout);
    assert.match(result.stderr, /Reconciliation evidence digest mismatch/);
    assert.strictEqual(fs.existsSync(pkg), false);
  });
});

// ---------------------------------------------------------------------------
// Blocker 4 — `/` is the canonical separator for every persisted relative path.
// ---------------------------------------------------------------------------

describe("blocker 4 — portable separators", () => {
  it("records every relative path with / even when the caller writes \\", () => {
    const root = project("Separators");
    fs.mkdirSync(path.join(root, "ans"), { recursive: true });
    fs.writeFileSync(path.join(root, "ans", "m1.md"), "the answers to module 1\n");
    // `ans\m1.md` is what a Windows operator types and what `path.relative`
    // returned. On the POSIX machine the folder is handed to, it is a file name.
    const recorded = run(["record", "--project-root", ".", "--module", "1", "--status", "CONFIRMED",
                          "--answer-file", "ans\\m1.md", "--owner", "A"], root);
    assert.strictEqual(recorded.status, 0, recorded.stderr);
    assert.strictEqual(state(root).modules[1].evidence, "ans/m1.md");

    fs.mkdirSync(path.join(root, "instructions"), { recursive: true });
    fs.writeFileSync(path.join(root, "instructions", "change.md"), "a change of direction\n");
    assert.strictEqual(run(["override", "--project-root", ".", "--instruction-file", "instructions\\change.md", "--owner", "A"], root).status, 0);
    assert.strictEqual(state(root).human_overrides[0].source, "instructions/change.md");

    fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
    fs.writeFileSync(path.join(root, "evidence", "done.md"), "what was done\n");
    assert.strictEqual(
      run(["reconcile", "--project-root", ".", "--override-id", state(root).human_overrides[0].id,
           "--evidence-file", "evidence\\done.md", "--owner", "A"], root).status,
      0,
    );
    assert.strictEqual(state(root).human_overrides[0].reconciliation_evidence, "evidence/done.md");

    fs.writeFileSync(path.join(root, "doc.md"), "the plan\n");
    assert.strictEqual(
      run(["doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs\\plan.md", "--content-file", "doc.md", "--owner", "A"], root).status,
      0,
    );
    const artifact = state(root).artifacts[0];
    assert.strictEqual(artifact.base_path, "docs/plan.md");
    assert.strictEqual(artifact.working_path, "docs/plan-v1.md");

    // Nothing anywhere in the ledger or the events may carry a `\` in a path.
    for (const value of [state(root).modules[1].evidence, artifact.base_path, artifact.working_path,
                         state(root).human_overrides[0].source, state(root).human_overrides[0].reconciliation_evidence]) {
      assert.doesNotMatch(value, /\\/, `${value} must not carry a backslash`);
    }
    assert.strictEqual(run(["validate", "--project-root", "."], root).status, 0);
  });

  it("a package built on Windows resolves on a POSIX recipient", () => {
    // The simulation is the point: `path.posix.resolve` is how the recipient's
    // filesystem reads the manifest, and an entry spelled `files\docs\plan.md`
    // resolves there to one file called `files\docs\plan.md`.
    const root = exportableProject("PosixRecipient");
    fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
    fs.writeFileSync(path.join(root, "evidence", "done.md"), "what was done\n");
    fs.writeFileSync(path.join(root, "instruction.md"), "a change of direction\n");
    assert.strictEqual(run(["override", "--project-root", ".", "--instruction-file", "instruction.md", "--owner", "A"], root).status, 0);
    assert.strictEqual(
      run(["reconcile", "--project-root", ".", "--override-id", state(root).human_overrides[0].id,
           "--evidence-file", "evidence\\done.md", "--owner", "A"], root).status,
      0,
    );

    const pkg = path.join(tempDir("plangonaut-fix-pkg-"), "pkg");
    assert.strictEqual(run(["project-export", "--project-root", ".", "--output-dir", pkg], root).status, 0);
    const manifest = JSON.parse(fs.readFileSync(path.join(pkg, "manifest.json"), "utf8"));
    for (const item of manifest.files) {
      assert.doesNotMatch(item.path, /\\/, `manifest entry ${item.path} must not carry a backslash`);
      // Resolved the way a POSIX recipient resolves it, every entry stays inside
      // the package and names the file that is actually there.
      const resolved = path.posix.resolve("/pkg", item.path);
      assert.ok(resolved.startsWith("/pkg/"), `${item.path} escapes the package on POSIX`);
      assert.strictEqual(resolved.slice("/pkg/".length), item.path);
      assert.ok(fs.existsSync(path.join(pkg, ...item.path.split("/"))), `${item.path} is not in the package`);
    }
    const embedded = JSON.parse(fs.readFileSync(path.join(pkg, "state", "state.json"), "utf8"));
    for (const value of [
      ...embedded.modules.map((item) => item.evidence),
      ...embedded.artifacts.flatMap((item) => [item.base_path, item.working_path]),
      ...embedded.evidence.map((item) => item.path),
      ...embedded.human_overrides.flatMap((item) => [item.source, item.reconciliation_evidence]),
    ]) {
      if (typeof value !== "string" || !value) continue;
      assert.doesNotMatch(value, /\\/, `embedded state still carries ${value}`);
      assert.strictEqual(path.posix.resolve("/delivered", value).startsWith("/delivered/"), true);
    }
  });

  it("a historic record spelled with \\ still validates, exports and imports", () => {
    // The compatibility half of the rule: a reader accepts both forms. A ledger
    // written before the rule is not broken and is not rewritten behind anyone's
    // back — this test is the guarantee the two ALN-005 pilots depend on.
    const root = exportableProject("Historic");
    const ledger = path.join(root, ".plangonaut", "state.json");
    const before = JSON.parse(fs.readFileSync(ledger, "utf8"));
    before.artifacts[0].base_path = before.artifacts[0].base_path.replaceAll("/", "\\");
    before.artifacts[0].working_path = before.artifacts[0].working_path.replaceAll("/", "\\");
    fs.writeFileSync(ledger, `${JSON.stringify(before, null, 2)}\n`);
    ageProject(root);

    assert.strictEqual(run(["validate", "--project-root", "."], root).status, 0, "a historic spelling must still validate");
    const pkg = path.join(tempDir("plangonaut-fix-pkg-"), "pkg");
    assert.strictEqual(run(["project-export", "--project-root", ".", "--output-dir", pkg], root).status, 0);
    const manifest = JSON.parse(fs.readFileSync(path.join(pkg, "manifest.json"), "utf8"));
    for (const item of manifest.files) assert.doesNotMatch(item.path, /\\/, "the package is canonical even from a historic ledger");
    const destination = path.join(tempDir("plangonaut-fix-dst-"), "delivered");
    assert.strictEqual(run(["project-import", "--package-dir", pkg, "--project-root", destination, "--operation-id", "OP-IMPORT-HIST"], root).status, 0);
    assert.strictEqual(run(["validate", "--project-root", "."], destination).status, 0);
  });

  it("migrate normalizes historic separators and records every substitution", () => {
    // `migrate` is the explicit route, and it is explicit in both directions: it
    // says what it changed, and the event keeps the previous spelling. Losing the
    // provenance of a historic record to make it look as though it had been born
    // clean is the defect this repository has been correcting for three rounds.
    const root = project("Migrate");
    fs.writeFileSync(path.join(root, "doc.md"), "the plan\n");
    assert.strictEqual(
      run(["doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/plan.md", "--content-file", "doc.md", "--owner", "A"], root).status,
      0,
    );
    const ledger = path.join(root, ".plangonaut", "state.json");
    const before = JSON.parse(fs.readFileSync(ledger, "utf8"));
    before.artifacts[0].base_path = "docs\\plan.md";
    before.artifacts[0].working_path = "docs\\plan-v1.md";
    fs.writeFileSync(ledger, `${JSON.stringify(before, null, 2)}\n`);
    // The Windows spellings come from an engine that predates the replay format;
    // so does the history they belong to.
    ageProject(root);

    const result = run(["migrate", "--project-root", ".", "--operation-id", "OP-MIGRATE-SEP"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /Normalized 2 recorded paths to "\/" as the separator/);
    assert.match(result.stdout, /docs\\plan\.md -> docs\/plan\.md/);

    const after = state(root);
    assert.strictEqual(after.artifacts[0].base_path, "docs/plan.md");
    assert.strictEqual(after.artifacts[0].working_path, "docs/plan-v1.md");
    const event = events(root).findLast((item) => item.type === "RECORDED_PATHS_NORMALIZED");
    assert.strictEqual(event.rewrites.length, 2);
    assert.deepStrictEqual(
      event.rewrites.map((item) => [item.before, item.after]).sort(),
      [["docs\\plan-v1.md", "docs/plan-v1.md"], ["docs\\plan.md", "docs/plan.md"]].sort(),
      "every substitution is recorded verbatim",
    );
    assert.strictEqual(run(["validate", "--project-root", "."], root).status, 0);

    // Nothing left to do, and it says so rather than writing a second event.
    const again = run(["migrate", "--project-root", ".", "--operation-id", "OP-MIGRATE-SEP-2"], root);
    assert.strictEqual(again.status, 0, again.stderr);
    assert.match(again.stdout, /already uses "\/"/);
    assert.strictEqual(events(root).filter((item) => item.type === "RECORDED_PATHS_NORMALIZED").length, 1);
  });
});

// ---------------------------------------------------------------------------
// Blocker 6 — the export refusal has to name the way out.
// ---------------------------------------------------------------------------

describe("blocker 6 — the export refusal names what is missing and what to do", () => {
  it("names the draft and the command that publishes it, and publishes nothing", () => {
    const root = project("NoPublished");
    fs.writeFileSync(path.join(root, "doc.md"), "the plan\n");
    assert.strictEqual(
      run(["doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/plan.md", "--content-file", "doc.md", "--owner", "A"], root).status,
      0,
    );
    const before = state(root);

    const pkg = path.join(tempDir("plangonaut-fix-pkg-"), "pkg");
    const result = run(["project-export", "--project-root", ".", "--output-dir", pkg], root);
    assert.strictEqual(result.status, 2, result.stdout);
    assert.match(result.stderr, /must carry at least one PUBLISHED Markdown document/);
    assert.match(result.stderr, /still in DRAFT — ART-1 \(docs\/plan\.md\)/);
    assert.match(result.stderr, /plangonaut doc-finalize --project-root \. --id ART-1 --owner <owner> --operation-id <id>/);
    assert.match(result.stderr, /Nothing was written and no document was published/);

    // The gate is unchanged and the refusal publishes nothing.
    const after = state(root);
    assert.strictEqual(after.revision, before.revision);
    assert.strictEqual(after.artifacts[0].status, "DRAFT");
    assert.strictEqual(fs.existsSync(pkg), false);

    // And the command it names is the one that actually unblocks the export.
    assert.strictEqual(run(["doc-finalize", "--project-root", ".", "--id", "ART-1", "--owner", "A"], root).status, 0);
    assert.strictEqual(run(["project-export", "--project-root", ".", "--output-dir", pkg], root).status, 0);
  });

  it("names the route from scratch when the ledger holds no document at all", () => {
    const root = project("NoDocuments");
    const pkg = path.join(tempDir("plangonaut-fix-pkg-"), "pkg");
    const result = run(["project-export", "--project-root", ".", "--output-dir", pkg], root);
    assert.strictEqual(result.status, 2, result.stdout);
    assert.match(result.stderr, /no documents at all in the ledger/);
    assert.match(result.stderr, /plangonaut doc-diff --project-root \./);
    assert.match(result.stderr, /plangonaut doc-save --project-root \./);
    assert.match(result.stderr, /plangonaut doc-finalize --project-root \./);
  });
});
