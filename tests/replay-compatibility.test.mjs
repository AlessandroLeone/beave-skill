import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ageProject } from "./older-engine.mjs";

/**
 * The replay and the journal, against the projects that already exist.
 *
 * A mechanism that only works on a folder it created is not a recovery
 * mechanism. These cases are the ones a real user arrives with: a project
 * written by an older engine, a folder whose path has a space or a name that is
 * not ASCII, a package handed over to somebody else, and a project that is all a
 * fresh agent has.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "lib", "bin", "plangonaut.js");

let counter = 0;

function plangonaut(root, args) {
  counter += 1;
  const full = [...args];
  if (!full.includes("--operation-id")) full.push("--operation-id", `c${counter}-${Date.now()}`);
  const result = spawnSync(process.execPath, [CLI, ...full], { cwd: root, encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}${result.stderr}`.trim() };
}

function ok(root, args) {
  const result = plangonaut(root, args);
  assert.strictEqual(result.status, 0, `expected success from ${args[0]}:\n${result.out}`);
  return result.out;
}

function projectAt(t, root, name) {
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
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

function scratch(t, folder) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-compat-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return path.join(base, folder);
}

test("a folder whose path has spaces and non-ASCII characters replays like any other", (t) => {
  const root = projectAt(t, scratch(t, "il forno del quartiere — cartella"), "Forno");
  ok(root, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Impasto a lievitazione lunga", "--status", "APPROVED", "--owner", "Ada"]);
  ok(root, ["qa-ask", "--project-root", root, "--id", "QNA-0001", "--question", "Quante infornate a settimana?", "--rationale", "Dimensionare il forno", "--owner", "Ada"]);

  assert.match(ok(root, ["replay", "--project-root", root]), /matches its history exactly/);
  assert.strictEqual(plangonaut(root, ["validate", "--project-root", root]).status, 0);

  // The text survives the round trip through the event log byte for byte.
  const events = fs.readFileSync(path.join(root, ".plangonaut", "events.jsonl"), "utf8");
  assert.match(events, /Impasto a lievitazione lunga/);
  assert.match(events, /Quante infornate a settimana\?/);
});

test("a recorded path spelled the Windows way does not stop a replay", (t) => {
  const root = projectAt(t, scratch(t, "windows-spelling"), "Windows");
  fs.writeFileSync(path.join(root, "draft.md"), "The plan.\n");
  const base = ["--project-root", root, "--id", "ART-0001", "--base-path", "docs/plan.md", "--content-file", path.join(root, "draft.md"), "--owner", "Ada"];
  const preview = JSON.parse(ok(root, ["doc-diff", ...base]));
  ok(root, ["doc-save", ...base, "--confirm-token", preview.confirmation_token]);

  const statePath = path.join(root, ".plangonaut", "state.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.artifacts[0].base_path = state.artifacts[0].base_path.replaceAll("/", "\\");
  state.artifacts[0].working_path = state.artifacts[0].working_path.replaceAll("/", "\\");
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  // The spelling comes from an older engine, and so does the history it belongs to.
  ageProject(root);

  assert.strictEqual(plangonaut(root, ["validate", "--project-root", root]).status, 0);
  ok(root, ["migrate", "--project-root", root]);
  ok(root, ["baseline", "--project-root", root, "--reason", "Upgraded after normalising historic separators", "--owner", "Ada"]);
  assert.match(ok(root, ["replay", "--project-root", root]), /matches its history exactly/);
});

test("a project handed over in a package replays in the folder it arrives in", (t) => {
  const root = projectAt(t, scratch(t, "source"), "Handover");
  fs.writeFileSync(path.join(root, "handoff.md"), "# Handoff\n\nWhat the next person needs.\n");
  const base = ["--project-root", root, "--id", "ART-HANDOFF", "--base-path", "docs/HANDOFF.md", "--content-file", path.join(root, "handoff.md"), "--owner", "Ada"];
  const preview = JSON.parse(ok(root, ["doc-diff", ...base]));
  ok(root, ["doc-save", ...base, "--confirm-token", preview.confirmation_token]);
  ok(root, ["doc-finalize", "--project-root", root, "--id", "ART-HANDOFF", "--owner", "Ada"]);
  ok(root, ["qa-ask", "--project-root", root, "--id", "QNA-0001", "--question", "Who signs off?", "--rationale", "Authority", "--owner", "Ada"]);

  const pkg = scratch(t, "package");
  ok(root, ["project-export", "--project-root", root, "--output-dir", pkg]);
  ok(root, ["project-verify", "--package-dir", pkg]);

  const destination = scratch(t, "delivered");
  ok(root, ["project-import", "--package-dir", pkg, "--project-root", destination]);

  /*
   * The delivered folder is reproducible from the moment it came into existence.
   * What travelled with it is one event — the export origin — because the
   * exporter's own log recorded the exporter's absolute path, and a handoff does
   * not carry the machine that made it (ALN-014). So the replay covers the
   * import, and says that the one event before it is outside the proof.
   */
  const replayed = ok(destination, ["replay", "--project-root", destination]);
  assert.match(replayed, /matches its history exactly/);
  assert.match(replayed, /from PROJECT_PACKAGE_IMPORTED/);
  assert.match(replayed, /1 earlier event is kept in the file and is not covered by this proof/);
  assert.strictEqual(plangonaut(destination, ["validate", "--project-root", destination]).status, 0);

  // And that one event is the export origin, which names the history it was made
  // from without carrying it.
  const arrived = fs
    .readFileSync(path.join(destination, ".plangonaut", "events.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.deepStrictEqual(arrived.map((event) => event.type), ["PROJECT_PACKAGE_EXPORTED", "PROJECT_PACKAGE_IMPORTED"]);
  assert.match(arrived[0].source_history_sha256, /^[a-f0-9]{64}$/);
  assert.ok(arrived[0].source_event_count >= 1);

  // And the interview arrived with it.
  const resumed = ok(destination, ["resume", "--project-root", destination]);
  assert.match(resumed, /Who signs off\?/);
});

test("a project is all a fresh agent needs: resume states the position and the integrity in one read", (t) => {
  const root = projectAt(t, scratch(t, "fresh"), "Fresh");
  ok(root, ["qa-ask", "--project-root", root, "--id", "QNA-0001", "--question", "How many loaves a week?", "--rationale", "Sizing", "--owner", "Ada"]);
  fs.writeFileSync(path.join(root, "a.md"), "About two hundred.\n");
  ok(root, ["qa-answer", "--project-root", root, "--id", "QNA-0001", "--answer-file", path.join(root, "a.md"), "--owner", "Ada"]);

  const resumed = ok(root, ["resume", "--project-root", root]);
  // The position.
  assert.match(resumed, /Where to continue/);
  assert.match(resumed, /QNA-0001/);
  // The recorded answer, and that it has not been applied.
  assert.match(resumed, /not yet applied|recorded answer and no recorded consequences/);
  // And nothing about integrity, because there is nothing to report.
  assert.doesNotMatch(resumed, /Resume blocked/);
  assert.doesNotMatch(resumed, /An interrupted operation was recovered/);
});

test("an older project keeps working, and is told exactly what it cannot prove", (t) => {
  const root = projectAt(t, scratch(t, "older"), "Older");
  ok(root, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Bake weekly", "--status", "APPROVED", "--owner", "Ada"]);
  const aged = ageProject(root);
  assert.ok(aged >= 2);

  // Everything still works. The only difference is what can be proved about it.
  assert.strictEqual(plangonaut(root, ["validate", "--project-root", root]).status, 0);
  ok(root, ["risk", "--project-root", root, "--id", "RSK-0001", "--title", "Oven fails", "--severity", "HIGH", "--status", "IDENTIFIED", "--owner", "Ada"]);

  const validated = ok(root, ["validate", "--project-root", root]);
  assert.match(validated, /Plangonaut state is valid/);
  assert.match(validated, /no point the state can be rebuilt from/);
  assert.match(validated, /plangonaut baseline/);

  const resumed = ok(root, ["resume", "--project-root", root]);
  assert.match(resumed, /What the history can and cannot prove/);
  assert.doesNotMatch(resumed, /Resume blocked/);
});
