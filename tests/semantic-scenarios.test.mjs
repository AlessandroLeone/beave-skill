import { test, describe, it } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CLI = path.resolve("lib/bin/plangonaut.js");

function runCli(args, cwd) {
  if (["record","override","reconcile","decision","requirement","task","dependency","risk","evidence","agent","checkpoint","gate","doc-save","doc-mark-deletion","doc-restore","doc-finalize"].includes(args[0]) && !args.includes("--operation-id")) args = [...args, "--operation-id", `OP-${crypto.randomUUID()}`];
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("IMP-006 Semantic Scenarios and Discovery Tests", () => {
  it("exports portable markdown containing the canonical source digest", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-test-semantic-1-"));
    const res = runCli(["export", "--target", "portable", "--output-dir", root], root);
    assert.strictEqual(res.status, 0);
    
    const portableFile = path.join(root, "plangonaut-portable.md");
    assert.ok(fs.existsSync(portableFile));
    const content = fs.readFileSync(portableFile, "utf8");
    
    assert.ok(content.includes("<!-- Canonical source digest: "));
    assert.ok(content.includes("# Plangonaut — Portable Semantic Edition"));
  });

  it("installs an adapter and verifies its integrity", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-test-semantic-2-"));
    
    // Install codex locally
    let res = runCli(["install", "--target", "codex", "--scope", "project", "--project-root", root], root);
    assert.strictEqual(res.status, 0);
    
    const dest = path.join(root, ".agents", "skills", "plangonaut");
    assert.ok(fs.existsSync(dest));
    assert.ok(fs.existsSync(path.join(dest, "plangonaut-adapter.json")));
    assert.ok(fs.existsSync(path.join(dest, "SKILL.md")));
    
    // Verify installation (should pass)
    res = runCli(["verify-install", "--target", "codex", "--scope", "project", "--project-root", root], root);
    assert.strictEqual(res.status, 0);
    assert.ok(res.stdout.includes("is pristine and matches original source"));
  });

  it("rejects drift when a file in the installed skill is manually modified", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-test-semantic-3-"));
    
    // Install claude locally
    runCli(["install", "--target", "claude", "--scope", "project", "--project-root", root], root);
    
    const dest = path.join(root, ".claude", "skills", "plangonaut");
    const skillMd = path.join(dest, "SKILL.md");
    
    // Manual modification (Drift)
    fs.appendFileSync(skillMd, "\n<!-- unauthorized edit -->");
    
    // Verify installation (should fail)
    const res = runCli(["verify-install", "--target", "claude", "--scope", "project", "--project-root", root], root);
    assert.strictEqual(res.status, 2);
    assert.ok(res.stderr.includes("Drift detected in installed skill at"));
  });
});

/**
 * ALN-008: the semantic protocol the dossier is supposed to teach.
 *
 * These scenarios check the *skill*, not the engine. A behaviour the engine has
 * and the dossier never mentions is met for the first time inside an error
 * message, which is the self-description defect ALN-005 and ALN-008 share. They
 * read what a host AI actually receives — the Portable Edition, which is
 * `SKILL.md` plus every reference concatenated — rather than a file the packaging
 * might not carry.
 *
 * Nothing here depends on the D5 forecast *surface*: the engine command is being
 * built against its own contract and its scenarios belong to the engine suite.
 * What is asserted here is the semantic protocol, which holds in Semantic-only
 * with no engine at all.
 */

const SKILL_FILES = (() => {
  const skillRoot = path.resolve("skills", "plangonaut");
  const found = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const location = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(location);
      else if (entry.name.endsWith(".md")) found.push(location);
    }
  };
  visit(skillRoot);
  return found.map((location) => ({
    relative: path.relative(skillRoot, location).replaceAll("\\", "/"),
    text: fs.readFileSync(location, "utf8"),
  }));
})();

/** The Portable Edition: what a host with no CLI and no repository is given. */
function portableEdition() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-test-semantic-protocol-"));
  const result = runCli(["export", "--target", "portable", "--output-dir", root], root);
  assert.strictEqual(result.status, 0, result.stderr);
  return fs.readFileSync(path.join(root, "plangonaut-portable.md"), "utf8");
}

function statedIn(needle) {
  return SKILL_FILES.filter((file) => file.text.includes(needle)).map((file) => file.relative);
}

describe("ALN-008 semantic protocol: what the dossier must teach", () => {
  it("states the last-step rule, with the wording that replaces the forbidden one", () => {
    // The rule the D5 decision and the addendum both make binding. A dossier that
    // forbids the phrase without supplying its replacement leaves the agent to
    // invent one, and it will invent something reassuring.
    const portable = portableEdition();
    assert.ok(
      portable.includes('do not say "last operation", "final step", "almost finished" or any equivalent'),
      "the Portable Edition must carry the prohibition",
    );
    assert.ok(
      portable.includes("this is the last operation currently planned"),
      "and the sentence that replaces it",
    );
    assert.ok(
      portable.includes("the next review may generate corrections"),
      "including why the previous step was not the last",
    );
  });

  it("states the last-step rule in exactly one place, and points at it from the others", () => {
    // The failure this task exists to fight: the same sentence copied into several
    // documents, which then drift apart. One home, and cross-references.
    const homes = statedIn('do not say "last operation", "final step", "almost finished"');
    assert.deepStrictEqual(homes, ["references/interview-protocol.md"]);

    for (const relative of ["SKILL.md", "references/lifecycle.md"]) {
      const file = SKILL_FILES.find((candidate) => candidate.relative === relative);
      assert.ok(file, relative + " must exist");
      assert.match(
        file.text,
        /interview-protocol\.md/,
        relative + " must route to the protocol instead of restating it",
      );
    }
  });

  it("requires ranges with a reasoned confidence and forbids a percentage whose denominator moves", () => {
    const portable = portableEdition();
    assert.ok(portable.includes("Never a completion percentage while its denominator can still change"));
    // Observable quantities, not a fabricated precision.
    for (const token of ["ALTA", "MEDIA", "BASSA", "REGOLARE", "IN_ESPANSIONE", "RISCHIO_LOOP", "BLOCCATO"]) {
      assert.ok(portable.includes(token), "the recorded value " + token + " must be documented");
    }
    assert.ok(portable.includes("with the reason for it"), "a bare confidence label is not a forecast");
  });

  it("keeps the conversational loop conditions with the agent, and says why", () => {
    // The engine derives what the ledger shows. Nothing in a ledger records that a
    // step was called the last one, and the dossier must not let the agent assume
    // that something else is watching for it.
    const portable = portableEdition();
    assert.ok(portable.includes("a final step was announced more than once and work was then added"));
    assert.ok(portable.includes("two consecutive verifications reopen work previously declared finished"));
    assert.ok(
      portable.includes("no ledger records that a step was called the last one"),
      "the reason the agent owns these must be stated, not implied",
    );
  });

  it("makes raising a loop signal a report rather than a halt", () => {
    const portable = portableEdition();
    assert.ok(portable.includes("Raising the signal is not stopping"));
    for (const shown of ["the observed cause", "what genuinely closed", "what keeps reopening", "the limit of the next cycle"]) {
      assert.ok(portable.includes(shown), "a raised signal must show " + shown);
    }
    assert.ok(portable.includes("a bounded cycle, a method review, a checkpoint and a stop"));
  });

  it("keeps the forecast in one canonical place instead of copying counts into documents", () => {
    const portable = portableEdition();
    assert.ok(portable.includes("Never copy a count that will change into several documents"));
    const template = fs.readFileSync(path.resolve("skills", "plangonaut", "assets", "project-state-template.md"), "utf8");
    assert.match(template, /## Operational forecast/, "the state document is the canonical place in Semantic-only");
    assert.match(template, /Change since the previous forecast, and its cause/);
  });

  it("documents re-record as a command, not only as the remedy inside a refusal", () => {
    // OD-012 was exactly this: a refusal naming an operation the dossier had never
    // heard of. An AI adopting Plangonaut must be able to find it before it is refused.
    const portable = portableEdition();
    assert.ok(portable.includes("re-record --project-root . --kind override|gate"));
    assert.ok(portable.includes("--reason"), "the reason is the only account of why the change was allowed");
    // What it is not: a way to pass, reopen or re-authorise anything.
    assert.ok(portable.includes("It changes provenance and only provenance"));
    assert.ok(portable.includes("Re-pointing a record to stop a check complaining is falsification"));
  });

  it("documents what validate re-verifies about a gate, and the limit of that check", () => {
    const portable = portableEdition();
    assert.ok(portable.includes("gates[].evidence"), "the check must be named");
    assert.ok(
      portable.includes("carry no evidence digest, so validate re-verified nothing for them"),
      "the sentence a passing validate prints must be recognisable before it is met",
    );
    assert.ok(
      portable.includes("A gate written before the record kept its evidence claims nothing, so nothing is refused"),
      "the compatibility limit is part of the rule, not an omission",
    );
    assert.ok(portable.includes("Read that as an open item, not as a pass"));
  });

  it("puts each ALN-008 subject in one reference and cross-references the rest", () => {
    // Placement, asserted: the engine mechanics in the engine contract, the
    // judgement about drift in traceability, the conversation protocol in the
    // interview protocol. Duplication here is the defect, so it is checked.
    assert.deepStrictEqual(statedIn("It changes provenance and only provenance"), ["references/engine-contract.md"]);
    assert.deepStrictEqual(
      statedIn("Re-pointing a record to stop a check complaining is falsification"),
      ["references/artifacts-and-traceability.md"],
    );
    assert.deepStrictEqual(statedIn("Raising the signal is not stopping"), ["references/interview-protocol.md"]);
  });

  it("tells the agent what to do when a derived signal contradicts the state it declared", () => {
    // Left by the skill agent for the lead, deliberately: the engine half was
    // being written at the same time. `plangonaut forecast` records the caller's cycle
    // state, records a contradicting signal beside it, and says so — and an
    // engine that speaks to nobody is the same as an engine that says nothing.
    const portable = portableEdition();
    assert.ok(
      portable.includes("Do not record the same cycle state again without answering the signal"),
      "the obligation must be stated, not left to be inferred from the engine's behaviour",
    );
    assert.ok(
      portable.includes("a residual that grew because scope was deliberately widened is not a loop"),
      "the dossier must allow the signal to be wrong, or the rule becomes a ritual",
    );
    assert.ok(
      portable.includes("Quote that sentence to the person rather than paraphrasing it"),
      "a measurement restated as a claim loses the only thing that made it worth showing",
    );
  });
});
