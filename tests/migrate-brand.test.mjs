import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * `.beave/` to `.plangonaut/`, and back.
 *
 * The property every test here defends is one sentence: **a project at rest has
 * exactly one state directory.** The first draft of the brand contract said a
 * completed migration retains `.beave/`, and also that a project holding both is
 * ambiguous and refused — a migration whose success condition was the failure
 * state. These tests are what stops that from coming back.
 *
 * The second property is that an interruption is never readable as an ordinary
 * project. The marker records the phase *before* the phase is attempted, so the
 * two situations that look identical on disk — staged but not swapped, swapped
 * but not cleaned — are told apart by what the engine recorded rather than by
 * guessing from the filesystem.
 */

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "lib", "bin", "plangonaut.js");

const run = (args, cwd) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });

function legacyProject(t, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "brand-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "owners.json"),
    JSON.stringify({ product: "A", technical: "A", budget: "A", safety: "A", release: "A" }),
  );
  const init = run(
    ["init", "--project-root", ".", "--project-name", name, "--project-mode", "Genesis",
     "--interaction-mode", "Standard", "--owners-file", "owners.json", "--operation-id", "OP-0001"],
    root,
  );
  assert.strictEqual(init.status, 0, init.stderr);
  // Created as a current project, then made legacy in place: a project is not
  // portable by copying, so renaming the directory is the only way to build a
  // legacy fixture whose recorded root still matches where it sits.
  fs.renameSync(path.join(root, ".plangonaut"), path.join(root, ".beave"));
  return root;
}

const dirs = (root) =>
  fs.readdirSync(root).filter((entry) => entry === ".beave" || entry === ".plangonaut").sort();

const migrationId = (root) => fs.readdirSync(path.join(root, ".plangonaut", "migrations"))[0];

const receipt = (root, id) =>
  JSON.parse(fs.readFileSync(path.join(root, ".plangonaut", "migrations", id, "receipt.json"), "utf8"));

describe("migrate-brand", () => {
  it("previews without touching the filesystem", (t) => {
    const root = legacyProject(t, "Preview");
    const before = fs.readdirSync(root).sort();

    const preview = run(["migrate-brand", "--project-root", ".", "--dry-run"], root);
    assert.strictEqual(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /source format\s+\.beave\//);
    assert.match(preview.stdout, /target format\s+\.plangonaut\//);
    assert.match(preview.stdout, /no blockers/);
    assert.match(preview.stdout, /Nothing was written/);
    // The backup location is part of the preview, because it is where the old
    // bytes go and a reader should not have to run it to find out.
    assert.match(preview.stdout, /backup\s+\.plangonaut\/migrations\//);

    assert.deepStrictEqual(fs.readdirSync(root).sort(), before);
  });

  it("leaves exactly one state directory, and it is the new one", (t) => {
    const root = legacyProject(t, "OneDirectory");
    const migrated = run(["migrate-brand", "--project-root", "."], root);
    assert.strictEqual(migrated.status, 0, migrated.stderr);

    assert.deepStrictEqual(dirs(root), [".plangonaut"], "a migrated project must not be ambiguous");
    assert.strictEqual(run(["validate", "--project-root", "."], root).status, 0);

    const status = JSON.parse(run(["status", "--project-root", "."], root).stdout);
    assert.strictEqual(status.state_format, "plangonaut");
    assert.strictEqual(status.project, "OneDirectory");
  });

  it("keeps the old bytes where no resolver looks for state, and proves they match", (t) => {
    const root = legacyProject(t, "Backup");
    const source = fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8");
    assert.strictEqual(run(["migrate-brand", "--project-root", "."], root).status, 0);

    const id = migrationId(root);
    const backup = path.join(root, ".plangonaut", "migrations", id, "legacy-backup", "state.json");
    assert.ok(fs.existsSync(backup), "the old state must be kept");
    assert.strictEqual(fs.readFileSync(backup, "utf8"), source, "kept byte for byte");

    const paper = receipt(root, id);
    for (const field of [
      "migration_id", "engine_version", "source_version", "target_version",
      "source_format", "target_format", "migrated_at", "files_migrated",
      "files_preserved", "references_updated", "source_digest", "target_digest",
      "backup_digest", "verification", "rollback",
    ]) {
      assert.ok(field in paper, `the receipt must record ${field}`);
    }
    assert.strictEqual(paper.source_format, ".beave");
    assert.strictEqual(paper.target_format, ".plangonaut");
    assert.strictEqual(paper.source_digest, paper.backup_digest, "the backup is the source");
    assert.strictEqual(paper.rollback.state, "available");
  });

  it("preserves the history rather than rewriting it", (t) => {
    const root = legacyProject(t, "History");
    const events = fs.readFileSync(path.join(root, ".beave", "events.jsonl"), "utf8");
    assert.strictEqual(run(["migrate-brand", "--project-root", "."], root).status, 0);
    assert.strictEqual(
      fs.readFileSync(path.join(root, ".plangonaut", "events.jsonl"), "utf8"),
      events,
      "the event chain is copied, never rewritten",
    );
  });

  /**
   * An ambiguous project is refused before `migrate-brand` gets to have an
   * opinion, and that is the right order: the resolver cannot say which of the
   * two directories is the project, so no command — including this one — may
   * act on either. The migration keeps its own blocker for the same case as
   * defence in depth; what a user sees is the resolver's sentence, which names
   * the situation rather than the command that tripped over it.
   */
  it("is refused on an ambiguous project, like every other command", (t) => {
    const root = legacyProject(t, "Both");
    fs.mkdirSync(path.join(root, ".plangonaut"));
    const refused = run(["migrate-brand", "--project-root", "."], root);
    assert.strictEqual(refused.status, 2);
    assert.match(refused.stderr, /both \.plangonaut\/ and \.beave\//);
    assert.deepStrictEqual(dirs(root), [".beave", ".plangonaut"], "nothing was moved");
  });

  it("rolls back to exactly one directory, and it is the old one", (t) => {
    const root = legacyProject(t, "Rollback");
    const before = fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8");
    assert.strictEqual(run(["migrate-brand", "--project-root", "."], root).status, 0);
    const id = migrationId(root);

    const back = run(["migrate-brand", "--project-root", ".", "--rollback", id], root);
    assert.strictEqual(back.status, 0, back.stderr);
    assert.deepStrictEqual(dirs(root), [".beave"], "a rolled-back project must not be ambiguous");
    assert.strictEqual(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"), before);
    assert.strictEqual(run(["validate", "--project-root", "."], root).status, 0);
  });

  it("refuses a rollback whose backup no longer matches its receipt", (t) => {
    const root = legacyProject(t, "Tampered");
    assert.strictEqual(run(["migrate-brand", "--project-root", "."], root).status, 0);
    const id = migrationId(root);

    const backup = path.join(root, ".plangonaut", "migrations", id, "legacy-backup", "state.json");
    fs.writeFileSync(backup, fs.readFileSync(backup, "utf8").replace("Tampered", "Something else"));

    const refused = run(["migrate-brand", "--project-root", ".", "--rollback", id], root);
    assert.strictEqual(refused.status, 2);
    assert.match(refused.stderr, /does not match the digest its receipt records/);
    assert.deepStrictEqual(dirs(root), [".plangonaut"], "a refused rollback changes nothing");
  });

  /**
   * An interrupted migration is not an ambiguous project, although it looks
   * exactly like one on disk. The marker is read before the directories are
   * counted, which is the only reason the two can be told apart at all.
   */
  it("reports an interruption as its own condition, not as an ambiguous project", (t) => {
    const root = legacyProject(t, "Interrupted");
    fs.writeFileSync(
      path.join(root, ".plangonaut-migration.json"),
      JSON.stringify({ migration_id: "MIG-test", phase: "swapped", started_at: "2026-09-16T00:00:00.000Z", staging: ".plangonaut-migration-MIG-test", engine_version: "0" }),
    );
    fs.mkdirSync(path.join(root, ".plangonaut"));

    const refused = run(["status", "--project-root", "."], root);
    assert.notStrictEqual(refused.status, 0);
    const payload = JSON.parse(refused.stdout);
    assert.strictEqual(payload.error.kind, "MIGRATION_INCOMPLETE");
    assert.match(payload.error.message, /--resume/);
    assert.match(payload.error.message, /--rollback/);
  });

  it("discards an unfinished migration and leaves the legacy project untouched", (t) => {
    const root = legacyProject(t, "Discard");
    const before = fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8");
    fs.writeFileSync(
      path.join(root, ".plangonaut-migration.json"),
      JSON.stringify({ migration_id: "MIG-half", phase: "staging", started_at: "2026-09-16T00:00:00.000Z", staging: ".plangonaut-migration-MIG-half", engine_version: "0" }),
    );
    fs.mkdirSync(path.join(root, ".plangonaut-migration-MIG-half"));

    const back = run(["migrate-brand", "--project-root", ".", "--rollback", "MIG-half"], root);
    assert.strictEqual(back.status, 0, back.stderr);
    assert.deepStrictEqual(dirs(root), [".beave"]);
    assert.ok(!fs.existsSync(path.join(root, ".plangonaut-migration-MIG-half")));
    assert.ok(!fs.existsSync(path.join(root, ".plangonaut-migration.json")));
    assert.strictEqual(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"), before);
  });
});

describe("the five states a project root can be in", () => {
  it("names each of them differently", (t) => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "brand-states-"));
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));

    // Neither.
    const empty = path.join(base, "empty");
    fs.mkdirSync(empty);
    assert.strictEqual(JSON.parse(run(["status", "--project-root", "."], empty).stdout).error.kind, "NOT_PLANGONAUT_PROJECT");

    // Both.
    const both = legacyProject(t, "Ambiguous");
    fs.mkdirSync(path.join(both, ".plangonaut"));
    assert.strictEqual(JSON.parse(run(["status", "--project-root", "."], both).stdout).error.kind, "PROJECT_STATE_AMBIGUOUS");

    // Legacy, and it works.
    const legacy = legacyProject(t, "Legacy");
    const status = JSON.parse(run(["status", "--project-root", "."], legacy).stdout);
    assert.strictEqual(status.state_format, "legacy");
    assert.strictEqual(status.state_directory, ".beave");
    assert.deepStrictEqual(dirs(legacy), [".beave"], "reading a legacy project must not create the new directory");
  });
});
