// Regression suite for DEF-1 / DEF-2 / DEF-3: the document commands silently and
// irreversibly destroyed user data.
//
// Root cause of both: after doc-finalize, `working_path === base_path`, and every
// document command treated that path as a disposable `-vN` working file. It was
// therefore MOVED into `.plangonaut/history/`, which (a) deleted the published
// document while state.json still reported PUBLISHED, and (b) overwrote the
// authentic history entry for that revision. doc-restore additionally skipped the
// filesystem-hash revalidation that doc-save performs, so it happily archived
// hand-edited content on top of a genuine revision.
//
// DEF-3 is the same class on the other side of the lifecycle: doc-finalize copied
// the working file straight onto base_path, destroying whatever was already there —
// a document predating the project, or a hand edit made while the artifact was in
// DRAFT, which the working-file hash check cannot see.
//
// The damage is irreversible by construction: `.plangonaut/backups/` only ever holds
// state.json and events.jsonl, never document content. These tests therefore
// assert on the FILES, not only on exit codes.
import { describe, it } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CLI = path.resolve("lib/bin/plangonaut.js");

function runCli(args, cwd) {
  if (["doc-save","doc-mark-deletion","doc-restore","doc-finalize"].includes(args[0]) && !args.includes("--operation-id")) args = [...args, "--operation-id", `OP-${crypto.randomUUID()}`];
  if (args[0] === "doc-save" && !args.includes("--confirm-token")) {
    const preview = spawnSync(process.execPath, [CLI, "doc-diff", ...args.slice(1)], { cwd, encoding: "utf8" });
    if (preview.status === 0) args = [...args, "--confirm-token", JSON.parse(preview.stdout).confirmation_token];
  }
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function newProject(label) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `plangonaut-test-${label}-`));
  fs.writeFileSync(path.join(root, "owners.json"), JSON.stringify({ product: "A", technical: "B", budget: "C", safety: "D", release: "E" }));
  const init = runCli(["init", "--project-root", ".", "--project-name", "DocTest", "--project-mode", "Resume", "--interaction-mode", "Expert", "--owners-file", "owners.json", "--operation-id", `OP-init-${label}`], root);
  assert.strictEqual(init.status, 0, init.stderr);
  return root;
}

function save(root, contentFile, content) {
  fs.writeFileSync(path.join(root, contentFile), content);
  const result = runCli(["doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/spec.md", "--content-file", contentFile, "--owner", "A"], root);
  assert.strictEqual(result.status, 0, result.stderr);
  return result;
}

function readState(root) {
  return JSON.parse(fs.readFileSync(path.join(root, ".plangonaut", "state.json"), "utf8"));
}

function artifact(root) {
  return readState(root).artifacts.find((item) => item.id === "ART-1");
}

// Builds the exact sequence from the defect report: save v1, save v2, finalize.
function publishedProject(label) {
  const root = newProject(label);
  save(root, "content-v1.txt", "v1");
  save(root, "content-v2.txt", "v2");
  const finalize = runCli(["doc-finalize", "--project-root", ".", "--id", "ART-1", "--owner", "A"], root);
  assert.strictEqual(finalize.status, 0, finalize.stderr);
  assert.strictEqual(fs.readFileSync(path.join(root, "docs/spec.md"), "utf8"), "v2");
  return root;
}

describe("DOCOP-001 data-loss regressions (DEF-1, DEF-2, DEF-3)", () => {
  it("DEF-1: doc-restore after a finalize keeps the published document on disk", () => {
    const root = publishedProject("def1");

    const restore = runCli(["doc-restore", "--project-root", ".", "--id", "ART-1", "--revision", "1", "--owner", "A"], root);
    assert.strictEqual(restore.status, 0, restore.stderr);

    // The published file survives the restore with its published content.
    assert.strictEqual(fs.existsSync(path.join(root, "docs/spec.md")), true, "the finalized document was deleted by doc-restore");
    assert.strictEqual(fs.readFileSync(path.join(root, "docs/spec.md"), "utf8"), "v2");
    // The restore itself lands in a new working revision, per DOCOP-001.
    assert.strictEqual(fs.readFileSync(path.join(root, "docs/spec-v3.md"), "utf8"), "v1");
    // "Restore ... does not delete intervening history": both revisions intact.
    assert.strictEqual(fs.readFileSync(path.join(root, ".plangonaut/history/ART-1-v1.md"), "utf8"), "v1");
    assert.strictEqual(fs.readFileSync(path.join(root, ".plangonaut/history/ART-1-v2.md"), "utf8"), "v2");
  });

  it("DEF-1: state never claims PUBLISHED while an unfinalized revision is current", () => {
    const root = publishedProject("def1-state");
    assert.strictEqual(artifact(root).status, "PUBLISHED");

    runCli(["doc-restore", "--project-root", ".", "--id", "ART-1", "--revision", "1", "--owner", "A"], root);

    const current = artifact(root);
    assert.strictEqual(current.revision, 3);
    assert.strictEqual(current.working_path, "docs/spec-v3.md");
    assert.strictEqual(current.status, "DRAFT", "the restore left a stale PUBLISHED status behind");
  });

  it("DEF-1: doc-save on a published artifact does not unpublish it either", () => {
    const root = publishedProject("def1-save");

    save(root, "content-v3.txt", "v3");

    assert.strictEqual(fs.existsSync(path.join(root, "docs/spec.md")), true, "doc-save deleted the finalized document");
    assert.strictEqual(fs.readFileSync(path.join(root, "docs/spec.md"), "utf8"), "v2");
    assert.strictEqual(fs.readFileSync(path.join(root, "docs/spec-v3.md"), "utf8"), "v3");
    assert.strictEqual(fs.readFileSync(path.join(root, ".plangonaut/history/ART-1-v2.md"), "utf8"), "v2");
    assert.strictEqual(artifact(root).status, "DRAFT");
  });

  it("DEF-1: a second doc-finalize is refused instead of deleting the publication", () => {
    const root = publishedProject("def1-finalize");

    const second = runCli(["doc-finalize", "--project-root", ".", "--id", "ART-1", "--owner", "A", "--idempotency-key", "distinct-key"], root);
    assert.strictEqual(second.status, 2);
    assert.match(second.stderr, /already finalized/);
    assert.strictEqual(fs.readFileSync(path.join(root, "docs/spec.md"), "utf8"), "v2");
  });

  it("DEF-2: doc-restore refuses an external edit exactly like doc-save does", () => {
    const root = publishedProject("def2");
    fs.writeFileSync(path.join(root, "docs/spec.md"), "hand edited outside plangonaut");

    const save = runCli(["doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/spec.md", "--content-file", "content-v2.txt", "--owner", "A"], root);
    assert.strictEqual(save.status, 2);
    assert.match(save.stderr, /External edit detected/);

    const restore = runCli(["doc-restore", "--project-root", ".", "--id", "ART-1", "--revision", "1", "--owner", "A"], root);
    assert.strictEqual(restore.status, 2, "doc-restore bypassed the external-edit guard that doc-save enforces");
    assert.match(restore.stderr, /External edit detected/);
  });

  it("DEF-2: the authentic revision 2 survives an attempted restore over a tampered file", () => {
    const root = publishedProject("def2-history");
    fs.writeFileSync(path.join(root, "docs/spec.md"), "hand edited outside plangonaut");

    runCli(["doc-restore", "--project-root", ".", "--id", "ART-1", "--revision", "1", "--owner", "A"], root);

    assert.strictEqual(
      fs.readFileSync(path.join(root, ".plangonaut/history/ART-1-v2.md"), "utf8"),
      "v2",
      "the hand-edited content overwrote the authentic revision 2 in history",
    );
  });

  it("DEF-2: an existing history entry is never replaced by different content", () => {
    const root = newProject("def2-guard");
    save(root, "content-v1.txt", "v1");
    save(root, "content-v2.txt", "v2");

    // Forge a history collision: revision 2 is still the live working file, so the
    // next archive targets ART-1-v2.md, which we pre-fill with foreign content.
    fs.writeFileSync(path.join(root, ".plangonaut/history/ART-1-v2.md"), "someone else's revision 2");

    const restore = runCli(["doc-restore", "--project-root", ".", "--id", "ART-1", "--revision", "1", "--owner", "A"], root);
    assert.strictEqual(restore.status, 2);
    assert.match(restore.stderr, /Refusing to overwrite recorded history/);
    assert.strictEqual(fs.readFileSync(path.join(root, ".plangonaut/history/ART-1-v2.md"), "utf8"), "someone else's revision 2");
  });

  it("validate compares the ledger hashes with the files on disk", () => {
    const root = publishedProject("ledger");
    const clean = runCli(["validate", "--project-root", "."], root);
    assert.strictEqual(clean.status, 0, clean.stderr);

    // The DOCUMENT_SAVED event for revision 2 recorded the real hash; corrupting
    // the history file makes the ledger and the disk disagree.
    fs.writeFileSync(path.join(root, ".plangonaut/history/ART-1-v2.md"), "corrupted");
    const corrupted = runCli(["validate", "--project-root", "."], root);
    assert.strictEqual(corrupted.status, 2, "a corrupted history file passed validation");
    assert.match(corrupted.stderr, /history file for ART-1 revision 2 does not match the hash recorded in the ledger/);
  });

  it("validate reports a PUBLISHED artifact whose base file has vanished", () => {
    const root = publishedProject("ledger-missing");
    fs.rmSync(path.join(root, "docs/spec.md"));

    const result = runCli(["validate", "--project-root", "."], root);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /is recorded as PUBLISHED but docs\/spec\.md does not exist/);
  });

  // DEF-3, same class as DEF-1/DEF-2: doc-finalize used to copy the working file
  // straight onto base_path, silently destroying whatever was already there. Nothing
  // in .plangonaut/backups/ could bring it back.
  it("DEF-3: doc-finalize refuses to overwrite a pre-existing untracked base file", () => {
    const root = newProject("def3");
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs/spec.md"), "a document that predates the project");
    save(root, "content-v1.txt", "v1");

    const result = runCli(["doc-finalize", "--project-root", ".", "--id", "ART-1", "--owner", "A"], root);
    assert.strictEqual(result.status, 2, "doc-finalize overwrote a file Plangonaut never recorded");
    assert.match(result.stderr, /already holds content Plangonaut never recorded/);
    assert.strictEqual(fs.readFileSync(path.join(root, "docs/spec.md"), "utf8"), "a document that predates the project");
  });

  it("DEF-3: explicit approval archives the superseded content instead of dropping it", () => {
    const root = newProject("def3-approved");
    fs.mkdirSync(path.join(root, "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "docs/spec.md"), "a document that predates the project");
    save(root, "content-v1.txt", "v1");

    const result = runCli(["doc-finalize", "--project-root", ".", "--id", "ART-1", "--owner", "A", "--accept-base-overwrite"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(fs.readFileSync(path.join(root, "docs/spec.md"), "utf8"), "v1");

    const snapshots = fs.readdirSync(path.join(root, ".plangonaut/history")).filter((name) => name.startsWith("ART-1-external-"));
    assert.strictEqual(snapshots.length, 1, "the superseded content was not archived");
    assert.strictEqual(fs.readFileSync(path.join(root, ".plangonaut/history", snapshots[0]), "utf8"), "a document that predates the project");

    // The supersession is evidence, so it belongs in the ledger.
    const events = fs.readFileSync(path.join(root, ".plangonaut/events.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    const finalized = events.at(-1);
    assert.strictEqual(finalized.type, "DOCUMENT_FINALIZED");
    assert.match(finalized.superseded_external_path, /ART-1-external-/);
    assert.strictEqual(typeof finalized.superseded_external_hash, "string");
  });

  it("DEF-3: a hand edit of the published file is caught at finalize time", () => {
    // While the artifact is DRAFT, assertNoExternalEdit guards the working file,
    // not the base one, so only the finalize audit can see this drift.
    const root = publishedProject("def3-drift");
    save(root, "content-v3.txt", "v3");
    fs.writeFileSync(path.join(root, "docs/spec.md"), "hand edited after publication");

    const result = runCli(["doc-finalize", "--project-root", ".", "--id", "ART-1", "--owner", "A"], root);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /already holds content Plangonaut never recorded/);
    assert.strictEqual(fs.readFileSync(path.join(root, "docs/spec.md"), "utf8"), "hand edited after publication");
  });

  it("DEF-3: the guard stays silent on a normal republication cycle", () => {
    // Every base file Plangonaut itself published matches a recorded digest, so the
    // audit must never ask for approval in the ordinary save/finalize loop.
    const root = publishedProject("def3-normal");
    save(root, "content-v3.txt", "v3");
    const second = runCli(["doc-finalize", "--project-root", ".", "--id", "ART-1", "--owner", "A"], root);
    assert.strictEqual(second.status, 0, second.stderr);
    assert.strictEqual(fs.readFileSync(path.join(root, "docs/spec.md"), "utf8"), "v3");

    const restore = runCli(["doc-restore", "--project-root", ".", "--id", "ART-1", "--revision", "1", "--owner", "A"], root);
    assert.strictEqual(restore.status, 0, restore.stderr);
    const third = runCli(["doc-finalize", "--project-root", ".", "--id", "ART-1", "--owner", "A"], root);
    assert.strictEqual(third.status, 0, third.stderr);
    assert.strictEqual(fs.readFileSync(path.join(root, "docs/spec.md"), "utf8"), "v1");
  });

  it("validate reports a working file edited outside Plangonaut", () => {
    const root = newProject("ledger-drift");
    save(root, "content-v1.txt", "v1");
    fs.writeFileSync(path.join(root, "docs/spec-v1.md"), "hand edited");

    const result = runCli(["validate", "--project-root", "."], root);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /working file docs\/spec-v1\.md for ART-1 was edited outside Plangonaut/);
  });
});
