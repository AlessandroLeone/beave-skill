import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ageProject } from "./older-engine.mjs";

/**
 * The interview ledger: what was asked, what came back, and what was done with it.
 *
 * Every test here is about one property a resumed project depends on, and the
 * hardest ones are the negative ones. An interrupted turn must not look
 * finished; a correction must not erase what it corrects; a question with a
 * recorded answer must not be asked again; and a project that predates the
 * ledger must not be described as one where nothing was ever asked.
 *
 * The commands run as a user runs them — a real CLI in a real directory — because
 * the states this ledger exists to distinguish only arise between two commands.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "lib", "bin", "plangonaut.js");

let counter = 0;

function plangonaut(root, args, options = {}) {
  counter += 1;
  const full = [...args];
  // Every mutation needs one; reads ignore it. Supplying it here keeps each test
  // about its subject instead of about operation-id plumbing.
  if (!full.includes("--operation-id") && !options.noOperation) {
    full.push("--operation-id", `t${counter}-${Date.now()}`);
  }
  const result = spawnSync(process.execPath, [CLI, ...full], { cwd: root, encoding: "utf8" });
  return {
    status: result.status,
    out: `${result.stdout}${result.stderr}`.trim(),
  };
}

function ok(root, args) {
  const result = plangonaut(root, args);
  assert.strictEqual(result.status, 0, `expected success from ${args[0]}:\n${result.out}`);
  return result.out;
}

function refused(root, args) {
  const result = plangonaut(root, args);
  assert.notStrictEqual(result.status, 0, `expected ${args[0]} to be refused, it succeeded:\n${result.out}`);
  return result.out;
}

/** A project with owners, ready for its first question. */
function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-qa-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, "owners.json"),
    JSON.stringify({ product: "Ada", technical: "Ada", budget: "Ada", safety: "Ada", release: "Ada" })
  );
  ok(root, [
    "init", "--project-root", root, "--project-name", "Ledger", "--project-mode", "Genesis",
    "--interaction-mode", "Standard", "--owners-file", path.join(root, "owners.json"),
  ]);
  return root;
}

const state = (root) => JSON.parse(fs.readFileSync(path.join(root, ".plangonaut", "state.json"), "utf8"));
const entry = (root, id) => state(root).interview_log.find((item) => item.id === id);
const view = (root) => fs.readFileSync(path.join(root, "QUESTION_ANSWER_HISTORY.md"), "utf8");

function answerFile(root, text) {
  const file = path.join(root, `answer-${counter}.txt`);
  fs.writeFileSync(file, text);
  return file;
}

/*
 * No `--module`: a question belongs to the module the interview is on.
 *
 * This helper used to hardcode `--module 2` on a project whose active module was
 * 1, which is exactly the discrepancy both ALN-011 pilots reported — baked into
 * the harness. A question against a module the interview has not reached is now
 * a deviation that has to be asked for, and it has its own test below.
 */
function ask(root, id, question, extra = []) {
  return ok(root, [
    "qa-ask", "--project-root", root, "--id", id, "--question", question,
    "--rationale", "The module cannot be recorded without it.",
    "--owner", "Ada", ...extra,
  ]);
}

function answer(root, id, text) {
  return ok(root, [
    "qa-answer", "--project-root", root, "--id", id,
    "--answer-file", answerFile(root, text), "--owner", "Ada",
  ]);
}

// ---------------------------------------------------------------------------
// 1-5. The five states an interruption can land in
// ---------------------------------------------------------------------------

test("a planned question is recorded as planned, and is not an asked one", (t) => {
  const root = project(t);
  ask(root, "1", "Who approves a completed job?", ["--planned"]);

  const recorded = entry(root, "QNA-0001");
  assert.strictEqual(recorded.status, "PLANNED");
  assert.strictEqual(recorded.asked_at, null, "a planned question was never put to anyone");
  assert.match(ok(root, ["qa-log", "--project-root", root, "--open"]), /PLANNED, not asked\s+QNA-0001/);
});

test("a question asked and unanswered stays unanswered, and Resume says so", (t) => {
  const root = project(t);
  ask(root, "1", "Who approves a completed job?");

  const recorded = entry(root, "QNA-0001");
  assert.strictEqual(recorded.status, "ASKED");
  assert.ok(recorded.asked_at, "an asked question records when");
  assert.strictEqual(recorded.answer, null);

  const resumed = ok(root, ["resume", "--project-root", root]);
  assert.match(resumed, /Asked and unanswered:\*\* QNA-0001/);
  assert.match(resumed, /do not treat it as answered/);
});

test("an answer is recorded verbatim, including its line breaks", (t) => {
  const root = project(t);
  ask(root, "1", "Who uses this?");
  const text = 'Dispatchers plan.\nTechnicians "execute".\n\nSupervisors approve.';
  answer(root, "1", text);

  const recorded = entry(root, "QNA-0001");
  assert.strictEqual(recorded.status, "ANSWERED");
  assert.strictEqual(recorded.answer, text.trim(), "the answer is the user's words, not a summary");
  assert.ok(recorded.answered_at);
});

test("an answer that is not applied yet never looks applied", (t) => {
  const root = project(t);
  ask(root, "1", "Who uses this?");
  answer(root, "1", "Dispatchers and technicians.");

  const recorded = entry(root, "QNA-0001");
  assert.strictEqual(recorded.status, "ANSWERED");
  assert.strictEqual(
    recorded.consequences_recorded_at,
    null,
    "applied is a timestamp written by the command that applies, not a word a caller sets"
  );

  assert.match(ok(root, ["qa-log", "--project-root", root, "--open"]), /ANSWERED, not applied/);
  const resumed = ok(root, ["resume", "--project-root", root]);
  assert.match(resumed, /Answered and not applied:\*\* QNA-0001/);
  assert.match(resumed, /First, finish what is open[\s\S]*QNA-0001/);

  /*
   * And it is a refusal, not advice.
   *
   * Resume printing "settle this first" holds exactly as long as the next agent
   * reads it. The engine refuses a new question while a settlement is
   * outstanding, so a half-applied answer cannot be buried under a newer one.
   */
  const blocked = refused(root, [
    "qa-ask", "--project-root", root, "--id", "2", "--question", "And who pays?",
    "--rationale", "Module 6.", "--owner", "Ada",
  ]);
  assert.match(blocked, /QNA-0001 has a recorded answer and no recorded consequences/);
  assert.match(blocked, /Nothing was written/);

  // Answering and settling are not blocked: closing the work is the point.
  ok(root, [
    "qa-settle", "--project-root", root, "--id", "1",
    "--interpretation", "Two roles.", "--reply", "Noted.", "--owner", "Ada",
  ]);
  ask(root, "2", "And who pays?");
});

test("a settled interaction records what it changed, and the next question with it", (t) => {
  const root = project(t);
  ask(root, "1", "Who uses this?");
  answer(root, "1", "Dispatchers and technicians.");
  ok(root, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Offline first", "--status", "APPROVED", "--owner", "Ada"]);
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "model.md"), "# Model\n");

  ok(root, [
    "qa-settle", "--project-root", root, "--id", "1",
    "--interpretation", "Two roles.", "--reply", "Recorded.",
    "--consequences", "DEC-0001", "--documents", "docs/model.md",
    "--open-points", "Approval order",
    "--next-id", "2", "--next-question", "Who approves a completed job?",
    "--owner", "Ada",
  ]);

  const settled = entry(root, "QNA-0001");
  assert.ok(settled.consequences_recorded_at);
  assert.deepStrictEqual(settled.consequences, ["DEC-0001"]);
  assert.deepStrictEqual(settled.documents, ["docs/model.md"]);
  assert.deepStrictEqual(settled.open_points, ["Approval order"]);

  // The next question exists as an entry, in the same transaction: a pointer to
  // something that does not exist is what an interruption between two commands
  // would otherwise leave behind.
  assert.strictEqual(settled.next_id, "QNA-0002");
  assert.strictEqual(entry(root, "QNA-0002").status, "PLANNED");
});

// ---------------------------------------------------------------------------
// 6-7. Closing and correcting
// ---------------------------------------------------------------------------

test("a deferred question records why, and a reason is not optional", (t) => {
  const root = project(t);
  ask(root, "1", "What is the budget ceiling?");

  refused(root, ["qa-close", "--project-root", root, "--id", "1", "--kind", "deferred", "--owner", "Ada"]);
  ok(root, [
    "qa-close", "--project-root", root, "--id", "1", "--kind", "deferred",
    "--reason", "The budget holder is away until the 14th.", "--owner", "Ada",
  ]);

  const closed = entry(root, "QNA-0001");
  assert.strictEqual(closed.status, "DEFERRED");
  assert.match(closed.closed_reason, /away until the 14th/);
});

test("a correction adds an entry and preserves the one it replaces", (t) => {
  const root = project(t);
  ask(root, "1", "Who uses this?");
  answer(root, "1", "Dispatchers.");
  ok(root, [
    "qa-settle", "--project-root", root, "--id", "1",
    "--interpretation", "One role.", "--reply", "Recorded.", "--owner", "Ada",
  ]);

  ok(root, [
    "qa-supersede", "--project-root", root, "--id", "1", "--new-id", "9",
    "--question", "Who uses this, and who approves what they do?",
    "--rationale", "The first wording missed the approval role.",
    "--reason", "The user corrected it in the next turn.",
    "--owner", "Ada",
  ]);

  const previous = entry(root, "QNA-0001");
  assert.strictEqual(previous.status, "SUPERSEDED");
  assert.strictEqual(previous.superseded_by, "QNA-0009");
  assert.strictEqual(previous.answer, "Dispatchers.", "a correction does not erase the earlier answer");
  assert.ok(previous.consequences_recorded_at, "nor the fact that it had been applied");
  assert.strictEqual(entry(root, "QNA-0009").supersedes, "QNA-0001");

  // And the document carries both, in order.
  const document = view(root);
  assert.ok(document.indexOf("## QNA-0001") < document.indexOf("## QNA-0009"));
  assert.match(document, /Dispatchers\./);
});

// ---------------------------------------------------------------------------
// 8-9. Interruption, and a different agent
// ---------------------------------------------------------------------------

test("Resume names the right frontier from every interrupted state", (t) => {
  for (const scenario of [
    { name: "planned", steps: (root) => ask(root, "1", "Q?", ["--planned"]), expect: /Ask QNA-0001, which is recorded as planned/ },
    { name: "asked", steps: (root) => ask(root, "1", "Q?"), expect: /Put QNA-0001 to the user again/ },
    {
      name: "answered",
      steps: (root) => {
        ask(root, "1", "Q?");
        answer(root, "1", "A.");
      },
      // An unfinished settlement is a precondition printed above the ordered
      // list, not a rank inside it: the recorded precedence puts the exact next
      // action third, and "finish the transaction" is a different statement from
      // "do it before everything else".
      expect: /First, finish what is open[\s\S]*QNA-0001/,
    },
  ]) {
    const root = project(t);
    scenario.steps(root);
    const resumed = ok(root, ["resume", "--project-root", root]);
    assert.match(resumed, scenario.expect, `frontier for the ${scenario.name} state`);
  }
});

test("a different agent reads the history without the earlier conversation", (t) => {
  const root = project(t);
  ask(root, "1", "Who approves a completed job?", ["--agent", "codex/session-a"]);
  answer(root, "1", "Supervisors, after the job syncs.");
  ok(root, [
    "qa-settle", "--project-root", root, "--id", "1",
    "--interpretation", "Approval is after sync.", "--reply", "Recorded.",
    "--next-id", "2", "--next-question", "What happens to a rejected job?",
    "--owner", "Ada",
  ]);

  // Everything the second agent needs is in two files it can read cold.
  const resumed = ok(root, ["resume", "--project-root", root]);
  assert.match(resumed, /Last completed interaction: QNA-0001/);
  assert.match(resumed, /Ask QNA-0002, which is recorded as planned/);
  assert.doesNotMatch(resumed, /Put QNA-0001 to the user again/, "an answered question is not re-asked");

  const document = view(root);
  assert.match(document, /Supervisors, after the job syncs\./);
  assert.match(document, /codex\/session-a/, "the agent that asked is recorded, when it said so");
});

// ---------------------------------------------------------------------------
// 10. Without the CLI
// ---------------------------------------------------------------------------

test("the document alone carries the history, for a host with no CLI", (t) => {
  const root = project(t);
  ask(root, "1", "Who uses this?");
  answer(root, "1", "Dispatchers and technicians.");
  ok(root, [
    "qa-settle", "--project-root", root, "--id", "1",
    "--interpretation", "Two roles.", "--reply", "Noted.", "--owner", "Ada",
  ]);

  // A semantic-only host reads this file and nothing else. It has to carry the
  // question, the answer, what Plangonaut understood, and the warning that it is
  // derived — otherwise "recover semantically" means "guess".
  const document = view(root);
  for (const needed of [
    "Who uses this?",
    "Dispatchers and technicians.",
    "Two roles.",
    "derived view",
    ".plangonaut/events.jsonl",
  ]) {
    assert.ok(document.includes(needed), `the standalone document must carry: ${needed}`);
  }
});

// ---------------------------------------------------------------------------
// 11-13. The document edited, references broken, order broken
// ---------------------------------------------------------------------------

test("a hand edit to the document is detected, and repaired without touching history", (t) => {
  const root = project(t);
  ask(root, "1", "Who uses this?");

  const file = path.join(root, "QUESTION_ANSWER_HISTORY.md");
  fs.appendFileSync(file, "\nSomebody typed this by hand.\n");

  const failed = plangonaut(root, ["validate", "--project-root", root]);
  assert.notStrictEqual(failed.status, 0);
  assert.match(failed.out, /edited outside Plangonaut/);
  assert.match(failed.out, /qa-log --project-root \. --regenerate/, "the refusal names the repair");

  ok(root, ["qa-log", "--project-root", root, "--regenerate"]);
  assert.strictEqual(plangonaut(root, ["validate", "--project-root", root]).status, 0);
  assert.strictEqual(entry(root, "QNA-0001").question, "Who uses this?", "the ledger was never in question");
});

test("a reference to a record that does not exist is refused", (t) => {
  const root = project(t);
  ask(root, "1", "Who uses this?");
  answer(root, "1", "Dispatchers.");

  const out = refused(root, [
    "qa-settle", "--project-root", root, "--id", "1",
    "--interpretation", "x", "--reply", "y", "--consequences", "DEC-9999", "--owner", "Ada",
  ]);
  assert.match(out, /DEC-9999/);
  assert.strictEqual(entry(root, "QNA-0001").consequences_recorded_at, null, "nothing was written");

  // And a document that is not there.
  const missing = refused(root, [
    "qa-settle", "--project-root", root, "--id", "1",
    "--interpretation", "x", "--reply", "y", "--documents", "docs/nope.md", "--owner", "Ada",
  ]);
  assert.match(missing, /docs\/nope\.md/);
});

test("a history put out of order by hand is refused by validate", (t) => {
  const root = project(t);
  ask(root, "1", "First?");
  ask(root, "2", "Second?");

  const location = path.join(root, ".plangonaut", "state.json");
  const edited = JSON.parse(fs.readFileSync(location, "utf8"));
  edited.interview_log.reverse();
  fs.writeFileSync(location, JSON.stringify(edited, null, 2));

  const out = plangonaut(root, ["validate", "--project-root", root]);
  assert.notStrictEqual(out.status, 0);
  assert.match(out.out, /out of chronological order/);
});

// ---------------------------------------------------------------------------
// 14. A project that predates the ledger
// ---------------------------------------------------------------------------

test("a project with no ledger is not described as one where nothing was asked", (t) => {
  const root = project(t);

  // A project created before this feature existed: the fields are simply absent.
  const location = path.join(root, ".plangonaut", "state.json");
  const legacy = JSON.parse(fs.readFileSync(location, "utf8"));
  delete legacy.interview_log;
  delete legacy.interview_log_since;
  delete legacy.interview_view;
  fs.writeFileSync(location, JSON.stringify(legacy, null, 2));
  ageProject(root);
  fs.rmSync(path.join(root, "QUESTION_ANSWER_HISTORY.md"), { force: true });

  assert.strictEqual(plangonaut(root, ["validate", "--project-root", root]).status, 0, "a project without the ledger is still valid");

  const resumed = ok(root, ["resume", "--project-root", root]);
  assert.match(resumed, /predates the interview ledger/);
  assert.match(resumed, /not the same as no question having been asked/);

  // Opening it records when, and reconstructs nothing.
  const migrated = ok(root, ["migrate", "--project-root", root]);
  assert.match(migrated, /Opened the interview ledger/);
  assert.match(migrated, /nothing has been reconstructed/);
  assert.deepStrictEqual(entry(root, "QNA-0001"), undefined);
  assert.ok(state(root).interview_log_since, "the marker says from when the history exists");
  assert.match(view(root), /No interaction recorded yet/);
});

// ---------------------------------------------------------------------------
// 15-16. Not re-asking, and the derived view staying in step
// ---------------------------------------------------------------------------

test("an answered question cannot be answered again behind the first answer", (t) => {
  const root = project(t);
  ask(root, "1", "Who uses this?");
  answer(root, "1", "Dispatchers.");

  const out = refused(root, [
    "qa-answer", "--project-root", root, "--id", "1",
    "--answer-file", answerFile(root, "Actually, technicians."), "--owner", "Ada",
  ]);
  assert.match(out, /already carries an answer/);
  assert.match(out, /qa-supersede/, "the refusal names the way to correct it");
  assert.strictEqual(entry(root, "QNA-0001").answer, "Dispatchers.");
});

test("the derived view is a pure function of the ledger and stays in step with it", (t) => {
  const root = project(t);
  ask(root, "1", "Who uses this?");

  const first = view(root);
  ok(root, ["qa-log", "--project-root", root, "--regenerate"]);
  assert.strictEqual(view(root), first, "regenerating twice produces the same bytes");

  answer(root, "1", "Dispatchers.");
  assert.notStrictEqual(view(root), first, "and a new fact changes them");
  assert.strictEqual(plangonaut(root, ["validate", "--project-root", root]).status, 0);

  // The digest recorded in state is the digest of the file on disk.
  const digest = state(root).interview_view.sha256;
  const onDisk = spawnSync(
    process.execPath,
    ["-e", `const c=require('node:crypto'),f=require('node:fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))`,
      path.join(root, "QUESTION_ANSWER_HISTORY.md")],
    { encoding: "utf8" }
  ).stdout;
  assert.strictEqual(onDisk, digest);
});

// ---------------------------------------------------------------------------
// Evidence versus inference
// ---------------------------------------------------------------------------

test("a recorded decision is never presented as evidence that a question was asked", (t) => {
  const root = project(t);
  ok(root, ["decision", "--project-root", root, "--id", "DEC-0014", "--title", "Budget ceiling", "--status", "APPROVED", "--owner", "Ada"]);

  // A decision exists; no question about it was ever recorded. The history must
  // say the second thing without being tempted by the first.
  const document = view(root);
  assert.match(document, /No interaction recorded yet/);
  assert.doesNotMatch(document, /DEC-0014/, "a decision is not an interaction");

  const resumed = ok(root, ["resume", "--project-root", root]);
  assert.match(resumed, /Recorded interactions: 0/);
  assert.doesNotMatch(resumed, /Last completed interaction: QNA/);
});

test("a question cannot be opened while a human override is unreconciled", (t) => {
  const root = project(t);
  fs.writeFileSync(path.join(root, "change.md"), "Drop the offline requirement.\n");
  ok(root, ["override", "--project-root", root, "--instruction-file", path.join(root, "change.md"), "--owner", "Ada"]);

  const out = refused(root, [
    "qa-ask", "--project-root", root, "--id", "1", "--question", "Who uses this?",
    "--rationale", "Module 2.", "--owner", "Ada",
  ]);
  assert.match(out, /reconcil/i, "the same rule `plangonaut next` already applies to the catalog");
});

// ---------------------------------------------------------------------------
// What an independent review reproduced
//
// Each of these is a defect that existed, with the commands that produced it.
// They are grouped because they share a cause: a property enforced in one
// command and not in the one beside it, or asserted in a document and checked
// nowhere.
// ---------------------------------------------------------------------------

test("qa-supersede applies the guards qa-ask applies, and cannot hide unfinished work", (t) => {
  const root = project(t);
  ask(root, "1", "Who uses this?");
  answer(root, "1", "Dispatchers.");

  // Superseding used to open a new question with the answer still unsettled.
  // The superseded entry keeps `status: ANSWERED`, so it dropped out of the
  // open set and Resume stopped reporting the work that was never finished.
  const out = refused(root, [
    "qa-supersede", "--project-root", root, "--id", "1", "--new-id", "2",
    "--question", "Who uses this, exactly?", "--rationale", "Reworded.",
    "--reason", "The first wording was vague.", "--owner", "Ada",
  ]);
  assert.match(out, /Settle it before replacing any question/);
  assert.match(out, /hide the unfinished work/);
  assert.strictEqual(entry(root, "QNA-0002"), undefined, "nothing was written");
  assert.match(ok(root, ["resume", "--project-root", root]), /First, finish what is open/);
});

test("qa-supersede is refused while a human override is unreconciled", (t) => {
  const root = project(t);
  ask(root, "1", "Who uses this?");
  fs.writeFileSync(path.join(root, "change.md"), "Drop the offline requirement.\n");
  ok(root, ["override", "--project-root", root, "--instruction-file", path.join(root, "change.md"), "--owner", "Ada"]);

  const out = refused(root, [
    "qa-supersede", "--project-root", root, "--id", "1", "--new-id", "2",
    "--question", "Who uses this, exactly?", "--rationale", "Reworded.",
    "--reason", "Reworded.", "--owner", "Ada",
  ]);
  assert.match(out, /reconcil/i, "the same block qa-ask already respects");
});

test("the agent that answered does not overwrite the agent that asked", (t) => {
  const root = project(t);
  ask(root, "1", "Who uses this?", ["--agent", "codex/session-a"]);
  ok(root, [
    "qa-answer", "--project-root", root, "--id", "1",
    "--answer-file", answerFile(root, "Dispatchers."), "--owner", "Ada",
    "--agent", "claude/session-b",
  ]);

  const recorded = entry(root, "QNA-0001");
  assert.strictEqual(recorded.agent, "codex/session-a", "who asked is a fact about the question");
  assert.strictEqual(recorded.answered_by_agent, "claude/session-b", "who recorded the answer is a different one");

  const document = view(root);
  assert.match(document, /Asked by: codex\/session-a/);
  assert.match(document, /Answer recorded by: claude\/session-b/);
});

test("a consequence has to be a record the answer created or changed", (t) => {
  const root = project(t);
  // A decision that exists before the question is even asked.
  ok(root, ["decision", "--project-root", root, "--id", "DEC-0014", "--title", "Budget ceiling", "--status", "APPROVED", "--owner", "Ada"]);
  ask(root, "1", "What is the budget ceiling?");
  answer(root, "1", "Eighty thousand.");

  const out = refused(root, [
    "qa-settle", "--project-root", root, "--id", "1",
    "--interpretation", "x", "--reply", "y", "--consequences", "DEC-0014", "--owner", "Ada",
  ]);
  assert.match(out, /last changed before QNA-0001 was asked/);
  assert.match(out, /created or changed/, "the document says so, and this is what makes it true");
  assert.strictEqual(entry(root, "QNA-0001").consequences_recorded_at, null);

  // Change it now — an update to a record carries its expected revision, like
  // every other guarded write — and it becomes a legitimate consequence.
  ok(root, [
    "decision", "--project-root", root, "--id", "DEC-0014", "--title", "Budget ceiling: 80k",
    "--status", "APPROVED", "--owner", "Ada", "--expected-revision", "1",
  ]);
  ok(root, [
    "qa-settle", "--project-root", root, "--id", "1",
    "--interpretation", "x", "--reply", "y", "--consequences", "DEC-0014", "--owner", "Ada",
  ]);
  assert.deepStrictEqual(entry(root, "QNA-0001").consequences, ["DEC-0014"]);
});

test("settling moves the recorded next action on, and keeps one a person wrote", (t) => {
  const root = project(t);
  ask(root, "1", "Who uses this?");
  answer(root, "1", "Dispatchers.");
  ok(root, [
    "qa-settle", "--project-root", root, "--id", "1",
    "--interpretation", "One role.", "--reply", "Noted.",
    "--next-id", "2", "--next-question", "And who approves?", "--owner", "Ada",
  ]);

  /*
   * The frontier ranks the exact next action third. It was never advanced, so
   * every project driven by this ledger kept printing init's placeholder —
   * "discuss module 1" — above the interview it was actually in, and an agent
   * obeying the bold line would do the one thing the skill forbids.
   */
  assert.match(state(root).exact_next_action, /QNA-0002/);
  const resumed = ok(root, ["resume", "--project-root", root]);
  assert.doesNotMatch(resumed, /\*\*Start here\.\*\* Exact next action, as recorded: Run `plangonaut next/);
  assert.match(resumed, /\*\*Start here\.\*\*[\s\S]*QNA-0002/);

  // A sentence a person wrote is still kept; the suggestion is reported instead.
  const second = project(t);
  ok(second, ["checkpoint", "--project-root", second, "--id", "CHK-0001", "--name", "Hand over", "--owner", "Ada", "--next-action", "Wait for the surveyor."]);
  ask(second, "1", "Who uses this?");
  answer(second, "1", "Dispatchers.");
  const out = ok(second, [
    "qa-settle", "--project-root", second, "--id", "1",
    "--interpretation", "One role.", "--reply", "Noted.", "--owner", "Ada",
  ]);
  assert.strictEqual(state(second).exact_next_action, "Wait for the surveyor.");
  assert.match(out, /written by a person, so it is kept unchanged/);
});

test("a reconstructed entry has to name its evidence, and invents no timestamp", (t) => {
  const root = project(t);

  const refusedWithout = refused(root, [
    "qa-ask", "--project-root", root, "--id", "1", "--question", "What was the budget?",
    "--rationale", "Recovering an old interview.", "--owner", "Ada", "--reconstructed",
  ]);
  assert.match(refusedWithout, /--reconstructed needs --reconstructed-from/);

  const refusedMissing = refused(root, [
    "qa-ask", "--project-root", root, "--id", "1", "--question", "What was the budget?",
    "--rationale", "Recovering an old interview.", "--owner", "Ada",
    "--reconstructed", "--reconstructed-from", "docs/nowhere.md",
  ]);
  assert.match(refusedMissing, /does not exist inside the project/);

  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "verbale-2025.md"), "# Verbale\n\nBudget: 80k.\n");
  ok(root, [
    "qa-ask", "--project-root", root, "--id", "1", "--question", "What was the budget?",
    "--rationale", "Recovering an old interview.", "--owner", "Ada",
    "--reconstructed", "--reconstructed-from", "docs/verbale-2025.md",
  ]);

  const recorded = entry(root, "QNA-0001");
  assert.strictEqual(recorded.reconstructed, true);
  assert.strictEqual(recorded.reconstructed_from, "docs/verbale-2025.md");
  assert.strictEqual(recorded.asked_at, null, "the instant it was really asked is not known, so none is invented");
  assert.match(view(root), /Reconstructed from: docs\/verbale-2025\.md/);
});

test("the catalog marks a question the ledger already answers", (t) => {
  const root = project(t);
  // The literal first catalog question of module 1.
  const question = "What is the working name and one-sentence purpose?";
  ok(root, [
    "qa-ask", "--project-root", root, "--id", "1", "--question", question,
    "--rationale", "Module 1.", "--module", "1", "--owner", "Ada",
  ]);
  answer(root, "1", "Forno di quartiere: pane a prenotazione settimanale.");
  ok(root, [
    "qa-settle", "--project-root", root, "--id", "1",
    "--interpretation", "Name and purpose recorded.", "--reply", "Noted.", "--owner", "Ada",
  ]);

  // `next` used to reprint it word for word, with no idea the ledger existed.
  const out = ok(root, ["next", "--project-root", root, "--count", "2"]);
  assert.match(out, /Already recorded as answered in QNA-0001/);
  assert.match(out, /Do not ask it again unless that answer was invalidated/);
});

test("points recorded as still open reach Resume, not only the document", (t) => {
  const root = project(t);
  ask(root, "1", "Who uses this?");
  answer(root, "1", "Dispatchers.");
  ok(root, [
    "qa-settle", "--project-root", root, "--id", "1",
    "--interpretation", "One role.", "--reply", "Noted.",
    "--open-points", "Whether the committee approves or only sees",
    "--owner", "Ada",
  ]);

  // They were written into the document and nowhere else, so the one thing a
  // fresh agent is told to read never mentioned them.
  const resumed = ok(root, ["resume", "--project-root", root]);
  assert.match(resumed, /Points recorded as still open/);
  assert.match(resumed, /QNA-0001: Whether the committee approves or only sees/);
});
