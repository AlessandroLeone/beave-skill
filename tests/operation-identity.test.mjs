import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * What makes two invocations the same operation, and what makes them two.
 *
 * `--operation-id` is how a caller says "this is the same operation as before",
 * and the engine checks the claim against a digest of the input. Version 1 of
 * that digest was `sha256(JSON.stringify(flags))`: the text as typed, in the
 * order typed. It got both directions wrong.
 *
 *   - The retry the contract teaches after an interruption was refused as
 *     "different input" when the flags were written in a different order, or
 *     when `--project-root` was `.` the second time.
 *   - A `--content-file` was digested as its *path*, so the same operation id
 *     pointing at the same filename holding entirely different text was accepted
 *     as a no-op and the new content was silently discarded.
 *
 * Version 2 digests the operation: the command, its options sorted by name, each
 * tagged by kind, with a file's *content* standing in for its path. Version 1 is
 * kept, because every event written before today is recognised by it and an
 * unrecognised completed operation is one that gets applied twice.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "lib", "bin", "plangonaut.js");

let counter = 0;

function plangonaut(cwd, args, env = {}) {
  counter += 1;
  const full = [...args];
  if (!full.includes("--operation-id")) full.push("--operation-id", `ID${counter}-${Date.now()}`);
  const result = spawnSync(process.execPath, [CLI, ...full], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return { status: result.status, out: `${result.stdout}${result.stderr}`.trim() };
}

function ok(cwd, args, env) {
  const result = plangonaut(cwd, args, env);
  assert.strictEqual(result.status, 0, `expected success from ${args[0]}:\n${result.out}`);
  return result.out;
}

function scratch(t, name = "work") {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-identity-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return path.join(base, name);
}

function project(t, name = "Identity") {
  const root = scratch(t, "project");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "owners.json"),
    JSON.stringify({ product: "Ada", technical: "Ada", budget: "Ada", safety: "Ada", release: "Ada" }),
  );
  ok(root, [
    "init", "--project-root", root, "--project-name", name,
    "--project-mode", "Genesis", "--interaction-mode", "Standard",
    "--owners-file", path.join(root, "owners.json"),
  ]);
  return root;
}

const readEvents = (root) =>
  fs.readFileSync(path.join(root, ".plangonaut", "events.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

// ---------------------------------------------------------------------------
// The same operation, written differently
// ---------------------------------------------------------------------------

test("the same options in a different order are the same operation", (t) => {
  const root = project(t);
  ok(root, ["decision", "--project-root", root, "--id", "DEC-1", "--title", "Test", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-A"]);

  const reordered = plangonaut(root, ["decision", "--owner", "Ada", "--status", "APPROVED", "--title", "Test", "--id", "DEC-1", "--project-root", root, "--operation-id", "OP-A"]);
  assert.strictEqual(reordered.status, 0, reordered.out);
  assert.match(reordered.out, /Idempotent retry/);
  assert.strictEqual(readEvents(root).filter((event) => event.type === "DECISION_CREATED").length, 1);
});

test("the project spelled two ways is the same project", (t) => {
  const root = project(t);
  ok(root, ["decision", "--project-root", root, "--id", "DEC-1", "--title", "Test", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-B"]);

  // Run from inside the folder, with `.`, and with a trailing separator.
  for (const spelling of [".", `${root}${path.sep}`, root.replaceAll("\\", "/")]) {
    const retry = plangonaut(root, ["decision", "--project-root", spelling, "--id", "DEC-1", "--title", "Test", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-B"]);
    assert.strictEqual(retry.status, 0, `${spelling}:\n${retry.out}`);
    assert.match(retry.out, /Idempotent retry/);
  }
});

test("a file at two equivalent paths is the same input; different content is not", (t) => {
  const root = project(t);
  const first = path.join(root, "answer.md");
  const second = path.join(root, "copy.md");
  fs.writeFileSync(first, "# The answer\n");
  fs.copyFileSync(first, second);

  ok(root, ["record", "--project-root", root, "--module", "1", "--status", "CONFIRMED", "--answer-file", first, "--owner", "Ada", "--operation-id", "OP-C"]);

  // Same bytes under another name: the content is the input, so this is a retry.
  const sameContent = plangonaut(root, ["record", "--project-root", root, "--module", "1", "--status", "CONFIRMED", "--answer-file", second, "--owner", "Ada", "--operation-id", "OP-C"]);
  assert.strictEqual(sameContent.status, 0, sameContent.out);
  assert.match(sameContent.out, /Idempotent retry/);

  /*
   * And the case version 1 got dangerously wrong: same id, same path, different
   * bytes. It answered `Idempotent retry` and threw the new answer away.
   */
  fs.writeFileSync(first, "# A completely different answer\n");
  const changed = plangonaut(root, ["record", "--project-root", root, "--module", "1", "--status", "CONFIRMED", "--answer-file", first, "--owner", "Ada", "--operation-id", "OP-C"]);
  assert.notStrictEqual(changed.status, 0, "a different file content passed as a repeat of the same operation");
  assert.match(changed.out, /already used with different input/);
});

test("a missing file is distinguished from another missing file", (t) => {
  const root = project(t);
  const conflicting = plangonaut(root, ["record", "--project-root", root, "--module", "1", "--status", "CONFIRMED", "--answer-file", path.join(root, "nowhere.md"), "--owner", "Ada", "--operation-id", "OP-D"]);
  // It fails for the ordinary reason — the file is not there — and not by
  // colliding with some other absent file.
  assert.notStrictEqual(conflicting.status, 0);
  assert.doesNotMatch(conflicting.out, /already used with different input/);
});

// ---------------------------------------------------------------------------
// Different operations stay different
// ---------------------------------------------------------------------------

test("options that really differ are a conflict, not a retry", (t) => {
  const root = project(t);
  ok(root, ["decision", "--project-root", root, "--id", "DEC-1", "--title", "First", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-E"]);

  for (const [what, args] of [
    ["a different title", ["--id", "DEC-1", "--title", "Second", "--status", "APPROVED", "--owner", "Ada"]],
    ["a different id", ["--id", "DEC-2", "--title", "First", "--status", "APPROVED", "--owner", "Ada"]],
    ["a different status", ["--id", "DEC-1", "--title", "First", "--status", "PROPOSED", "--owner", "Ada"]],
    ["an extra option", ["--id", "DEC-1", "--title", "First", "--status", "APPROVED", "--owner", "Ada", "--expected-revision", "2"]],
  ]) {
    const conflict = plangonaut(root, ["decision", "--project-root", root, ...args, "--operation-id", "OP-E"]);
    assert.notStrictEqual(conflict.status, 0, `${what} was accepted as a repeat`);
    assert.match(conflict.out, /already used with different input/, what);
  }
});

test("the order inside a value is preserved, because only the caller knows if it matters", (t) => {
  const root = project(t);
  fs.writeFileSync(path.join(root, "doc.md"), "# Doc\n");
  ok(root, ["decision", "--project-root", root, "--id", "DEC-1", "--title", "One", "--status", "APPROVED", "--owner", "Ada"]);
  ok(root, ["decision", "--project-root", root, "--id", "DEC-2", "--title", "Two", "--status", "APPROVED", "--owner", "Ada"]);

  const base = ["--project-root", root, "--id", "ART-1", "--base-path", "doc.md", "--content-file", path.join(root, "doc.md"), "--owner", "Ada"];
  const preview = JSON.parse(ok(root, ["doc-diff", ...base]));
  ok(root, ["doc-save", ...base, "--confirm-token", preview.confirmation_token, "--sources", "DEC-1,DEC-2", "--operation-id", "OP-F"]);

  /*
   * `--sources DEC-2,DEC-1` is not obviously the same operation: provenance is
   * recorded in the order given. Nothing here sorts the inside of a value, so
   * the two stay distinct — a refusal, never a silent merge.
   */
  const swapped = plangonaut(root, ["doc-save", ...base, "--confirm-token", preview.confirmation_token, "--sources", "DEC-2,DEC-1", "--operation-id", "OP-F"]);
  assert.notStrictEqual(swapped.status, 0);
  assert.match(swapped.out, /already used with different input/);
});

// ---------------------------------------------------------------------------
// The version, and what it is for
// ---------------------------------------------------------------------------

test("a new record declares the algorithm that produced its digest", (t) => {
  const root = project(t);
  ok(root, ["decision", "--project-root", root, "--id", "DEC-1", "--title", "Test", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-G"]);
  const event = readEvents(root).findLast((item) => item.type === "DECISION_CREATED");
  assert.strictEqual(event.operation_payload_version, 2);
  assert.match(event.operation_payload_hash, /^[a-f0-9]{64}$/);
});

test("an operation recorded by the earlier engine is still recognised", (t) => {
  const root = project(t);
  ok(root, ["decision", "--project-root", root, "--id", "DEC-1", "--title", "Legacy", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-H"]);

  /*
   * Aged honestly: the fields a version-1 engine wrote, and none it did not.
   * The digest is recomputed the way that engine computed it — over the flags as
   * typed — so this is a record that engine could have produced.
   */
  const eventsPath = path.join(root, ".plangonaut", "events.jsonl");
  const lines = fs.readFileSync(eventsPath, "utf8").split(/\r?\n/).filter(Boolean);
  const aged = lines.map((line) => {
    const event = JSON.parse(line);
    if (event.type !== "DECISION_CREATED") return line;
    delete event.operation_payload_version;
    const legacyFlags = {
      "project-root": root, id: "DEC-1", title: "Legacy", status: "APPROVED", owner: "Ada",
    };
    event.operation_payload_hash = crypto.createHash("sha256").update(JSON.stringify(legacyFlags)).digest("hex");
    event.idempotency_key = crypto.createHash("sha256").update(`OP-H:${event.operation_payload_hash}`).digest("hex");
    event.payload_sha256 = undefined;
    delete event.payload_sha256;
    return JSON.stringify(event);
  });
  fs.writeFileSync(eventsPath, `${aged.join("\n")}\n`);

  // The identical command, spelled identically, is still a no-op — which is what
  // stops it being applied a second time.
  const retry = plangonaut(root, ["decision", "--project-root", root, "--id", "DEC-1", "--title", "Legacy", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-H"]);
  assert.strictEqual(retry.status, 0, retry.out);
  assert.match(retry.out, /Idempotent retry/);
  assert.strictEqual(readEvents(root).filter((event) => event.type === "DECISION_CREATED").length, 1);

  // And genuinely different input against that same old record still conflicts.
  const conflict = plangonaut(root, ["decision", "--project-root", root, "--id", "DEC-1", "--title", "Changed", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-H"]);
  assert.notStrictEqual(conflict.status, 0);
  assert.match(conflict.out, /already used with different input/);
});

test("a reordered retry works after a recovery, which is the case it exists for", (t) => {
  const root = project(t);
  const args = ["risk", "--project-root", root, "--id", "RSK-1", "--title", "Oven fails", "--severity", "HIGH", "--status", "IDENTIFIED", "--owner", "Ada", "--operation-id", "OP-I"];

  // Killed after the event and before the state: the operation happened, the
  // project has not caught up, and the retry is the documented way out.
  const killed = plangonaut(root, args, { PLANGONAUT_FAULT_AT: "after-events" });
  assert.strictEqual(killed.status, 97, killed.out);

  const retry = plangonaut(root, ["risk", "--owner", "Ada", "--status", "IDENTIFIED", "--severity", "HIGH", "--title", "Oven fails", "--id", "RSK-1", "--project-root", ".", "--operation-id", "OP-I"]);
  assert.strictEqual(retry.status, 0, retry.out);
  assert.strictEqual(plangonaut(root, ["validate", "--project-root", root]).status, 0);
  assert.strictEqual(plangonaut(root, ["replay", "--project-root", root, "--verify"]).status, 0);
  assert.strictEqual(readEvents(root).filter((event) => event.type === "RISK_CREATED").length, 1);
});

// ---------------------------------------------------------------------------
// What the fourth independent review reproduced, 2026-09-12
// ---------------------------------------------------------------------------

test("a record from the earlier engine cannot certify a file-valued operation", (t) => {
  const root = project(t);
  const answer = path.join(root, "answer.md");
  fs.writeFileSync(answer, "ANSWER ONE: use Postgres.\n");
  ok(root, ["record", "--project-root", root, "--module", "1", "--status", "CONFIRMED", "--answer-file", answer, "--owner", "Ada", "--operation-id", "OP-LEGACY"]);

  /*
   * Aged to what an `alpha.2` engine wrote: no `operation_payload_version`, and
   * a digest over the flags as typed — which saw the *path* of the answer file
   * and never a byte of its content.
   *
   * The review proved this end to end with the shipped alpha.2 tarball: a human
   * override reading "do NOT ship. Halt the release." was discarded in favour of
   * one reading "ship on Friday", and the command exited 0 saying
   * `Idempotent retry: override already applied.`
   */
  const eventsPath = path.join(root, ".plangonaut", "events.jsonl");
  const lines = fs.readFileSync(eventsPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    const event = JSON.parse(line);
    if (event.type !== "MODULE_RECORDED") return line;
    delete event.operation_payload_version;
    const legacyFlags = { "project-root": root, module: "1", status: "CONFIRMED", "answer-file": answer, owner: "Ada" };
    event.operation_payload_hash = crypto.createHash("sha256").update(JSON.stringify(legacyFlags)).digest("hex");
    event.idempotency_key = crypto.createHash("sha256").update(`OP-LEGACY:${event.operation_payload_hash}`).digest("hex");
    delete event.payload_sha256;
    return JSON.stringify(event);
  });
  fs.writeFileSync(eventsPath, `${lines.join("\n")}\n`);

  // The same filename, entirely different text, the same operation id.
  fs.writeFileSync(answer, "ANSWER TWO: use MySQL instead. THIS IS THE CORRECTED ANSWER.\n");
  const retried = plangonaut(root, ["record", "--project-root", root, "--module", "1", "--status", "CONFIRMED", "--answer-file", answer, "--owner", "Ada", "--operation-id", "OP-LEGACY"]);

  assert.notStrictEqual(retried.status, 0, "the corrected content was discarded and the command reported success");
  assert.match(retried.out, /recorded by an earlier version of Plangonaut/);
  assert.match(retried.out, /--answer-file/);
  assert.match(retried.out, /Nothing was written/);
});

test("a legacy record with no file input is still recognised, and still conflicts", (t) => {
  const root = project(t);
  ok(root, ["decision", "--project-root", root, "--id", "DEC-1", "--title", "Legacy", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-SCALAR"]);

  const eventsPath = path.join(root, ".plangonaut", "events.jsonl");
  const lines = fs.readFileSync(eventsPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    const event = JSON.parse(line);
    if (event.type !== "DECISION_CREATED") return line;
    delete event.operation_payload_version;
    const legacyFlags = { "project-root": root, id: "DEC-1", title: "Legacy", status: "APPROVED", owner: "Ada" };
    event.operation_payload_hash = crypto.createHash("sha256").update(JSON.stringify(legacyFlags)).digest("hex");
    event.idempotency_key = crypto.createHash("sha256").update(`OP-SCALAR:${event.operation_payload_hash}`).digest("hex");
    delete event.payload_sha256;
    return JSON.stringify(event);
  });
  fs.writeFileSync(eventsPath, `${lines.join("\n")}\n`);

  // Nothing here reads a file, so the older digest still says everything it
  // needs to: an identical retry is the no-op it always was.
  const retry = plangonaut(root, ["decision", "--project-root", root, "--id", "DEC-1", "--title", "Legacy", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-SCALAR"]);
  assert.strictEqual(retry.status, 0, retry.out);
  assert.match(retry.out, /Idempotent retry/);

  const conflict = plangonaut(root, ["decision", "--project-root", root, "--id", "DEC-1", "--title", "Changed", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-SCALAR"]);
  assert.notStrictEqual(conflict.status, 0);
  assert.match(conflict.out, /already used with different input/);
});
