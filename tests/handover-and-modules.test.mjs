import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Three things this engine promised and did not keep.
 *
 *  - **Handover.** `project-export` and `project-import` build a directory beside
 *    their destination and promote it with a rename. The rename is why a final
 *    folder is never half a package; what was missing is everything before it. A
 *    killed process left `.name.<uuid>.tmp` behind and no command would ever
 *    mention it again — on the path where a half-finished folder is most likely
 *    to be mistaken for a finished one.
 *  - **Modules.** Both ALN-011 pilots reported, independently, that QNA-0001 and
 *    QNA-0002 were recorded against module 2 while the active module was 1, and
 *    that nothing in the folder explained it. The rule was missing, not broken.
 *  - **The first file a Windows user writes.** PowerShell 5.1 puts a BOM in
 *    front of `owners.json`, the file looks right in every editor, and the very
 *    first Beave command refuses it (ALN-009).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "lib", "bin", "beave.js");

let counter = 0;

function beave(root, args, env = {}) {
  counter += 1;
  const full = [...args];
  if (!full.includes("--operation-id")) full.push("--operation-id", `H${counter}-${Date.now()}`);
  const result = spawnSync(process.execPath, [CLI, ...full], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}`.trim() };
}

function ok(root, args, env) {
  const result = beave(root, args, env);
  assert.strictEqual(result.status, 0, `expected success from ${args[0]}:\n${result.out}`);
  return result.out;
}

function refused(root, args) {
  const result = beave(root, args);
  assert.notStrictEqual(result.status, 0, `expected ${args[0]} to be refused:\n${result.out}`);
  return result.out;
}

function crashAt(root, label, args) {
  const result = beave(root, args, { BEAVE_FAULT_AT: label });
  assert.strictEqual(result.status, 97, `the fault at ${label} did not fire:\n${result.out}`);
  return result;
}

function scratch(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "beave-handover-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return base;
}

function project(t, name = "Handover") {
  const root = path.join(scratch(t), "project");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "owners.json"),
    JSON.stringify({ product: "Ada", technical: "Ada", budget: "Ada", safety: "Ada", release: "Ada" }),
  );
  ok(root, [
    "init", "--project-root", root, "--project-name", name,
    "--project-mode", "Resume", "--interaction-mode", "Standard",
    "--owners-file", path.join(root, "owners.json"),
  ]);
  return root;
}

/** A project with a published document, which is what a package needs. */
function exportable(t) {
  const root = project(t, "Exportable");
  fs.writeFileSync(path.join(root, "handoff.md"), "# Handoff\n\nWhat the next person needs.\n");
  const base = ["--project-root", root, "--id", "ART-HANDOFF", "--base-path", "docs/HANDOFF.md", "--content-file", path.join(root, "handoff.md"), "--owner", "Ada"];
  const preview = JSON.parse(ok(root, ["doc-diff", ...base]));
  ok(root, ["doc-save", ...base, "--confirm-token", preview.confirmation_token]);
  ok(root, ["doc-finalize", "--project-root", root, "--id", "ART-HANDOFF", "--owner", "Ada"]);
  return root;
}

const listing = (directory) => (fs.existsSync(directory) ? fs.readdirSync(directory).sort() : []);

// ---------------------------------------------------------------------------
// Export and import, killed at each of the ten points
// ---------------------------------------------------------------------------

const STAGING_FAULTS = [
  "staging-before-open",
  "staging-after-marker",
  "staging-during-copy",
  "staging-after-state",
  "staging-after-events",
  "staging-after-manifest",
  "staging-after-verify",
  "staging-before-rename",
  "staging-after-rename",
  "staging-before-cleanup",
];

for (const label of STAGING_FAULTS) {
  test(`an export killed at ${label} leaves either a whole package or none`, (t) => {
    const root = exportable(t);
    const out = path.join(scratch(t), "package");
    const parent = path.dirname(out);

    crashAt(root, label, ["project-export", "--project-root", root, "--output-dir", out]);

    const promoted = label === "staging-after-rename" || label === "staging-before-cleanup";
    if (promoted) {
      /*
       * Past the rename: the package is there and it is complete — but while it
       * still carries the marker it is **not** something to hand to anybody.
       *
       * The marker survives the rename on purpose, because one that disappears
       * first can leave a directory nothing recognises. What changed after the
       * fourth review is what `project-verify` does about it: the marker records
       * the exporting machine's absolute paths, its hostname and the PID that
       * made it, and the command whose job is to check a package before a
       * handoff used to call that "harmless" and exit 0.
       */
      assert.ok(fs.existsSync(out), "the package vanished after the rename");
      const stray = path.join(out, ".beave-staging.json");
      if (fs.existsSync(stray)) {
        assert.strictEqual(path.resolve(JSON.parse(fs.readFileSync(stray, "utf8")).destination), path.resolve(out), "the marker does not name the folder it is in");
        const refused = beave(root, ["project-verify", "--package-dir", out]);
        assert.notStrictEqual(refused.status, 0, "a package still carrying its staging marker was verified");
        assert.match(refused.out, /records the exporting machine/);
        assert.notStrictEqual(beave(root, ["project-import", "--package-dir", out, "--project-root", path.join(scratch(t), `from-marked-${label}`)]).status, 0);

        // And the way out costs nothing.
        ok(root, ["recover", "--project-root", root, "--apply"]);
        assert.ok(!fs.existsSync(stray), "the marker was not cleared by the next command");
      }
      assert.strictEqual(beave(root, ["project-verify", "--package-dir", out]).status, 0, "a promoted package did not verify once the marker was gone");
    } else {
      assert.ok(!fs.existsSync(out), "a half-built package was promoted to the destination");
    }

    // The project itself is untouched: an export only ever reads it.
    assert.strictEqual(beave(root, ["validate", "--project-root", root]).status, 0);
    assert.strictEqual(beave(root, ["replay", "--project-root", root]).status, 0);

    // Whatever is left beside the destination is Beave's own and is resolved by
    // the next export, which then succeeds.
    const second = path.join(parent, "package-2");
    ok(root, ["project-export", "--project-root", root, "--output-dir", second]);
    assert.strictEqual(beave(root, ["project-verify", "--package-dir", second]).status, 0);
    for (const entry of listing(parent)) {
      assert.ok(!entry.endsWith(".tmp"), `a staging directory was left behind: ${entry}`);
    }
  });
}

for (const label of STAGING_FAULTS) {
  test(`an import killed at ${label} never leaves half a project`, (t) => {
    const root = exportable(t);
    const pkg = path.join(scratch(t), "package");
    ok(root, ["project-export", "--project-root", root, "--output-dir", pkg]);

    const destination = path.join(scratch(t), "delivered");
    const parent = path.dirname(destination);
    crashAt(root, label, ["project-import", "--package-dir", pkg, "--project-root", destination]);

    const promoted = label === "staging-after-rename" || label === "staging-before-cleanup";
    if (promoted) {
      assert.ok(fs.existsSync(path.join(destination, ".beave", "state.json")), "the imported project is not there");
      assert.strictEqual(beave(destination, ["validate", "--project-root", destination]).status, 0, "a promoted import did not validate");
      const stray = path.join(destination, ".beave-staging.json");
      if (fs.existsSync(stray)) {
        // Same rule as the export: the marker names the folder it is in, so the
        // promotion happened, and re-importing to that destination clears it.
        assert.strictEqual(path.resolve(JSON.parse(fs.readFileSync(stray, "utf8")).destination), path.resolve(destination));
        refused(root, ["project-import", "--package-dir", pkg, "--project-root", destination]);
        assert.ok(!fs.existsSync(stray), "the marker was not cleared");
      }
      assert.strictEqual(beave(destination, ["validate", "--project-root", destination]).status, 0);
      return;
    }

    assert.ok(!fs.existsSync(destination), "a half-built project was promoted to the destination");
    // The package is untouched, and a second import to the same place works.
    assert.strictEqual(beave(root, ["project-verify", "--package-dir", pkg]).status, 0);
    ok(root, ["project-import", "--package-dir", pkg, "--project-root", destination]);
    assert.strictEqual(beave(destination, ["validate", "--project-root", destination]).status, 0);
    for (const entry of listing(parent)) {
      assert.ok(!entry.endsWith(".tmp"), `a staging directory was left behind: ${entry}`);
    }
  });
}

test("a directory that is not Beave's is never removed, whatever it is called", (t) => {
  const root = exportable(t);
  const out = path.join(scratch(t), "package");
  const parent = path.dirname(out);

  // Two decoys: one that looks exactly like a staging directory, one that is a
  // staging directory of a *different* destination.
  const decoy = path.join(parent, `.${path.basename(out)}.not-beave.tmp`);
  fs.mkdirSync(decoy, { recursive: true });
  fs.writeFileSync(path.join(decoy, "mine.txt"), "a user's own file\n");
  const otherDestination = path.join(parent, "somewhere-else");
  const otherStaging = path.join(parent, ".somewhere-else.abc.tmp");
  fs.mkdirSync(otherStaging, { recursive: true });
  fs.writeFileSync(
    path.join(otherStaging, ".beave-staging.json"),
    `${JSON.stringify({ format: "beave-staging-v1", kind: "export", staging_id: "x", operation_id: null, source: root, destination: otherDestination, phase: "COPYING", pid: 999_999, host: os.hostname(), created_at: "2026-09-12T00:00:00.000Z", updated_at: "2026-09-12T00:00:00.000Z", expected_files: null, expected_manifest_sha256: null }, null, 2)}\n`,
  );

  ok(root, ["project-export", "--project-root", root, "--output-dir", out]);

  assert.ok(fs.existsSync(path.join(decoy, "mine.txt")), "a directory with no Beave marker was removed");
  assert.ok(fs.existsSync(otherStaging), "a staging for another destination was removed");
});

test("an unfinished export is reported by recover and by resume, and cleared on request", (t) => {
  const root = exportable(t);
  const out = path.join(scratch(t), "package");
  crashAt(root, "staging-after-manifest", ["project-export", "--project-root", root, "--output-dir", out]);

  const reported = ok(root, ["recover", "--project-root", root]);
  assert.match(reported, /export to /);
  assert.match(reported, /phase       MANIFEST/);
  assert.match(reported, /would be    discarded/);

  const resumed = ok(root, ["resume", "--project-root", root]);
  assert.match(resumed, /An export did not finish/);
  assert.match(resumed, /an export only ever reads it/);

  ok(root, ["recover", "--project-root", root, "--apply"]);
  assert.doesNotMatch(ok(root, ["recover", "--project-root", root]), /export to /);
  assert.doesNotMatch(ok(root, ["resume", "--project-root", root]), /An export did not finish/);
});

test("an existing destination is never overwritten, and a retry with different input is refused", (t) => {
  const root = exportable(t);
  const out = path.join(scratch(t), "package");
  ok(root, ["project-export", "--project-root", root, "--output-dir", out, "--operation-id", "OP-EXPORT"]);
  const digest = fs.readFileSync(path.join(out, "manifest.json"), "utf8");

  assert.match(refused(root, ["project-export", "--project-root", root, "--output-dir", out]), /Refusing to overwrite existing project package/);
  assert.strictEqual(fs.readFileSync(path.join(out, "manifest.json"), "utf8"), digest, "the existing package was touched");

  const destination = path.join(scratch(t), "delivered");
  ok(root, ["project-import", "--package-dir", out, "--project-root", destination, "--operation-id", "OP-IMPORT"]);
  // The same operation id with the same input is a no-op; with different input
  // it is a different operation wearing the same name.
  const retry = beave(root, ["project-import", "--package-dir", out, "--project-root", destination, "--operation-id", "OP-IMPORT"]);
  assert.strictEqual(retry.status, 0, retry.out);
  assert.match(retry.out, /Idempotent retry/);
  /*
   * The same operation id, different input, *into the same project* is refused —
   * that is where the two share a history to compare against. A different
   * destination is a different project with no events in common, so nothing can
   * cross-check it, and this test says so rather than asserting a guarantee the
   * engine does not make.
   */
  const elsewhere = beave(root, ["project-import", "--package-dir", out, "--project-root", path.join(scratch(t), "other"), "--operation-id", "OP-IMPORT"]);
  assert.strictEqual(elsewhere.status, 0, "an import into a fresh directory shares no history with the first one");

  // An export writes no event into the project, so its operation id is not in
  // the history to be compared against; a mutation's is.
  ok(root, ["decision", "--project-root", root, "--id", "DEC-9", "--title", "Recorded once", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-ONCE"]);
  const conflicting = beave(root, ["decision", "--project-root", root, "--id", "DEC-9", "--title", "Something else", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-ONCE"]);
  assert.notStrictEqual(conflicting.status, 0);
  assert.match(conflicting.out, /already used with different input/);
});

// ---------------------------------------------------------------------------
// The interview and the active module
// ---------------------------------------------------------------------------

const state = (root) => JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
const activeModule = (root) => state(root).modules.find((item) => !["CONFIRMED", "DEFERRED", "NOT APPLICABLE"].includes(item.status));
const entry = (root, id) => state(root).interview_log.find((item) => item.id === id);

function askInActive(root, id, question) {
  return ok(root, ["qa-ask", "--project-root", root, "--id", id, "--question", question, "--rationale", "Because the module needs it.", "--owner", "Ada"]);
}

function answerAndSettle(root, id, text, extra = []) {
  fs.writeFileSync(path.join(root, `${id}.md`), `${text}\n`);
  ok(root, ["qa-answer", "--project-root", root, "--id", id, "--answer-file", path.join(root, `${id}.md`), "--owner", "Ada"]);
  return ok(root, ["qa-settle", "--project-root", root, "--id", id, "--interpretation", "Recorded.", "--reply", "Noted.", "--owner", "Ada", ...extra]);
}

test("a question with no module is recorded against the module the interview is on", (t) => {
  const root = project(t);
  assert.strictEqual(activeModule(root).id, 1);
  askInActive(root, "QNA-0001", "What is this project for?");
  assert.strictEqual(entry(root, "QNA-0001").module, 1, "a question with no module was left with none");
  assert.strictEqual(entry(root, "QNA-0001").crosscutting, false);
});

test("several questions can belong to one module, and the module does not advance on an answer", (t) => {
  const root = project(t);
  askInActive(root, "QNA-0001", "What is this project for?");
  answerAndSettle(root, "QNA-0001", "A neighbourhood bakery.");
  askInActive(root, "QNA-0002", "Who is it for?");
  answerAndSettle(root, "QNA-0002", "The four streets around the square.");

  assert.strictEqual(entry(root, "QNA-0001").module, 1);
  assert.strictEqual(entry(root, "QNA-0002").module, 1);
  assert.strictEqual(activeModule(root).id, 1, "an answer advanced the module on its own");
});

test("the answer that finishes a module closes it in the same operation", (t) => {
  const root = project(t);
  askInActive(root, "QNA-0001", "What is this project for?");
  fs.writeFileSync(path.join(root, "module-1.md"), "A neighbourhood bakery, for the four streets around the square.\n");
  fs.writeFileSync(path.join(root, "QNA-0001.md"), "A neighbourhood bakery.\n");
  ok(root, ["qa-answer", "--project-root", root, "--id", "QNA-0001", "--answer-file", path.join(root, "QNA-0001.md"), "--owner", "Ada"]);

  const before = fs.readFileSync(path.join(root, ".beave", "events.jsonl"), "utf8").trim().split("\n").length;
  const out = ok(root, [
    "qa-settle", "--project-root", root, "--id", "QNA-0001",
    "--interpretation", "Purpose recorded.", "--reply", "Noted.",
    "--complete-module", "CONFIRMED", "--module-answer-file", path.join(root, "module-1.md"),
    "--owner", "Ada",
  ]);
  assert.match(out, /Recorded module 1 as CONFIRMED in the same operation/);

  // One operation, one event: the settlement and the module outcome are one fact.
  const after = fs.readFileSync(path.join(root, ".beave", "events.jsonl"), "utf8").trim().split("\n");
  assert.strictEqual(after.length, before + 1, "the module outcome was written as a second event");
  assert.strictEqual(JSON.parse(after[after.length - 1]).module_completed.id, 1);

  assert.strictEqual(state(root).modules[1].status, "CONFIRMED");
  assert.strictEqual(activeModule(root).id, 2, "the module did not advance when it was recorded");
  assert.strictEqual(beave(root, ["replay", "--project-root", root]).status, 0);
  assert.strictEqual(beave(root, ["validate", "--project-root", root]).status, 0);
});

test("a question against a module the interview has not reached is refused, and says what to do", (t) => {
  const root = project(t);
  const out = refused(root, [
    "qa-ask", "--project-root", root, "--id", "QNA-0001", "--question", "How many benches?",
    "--rationale", "Sizing.", "--module", "2", "--owner", "Ada",
  ]);
  assert.match(out, /not the module this interview is on \(1 —/);
  assert.match(out, /makes the earlier ones look settled when they are not/);
  assert.match(out, /--crosscutting --crosscutting-reason/);
  assert.match(out, /record it first with/);
  assert.match(out, /Nothing was written/);
  assert.strictEqual(state(root).interview_log.length, 0);
});

test("a crosscutting question is allowed when it says why, and Resume shows it as a detour", (t) => {
  const root = project(t);
  ok(root, [
    "qa-ask", "--project-root", root, "--id", "QNA-0001", "--question", "Who signs the lease?",
    "--rationale", "It blocks everything downstream.", "--module", "2",
    "--crosscutting", "--crosscutting-reason", "The lease deadline is next week and it decides whether there is a project at all",
    "--owner", "Ada",
  ]);
  const recorded = entry(root, "QNA-0001");
  assert.strictEqual(recorded.module, 2);
  assert.strictEqual(recorded.crosscutting, true);
  assert.match(recorded.crosscutting_reason, /lease deadline/);

  // The active module has not moved, and Resume says the detour is a detour.
  assert.strictEqual(activeModule(root).id, 1);
  const resumed = ok(root, ["resume", "--project-root", root]);
  assert.match(resumed, /asked outside the module the interview is on/);
  assert.match(resumed, /do not mean the earlier modules are finished/);
  assert.match(resumed, /QNA-0001 on module 2: The lease deadline/);

  // And so does the document a reader opens without any tool.
  const document = fs.readFileSync(path.join(root, "QUESTION_ANSWER_HISTORY.md"), "utf8");
  assert.match(document, /asked outside the module the interview was on/);
  assert.match(document, /Why it was asked there: The lease deadline/);
});

test("a detour cannot close the module it detoured into, and neither flag works alone", (t) => {
  const root = project(t);
  ok(root, [
    "qa-ask", "--project-root", root, "--id", "QNA-0001", "--question", "Who signs the lease?",
    "--rationale", "It blocks everything.", "--module", "2",
    "--crosscutting", "--crosscutting-reason", "The lease decides whether there is a project",
    "--owner", "Ada",
  ]);
  fs.writeFileSync(path.join(root, "a.md"), "The parish council.\n");
  fs.writeFileSync(path.join(root, "m.md"), "Module evidence.\n");
  ok(root, ["qa-answer", "--project-root", root, "--id", "QNA-0001", "--answer-file", path.join(root, "a.md"), "--owner", "Ada"]);

  const out = refused(root, [
    "qa-settle", "--project-root", root, "--id", "QNA-0001", "--interpretation", "x", "--reply", "y",
    "--complete-module", "CONFIRMED", "--module-answer-file", path.join(root, "m.md"), "--owner", "Ada",
  ]);
  assert.match(out, /crosscutting question/);
  assert.match(out, /A detour does not close the module it detoured into/);

  // Half the pair is refused too.
  const half = refused(root, [
    "qa-settle", "--project-root", root, "--id", "QNA-0001", "--interpretation", "x", "--reply", "y",
    "--complete-module", "CONFIRMED", "--owner", "Ada",
  ]);
  assert.match(half, /go together/);

  // `--crosscutting` on the active module describes nothing, and says so. Its
  // own project, because this one has an answer waiting to be settled and
  // `qa-ask` refuses that first — for a good reason that is not this one.
  const other = project(t, "Pointless");
  const pointless = refused(other, [
    "qa-ask", "--project-root", other, "--id", "QNA-0009", "--question", "x", "--rationale", "y",
    "--module", "1", "--crosscutting", "--crosscutting-reason", "z", "--owner", "Ada",
  ]);
  assert.match(pointless, /describes nothing/);
});

test("a module cannot be skipped in silence: the interview stays where the record says it is", (t) => {
  const root = project(t);
  askInActive(root, "QNA-0001", "What is this project for?");
  answerAndSettle(root, "QNA-0001", "A neighbourhood bakery.");

  // Module 1 is not recorded, so module 2 is not reachable without saying so.
  assert.strictEqual(activeModule(root).id, 1);
  refused(root, ["qa-ask", "--project-root", root, "--id", "QNA-0002", "--question", "Who are the users?", "--rationale", "Module 2.", "--module", "2", "--owner", "Ada"]);
  assert.strictEqual(state(root).interview_log.length, 1);
});

test("an interruption while a settlement completes a module loses neither", (t) => {
  const root = project(t);
  askInActive(root, "QNA-0001", "What is this project for?");
  fs.writeFileSync(path.join(root, "a.md"), "A neighbourhood bakery.\n");
  fs.writeFileSync(path.join(root, "m.md"), "Module evidence.\n");
  ok(root, ["qa-answer", "--project-root", root, "--id", "QNA-0001", "--answer-file", path.join(root, "a.md"), "--owner", "Ada"]);

  crashAt(root, "after-state", [
    "qa-settle", "--project-root", root, "--id", "QNA-0001", "--interpretation", "Purpose recorded.", "--reply", "Noted.",
    "--complete-module", "CONFIRMED", "--module-answer-file", path.join(root, "m.md"), "--owner", "Ada", "--operation-id", "OP-SETTLE",
  ]);

  assert.strictEqual(beave(root, ["validate", "--project-root", root]).status, 0);
  assert.ok(entry(root, "QNA-0001").consequences_recorded_at, "the settlement was lost");
  assert.strictEqual(state(root).modules[1].status, "CONFIRMED", "the module outcome was lost while the settlement survived");
  assert.strictEqual(activeModule(root).id, 2);
  assert.strictEqual(beave(root, ["replay", "--project-root", root]).status, 0);
});

// ---------------------------------------------------------------------------
// The BOM
// ---------------------------------------------------------------------------

function ownersFile(root, { bom = false, text = null } = {}) {
  const body = text ?? JSON.stringify({ product: "Ada", technical: "Ada", budget: "Ada", safety: "Ada", release: "Ada" }, null, 2);
  const file = path.join(root, "owners.json");
  // Byte for byte what `Set-Content -Encoding utf8` produces on Windows
  // PowerShell 5.1: EF BB BF and then the text.
  fs.writeFileSync(file, bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body, "utf8")]) : Buffer.from(body, "utf8"));
  return file;
}

function initWith(root, file) {
  return beave(root, [
    "init", "--project-root", root, "--project-name", "BOM",
    "--project-mode", "Resume", "--interaction-mode", "Standard", "--owners-file", file,
  ]);
}

test("owners.json without a BOM works, and with the BOM PowerShell writes it works too", (t) => {
  const plain = path.join(scratch(t), "plain");
  fs.mkdirSync(plain, { recursive: true });
  assert.strictEqual(initWith(plain, ownersFile(plain)).status, 0);

  const withBom = path.join(scratch(t), "with-bom");
  fs.mkdirSync(withBom, { recursive: true });
  const file = ownersFile(withBom, { bom: true });
  assert.deepStrictEqual([...fs.readFileSync(file).subarray(0, 3)], [0xef, 0xbb, 0xbf], "the fixture has no BOM, so it proves nothing");
  const result = initWith(withBom, file);
  assert.strictEqual(result.status, 0, `the first command a Windows user runs still fails:\n${result.out}`);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(withBom, ".beave", "state.json"), "utf8")).decision_owners.product, "Ada");
});

test("the BOM is tolerated and nothing else is", (t) => {
  // Invalid JSON after the BOM is still invalid.
  const broken = path.join(scratch(t), "broken");
  fs.mkdirSync(broken, { recursive: true });
  const brokenResult = initWith(broken, ownersFile(broken, { bom: true, text: '{"product": "Ada",,}' }));
  assert.notStrictEqual(brokenResult.status, 0);
  assert.match(brokenResult.out, /Cannot read JSON/);

  // A BOM anywhere but the start is a character in the middle of a document.
  const inner = path.join(scratch(t), "inner");
  fs.mkdirSync(inner, { recursive: true });
  const innerFile = path.join(inner, "owners.json");
  fs.writeFileSync(innerFile, Buffer.concat([Buffer.from('{"product":', "utf8"), Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('"Ada"}', "utf8")]));
  const innerResult = initWith(inner, innerFile);
  assert.notStrictEqual(innerResult.status, 0);
  assert.match(innerResult.out, /Cannot read JSON/);

  // Two marks: one is an artefact, two is damage.
  const twice = path.join(scratch(t), "twice");
  fs.mkdirSync(twice, { recursive: true });
  const twiceFile = path.join(twice, "owners.json");
  fs.writeFileSync(twiceFile, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify({ product: "Ada" }), "utf8")]));
  assert.notStrictEqual(initWith(twice, twiceFile).status, 0);
});

test("a BOM does not stop the names inside from being what they are", (t) => {
  const root = path.join(scratch(t), "unicode");
  fs.mkdirSync(root, { recursive: true });
  const owners = { product: "Ada Moreau", technical: "Søren Kjær", budget: "李明", safety: "Ada Moreau", release: "Zoë O'Brien" };
  const file = ownersFile(root, { bom: true, text: JSON.stringify(owners, null, 2) });
  assert.strictEqual(initWith(root, file).status, 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8")).decision_owners, owners);
});

// ---------------------------------------------------------------------------
// What the second independent review reproduced, 2026-09-12
// ---------------------------------------------------------------------------

test("an interrupted init leaves a project the next command reports as valid", (t) => {
  const root = path.join(scratch(t), "interrupted-init");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "owners.json"),
    JSON.stringify({ product: "Ada", technical: "Ada", budget: "Ada", safety: "Ada", release: "Ada" }),
  );
  const args = [
    "init", "--project-root", root, "--project-name", "Interrupted",
    "--project-mode", "Resume", "--interaction-mode", "Standard",
    "--owners-file", path.join(root, "owners.json"), "--operation-id", "OP-INIT",
  ];

  /*
   * `init` was the one command that wrote a derived document without telling the
   * journal so. The recovery rolled the state forward and skipped the document,
   * and the retry then said `Idempotent retry: init already applied.` and exited
   * 0 over a project `validate` refused — a false success on the very first
   * command a user runs.
   */
  crashAt(root, "after-events", args);
  const retry = beave(root, args);
  assert.strictEqual(retry.status, 0, retry.out);
  assert.match(retry.out, /Idempotent retry/);

  const validated = beave(root, ["validate", "--project-root", root]);
  assert.strictEqual(validated.status, 0, `the project the retry called finished is not valid:\n${validated.out}`);
  assert.ok(fs.existsSync(path.join(root, "QUESTION_ANSWER_HISTORY.md")), "the derived document was never written");
  assert.strictEqual(beave(root, ["replay", "--project-root", root]).status, 0);
});

for (const label of ["after-staged", "before-commit", "after-events", "after-state", "after-commit"]) {
  test(`an init killed at ${label} comes back valid, document and all`, (t) => {
    const root = path.join(scratch(t), `init-${label}`);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, "owners.json"),
      JSON.stringify({ product: "Ada", technical: "Ada", budget: "Ada", safety: "Ada", release: "Ada" }),
    );
    crashAt(root, label, [
      "init", "--project-root", root, "--project-name", "Killed",
      "--project-mode", "Resume", "--interaction-mode", "Standard",
      "--owners-file", path.join(root, "owners.json"), "--operation-id", "OP-INIT",
    ]);

    const validated = beave(root, ["validate", "--project-root", root]);
    if (fs.existsSync(path.join(root, ".beave", "state.json"))) {
      assert.strictEqual(validated.status, 0, `killed at ${label}:\n${validated.out}`);
      assert.ok(fs.existsSync(path.join(root, "QUESTION_ANSWER_HISTORY.md")));
    }
  });
}

test("a package carries nothing its manifest does not declare", (t) => {
  const root = exportable(t);
  const out = path.join(scratch(t), "clean-package");
  ok(root, ["project-export", "--project-root", root, "--output-dir", out]);

  /*
   * Every package used to carry `backups/.beave-staging.json.*.bak`: the marker
   * was written with `atomicWrite`, which keeps a copy of what it replaces, and
   * the copies were inside the directory that then became the package. A handoff
   * shipped the exporter's hostname, PID and absolute paths in files the
   * manifest never mentioned.
   */
  const manifest = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
  const declared = new Set(manifest.files.map((item) => item.path));
  const onDisk = [];
  const walk = (directory, prefix) => {
    for (const entry of fs.readdirSync(directory).sort()) {
      const candidate = path.join(directory, entry);
      const relative = prefix ? `${prefix}/${entry}` : entry;
      if (fs.statSync(candidate).isDirectory()) walk(candidate, relative);
      else onDisk.push(relative);
    }
  };
  walk(out, "");
  const undeclared = onDisk.filter((relative) => relative !== "manifest.json" && !declared.has(relative));
  assert.deepStrictEqual(undeclared, [], "the package carries files its manifest does not declare");

  // And nothing anywhere in it names this machine.
  for (const relative of onDisk) {
    const body = fs.readFileSync(path.join(out, relative), "utf8");
    assert.ok(!body.includes(os.hostname()), `${relative} carries the exporter's hostname`);
  }
});

test("project-verify refuses a file the manifest does not declare, wherever it is", (t) => {
  const root = exportable(t);
  for (const [index, relative] of ["EVIL.md", "files/EVIL.md", "history/ART-9-v7.md"].entries()) {
    const out = path.join(scratch(t), `tampered-${index}`);
    ok(root, ["project-export", "--project-root", root, "--output-dir", out]);
    assert.strictEqual(beave(root, ["project-verify", "--package-dir", out]).status, 0, "the clean package did not verify");

    fs.mkdirSync(path.dirname(path.join(out, relative)), { recursive: true });
    fs.writeFileSync(path.join(out, relative), "added after the export\n");
    const verified = beave(root, ["project-verify", "--package-dir", out]);
    assert.notStrictEqual(verified.status, 0, `an added ${relative} was accepted`);
    assert.match(verified.out, /manifest does not declare/);
    assert.match(verified.out, new RegExp(relative.replace(/[/.]/g, "\\$&")));
  }
});

test("a staging directory is not a package, and neither verify nor import will take it", (t) => {
  const root = exportable(t);
  const out = path.join(scratch(t), "never-promoted");
  const parent = path.dirname(out);
  crashAt(root, "staging-before-rename", ["project-export", "--project-root", root, "--output-dir", out]);

  const staging = fs.readdirSync(parent).map((entry) => path.join(parent, entry)).find((candidate) => fs.existsSync(path.join(candidate, ".beave-staging.json")));
  assert.ok(staging, "the interrupted export left no staging directory to test with");

  const verified = beave(root, ["project-verify", "--package-dir", staging]);
  assert.notStrictEqual(verified.status, 0, "a staging directory verified as a package");
  assert.match(verified.out, /is a Beave staging directory, not a package/);
  assert.match(verified.out, /never finished/);

  const imported = beave(root, ["project-import", "--package-dir", staging, "--project-root", path.join(scratch(t), "from-staging")]);
  assert.notStrictEqual(imported.status, 0, "a staging directory was imported as a project");
  assert.match(imported.out, /not a package/);
  assert.ok(!fs.existsSync(path.join(scratch(t), "from-staging")));
});

test("the natural retry clears the marker an interrupted promotion left behind", (t) => {
  const root = exportable(t);
  const pkg = path.join(scratch(t), "pkg-for-retry");
  ok(root, ["project-export", "--project-root", root, "--output-dir", pkg]);
  const destination = path.join(scratch(t), "delivered-retry");

  crashAt(root, "staging-after-rename", ["project-import", "--package-dir", pkg, "--project-root", destination, "--operation-id", "OP-RETRY"]);
  const stray = path.join(destination, ".beave-staging.json");
  assert.ok(fs.existsSync(stray), "the fixture did not produce the leftover marker");

  /*
   * The retry the contract teaches — same operation id — used to answer
   * `Idempotent retry` and return before the code that recognises the marker,
   * so the file stayed there for ever. The resolution runs first now.
   */
  const retry = beave(root, ["project-import", "--package-dir", pkg, "--project-root", destination, "--operation-id", "OP-RETRY"]);
  assert.strictEqual(retry.status, 0, retry.out);
  assert.ok(!fs.existsSync(stray), "the natural retry left the marker in place");
  assert.strictEqual(beave(destination, ["validate", "--project-root", destination]).status, 0);
});

test("re-exporting to the same destination clears the marker before it refuses", (t) => {
  const root = exportable(t);
  const out = path.join(scratch(t), "pkg-same-destination");
  crashAt(root, "staging-after-rename", ["project-export", "--project-root", root, "--output-dir", out]);
  const stray = path.join(out, ".beave-staging.json");
  assert.ok(fs.existsSync(stray));

  // The refusal is right — the package is there — but it used to happen before
  // any recovery, so the only command that recognises the marker never reached it.
  const again = beave(root, ["project-export", "--project-root", root, "--output-dir", out]);
  assert.notStrictEqual(again.status, 0);
  assert.match(again.out, /Refusing to overwrite existing project package/);
  assert.ok(!fs.existsSync(stray), "the marker survived a re-export to the same destination");
  assert.strictEqual(beave(root, ["project-verify", "--package-dir", out]).status, 0);
});

test("a command leaves no permanent backup of the files that exist only while it runs", (t) => {
  const root = project(t, "NoLitter");
  const backups = path.join(root, ".beave", "backups");
  for (let index = 0; index < 8; index += 1) ok(root, ["status", "--project-root", root]);

  const litter = (fs.existsSync(backups) ? fs.readdirSync(backups) : []).filter(
    (entry) => entry.startsWith("lock.json") || entry.startsWith(".beave-staging.json") || entry.startsWith("journal.json"),
  );
  /*
   * `noteObservedRevision` rewrote the lock through `atomicWrite`, which keeps a
   * copy of what it replaces — one per command, for ever, of a file that holds
   * no project data. The same mechanism put the staging marker's backups inside
   * every package.
   */
  assert.deepStrictEqual(litter, [], "a transient file is being backed up on every command");
});

// ---------------------------------------------------------------------------
// What the third independent review reproduced, 2026-09-12
// ---------------------------------------------------------------------------

test("project-import refuses a file the manifest does not declare, wherever it is", (t) => {
  const root = exportable(t);
  /*
   * The check existed, in the command that reports rather than the command that
   * acts. `project-verify` refused a rogue file in seven positions; `project-
   * import` accepted it in all seven and then said `Beave state is valid.` -- a
   * false success on the trust boundary the verifier exists to guard.
   */
  for (const [index, relative] of ["rogue.txt", "files/rogue.md", "files/docs/.hidden", "history/ART-9-v7.md", "state/extra.json", "deep/nested/payload.bin"].entries()) {
    const out = path.join(scratch(t), `rogue-${index}`);
    ok(root, ["project-export", "--project-root", root, "--output-dir", out]);
    fs.mkdirSync(path.dirname(path.join(out, relative)), { recursive: true });
    fs.writeFileSync(path.join(out, relative), "added after the export\n");

    const destination = path.join(scratch(t), `from-rogue-${index}`);
    const imported = beave(root, ["project-import", "--package-dir", out, "--project-root", destination]);
    assert.notStrictEqual(imported.status, 0, `an added ${relative} was imported`);
    assert.match(imported.out, /manifest does not declare/);
    assert.ok(!fs.existsSync(destination), "the refused import created the destination anyway");
  }
});

test("the marker a crash leaves in a finished package makes both verify and import refuse it", (t) => {
  const root = exportable(t);
  const out = path.join(scratch(t), "pkg-with-marker");
  crashAt(root, "staging-after-rename", ["project-export", "--project-root", root, "--output-dir", out]);
  const marker = path.join(out, ".beave-staging.json");
  assert.ok(fs.existsSync(marker), "the fixture did not leave the marker");

  /*
   * This test used to assert the opposite, on the reasoning that refusing would
   * turn a recoverable crash into a package nobody can accept. The fourth review
   * read the file: it holds the exporting machine's absolute paths, its hostname
   * and the PID of the process that made it — the disclosure ALN-014 exists to
   * prevent — and `project-verify` was calling it harmless. A recoverable crash
   * is exactly what it is; the recovery is one command, and until it has run the
   * package is not something to hand to somebody.
   */
  const body = JSON.parse(fs.readFileSync(marker, "utf8"));
  assert.ok(body.host && body.pid, "the marker no longer carries host data; this test is testing nothing");

  const verified = beave(root, ["project-verify", "--package-dir", out]);
  assert.notStrictEqual(verified.status, 0, "a package carrying the exporter's hostname and PID verified");
  assert.match(verified.out, /records the exporting machine/);

  const destination = path.join(scratch(t), "from-marked");
  const imported = beave(root, ["project-import", "--package-dir", out, "--project-root", destination]);
  assert.notStrictEqual(imported.status, 0, "a package carrying the exporter's hostname and PID imported");
  assert.ok(!fs.existsSync(destination));

  // Cleared where it was made, the same package is fine.
  ok(root, ["recover", "--project-root", root, "--apply"]);
  assert.ok(!fs.existsSync(marker));
  ok(root, ["project-verify", "--package-dir", out]);
  ok(root, ["project-import", "--package-dir", out, "--project-root", destination]);
  assert.strictEqual(beave(destination, ["validate", "--project-root", destination]).status, 0);
});

test("status refuses a project whose state does not agree with its history", (t) => {
  const root = project(t, "Divergent");
  const location = path.join(root, ".beave", "state.json");
  const state = JSON.parse(fs.readFileSync(location, "utf8"));
  state.exact_next_action = "edited by hand";
  fs.writeFileSync(location, JSON.stringify(state, null, 2));

  /*
   * `validate`, `resume` and `replay --verify` all exit 2 on this project.
   * `status` printed the edited state's own account of itself as fact and exited
   * 0 -- the last command in the family, found by a third review beside the
   * areas it had been asked to look at.
   */
  const reported = beave(root, ["status", "--project-root", root]);
  assert.strictEqual(reported.status, 2, reported.out);
  assert.match(reported.out, /does not agree with its history/);
  assert.match(reported.out, /replay --project-root . --repair/);
  assert.strictEqual(beave(root, ["validate", "--project-root", root]).status, 2);
});

// ---------------------------------------------------------------------------
// What the fourth fresh-agent pilot found, 2026-09-12
// ---------------------------------------------------------------------------

test("the recorded next action names the questions that are actually open", (t) => {
  const root = project(t, "Choir");
  const ask = (id, question) => ok(root, [
    "qa-ask", "--project-root", root, "--id", id, "--question", question,
    "--rationale", "It decides what the project is for.", "--owner", "Ada",
  ]);

  /*
   * A pilot opened two questions and `resume` then printed, as its highest
   * priority instruction, "Continue the interview from QNA-0001; no next
   * question is recorded yet" — false, two paragraphs above the list of the two
   * that were open. Resume's precedence puts the recorded action above an open
   * question, so a field nothing had updated beat a live fact of the ledger.
   */
  ask("QNA-0001", "What is this for, in one sentence?");
  const afterOne = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
  assert.match(afterOne.exact_next_action, /^Answer the open question \(QNA-0001\) with beave qa-answer/);

  ask("QNA-0002", "Who is it for, and why now?");
  const afterTwo = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
  assert.match(afterTwo.exact_next_action, /^Answer the open questions \(QNA-0001, QNA-0002\) with beave qa-answer, then settle each/);

  const resumed = beave(root, ["resume", "--project-root", root]);
  assert.strictEqual(resumed.status, 0, resumed.out);
  assert.match(resumed.out, /QNA-0001, QNA-0002/);
  assert.doesNotMatch(resumed.out, /no next question is recorded yet/);
  assert.strictEqual(beave(root, ["validate", "--project-root", root]).status, 0);
});

test("qa-ask does not overwrite a next action a person wrote", (t) => {
  const root = project(t, "Choir2");
  ok(root, [
    "checkpoint", "--project-root", root, "--id", "CHK-0001", "--name", "Before the interview",
    "--owner", "Ada", "--next-action", "Ask Nadia about the hall booking before anything else.",
  ]);

  const asked = beave(root, [
    "qa-ask", "--project-root", root, "--id", "QNA-0001", "--question", "What is this for?",
    "--rationale", "It decides what the project is for.", "--owner", "Ada",
  ]);
  assert.strictEqual(asked.status, 0, asked.out);
  // Kept, and the sentence it would have written is offered rather than applied.
  assert.match(asked.out, /written by a person, so it is kept unchanged/);
  assert.match(asked.out, /Suggested instead: Answer the open question \(QNA-0001\)/);
  const state = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
  assert.strictEqual(state.exact_next_action, "Ask Nadia about the hall booking before anything else.");
});

// ---------------------------------------------------------------------------
// What the fifth fresh-agent pilot read, 2026-09-12
// ---------------------------------------------------------------------------

test("the engine recognises its own sentence, so a settled question does not freeze the next action", (t) => {
  const root = project(t, "OwnSentence");
  const ask = (id, question) => ok(root, [
    "qa-ask", "--project-root", root, "--id", id, "--question", question,
    "--rationale", "It decides what the project is for.", "--owner", "Ada",
  ]);

  ask("QNA-0001", "How many people can tend it each week?");
  ok(root, ["qa-answer", "--project-root", root, "--id", "QNA-0001", "--answer", "Five, plus two at weekends.", "--owner", "Ada"]);
  ok(root, [
    "qa-settle", "--project-root", root, "--id", "QNA-0001",
    "--interpretation", "Five in the week, two at weekends.",
    "--reply", "Recorded.", "--owner", "Ada",
  ]);

  /*
   * `qa-settle` writes "Continue the interview from QNA-0001; no next question
   * is recorded yet." and that sentence was missing from the list of the
   * engine's own. So the next `qa-ask` treated it as a person's, refused to move
   * it, and a fresh agent read a context pack that said at the top that no next
   * question was recorded and twenty lines below that QNA-0002 was.
   */
  /*
   * The sentence is read off the ledger now, so settling the only open question
   * says the interview has nothing open — which is true — instead of "no next
   * question is recorded yet", which was true only here and false whenever
   * other questions were open. The bounded check found it saying that with
   * three open.
   */
  const settled = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
  assert.match(settled.exact_next_action, /^The interview has nothing open\./);

  ask("QNA-0002", "What is it for, in one sentence?");
  const after = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
  assert.match(after.exact_next_action, /^Answer the open question \(QNA-0002\) with beave qa-answer/);

  const resumed = beave(root, ["resume", "--project-root", root]);
  assert.strictEqual(resumed.status, 0, resumed.out);
  assert.doesNotMatch(resumed.out, /no next question is recorded yet/);
});


// ---------------------------------------------------------------------------
// The recorded next action, and the engine's own handwriting
// ---------------------------------------------------------------------------

test("settling one question while others are open does not announce that none are", (t) => {
  const root = project(t, "StillOpen");
  const ask = (id, question) => ok(root, [
    "qa-ask", "--project-root", root, "--id", id, "--question", question,
    "--rationale", "It decides what the project is for.", "--owner", "Ada",
  ]);
  ask("QNA-0001", "What is it for?");
  ask("QNA-0002", "Who is it for?");
  ask("QNA-0003", "Why now?");
  ok(root, ["qa-answer", "--project-root", root, "--id", "QNA-0001", "--answer", "For the neighbourhood.", "--owner", "Ada"]);
  ok(root, [
    "qa-settle", "--project-root", root, "--id", "QNA-0001",
    "--interpretation", "For the neighbourhood.", "--reply", "Recorded.", "--owner", "Ada",
  ]);

  /*
   * It used to say "Continue the interview from QNA-0001; no next question is
   * recorded yet" — read off that one entry and nothing else — while `resume`
   * listed QNA-0002 and QNA-0003 fifty lines below. Adding the sentence to the
   * list of the engine's own made it replaceable; it did not make it true.
   */
  const state = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
  assert.match(state.exact_next_action, /^Answer the open questions \(QNA-0002, QNA-0003\)/);
  const resumed = ok(root, ["resume", "--project-root", root]);
  assert.doesNotMatch(resumed, /no next question is recorded yet/);
});

test("closing or superseding a question moves the recorded action off it", (t) => {
  const root = project(t, "ClosedOff");
  const ask = (id, question) => ok(root, [
    "qa-ask", "--project-root", root, "--id", id, "--question", question,
    "--rationale", "It decides what the project is for.", "--owner", "Ada",
  ]);
  ask("QNA-0001", "What is it for?");
  ask("QNA-0002", "Who is it for?");

  ok(root, ["qa-close", "--project-root", root, "--id", "QNA-0001", "--kind", "deferred", "--reason", "waiting on legal", "--owner", "Ada"]);
  let state = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
  assert.doesNotMatch(state.exact_next_action, /QNA-0001/, "the action still names a question that can no longer be answered");
  assert.match(state.exact_next_action, /QNA-0002/);

  ok(root, [
    "qa-supersede", "--project-root", root, "--id", "QNA-0002", "--new-id", "QNA-0009",
    "--question", "Who exactly is it for?", "--rationale", "The first was too vague.",
    "--reason", "unclear", "--owner", "Ada",
  ]);
  state = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
  assert.match(state.exact_next_action, /QNA-0009/);
  assert.doesNotMatch(state.exact_next_action, /QNA-0002/);

  // And the instruction can be obeyed, which is the point of recording one.
  ok(root, ["qa-answer", "--project-root", root, "--id", "QNA-0009", "--answer", "The families on the street.", "--owner", "Ada"]);
});

test("the engine recognises its own handwriting whatever the caller wrote in it", (t) => {
  const root = project(t, "OwnHandwriting");

  /*
   * Three ways the sentence escaped the list of the engine's own, all found by
   * one bounded check: a five-digit question id (`QNA-\d{4}` did not match
   * `QNA-10000`), a multi-line `--next-question`, and a multi-line gate
   * consequence — `.*` does not cross a newline. Each froze the recorded action
   * for ever, with the engine stating that a person had written it.
   */
  ok(root, ["qa-ask", "--project-root", root, "--id", "QNA-10000", "--question", "A five digit id?", "--rationale", "Ids may be longer than four digits.", "--owner", "Ada"]);
  const asked = ok(root, ["qa-ask", "--project-root", root, "--id", "QNA-10001", "--question", "And another?", "--rationale", "Same reason.", "--owner", "Ada"]);
  assert.doesNotMatch(asked, /written by a person/, "the engine did not recognise a sentence it had written one command earlier");
  let state = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
  assert.match(state.exact_next_action, /QNA-10000, QNA-10001/);

  // A multi-line follow-up question is flattened into one line, and stays the
  // engine's own.
  ok(root, ["qa-answer", "--project-root", root, "--id", "QNA-10000", "--answer", "Yes.", "--owner", "Ada"]);
  ok(root, [
    "qa-settle", "--project-root", root, "--id", "QNA-10000",
    "--interpretation", "Yes.", "--reply", "Recorded.", "--owner", "Ada",
    "--next-id", "QNA-10002", "--next-question", "Line one?\nLine two?", "--next-rationale", "It has two parts.",
  ]);
  state = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
  assert.doesNotMatch(state.exact_next_action, /\n/, "a newline reached the recorded next action");
  assert.match(state.exact_next_action, /^Ask QNA-10002: Line one\? Line two\?$/);

  const next = ok(root, ["qa-ask", "--project-root", root, "--id", "QNA-10003", "--question", "A third?", "--rationale", "Same reason.", "--owner", "Ada"]);
  assert.doesNotMatch(next, /written by a person/, "a flattened sentence was still read as a person's");
});

test("a sentence a person wrote survives all of this", (t) => {
  const root = project(t, "HumanSentence");
  ok(root, [
    "checkpoint", "--project-root", root, "--id", "CHK-0001", "--name", "Before the interview",
    "--owner", "Ada", "--next-action", "Ask Nadia about the hall booking before anything else.",
  ]);
  const human = "Ask Nadia about the hall booking before anything else.";

  for (const command of [
    ["qa-ask", "--project-root", root, "--id", "QNA-0001", "--question", "What is it for?", "--rationale", "Purpose.", "--owner", "Ada"],
  ]) {
    const out = ok(root, command);
    assert.match(out, /written by a person, so it is kept unchanged/);
  }
  ok(root, ["qa-close", "--project-root", root, "--id", "QNA-0001", "--kind", "deferred", "--reason", "later", "--owner", "Ada"]);

  const state = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
  assert.strictEqual(state.exact_next_action, human, "a person's sentence was overwritten");
});

test("a gate condition spanning two lines does not break the recorded next action", (t) => {
  const root = project(t, "GateWarn");
  fs.writeFileSync(path.join(root, "module-1.md"), "Confirmed purpose and boundaries.\n");
  ok(root, ["record", "--project-root", root, "--module", "1", "--status", "CONFIRMED", "--answer-file", path.join(root, "module-1.md"), "--owner", "Ada"]);
  fs.writeFileSync(path.join(root, "evidence.md"), "what was checked\n");

  /*
   * `--consequence` is free text from a caller, and it went into the recorded
   * next action verbatim. A newline in it broke the `- Exact next action:` item
   * in `resume` and the context pack, spilling the rest into a bare paragraph —
   * and, before the patterns were widened, made the engine call its own sentence
   * a person's. The re-check of that fix found this branch still unflattened
   * while the one with no free text in it had been done.
   */
  ok(root, [
    "gate", "--project-root", root, "--id", "G1", "--status", "WARN",
    "--evidence-file", path.join(root, "evidence.md"), "--owner", "Ada",
    "--consequence", "First line of the condition.\nSecond line.",
    "--review-date", "2026-12-01",
  ]);

  const state = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
  assert.doesNotMatch(state.exact_next_action, /\n/, "a newline reached the recorded next action");
  assert.match(state.exact_next_action, /First line of the condition\. Second line\.$/);

  // One list item, not two.
  const resumed = ok(root, ["resume", "--project-root", root]);
  const line = resumed.split(/\r?\n/).find((item) => item.startsWith("- Exact next action:"));
  assert.ok(line.includes("Second line."), "the recorded action was split across lines in the report");

  // And it is still the engine's own sentence, so the next command may move it.
  const moved = ok(root, ["qa-ask", "--project-root", root, "--id", "QNA-0001", "--question", "What next?", "--rationale", "It decides the plan.", "--owner", "Ada"]);
  assert.doesNotMatch(moved, /written by a person/);
});
