import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * A handoff must not carry the machine that made it.
 *
 * `project.root` is an absolute path, and it was in two places in every package:
 * `state.json`, and the first event's patch — which is where the whole state was
 * written when the project began. So a package disclosed the user's name, the
 * drive letter and the folder layout of whoever exported it, to everybody they
 * ever gave it to, in a file the recipient has no reason to read. And it was
 * useless there: the import rewrites it on arrival.
 *
 * Rewriting recorded events was never an option. So a package carries a
 * *portable replay origin* instead: one event holding the whole state with the
 * root replaced, plus the digest, length and last event id of the history it was
 * made from. The recipient can replay everything from the moment the package was
 * made; what came before is attested by that digest and is not claimed to be
 * reproduced, because it is not there.
 *
 * These tests use sentinels — a user name and a folder name that exist nowhere
 * else — so that a leak is a failing assertion and not a judgement call.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "lib", "bin", "beave.js");

const SENTINEL_USER = "SENTINELUSER-b7f2";
const SENTINEL_FOLDER = "Cartella Sentinella — privata";

let counter = 0;

function beave(cwd, args, env = {}) {
  counter += 1;
  const full = [...args];
  if (!full.includes("--operation-id")) full.push("--operation-id", `PKG${counter}-${Date.now()}`);
  const result = spawnSync(process.execPath, [CLI, ...full], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  return { status: result.status, out: `${result.stdout}${result.stderr}`.trim() };
}

function ok(cwd, args, env) {
  const result = beave(cwd, args, env);
  assert.strictEqual(result.status, 0, `expected success from ${args[0]}:\n${result.out}`);
  return result.out;
}

function base(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "beave-portable-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A project under a path that is its own sentinel, ready to be handed over. */
function exportable(t, folder = SENTINEL_FOLDER) {
  const root = path.join(base(t), "Users", SENTINEL_USER, folder, "progetto");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "owners.json"),
    JSON.stringify({ product: "Ada", technical: "Ada", budget: "Ada", safety: "Ada", release: "Ada" }),
  );
  ok(root, [
    "init", "--project-root", root, "--project-name", "Portabile",
    "--project-mode", "Genesis", "--interaction-mode", "Standard",
    "--owners-file", path.join(root, "owners.json"),
  ]);
  ok(root, ["qa-ask", "--project-root", root, "--id", "QNA-0001", "--question", "Chi firma?", "--rationale", "Serve per la consegna.", "--owner", "Ada"]);
  ok(root, ["qa-answer", "--project-root", root, "--id", "QNA-0001", "--answer", "Nadia.", "--owner", "Ada"]);
  ok(root, ["decision", "--project-root", root, "--id", "DEC-1", "--title", "Consegna a Nadia", "--status", "APPROVED", "--owner", "Ada"]);
  ok(root, ["requirement", "--project-root", root, "--id", "REQ-1", "--title", "Una firma", "--status", "ACTIVE", "--owner", "Ada"]);
  ok(root, ["risk", "--project-root", root, "--id", "RSK-1", "--title", "Nessuno firma", "--severity", "MEDIUM", "--status", "IDENTIFIED", "--owner", "Ada"]);

  const doc = path.join(root, "handoff.md");
  fs.writeFileSync(doc, "# Consegna\n\nQuello che serve sapere.\n");
  const args = ["--project-root", root, "--id", "ART-1", "--base-path", "docs/HANDOFF.md", "--content-file", doc, "--owner", "Ada"];
  const preview = JSON.parse(ok(root, ["doc-diff", ...args]));
  ok(root, ["doc-save", ...args, "--confirm-token", preview.confirmation_token]);
  ok(root, ["doc-finalize", "--project-root", root, "--id", "ART-1", "--owner", "Ada"]);
  return root;
}

/** Everything in the package, as text, with its path. */
function packageContents(pkg) {
  const out = [];
  const walk = (dir, prefix = "") => {
    for (const entry of fs.readdirSync(dir).sort()) {
      const candidate = path.join(dir, entry);
      const relative = prefix ? `${prefix}/${entry}` : entry;
      if (fs.statSync(candidate).isDirectory()) { walk(candidate, relative); continue; }
      out.push({ path: relative, body: fs.readFileSync(candidate, "utf8") });
    }
  };
  walk(pkg);
  return out;
}

/**
 * The scan the contract requires: content *and* names, for everything that
 * belongs to the machine rather than to the project.
 */
function leaks(pkg, root) {
  const needles = [
    ["the sentinel user name", SENTINEL_USER],
    ["the sentinel folder", SENTINEL_FOLDER],
    ["the exporting project's path", root],
    ["an absolute Windows path", "[A-Za-z]:\\\\\\\\"],
    ["an absolute Windows path", "[A-Za-z]:/"],
    ["the operating-system temp directory", path.parse(os.tmpdir()).base],
    ["this machine's hostname", os.hostname()],
    ["this account's user name", os.userInfo().username],
    ["a process id field", '"pid"'],
    ["a staging marker", "beave-staging"],
    ["a journal", '"journal"'],
    ["a lock", "lock.json"],
  ];
  const found = [];
  for (const file of packageContents(pkg)) {
    for (const [label, needle] of needles) {
      const pattern = new RegExp(needle.length > 3 && /[\\[\\\\]/.test(needle) ? needle : needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      if (pattern.test(file.body)) found.push(`${label} in ${file.path}`);
      if (pattern.test(file.path)) found.push(`${label} in the NAME of ${file.path}`);
    }
  }
  return [...new Set(found)];
}

// ---------------------------------------------------------------------------

test("an exported package carries nothing that belongs to the machine that made it", (t) => {
  const root = exportable(t);
  const pkg = path.join(base(t), "pacchetto");
  ok(root, ["project-export", "--project-root", root, "--output-dir", pkg]);

  assert.deepStrictEqual(leaks(pkg, root), [], "the package discloses the exporting environment");

  // And the state it carries says plainly that it is a package, not a location.
  const state = JSON.parse(fs.readFileSync(path.join(pkg, "state", "state.json"), "utf8"));
  assert.strictEqual(state.project.root, "<packaged>");
});

test("a path with spaces and one with non-ASCII characters export just as clean", (t) => {
  for (const folder of ["Con Spazi E Spazi", "Cartella con àccènti e 日本語"]) {
    const root = exportable(t, folder);
    const pkg = path.join(base(t), "pacchetto");
    ok(root, ["project-export", "--project-root", root, "--output-dir", pkg]);
    assert.deepStrictEqual(leaks(pkg, root), [], `a package exported from ${folder} discloses the environment`);
  }
});

test("the package declares the transformation, and the digest of the history it was made from", (t) => {
  const root = exportable(t);
  const pkg = path.join(base(t), "pacchetto");
  ok(root, ["project-export", "--project-root", root, "--output-dir", pkg]);

  const manifest = JSON.parse(fs.readFileSync(path.join(pkg, "manifest.json"), "utf8"));
  const transform = manifest.history_transform;
  assert.strictEqual(transform.kind, "portable-replay-origin");
  assert.match(transform.source_history_sha256, /^[a-f0-9]{64}$/);

  // The digest is of the exporting project's real history, and can be checked
  // against it by anyone holding both.
  const sourceHistory = fs.readFileSync(path.join(root, ".beave", "events.jsonl"), "utf8");
  const digest = spawnSync(process.execPath, ["-e", "const c=require('node:crypto'),f=require('node:fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))", path.join(root, ".beave", "events.jsonl")], { encoding: "utf8" }).stdout;
  assert.strictEqual(transform.source_history_sha256, digest);
  assert.strictEqual(transform.source_event_count, sourceHistory.split(/\r?\n/).filter(Boolean).length);

  // And PROJECT_ENTRY.md tells the recipient, in words, what they did and did not get.
  const entry = fs.readFileSync(path.join(pkg, "PROJECT_ENTRY.md"), "utf8");
  assert.match(entry, /holds \*\*one\*\* event/);
  assert.match(entry, /attested|digest/);
});

test("the package arrives somewhere completely different and is a project there", (t) => {
  const root = exportable(t);
  const pkg = path.join(base(t), "pacchetto");
  ok(root, ["project-export", "--project-root", root, "--output-dir", pkg]);

  // Another user, another folder, another spelling: nothing of the source path.
  const destination = path.join(base(t), "Users", "ALTRO-UTENTE", "Documenti", "arrivo");
  ok(root, ["project-import", "--package-dir", pkg, "--project-root", destination, "--operation-id", "OP-ARRIVE"]);

  assert.strictEqual(beave(destination, ["validate", "--project-root", destination]).status, 0);
  assert.strictEqual(beave(destination, ["replay", "--project-root", destination, "--verify"]).status, 0);
  const resumed = beave(destination, ["resume", "--project-root", destination]);
  assert.strictEqual(resumed.status, 0, resumed.out);

  // Everything the project decided came with it.
  const state = JSON.parse(fs.readFileSync(path.join(destination, ".beave", "state.json"), "utf8"));
  assert.strictEqual(state.project.root, destination);
  assert.deepStrictEqual(state.decisions.map((item) => item.id), ["DEC-1"]);
  assert.deepStrictEqual(state.requirements.map((item) => item.id), ["REQ-1"]);
  assert.deepStrictEqual(state.risks.map((item) => item.id), ["RSK-1"]);
  assert.deepStrictEqual(state.artifacts.map((item) => item.id), ["ART-1"]);

  // Including the interview, in the ledger and in the document that renders it.
  assert.deepStrictEqual(state.interview_log.map((item) => item.id), ["QNA-0001"]);
  const rendered = fs.readFileSync(path.join(destination, "QUESTION_ANSWER_HISTORY.md"), "utf8");
  assert.match(rendered, /Chi firma\?/);
  assert.match(rendered, /Nadia/);
  assert.ok(fs.existsSync(path.join(destination, "docs", "HANDOFF.md")), "the published document did not arrive");
});

test("exporting changes nothing in the project that was exported", (t) => {
  const root = exportable(t);
  const before = fs.readFileSync(path.join(root, ".beave", "events.jsonl"), "utf8");
  const beforeState = fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8");

  ok(root, ["project-export", "--project-root", root, "--output-dir", path.join(base(t), "pacchetto")]);

  assert.strictEqual(fs.readFileSync(path.join(root, ".beave", "events.jsonl"), "utf8"), before, "the export rewrote the source history");
  assert.strictEqual(fs.readFileSync(path.join(root, ".beave", "state.json"), "utf8"), beforeState, "the export rewrote the source state");
  assert.strictEqual(beave(root, ["validate", "--project-root", root]).status, 0);
  assert.strictEqual(beave(root, ["replay", "--project-root", root, "--verify"]).status, 0);
});

test("two exports of the same project produce the same files, apart from the instants they record", (t) => {
  const root = exportable(t);
  const first = path.join(base(t), "uno");
  const second = path.join(base(t), "due");
  ok(root, ["project-export", "--project-root", root, "--output-dir", first]);
  ok(root, ["project-export", "--project-root", root, "--output-dir", second]);

  const names = (pkg) => packageContents(pkg).map((file) => file.path);
  assert.deepStrictEqual(names(first), names(second));

  // Every file that is not a timestamped record of the export itself is identical.
  for (const file of packageContents(first)) {
    if (file.path === "manifest.json" || file.path === "state/events.jsonl" || file.path === "state/state.json") continue;
    assert.strictEqual(file.body, fs.readFileSync(path.join(second, file.path), "utf8"), `${file.path} differs between two exports`);
  }
});

test("a package somebody edited is refused", (t) => {
  const root = exportable(t);
  const pkg = path.join(base(t), "pacchetto");
  ok(root, ["project-export", "--project-root", root, "--output-dir", pkg]);

  const target = path.join(pkg, "files", "docs", "HANDOFF.md");
  fs.writeFileSync(target, `${fs.readFileSync(target, "utf8")}\nand one more line nobody recorded\n`);

  const verified = beave(root, ["project-verify", "--package-dir", pkg]);
  assert.notStrictEqual(verified.status, 0, "an edited package verified");
  const imported = beave(root, ["project-import", "--package-dir", pkg, "--project-root", path.join(base(t), "arrivo")]);
  assert.notStrictEqual(imported.status, 0, "an edited package imported");
});

test("NEGATIVE CONTROL: the scan finds each thing it is looking for when it is there", (t) => {
  const root = exportable(t);
  const pkg = path.join(base(t), "pacchetto");
  ok(root, ["project-export", "--project-root", root, "--output-dir", pkg]);
  assert.deepStrictEqual(leaks(pkg, root), [], "the clean package must be clean before this control means anything");

  /*
   * Every needle, planted on purpose, one at a time. A scan that reports nothing
   * because its patterns are wrong looks exactly like a package that is clean,
   * and this repository has already shipped one control that passed by comparing
   * a contaminated file with itself.
   */
  const plants = [
    ["content: the sentinel user", "planted.txt", `a line naming ${SENTINEL_USER}\n`],
    ["content: the sentinel folder", "planted.txt", `a line naming ${SENTINEL_FOLDER}\n`],
    ["content: an absolute Windows path", "planted.txt", "C:\\\\Users\\\\qualcuno\\\\progetto\n"],
    ["content: the exporting path", "planted.txt", `${root}\n`],
    ["content: this hostname", "planted.txt", `${os.hostname()}\n`],
    ["content: a pid field", "planted.txt", '{"pid": 4242}\n'],
    ["content: a lock", "planted.txt", "lock.json\n"],
    ["content: a staging marker", "planted.txt", ".beave-staging.json\n"],
    ["a file NAMED after the sentinel user", `${SENTINEL_USER}.txt`, "harmless\n"],
  ];

  for (const [what, name, body] of plants) {
    const planted = path.join(pkg, name);
    fs.writeFileSync(planted, body);
    const found = leaks(pkg, root);
    fs.rmSync(planted, { force: true });
    assert.ok(found.length > 0, `the scan did not notice ${what}`);
  }

  // And it is clean again once they are gone, so the control cannot pass by
  // leaving the package dirty.
  assert.deepStrictEqual(leaks(pkg, root), []);
});

// ---------------------------------------------------------------------------
// What the fourth independent review reproduced, 2026-09-12
// ---------------------------------------------------------------------------

test("a package carrying a staging marker is refused, because that file is the machine", (t) => {
  const root = exportable(t);
  const pkg = path.join(base(t), "interrotto");

  // Killed between the rename and the marker's removal: the package is complete
  // and carries one file that names the machine that made it.
  const killed = spawnSync(process.execPath, [CLI, "project-export", "--project-root", root, "--output-dir", pkg, "--operation-id", "OP-KILLED"], {
    cwd: root, encoding: "utf8", env: { ...process.env, BEAVE_FAULT_AT: "staging-after-rename" },
  });
  assert.strictEqual(killed.status, 97, `${killed.stdout}${killed.stderr}`);

  const marker = JSON.parse(fs.readFileSync(path.join(pkg, ".beave-staging.json"), "utf8"));
  assert.ok(marker.host && marker.pid && marker.source, "the marker no longer carries what this test is about");

  /*
   * `project-verify` printed "It is harmless and is not part of the package" and
   * exited 0 — over a file holding the exporter's absolute paths, hostname and
   * PID, in the one command whose job is to check a package before a handoff.
   */
  const verified = beave(root, ["project-verify", "--package-dir", pkg]);
  assert.notStrictEqual(verified.status, 0);
  assert.match(verified.out, /records the exporting machine/);
  assert.doesNotMatch(verified.out, /harmless/);

  const imported = beave(root, ["project-import", "--package-dir", pkg, "--project-root", path.join(base(t), "arrivo")]);
  assert.notStrictEqual(imported.status, 0);

  // The scan agrees with the refusal: while that file is there, the package
  // discloses the machine.
  assert.ok(leaks(pkg, root).length > 0, "the scan should see what the refusal is about");
  ok(root, ["recover", "--project-root", root, "--apply"]);
  assert.deepStrictEqual(leaks(pkg, root), []);
  ok(root, ["project-verify", "--package-dir", pkg]);
});

test("the manifest cannot claim a history the package's own origin contradicts", (t) => {
  const root = exportable(t);
  const pkg = path.join(base(t), "pacchetto");
  ok(root, ["project-export", "--project-root", root, "--output-dir", pkg]);

  /*
   * `history_transform` is what a recipient matches a package against its source
   * by, and nothing compared it with the origin event three files away: sixty-
   * four zeroes and a count of 9999 both verified.
   */
  for (const [field, value] of [["source_history_sha256", "0".repeat(64)], ["source_event_count", 9999], ["source_last_event_id", "not-the-one"]]) {
    const manifestPath = path.join(pkg, "manifest.json");
    const original = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(original);
    manifest.history_transform[field] = value;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const verified = beave(root, ["project-verify", "--package-dir", pkg]);
    assert.notStrictEqual(verified.status, 0, `a manifest claiming a false ${field} verified`);
    assert.match(verified.out, /disagree about|contradicts itself/);

    /*
     * And the command that *acts* makes the same check. For one round it did
     * not, and the re-check named why that is worse than it sounds: import
     * writes `package_manifest_sha256` into the destination's event log, so
     * importing a falsified package notarises the false attestation in the one
     * place it will be read back later.
     */
    const destination = path.join(base(t), `from-false-${field}`);
    const imported = beave(root, ["project-import", "--package-dir", pkg, "--project-root", destination]);
    assert.notStrictEqual(imported.status, 0, `a manifest claiming a false ${field} was imported`);
    assert.ok(!fs.existsSync(destination));
    fs.writeFileSync(manifestPath, original);
  }
  ok(root, ["project-verify", "--package-dir", pkg]);
});

test("PROJECT_ENTRY.md does not promise a history the package does not carry", (t) => {
  const root = exportable(t);
  const pkg = path.join(base(t), "pacchetto");
  ok(root, ["project-export", "--project-root", root, "--output-dir", pkg]);
  const destination = path.join(base(t), "arrivo");
  ok(root, ["project-import", "--package-dir", pkg, "--project-root", destination, "--operation-id", "OP-ENTRY"]);

  /*
   * The file every recipient reads said `doc-history` would work "exactly as it
   * did for whoever exported". It returns `[]`: it reads the event log, and the
   * log a package carries begins at the export.
   */
  const history = beave(destination, ["doc-history", "--project-root", destination, "--id", "ART-1"]);
  assert.strictEqual(history.status, 0);
  const entry = fs.readFileSync(path.join(pkg, "PROJECT_ENTRY.md"), "utf8");
  if (JSON.parse(history.out.trim() || "[]").length === 0) {
    assert.match(entry, /will be \*\*empty\*\* for anything that happened before this package was made/);
  }
  // And what the package does still give back is what it says it gives back.
  assert.match(entry, /doc-restore\` brings an earlier revision back/);
  ok(destination, ["doc-restore", "--project-root", destination, "--id", "ART-1", "--revision", "1", "--owner", "Ada", "--operation-id", "OP-RESTORE"]);
});

// ---------------------------------------------------------------------------
// What the bounded check of the three fixes reproduced, 2026-09-12
// ---------------------------------------------------------------------------

test("a package with no attestation at all is refused, and a falsy one is not a missing one", (t) => {
  const root = exportable(t);
  const pkg = path.join(base(t), "senza-attestazione");
  ok(root, ["project-export", "--project-root", root, "--output-dir", pkg]);
  const manifestPath = path.join(pkg, "manifest.json");
  const original = fs.readFileSync(manifestPath, "utf8");

  /*
   * The check began `if (!declared) return`. So an attacker never had to falsify
   * the digest, the count or the last event id — deleting the block was enough,
   * and so was `null`, `false`, `""` or `0`. Both commands answered exit 0 and
   * the import notarised the unattested manifest in the destination's log.
   */
  for (const [what, mutate] of [
    ["removed", (manifest) => { delete manifest.history_transform; }],
    ["null", (manifest) => { manifest.history_transform = null; }],
    ["false", (manifest) => { manifest.history_transform = false; }],
    ["an empty string", (manifest) => { manifest.history_transform = ""; }],
    ["zero", (manifest) => { manifest.history_transform = 0; }],
  ]) {
    const manifest = JSON.parse(original);
    mutate(manifest);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const verified = beave(root, ["project-verify", "--package-dir", pkg]);
    assert.notStrictEqual(verified.status, 0, `an attestation ${what} verified`);
    assert.match(verified.out, /declares no `history_transform`|disagree about|contradicts itself/);

    const destination = path.join(base(t), `arrivo-${what.replace(/\s+/g, "-")}`);
    const imported = beave(root, ["project-import", "--package-dir", pkg, "--project-root", destination]);
    assert.notStrictEqual(imported.status, 0, `an attestation ${what} was imported`);
    assert.ok(!fs.existsSync(destination), `the destination was created for an attestation ${what}`);
  }

  fs.writeFileSync(manifestPath, original);
  ok(root, ["project-verify", "--package-dir", pkg]);
});

test("a package whose ledger was edited is refused, not imported and then found broken", (t) => {
  const root = exportable(t);
  const pkg = path.join(base(t), "ledger-modificato");
  ok(root, ["project-export", "--project-root", root, "--output-dir", pkg]);

  /*
   * The forgery the check reproduced: edit the origin event, repair the
   * manifest's `history_transform` to agree with it, and repair that file's
   * entry in the manifest's file list. Everything the two commands looked at
   * agreed — and the imported project failed `validate` on the next command
   * with "the event was edited after it was written". The engine could always
   * tell; the gate simply never asked.
   */
  const eventsPath = path.join(pkg, "state", "events.jsonl");
  const origin = JSON.parse(fs.readFileSync(eventsPath, "utf8").split(/\r?\n/).filter(Boolean)[0]);
  origin.source_event_count = 4242;
  origin.source_history_sha256 = "b".repeat(64);
  const forged = `${JSON.stringify(origin)}\n`;
  fs.writeFileSync(eventsPath, forged);

  const manifestPath = path.join(pkg, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.history_transform.source_event_count = 4242;
  manifest.history_transform.source_history_sha256 = "b".repeat(64);
  const entry = manifest.files.find((item) => item.path === "state/events.jsonl");
  entry.sha256 = crypto.createHash("sha256").update(forged).digest("hex");
  entry.bytes = Buffer.byteLength(forged);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const verified = beave(root, ["project-verify", "--package-dir", pkg]);
  assert.notStrictEqual(verified.status, 0, "a package with an edited ledger verified");
  assert.match(verified.out, /does not match the digest it records of itself/);

  const destination = path.join(base(t), "da-ledger-modificato");
  const imported = beave(root, ["project-import", "--package-dir", pkg, "--project-root", destination]);
  assert.notStrictEqual(imported.status, 0, "a package with an edited ledger was imported");
  assert.ok(!fs.existsSync(destination));
});
