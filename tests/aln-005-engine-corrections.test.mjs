import { describe, it } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ageProject } from "./older-engine.mjs";

/**
 * The engine corrections the ALN-005 pilots demonstrated.
 *
 * Every test here exists because a real pilot ran a real command and got an
 * answer the product should not have given. None of them is a restatement of the
 * implementation: each one fails on the pre-correction engine, for the reason the
 * pilot reported.
 *
 * Evidence: `docs/evidence/ALN005_HANDOFF_PILOTS_2026-09-10.md`.
 */

const CLI = path.resolve("lib/bin/beave.js");
const owners = { product: "A", technical: "B", budget: "C", safety: "D", release: "E" };

function run(args, cwd) {
  const mutating = [
    "record", "override", "reconcile", "decision", "requirement", "task", "dependency",
    "risk", "evidence", "agent", "checkpoint", "gate", "doc-save", "doc-mark-deletion",
    "doc-restore", "doc-finalize",
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

function project(name = "ALN005") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-aln005-"));
  fs.writeFileSync(path.join(root, "owners.json"), JSON.stringify(owners));
  const result = run([
    "init", "--project-root", ".", "--project-name", name, "--project-mode", "Genesis",
    "--interaction-mode", "Standard", "--owners-file", "owners.json",
    "--operation-id", `OP-init-${name.replace(/[^A-Za-z0-9._:-]/g, "-")}`,
  ], root);
  assert.strictEqual(result.status, 0, result.stderr);
  return root;
}

describe("ALN-005 engine corrections", () => {
  it("refuses an option it cannot store instead of dropping it", () => {
    const root = project("Options");
    // Pilot B: `task --description … --acceptance … --blocking-point …` printed
    // "Created task" and stored the title. The rest went nowhere and the user was
    // never told.
    const result = run([
      "task", "--project-root", ".", "--id", "TSK-1", "--title", "Do the thing",
      "--status", "READY", "--owner", "A", "--description", "half the specification",
    ], root);
    assert.strictEqual(result.status, 2, result.stdout);
    assert.match(result.stderr, /Unknown option for task: --description/);
    assert.match(result.stderr, /Nothing was written/);
    const state = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
    assert.deepEqual(state.tasks, [], "nothing may be written when an option is refused");
  });

  it("still accepts the caller-identity options on every command", () => {
    const root = project("Universal");
    // `--operation-id` on a read, and `--idempotency-key` as a deliberate
    // distinguisher, are not command input and must keep working: an option list
    // that refused them would break previewing a save with the save's own
    // arguments, and break making a second identical operation distinct.
    assert.strictEqual(run(["status", "--project-root", ".", "--operation-id", "OP-read"], root).status, 0);
    assert.strictEqual(
      run(["decision", "--project-root", ".", "--id", "DEC-1", "--title", "T", "--status", "APPROVED", "--owner", "A", "--idempotency-key", "distinct"], root).status,
      0,
    );
  });

  it("refuses a repeated option instead of keeping the last value", () => {
    const root = project("Repeated");
    for (const id of ["DEC-1", "DEC-2"]) {
      assert.strictEqual(
        run(["decision", "--project-root", ".", "--id", id, "--title", "T", "--status", "APPROVED", "--owner", "A"], root).status,
        0,
      );
    }
    fs.writeFileSync(path.join(root, "a.md"), "alpha\n");
    // `--sources DEC-1 --sources DEC-2` used to record provenance on DEC-2 alone
    // and report success. A list belongs in one comma-separated value, which does
    // work and is asserted below.
    const repeated = run([
      "doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/s.md",
      "--content-file", "a.md", "--owner", "A", "--sources", "DEC-1", "--sources", "DEC-2",
    ], root);
    assert.strictEqual(repeated.status, 2, repeated.stdout);
    assert.match(repeated.stderr, /--sources was given more than once/);
    assert.match(repeated.stderr, /Nothing was written/);

    assert.strictEqual(
      run(["doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/s.md", "--content-file", "a.md", "--owner", "A", "--sources", "DEC-1,DEC-2"], root).status,
      0,
    );
    const state = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
    assert.deepEqual(state.artifacts[0].provenance, ["DEC-1", "DEC-2"]);
  });

  it("refuses an owner role it cannot represent", () => {
    // Pilot B supplied `compliance` and `quality` for a CE-marked product. `init`
    // succeeded, said nothing, and stored neither.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "beave-aln005-owners-"));
    fs.writeFileSync(
      path.join(root, "owners.json"),
      JSON.stringify({ ...owners, compliance: "Chiara", quality: "Paolo" }),
    );
    const result = run([
      "init", "--project-root", ".", "--project-name", "Owners", "--project-mode", "Genesis",
      "--interaction-mode", "Standard", "--owners-file", "owners.json", "--operation-id", "OP-init-owners",
    ], root);
    assert.strictEqual(result.status, 2, result.stdout);
    assert.match(result.stderr, /compliance/);
    assert.match(result.stderr, /quality/);
    assert.ok(!fs.existsSync(path.join(root, ".beave")), "a refused init writes no state");
  });

  it("validate reports a module whose recorded evidence no longer matches its file", () => {
    const root = project("Drift");
    fs.writeFileSync(path.join(root, "answer.md"), "the answer as recorded\n");
    assert.strictEqual(
      run(["record", "--project-root", ".", "--module", "1", "--status", "CONFIRMED", "--answer-file", "answer.md", "--owner", "A"], root).status,
      0,
    );
    assert.strictEqual(run(["validate", "--project-root", "."], root).status, 0);

    // The document moves on, which is what happens every time a governed evidence
    // document advances to a new -vN. `validate` used to keep saying "valid".
    fs.writeFileSync(path.join(root, "answer.md"), "the answer, reconsidered\n");
    const result = run(["validate", "--project-root", "."], root);
    assert.strictEqual(result.status, 2, result.stdout);
    assert.match(result.stderr, /module 1/);
    assert.match(result.stderr, /no longer matches/);

    // And it stays a report, not a block: the project is still usable, because
    // re-recording is the fix and it has to be reachable.
    assert.strictEqual(
      run(["record", "--project-root", ".", "--module", "1", "--status", "CONFIRMED", "--answer-file", "answer.md", "--owner", "A"], root).status,
      0,
      "recorded-digest drift must not block the operation that repairs it",
    );
    assert.strictEqual(run(["validate", "--project-root", "."], root).status, 0);
  });

  it("a refused preview hands out no usable confirmation", () => {
    const root = project("Token");
    fs.writeFileSync(path.join(root, "a.md"), "alpha\n");
    let result = run(["doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/spec.md", "--content-file", "a.md", "--owner", "A"], root);
    assert.strictEqual(result.status, 0, result.stderr);

    fs.writeFileSync(path.join(root, "b.md"), "beta\n");
    const clean = JSON.parse(run(["doc-diff", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/spec.md", "--content-file", "b.md", "--owner", "A"], root).stdout);
    assert.deepEqual(clean.blockers, []);
    assert.match(clean.confirmation_token, /^[a-f0-9]{64}$/);

    // Same content, same artifact; the only difference is that this preview is
    // refused. It used to return a token byte-identical to the clean one, and
    // doc-save accepted it.
    const blocked = JSON.parse(run([
      "doc-diff", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/spec.md",
      "--content-file", "b.md", "--owner", "A", "--expected-revision", "99", "--expected-hash", "0".repeat(64),
    ], root).stdout);
    assert.ok(blocked.blockers.length > 0, "the stale revision must be reported");
    assert.strictEqual(blocked.confirmation_token, "", "a refused preview must hand out no confirmation");
  });

  it("a refused save names the reason, not the missing token", () => {
    const root = project("Reason");
    fs.writeFileSync(path.join(root, "a.md"), "alpha\n");
    assert.strictEqual(run(["doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/spec.md", "--content-file", "a.md", "--owner", "A"], root).status, 0);

    // The substantive refusal comes first. Previously a stale save was reported as
    // "run doc-diff and pass its confirmation_token": true, useless, and pointing
    // at the wrong problem.
    fs.writeFileSync(path.join(root, "b.md"), "beta\n");
    const result = run([
      "doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/spec.md",
      "--content-file", "b.md", "--owner", "A", "--expected-revision", "0", "--expected-hash", "NEW",
      "--confirm-token", "",
    ], root);
    assert.strictEqual(result.status, 2);
    assert.match(result.stderr, /stale revision/);
  });

  it("a preview refuses the paths the save refuses", () => {
    const root = project("Paths");
    fs.writeFileSync(path.join(root, "a.md"), "alpha\n");
    for (const basePath of [".beave/state.json", "../escape.md"]) {
      const preview = JSON.parse(run(["doc-diff", "--project-root", ".", "--id", "ART-X", "--base-path", basePath, "--content-file", "a.md", "--owner", "A"], root).stdout);
      assert.ok(preview.blockers.length > 0, `${basePath} previewed cleanly for a save that can never succeed`);
      assert.strictEqual(preview.confirmation_token, "");
    }
  });

  it("a pure append leaves no backup copy, a rewrite still does", () => {
    const root = project("Backups");
    // Right after `init` the directory does not exist at all: nothing has been
    // overwritten yet, so nothing has been copied.
    const backupDir = path.join(root, ".beave", "backups");
    const backups = () => (fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : []);
    // `events.jsonl` is append-only: copying it before every append duplicated the
    // whole log each time, which is why the pilot reached 104 MB of backups
    // against 220 KB of documents, growing with the square of the operations.
    assert.strictEqual(backups().filter((name) => name.startsWith("events.jsonl.")).length, 0);
    for (let index = 0; index < 3; index += 1) {
      assert.strictEqual(
        run(["decision", "--project-root", ".", "--id", `DEC-${index}`, "--title", "T", "--status", "APPROVED", "--owner", "A"], root).status,
        0,
      );
    }
    assert.strictEqual(
      backups().filter((name) => name.startsWith("events.jsonl.")).length,
      0,
      "an append-only file needs no copy: every prior byte is still in it",
    );
    // `state.json` is rewritten wholesale, so it is copied every time — that is
    // the file a recovery actually reads.
    assert.ok(backups().filter((name) => name.startsWith("state.json.")).length >= 3);

    // And the log really did keep everything.
    const events = fs.readFileSync(path.join(root, ".beave", "events.jsonl"), "utf8").split(/\r?\n/).filter(Boolean);
    assert.ok(events.length >= 4);
  });

  it("a WARN gate carries the owner, consequence and review date lifecycle.md requires", () => {
    const root = project("Warn");
    fs.writeFileSync(path.join(root, "answer.md"), "module one answered\n");
    assert.strictEqual(run(["record", "--project-root", ".", "--module", "1", "--status", "CONFIRMED", "--answer-file", "answer.md", "--owner", "A"], root).status, 0);
    fs.writeFileSync(path.join(root, "gate.md"), "gate evidence\n");

    // A WARN with no debt is refused: it used to be accepted and was then
    // indistinguishable from a PASSED in every observable field.
    let result = run(["gate", "--project-root", ".", "--id", "G1", "--status", "WARN", "--evidence-file", "gate.md", "--owner", "A"], root);
    assert.strictEqual(result.status, 2, result.stdout);
    assert.match(result.stderr, /consequence/);
    assert.match(result.stderr, /review-date/);

    result = run([
      "gate", "--project-root", ".", "--id", "G1", "--status", "WARN", "--evidence-file", "gate.md",
      "--owner", "A", "--consequence", "module 3 is unverified", "--review-date", "2026-10-01",
    ], root);
    assert.strictEqual(result.status, 0, result.stderr);

    const state = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
    const gate = state.gates.find((item) => item.name === "G1");
    assert.strictEqual(gate.status, "WARN");
    assert.strictEqual(gate.consequence, "module 3 is unverified");
    assert.strictEqual(gate.review_date, "2026-10-01");
    assert.strictEqual(gate.owner, "A");
    // The gate record used to be `{id, name, status}`: a reader of state.json
    // could see that a gate had passed and not on what authority or evidence.
    assert.match(gate.evidence_sha256, /^[a-f0-9]{64}$/);
    assert.ok(gate.evidence.endsWith("gate.md"));
    assert.match(state.exact_next_action, /module 3 is unverified/);
    assert.match(state.exact_next_action, /2026-10-01/);
  });

  it("a save that removes recorded lines without a marked deletion says so", () => {
    const root = project("Deletion");
    fs.writeFileSync(path.join(root, "full.md"), "keep\ndrop one\ndrop two\n");
    assert.strictEqual(run(["doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/spec.md", "--content-file", "full.md", "--owner", "A"], root).status, 0);

    fs.writeFileSync(path.join(root, "short.md"), "keep\n");
    const result = run(["doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/spec.md", "--content-file", "short.md", "--owner", "A"], root);
    assert.strictEqual(result.status, 0, result.stderr);
    const outcome = JSON.parse(result.stdout);
    assert.deepEqual(outcome.deletion_intent_ids, []);
    assert.strictEqual(outcome.warnings.length, 1);
    assert.match(outcome.warnings[0], /removes 2 recorded lines/);
    assert.match(outcome.warnings[0], /doc-mark-deletion/);
    // The save still applies: this is a report, not a refusal. Refusing would be a
    // DOCOP-001 behaviour change and, under D3, needs a corpus scenario first.
    assert.strictEqual(fs.readFileSync(path.join(root, "docs", "spec-v2.md"), "utf8"), "keep\n");
  });

  it("a project blocked by a changed evidence file is told how to unblock it", () => {
    // Pilot B's continuation corrected an evidence file it had legitimately
    // superseded and found a project that answered "hash does not match" to
    // every command and named no way out. The check is right — it runs inside
    // `commitState`, so it is the one integrity rule a mutation cannot outrun —
    // but a refusal that blocks everything has to say what unblocks it.
    const root = project("Evidence");
    fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
    fs.writeFileSync(path.join(root, "evidence", "E1.md"), "the recorded answer\n");
    assert.strictEqual(run(["evidence", "--project-root", ".", "--id", "EVD-001", "--title", "E1", "--file", "evidence/E1.md", "--owner", "A"], root).status, 0);

    fs.writeFileSync(path.join(root, "evidence", "E1.md"), "the recorded answer\nand a correction\n");

    const blocked = run(["decision", "--project-root", ".", "--id", "DEC-001", "--title", "T", "--status", "APPROVED", "--owner", "A"], root);
    assert.strictEqual(blocked.status, 2);
    // An unrelated mutation is refused too: that is the part that has to be
    // explained, not the validate failure.
    assert.match(blocked.stderr, /Transaction failed validation/);
    // Asserted as one exact string, because `docop.rs` asserts the same string:
    // Studio and the engine must name the same route out of the same refusal.
    assert.ok(blocked.stderr.includes(
      "- evidence EVD-001 no longer matches evidence/E1.md: re-record it with `beave evidence --id EVD-001 --file evidence/E1.md --owner <owner> --expected-revision 1`. Until then every mutation is refused, because this check runs inside the transaction."
    ), blocked.stderr);

    // And the route the message names actually works.
    assert.strictEqual(run(["evidence", "--project-root", ".", "--id", "EVD-001", "--title", "E1", "--file", "evidence/E1.md", "--owner", "A", "--expected-revision", "1"], root).status, 0);
    assert.strictEqual(run(["validate", "--project-root", "."], root).status, 0);
    assert.strictEqual(run(["decision", "--project-root", ".", "--id", "DEC-001", "--title", "T", "--status", "APPROVED", "--owner", "A"], root).status, 0);
  });
  it("a copied project says the tool cannot run here, not that the state is broken", () => {
    // Found by moving a real delivered folder. `status`, `validate` and `resume`
    // all refused with "project root does not match requested root" and nothing
    // else — and the pilot dossiers tell a recipient to stop when a command
    // fails. So the ordinary act of receiving a handoff produced a refusal that
    // reads like corruption and stops the wrong work.
    //
    // The check stays: a state written for one root must not be operated on at
    // another without a governed re-rooting. What it now does is name the route.
    const root = project("Moved");
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "beave-moved-"));
    fs.cpSync(root, elsewhere, { recursive: true });

    for (const command of ["status", "validate", "resume"]) {
      const refused = run([command, "--project-root", "."], elsewhere);
      assert.strictEqual(refused.status, 2, `${command} should refuse a moved project`);
      assert.match(refused.stderr, /project root does not match requested root/);
      // Both roots, so the reader can see what happened.
      assert.ok(refused.stderr.includes(root), refused.stderr);
      // The route out.
      assert.match(refused.stderr, /beave project-export/);
      assert.match(refused.stderr, /beave project-import/);
      // And the distinction the dossiers could not make.
      assert.match(refused.stderr, /not the project state being broken/);
    }

    // The same folder in its own place is untouched by any of this.
    assert.strictEqual(run(["validate", "--project-root", "."], root).status, 0);
  });
  it("advances its own next action, and keeps one a person wrote", () => {
    // G-M20. The first fix warned and replaced anyway. A warning reaches the
    // agent holding the terminal; the recipient of a handoff reads the delivered
    // folder and nothing else, so the folder still travelled with an instruction
    // that was not the one a person had written. The behaviour is what had to
    // change.
    const root = project("NextAction");
    fs.writeFileSync(path.join(root, "answer.md"), "the answer\n");
    const recordModule = (id) =>
      run(["record", "--project-root", ".", "--module", String(id), "--status", "CONFIRMED",
           "--answer-file", "answer.md", "--owner", "A", "--summary", `m${id}`], root);
    const nextAction = () =>
      JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8")).exact_next_action;

    // 1 - ordinary interview: the engine's own sentence is the engine's to move.
    const first = recordModule(0);
    assert.strictEqual(first.status, 0, first.stderr);
    assert.match(nextAction(), /^Discuss module 1 —/);
    assert.doesNotMatch(first.stdout, /written by a person/);

    // 2 - a person records a handoff instruction.
    const handoff = "MARCO ESEGUE WRK-001. Elena accetta col Blocco note. Nessuna AI puo farlo.";
    assert.strictEqual(
      run(["checkpoint", "--project-root", ".", "--id", "CHK-HANDOFF", "--name", "Handoff", "--owner", "A", "--next-action", handoff], root).status,
      0,
    );
    assert.strictEqual(nextAction(), handoff);

    // 3 - and it survives, unchanged, through more than one record.
    for (const id of [1, 2, 3]) {
      const outcome = recordModule(id);
      assert.strictEqual(outcome.status, 0, outcome.stderr);
      assert.strictEqual(nextAction(), handoff, `record --module ${id} must not touch a human next action`);
      // The suggestion is still reported, so nothing is lost either way.
      assert.match(outcome.stdout, /written by a person, so it is kept unchanged/);
      assert.match(outcome.stdout, /Suggested instead: Discuss module \d+ —/);
      assert.match(outcome.stdout, /beave checkpoint --next-action/);
    }

    // 4 - every surface a recipient reads still carries it.
    const resumed = run(["resume", "--project-root", "."], root);
    assert.strictEqual(resumed.status, 0, resumed.stderr);
    assert.ok(resumed.stdout.includes(handoff), "resume must carry the preserved action");
    const status = run(["status", "--project-root", "."], root);
    assert.strictEqual(JSON.parse(status.stdout).exact_next_action, handoff);
    const pack = run(["context-pack", "--project-root", "."], root);
    assert.ok(pack.stdout.includes(handoff), "the context pack must carry it");

    // 5 - and the operation whose job it is can still replace it.
    const replaced = "ELENA VERIFICA LA COPIA, poi Marco decide.";
    assert.strictEqual(
      run(["checkpoint", "--project-root", ".", "--id", "CHK-HANDOFF", "--name", "Handoff", "--owner", "A", "--expected-revision", "1", "--next-action", replaced], root).status,
      0,
    );
    assert.strictEqual(nextAction(), replaced);
  });

  it("a gate outcome does not overwrite a next action a person wrote", () => {
    // Same rule, same reason: recording a gate is not an instruction to whoever
    // receives the folder.
    const root = project("GateNextAction");
    // G1 will not close while a module is unresolved, so resolve one first: the
    // point of this test is the next action, not the gate's own prerequisites.
    fs.writeFileSync(path.join(root, "answer.md"), "the answer\n");
    for (const id of [0, 1]) {
      assert.strictEqual(
        run(["record", "--project-root", ".", "--module", String(id), "--status", "CONFIRMED",
             "--answer-file", "answer.md", "--owner", "A", "--summary", `m${id}`], root).status,
        0,
      );
    }
    const handoff = "PAOLO PORTA I DISEGNI. Nessun ordine, nemmeno un campione.";
    assert.strictEqual(
      run(["checkpoint", "--project-root", ".", "--id", "CHK-H", "--name", "H", "--owner", "A", "--next-action", handoff], root).status,
      0,
    );
    fs.writeFileSync(path.join(root, "gate.md"), "gate evidence\n");
    const gate = run(["gate", "--project-root", ".", "--id", "G1", "--status", "PASSED", "--evidence-file", "gate.md", "--owner", "A"], root);
    assert.strictEqual(gate.status, 0, gate.stderr);
    const state = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
    assert.strictEqual(state.exact_next_action, handoff);
    assert.match(gate.stdout, /written by a person, so it is kept unchanged/);
    // The gate itself still did its job.
    assert.strictEqual(state.current_gate, "G2");
  });

  it("a preserved next action survives the export and import round trip", () => {
    // The recipient reads the delivered folder. If the package loses the
    // instruction, everything above is decoration.
    const root = project("RoundTrip");
    fs.writeFileSync(path.join(root, "doc.md"), "the plan\n");
    assert.strictEqual(
      run(["doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/plan.md", "--content-file", "doc.md", "--owner", "A"], root).status,
      0,
    );
    assert.strictEqual(run(["doc-finalize", "--project-root", ".", "--id", "ART-1", "--owner", "A"], root).status, 0);

    const handoff = "CHIARA FIRMA RIS-01b. Nessuna AI puo firmare al posto suo.";
    assert.strictEqual(
      run(["checkpoint", "--project-root", ".", "--id", "CHK-H", "--name", "H", "--owner", "A", "--next-action", handoff], root).status,
      0,
    );

    const pkg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "beave-rt-")), "pkg");
    assert.strictEqual(run(["project-export", "--project-root", ".", "--output-dir", pkg], root).status, 0);
    assert.strictEqual(run(["project-verify", "--package-dir", pkg], root).status, 0);

    const destination = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "beave-rt-")), "delivered");
    assert.strictEqual(run(["project-import", "--package-dir", pkg, "--project-root", destination, "--operation-id", "OP-IMPORT-RT"], root).status, 0);

    const delivered = JSON.parse(fs.readFileSync(path.join(destination, ".beave", "state.json"), "utf8"));
    assert.strictEqual(delivered.exact_next_action, handoff, "the delivered folder must carry the human instruction");
    const resumed = run(["resume", "--project-root", "."], destination);
    assert.strictEqual(resumed.status, 0, resumed.stderr);
    assert.ok(resumed.stdout.includes(handoff), "resume in the delivered folder must carry it");
  });

  // ---------------------------------------------------------------------------
  // The four corrections that shipped with no test.
  //
  // A final independent review proved the gap by negative control rather than by
  // reading: it reverted the staging fix, the `override` branch, both packaging
  // loops and the backward-compatibility guard in one build, ran this suite
  // against it, and nothing went red. The P0 below existed in the first place
  // because a code path was never exercised; leaving it unexercised after fixing
  // it repeats the mistake with the answer already in hand.
  //
  // Each of these must fail against the reverted build, which is the only thing
  // that makes it a regression test rather than a description.
  // ---------------------------------------------------------------------------

  it("a package carrying a deletion reason can be imported at all", () => {
    // P0-1. `deletion-reasons/` sorts before `files/` in the manifest, and only
    // the `files/` branch created the staging directory. So the first entry of
    // every package that recorded a reason hit a realpath on a directory that did
    // not exist yet, and the whole handoff failed — for the packages that had
    // taken the most care to explain themselves.
    const root = project("ImportDeletion");
    fs.writeFileSync(path.join(root, "doc.md"), "line one\nline two\n");
    assert.strictEqual(
      run(["doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/plan.md", "--content-file", "doc.md", "--owner", "A"], root).status,
      0,
    );
    const reason = "the supplier withdrew the part, so line two describes something nobody can buy\n";
    fs.writeFileSync(path.join(root, "reason.md"), reason);
    fs.writeFileSync(path.join(root, "shorter.md"), "line one\n");
    const marked = run([
      "doc-mark-deletion", "--project-root", ".", "--id", "ART-1", "--target", "line two",
      "--reason-file", "reason.md", "--content-file", "shorter.md", "--owner", "A",
    ], root);
    assert.strictEqual(marked.status, 0, marked.stderr);

    const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "reason.md"))).digest("hex");
    const relative = path.join("deletion-reasons", `${digest}.md`);
    assert.ok(fs.existsSync(path.join(root, ".beave", relative)), "the reason must be archived in the governed area");

    // A package exists only around a published artifact.
    assert.strictEqual(run(["doc-finalize", "--project-root", ".", "--id", "ART-1", "--owner", "A"], root).status, 0);

    const pkg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "beave-del-")), "pkg");
    assert.strictEqual(run(["project-export", "--project-root", ".", "--output-dir", pkg], root).status, 0);

    // The entry that used to decide the outcome, asserted rather than assumed.
    const manifest = JSON.parse(fs.readFileSync(path.join(pkg, "manifest.json"), "utf8"));
    assert.ok(
      manifest.files[0].path.startsWith("deletion-reasons/"),
      `the first packaged entry must still be a deletion reason, or this test no longer covers the defect; it was ${manifest.files[0].path}`,
    );
    assert.strictEqual(run(["project-verify", "--package-dir", pkg], root).status, 0);

    const destination = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "beave-del-")), "delivered");
    const imported = run(["project-import", "--package-dir", pkg, "--project-root", destination, "--operation-id", "OP-IMPORT-DEL"], root);
    assert.strictEqual(imported.status, 0, imported.stderr);

    // Arriving is not enough: the recipient has to be able to read it.
    const delivered = path.join(destination, ".beave", relative);
    assert.ok(fs.existsSync(delivered), "the reason must arrive in the delivered folder");
    assert.strictEqual(fs.readFileSync(delivered, "utf8"), reason, "and it must arrive unchanged");
    assert.strictEqual(run(["validate", "--project-root", "."], destination).status, 0);
  });

  it("a gate's evidence and an override's source survive the round trip", () => {
    // P1-2. The package carried neither, so the delivered folder failed its own
    // `validate` for the override, and said nothing at all about the gate — the
    // recipient inherited a passed gate whose evidence had never been sent.
    const root = project("CarryEvidence");
    fs.writeFileSync(path.join(root, "doc.md"), "the plan\n");
    assert.strictEqual(
      run(["doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/plan.md", "--content-file", "doc.md", "--owner", "A"], root).status,
      0,
    );
    assert.strictEqual(run(["doc-finalize", "--project-root", ".", "--id", "ART-1", "--owner", "A"], root).status, 0);
    fs.writeFileSync(path.join(root, "answer.md"), "the answer\n");
    for (const id of [0, 1]) {
      assert.strictEqual(
        run(["record", "--project-root", ".", "--module", String(id), "--status", "CONFIRMED",
             "--answer-file", "answer.md", "--owner", "A", "--summary", `m${id}`], root).status,
        0,
      );
    }
    fs.mkdirSync(path.join(root, "answers"), { recursive: true });
    fs.writeFileSync(path.join(root, "answers", "g1.md"), "what G1 was passed on\n");
    assert.strictEqual(
      run(["gate", "--project-root", ".", "--id", "G1", "--status", "PASSED", "--evidence-file", "answers/g1.md", "--owner", "A"], root).status,
      0,
    );
    fs.mkdirSync(path.join(root, "instructions"), { recursive: true });
    fs.writeFileSync(path.join(root, "instructions", "change.md"), "the client changed the brief\n");
    assert.strictEqual(
      run(["override", "--project-root", ".", "--instruction-file", "instructions/change.md", "--owner", "A"], root).status,
      0,
    );

    const pkg = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "beave-carry-")), "pkg");
    assert.strictEqual(run(["project-export", "--project-root", ".", "--output-dir", pkg], root).status, 0);
    assert.strictEqual(run(["project-verify", "--package-dir", pkg], root).status, 0);
    const destination = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "beave-carry-")), "delivered");
    assert.strictEqual(
      run(["project-import", "--package-dir", pkg, "--project-root", destination, "--operation-id", "OP-IMPORT-CARRY"], root).status,
      0,
    );

    assert.ok(fs.existsSync(path.join(destination, "answers", "g1.md")), "the gate evidence must be delivered");
    assert.ok(fs.existsSync(path.join(destination, "instructions", "change.md")), "the override's source must be delivered");
    const validated = run(["validate", "--project-root", "."], destination);
    assert.strictEqual(validated.status, 0, validated.stderr);
  });

  it("an override does not overwrite a next action a person wrote", () => {
    // P1-1. `record` and `gate` were corrected first and `override` was missed,
    // which is the whole shape of this defect family: the check covers the case
    // just found rather than the rule.
    const root = project("OverrideNextAction");
    const handoff = "CHIARA FIRMA RIS-01b. Nessuna AI puo firmare al posto suo.";
    assert.strictEqual(
      run(["checkpoint", "--project-root", ".", "--id", "CHK-H", "--name", "H", "--owner", "A", "--next-action", handoff], root).status,
      0,
    );
    fs.mkdirSync(path.join(root, "instructions"), { recursive: true });
    fs.writeFileSync(path.join(root, "instructions", "change.md"), "the client changed the brief\n");
    const result = run(["override", "--project-root", ".", "--instruction-file", "instructions/change.md", "--owner", "A"], root);
    assert.strictEqual(result.status, 0, result.stderr);

    const state = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
    assert.strictEqual(state.exact_next_action, handoff, "the human instruction must be kept");
    assert.match(result.stdout, /written by a person, so it is kept unchanged/);
    assert.match(result.stdout, /Suggested instead: Reconcile OVR-/);
    // The override itself still happened.
    assert.strictEqual(state.human_overrides.length, 1);

    // And the sanctioned replacement still replaces — but `--next-action` alone is
    // no longer the sanction (blocker 1). It used to be mandatory on `reconcile`,
    // so its presence said nothing about intent; the intent is now a flag of its
    // own, and without it the replacement is refused and the override stays OPEN.
    fs.writeFileSync(path.join(root, "evidence.md"), "what was done about it\n");
    const refused = run(["reconcile", "--project-root", ".", "--override-id", state.human_overrides[0].id,
                         "--evidence-file", "evidence.md", "--owner", "A", "--next-action", "DELIBERATELY REPLACED"], root);
    assert.strictEqual(refused.status, 2, refused.stdout);
    assert.match(refused.stderr, /Refusing to replace the exact next action/);
    assert.match(refused.stderr, /--replace-human-next-action/);
    const stillBlocked = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
    assert.strictEqual(stillBlocked.exact_next_action, handoff, "a refused reconcile changes nothing");
    assert.strictEqual(stillBlocked.human_overrides[0].status, "OPEN");

    const reconciled = run(["reconcile", "--project-root", ".", "--override-id", state.human_overrides[0].id,
                            "--evidence-file", "evidence.md", "--owner", "A", "--next-action", "DELIBERATELY REPLACED",
                            "--replace-human-next-action"], root);
    assert.strictEqual(reconciled.status, 0, reconciled.stderr);
    assert.match(reconciled.stdout, /was replaced, as --replace-human-next-action asked/);
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8")).exact_next_action,
      "DELIBERATELY REPLACED",
    );
  });

  it("a missing archived reason is reported, and a marker written before the rule is not", () => {
    // P1-4. The first version of the check failed every marker, including the
    // thirty-one and thirty-eight written by the two pilots before the rule
    // existed, which made both delivered folders invalid. Narrowing it to markers
    // that actually recorded an archive path is the fix; the risk of narrowing is
    // switching the check off, so both directions are pinned here.
    const root = project("ArchiveCheck");
    fs.writeFileSync(path.join(root, "doc.md"), "line one\nline two\n");
    assert.strictEqual(
      run(["doc-save", "--project-root", ".", "--id", "ART-1", "--base-path", "docs/plan.md", "--content-file", "doc.md", "--owner", "A"], root).status,
      0,
    );
    fs.writeFileSync(path.join(root, "reason.md"), "because the part was withdrawn\n");
    fs.writeFileSync(path.join(root, "shorter.md"), "line one\n");
    assert.strictEqual(
      run(["doc-mark-deletion", "--project-root", ".", "--id", "ART-1", "--target", "line two",
           "--reason-file", "reason.md", "--content-file", "shorter.md", "--owner", "A"], root).status,
      0,
    );
    assert.strictEqual(run(["validate", "--project-root", "."], root).status, 0);

    const digest = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "reason.md"))).digest("hex");
    const archive = path.join(root, ".beave", "deletion-reasons", `${digest}.md`);

    // Live control: the marker recorded an archive, so losing it must be reported.
    fs.rmSync(archive);
    const broken = run(["validate", "--project-root", "."], root);
    assert.strictEqual(broken.status, 2, broken.stdout);
    assert.match(broken.stderr, /records a reason at/);
    assert.match(broken.stderr, /cannot be read any more/);

    // Backward compatibility: the same missing file, on a marker written before
    // the rule, is not an error — there is nothing it could be checked against.
    // A pre-rule ledger is exactly this one without the field.
    const ledger = path.join(root, ".beave", "events.jsonl");
    const lines = fs.readFileSync(ledger, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
      const event = JSON.parse(line);
      delete event.reason_archive_path;
      return JSON.stringify(event);
    });
    fs.writeFileSync(ledger, `${lines.join("\n")}\n`);
    // An event that predates the rule predates the replay format as well, and an
    // event now records a digest of itself: editing one without ageing the
    // history would make this fixture a project no engine ever wrote.
    ageProject(root);
    const legacy = run(["validate", "--project-root", "."], root);
    assert.strictEqual(legacy.status, 0, legacy.stderr);
  });

  it("reconcile says so when it cannot use the next action it was given", () => {
    // Found by the final independent review. `reconcile` is one of the two
    // commands allowed to replace a recorded next action, so this is not a breach
    // of that rule — but with a second override still open it replaced the field
    // with a blocker sentence, dropped the operator's own, and printed nothing.
    // The blocker sentence is right. The silence is the defect.
    const root = project("ReconcileSilence");
    const handoff = "HUMAN: do not proceed without the client.";
    assert.strictEqual(
      run(["checkpoint", "--project-root", ".", "--id", "CHK-H", "--name", "H", "--owner", "A", "--next-action", handoff], root).status,
      0,
    );
    fs.mkdirSync(path.join(root, "instructions"), { recursive: true });
    fs.writeFileSync(path.join(root, "instructions", "one.md"), "first change\n");
    fs.writeFileSync(path.join(root, "instructions", "two.md"), "second change\n");
    for (const name of ["one.md", "two.md"]) {
      assert.strictEqual(
        run(["override", "--project-root", ".", "--instruction-file", `instructions/${name}`, "--owner", "A"], root).status,
        0,
      );
    }
    const before = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
    assert.strictEqual(before.human_overrides.length, 2);

    fs.writeFileSync(path.join(root, "evidence.md"), "what was done\n");
    const result = run(["reconcile", "--project-root", ".", "--override-id", before.human_overrides[0].id,
                        "--evidence-file", "evidence.md", "--owner", "A", "--next-action", "OPERATOR ASKED FOR THIS"], root);
    assert.strictEqual(result.status, 0, result.stderr);

    const after = JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"));
    assert.strictEqual(
      after.exact_next_action,
      `Reconcile ${before.human_overrides[1].id} before continuing.`,
      "the blocker sentence still wins",
    );
    assert.match(result.stdout, /The next action was set to the blocker sentence/);
    assert.match(result.stdout, /was NOT recorded in state/);
    assert.match(result.stdout, /OPERATOR ASKED FOR THIS/);
    // Blocker 1. The sentence the blocker displaced is now in the ledger verbatim,
    // not only in a backup that does not travel with the folder.
    const reconciledEvent = fs.readFileSync(path.join(root, ".beave", "events.jsonl"), "utf8")
      .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
      .findLast((event) => event.type === "HUMAN_OVERRIDE_RECONCILED");
    assert.strictEqual(reconciledEvent.next_action_outcome, "blocked_by_open_override");
    assert.strictEqual(reconciledEvent.next_action_before, handoff);
    assert.strictEqual(reconciledEvent.next_action_after, `Reconcile ${before.human_overrides[1].id} before continuing.`);

    // And closing the last one records the sentence given to it.
    const last = run(["reconcile", "--project-root", ".", "--override-id", before.human_overrides[1].id,
                      "--evidence-file", "evidence.md", "--owner", "A", "--next-action", "OPERATOR ASKED FOR THIS"], root);
    assert.strictEqual(last.status, 0, last.stderr);
    assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8")).exact_next_action,
      "OPERATOR ASKED FOR THIS",
    );
    assert.doesNotMatch(last.stdout, /was NOT set/);
  });
});
