import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_ROOT = path.join(PACKAGE_ROOT, "skills", "beave");
const VERSION = fs.readFileSync(path.join(PACKAGE_ROOT, "VERSION"), "utf8").trim();
const SCHEMA_VERSION = 3;


const PROJECT_MODES = new Set(["Genesis", "Adoption", "Reconstruction", "Evolution", "Resume"]);
const INTERACTION_MODES = new Set(["Guided", "Standard", "Expert"]);
const MODULE_STATUSES = new Set(["NOT STARTED", "IN DISCUSSION", "CONFIRMED", "PARTIAL", "DEFERRED", "NOT APPLICABLE", "BLOCKED"]);
const OWNER_KEYS = ["product", "technical", "budget", "safety", "release"];
const LIFECYCLE_STATES = new Set(["INTAKE", "DISCOVERY", "INTERVIEW", "RESEARCH", "BLUEPRINT", "FOUNDATION", "PLAN", "EXECUTE", "VERIFY", "RELEASE", "OPERATE"]);

// D5 / FR-024. The vocabulary is the user's, recorded in Italian in
// `planning/CLAUDE_PROGRESS_FORECAST_ADDENDUM.md`, and it is stored verbatim
// rather than translated: the person who reads it back is the person who wrote it.
const CONFIDENCE_LEVELS = ["ALTA", "MEDIA", "BASSA"];
const CYCLE_STATES = ["REGOLARE", "IN_ESPANSIONE", "RISCHIO_LOOP", "BLOCCATO"];
// Ordered, because the engine has to be able to say "the signals imply more than
// you recorded" without being able to say "so I changed it".
const CYCLE_STATE_RANK: Record<string, number> = { REGOLARE: 0, IN_ESPANSIONE: 1, RISCHIO_LOOP: 2, BLOCCATO: 3 };
const TASK_STATUSES = ["BACKLOG", "READY", "IN_PROGRESS", "REVIEW", "DONE", "BLOCKED"];
const MODULE_TERMINAL_STATUSES = new Set(["CONFIRMED", "DEFERRED", "NOT APPLICABLE"]);
const OPEN_RISK_STATUSES = new Set(["IDENTIFIED", "REALIZED"]);
const CLOSED_RISK_STATUSES = new Set(["MITIGATED", "ACCEPTED"]);

class BeaveError extends Error {}

function now(): string {
  return new Date().toISOString();
}

function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalSourceDigest(): string {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const location = path.join(directory, entry.name);
      if (entry.isDirectory() && entry.name !== "__pycache__") visit(location);
      else if (entry.isFile() && !entry.name.endsWith(".pyc")) files.push(location);
    }
  };
  visit(SKILL_ROOT);
  files.sort((left, right) => {
    const a = path.relative(SKILL_ROOT, left).replaceAll("\\", "/");
    const b = path.relative(SKILL_ROOT, right).replaceAll("\\", "/");
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const digest = crypto.createHash("sha256");
  for (const location of files) {
    digest.update(path.relative(SKILL_ROOT, location).replaceAll("\\", "/"));
    digest.update("\0");
    digest.update(fs.readFileSync(location));
    digest.update("\0");
  }
  return digest.digest("hex");
}

interface Flags {
  [key: string]: string | boolean | undefined;
}

interface Project {
  name: string;
  root: string;
  mode: string;
}

interface Module {
  id: number;
  title: string;
  status: string;
  owner?: string | null;
  evidence?: string | null;
  evidence_sha256?: string;
  summary?: string | null;
  updated_at?: string | null;
}

/**
 * One superseded source of a governed record, kept when `re-record` re-points it.
 *
 * `path`/`sha256` are what the record used to claim. They are `null` when there
 * was nothing to claim — a gate recorded before the gate record kept its evidence
 * — which is a different fact from "the previous digest matched", and the two are
 * not allowed to look alike.
 */
interface RecordedSourceSupersession {
  path: string | null;
  sha256: string | null;
  superseded_at: string;
  superseded_by: string;
  reason: string;
  event_id: string;
}

interface Override {
  id: string;
  status: string;
  owner: string;
  reason: string;
  source: string;
  source_sha256: string;
  summary: string;
  created_at: string;
  reconciled_by?: string;
  reconciled_at?: string;
  reconciliation_evidence?: string;
  reconciliation_sha256?: string;
  source_history?: RecordedSourceSupersession[];
}

interface Decision { id: string; title: string; status: string; owner: string; revision: number; updated_at: string; }
interface Requirement { id: string; title: string; status: string; owner: string; revision: number; updated_at: string; }
interface Artifact { id: string; base_path: string; working_path: string; status: string; revision: number; content_hash: string; lock_owner: string; provenance: string[]; }
interface Task { id: string; title: string; status: string; owner: string; revision: number; updated_at: string; }
interface Dependency { id: string; from: string; to: string; type: string; owner: string; revision: number; updated_at: string; }
interface Gate {
  id: string;
  name: string;
  status: string;
  // Everything below arrived after the record shipped as `{id, name, status}`.
  // A gate written before that carries none of it, which is why `validate` has to
  // treat an absent digest as "nothing was claimed" rather than as a failure.
  owner?: string;
  evidence?: string | null;
  evidence_sha256?: string | null;
  updated_at?: string;
  consequence?: string | null;
  review_date?: string | null;
  source_history?: RecordedSourceSupersession[];
}
interface Risk { id: string; title: string; severity: string; status: string; owner: string; revision: number; updated_at: string; }
interface Evidence { id: string; path: string; sha256: string; owner: string; revision: number; updated_at: string; }
interface Agent { id: string; name: string; status: string; owner: string; revision: number; updated_at: string; }
interface Operation { id: string; type: string; status: string; }
interface Checkpoint { id: string; name: string; owner: string; revision: number; created_at: string; updated_at: string; }

/**
 * A quantity expressed as a range, which is the only way D5 allows one to be
 * expressed.
 *
 * `min === max` is not a rounding artefact: it means the quantity is **known**.
 * The engine stores a single supplied number that way and prints it as "N (known)"
 * so a reader cannot mistake certainty for a range that happens to be narrow.
 *
 * There is no percentage field here and none anywhere else in the record. A
 * percentage whose denominator can still change is the exact thing
 * `docs/decisions/2026-09-10-progress-forecast-and-loop-detection.md` forbids, so
 * the engine refuses one at the command line rather than storing it.
 */
interface ForecastRange { min: number; max: number; }

/**
 * What the engine counted for itself, from the ledgers, at the moment the
 * forecast was recorded.
 *
 * Never supplied by the caller: `beave forecast` has no option that writes any of
 * it. The addendum's rule is that the caller describes the work and the engine
 * counts what it can already see, so that a forecast can be checked against the
 * project rather than only believed.
 */
interface ForecastDerived {
  open_blockers: number;
  open_overrides: number;
  tasks_by_status: Record<string, number>;
  gates_remaining: number;
  unresolved_modules: number[];
  // Beyond the five the contract names, and needed by the signals:
  //  - `open_findings` is what the fourth loop condition means by "rilievi": risks
  //    still IDENTIFIED or REALIZED.
  //  - `evidence_records` is what "without producing new evidence" is measured on.
  //  - `status_history_events` is how many ledger events in this project recorded
  //    the status of the record they changed. It is 0 for every project written
  //    before ALN-008, and when it is 0 the reopening signal cannot be derived at
  //    all. The number is stored so that the absence of that signal can be read as
  //    "not observable here" instead of as "did not happen".
  open_findings: number;
  evidence_records: number;
  status_history_events: number;
}

/**
 * One D5 condition the engine observed for itself in the recorded data.
 *
 * `implies_cycle_state` is what the requirement says the condition raises — "at
 * least RISCHIO LOOP" — and it is advisory: nothing in this file ever writes it
 * into `cycle_state`. `observed` is a finished sentence, because the skill and
 * Studio both have to show the observed cause and neither should be inventing the
 * wording.
 */
interface ForecastSignal {
  code: string;
  implies_cycle_state: string;
  observed: string;
  detail: Record<string, unknown>;
}

/** One recorded forecast. `progress_forecast` holds the current one; `forecast_history[]` every previous one, in order. */
interface ProgressForecast {
  phase: string;
  known_work: string;
  conditional_work: string;
  questions: ForecastRange;
  operations: ForecastRange;
  cycles: ForecastRange;
  confidence: string;
  confidence_reason: string;
  cycle_state: string;
  change_reason: string | null;
  recorded_by: string;
  recorded_at: string;
  state_revision: number;
  derived: ForecastDerived;
  signals: ForecastSignal[];
}

interface State {
  schema_version: number;
  beave_version: string;
  project: Project;
  interaction_mode: string;
  intake_strategy: string;
  decision_owners: Record<string, string>;
  lifecycle_state: string;
  current_gate: string;
  modules: Module[];
  
  decisions: Decision[];
  requirements: Requirement[];
  artifacts: Artifact[];
  tasks: Task[];
  dependencies: Dependency[];
  gates: Gate[];
  risks: Risk[];
  evidence: Evidence[];
  agents: Agent[];
  operations: Operation[];
  checkpoints: Checkpoint[];

  blockers: string[];
  risks_legacy?: string[];
  evidence_legacy?: string[];
  // Both optional, and they have to stay optional. A project that has never
  // recorded a forecast is not an invalid project, and the two ALN-005 pilots are
  // the real prior projects that prove it: neither carries either field and both
  // must keep answering "Beave state is valid.".
  progress_forecast?: ProgressForecast;
  forecast_history?: ProgressForecast[];
  /**
   * The interview ledger, and the same reasoning as the two fields above: a
   * project created before it existed is valid and carries none. `undefined`
   * therefore means "this project predates the ledger", which is a different
   * statement from `[]` — "recording is on and nothing has been asked yet" — and
   * Resume says which of the two it is looking at rather than merging them.
   */
  interview_log?: InterviewEntry[];
  /** When recording began. Nothing before this instant is claimed either way. */
  interview_log_since?: string;
  /** Digest of the derived document, so a hand edit to it is detectable. */
  interview_view?: { path: string; sha256: string } | null;
  human_overrides: Override[];
  needs_reconciliation: boolean;
  revision: number;
  last_event_id: string;
  exact_next_action: string;
  created_at?: string;
  updated_at?: string;
}

// Flags that stand alone: they carry approval, not a value.
const BOOLEAN_FLAGS = new Set(["dry-run", "accept-base-overwrite", "replace-human-next-action", "planned", "reconstructed", "regenerate", "open", "last", "json", "verify", "repair", "apply", "force", "crosscutting"]);

/** Line separator used where a template literal would be harder to read. */
const NL = "\n";

/**
 * The interview ledger.
 *
 * `PLANNED` is a question Beave intends to ask; `ASKED` has been put to the user
 * and has no answer yet; `ANSWERED` has one. Whether that answer has been
 * *applied* to the project's records is deliberately **not** a status: it is
 * `consequences_recorded_at`, a timestamp written by the one command that
 * records consequences. A word can be set by the command that sets the status; a
 * timestamp that says "applied" can only be written by the code that applied it.
 * That distinction is the whole point of the state -- an interrupted turn must
 * never look finished.
 */
const QA_STATUSES = new Set([
  "PLANNED",
  "ASKED",
  "ANSWERED",
  "DEFERRED",
  "SKIPPED",
  "SUPERSEDED",
  "INVALIDATED",
]);

/** Statuses that close an entry without an answer, and why each needs a reason. */
const QA_CLOSE_KINDS = new Set(["deferred", "skipped", "invalidated"]);

/** The derived, human-readable rendering, at the project root so it is visible. */
const QA_VIEW_RELATIVE = "QUESTION_ANSWER_HISTORY.md";

const QA_ID_PATTERN = /^QNA-[0-9]{4,}$/;

/**
 * The options each command actually consumes.
 *
 * Anything else is refused. It used to be accepted and dropped: `task --title X
 * --description Y --acceptance Z` printed "Created task" and stored only the
 * title, and `init --owners-file` with a `compliance` key succeeded while
 * discarding it. A user who supplies a compliance owner for a CE-marked product
 * has every reason to believe it was recorded (ALN-005 pilot B).
 *
 * The eight ledger commands share one set. It is wider than any single one of
 * them needs — `--severity` is meaningful only to `risk` — so it catches an
 * unknown option without also rejecting an option that another ledger command
 * legitimately takes. Narrowing it per kind is a further improvement, not a
 * prerequisite for closing the silent-loss defect.
 */
const COMMAND_OPTIONS: Record<string, string[]> = {
  capabilities: [],
  version: [],
  help: [],
  init: ["project-root", "project-name", "project-mode", "interaction-mode", "owners-file", "operation-id"],
  status: ["project-root"],
  next: ["project-root", "count"],
  resume: ["project-root"],
  validate: ["project-root"],
  migrate: ["project-root", "operation-id"],
  // Reading and repairing are the same command because they answer the same
  // question; `--repair` is what turns the answer into a write, and it needs an
  // operation id like every other mutation.
  replay: ["project-root", "verify", "repair", "operation-id"],
  baseline: ["project-root", "reason", "owner", "operation-id"],
  // `--apply` is the write. Without it the command reports and touches nothing:
  // the command someone runs when something has gone wrong should not be the one
  // that changes things.
  recover: ["project-root", "apply"],
  // The only route that removes a lock this process does not hold, which is why
  // it is a command a person runs rather than something a retry does.
  unlock: ["project-root", "force"],
  record: ["project-root", "module", "status", "answer-file", "owner", "summary", "operation-id"],
  override: ["project-root", "instruction-file", "owner", "reason", "operation-id"],
  // OD-012. `override` creates; this re-points what an existing record stands on.
  "re-record": ["project-root", "kind", "id", "source-file", "owner", "reason", "operation-id"],
  // `--next-action` is optional here on purpose (blocker 1): making it mandatory
  // is what forced operators to overwrite a sentence a person had written.
  reconcile: ["project-root", "override-id", "evidence-file", "owner", "next-action", "replace-human-next-action", "operation-id"],
  // D5/FR-024. With `--project-root` alone it reads, like `status`; with any of the
  // others it records. `derived` and `signals` have no options on purpose — they
  // are what the engine counted, not what the caller asserted.
  forecast: [
    "project-root", "owner", "phase", "known-work", "conditional-work", "questions", "operations",
    "cycles", "confidence", "confidence-reason", "cycle-state", "change-reason", "expected-revision",
    "operation-id",
  ],
  gate: ["project-root", "id", "status", "evidence-file", "owner", "consequence", "review-date", "operation-id"],
  decision: ["project-root", "id", "title", "name", "status", "severity", "owner", "from", "to", "type", "file", "next-action", "expected-revision", "operation-id"],
  requirement: ["project-root", "id", "title", "name", "status", "severity", "owner", "from", "to", "type", "file", "next-action", "expected-revision", "operation-id"],
  task: ["project-root", "id", "title", "name", "status", "severity", "owner", "from", "to", "type", "file", "next-action", "expected-revision", "operation-id"],
  dependency: ["project-root", "id", "title", "name", "status", "severity", "owner", "from", "to", "type", "file", "next-action", "expected-revision", "operation-id"],
  risk: ["project-root", "id", "title", "name", "status", "severity", "owner", "from", "to", "type", "file", "next-action", "expected-revision", "operation-id"],
  evidence: ["project-root", "id", "title", "name", "status", "severity", "owner", "from", "to", "type", "file", "next-action", "expected-revision", "operation-id"],
  agent: ["project-root", "id", "title", "name", "status", "severity", "owner", "from", "to", "type", "file", "next-action", "expected-revision", "operation-id"],
  checkpoint: ["project-root", "id", "title", "name", "status", "severity", "owner", "from", "to", "type", "file", "next-action", "expected-revision", "operation-id"],
  // A preview takes exactly what the save it previews takes. The intended
  // workflow is "run doc-diff with the arguments you are about to run doc-save
  // with", and a narrower list would refuse that.
  "doc-diff": ["project-root", "id", "base-path", "content-file", "owner", "sources", "confirm-token", "expected-revision", "expected-hash"],
  "doc-mark-deletion": ["project-root", "id", "target", "reason-file", "content-file", "owner", "expected-revision", "expected-hash", "operation-id"],
  "doc-save": ["project-root", "id", "base-path", "content-file", "owner", "sources", "confirm-token", "expected-revision", "expected-hash", "operation-id"],
  "doc-history": ["project-root", "id"],
  "doc-restore": ["project-root", "id", "revision", "owner", "expected-revision", "expected-hash", "operation-id"],
  "doc-finalize": ["project-root", "id", "owner", "accept-base-overwrite", "expected-revision", "expected-hash", "operation-id"],
  "context-pack": ["project-root", "output"],
  "project-export": ["project-root", "output-dir"],
  "project-verify": ["package-dir"],
  "project-import": ["package-dir", "project-root", "operation-id"],
  export: ["target", "output-dir"],
  install: ["target", "scope", "project-root", "dry-run"],
  "verify-install": ["target", "scope", "project-root"],
  // The interview ledger. Three commands for three moments, because they are
  // three moments: a question put, an answer received, and the answer applied.
  // Collapsing them would make an interrupted turn indistinguishable from a
  // finished one, which is the failure the ledger exists to prevent.
  "qa-ask": [
    "project-root", "id", "question", "question-file", "rationale", "rationale-file",
    "module", "owner", "agent", "planned", "reconstructed", "reconstructed-from", "operation-id",
    "crosscutting", "crosscutting-reason",
  ],
  "qa-answer": ["project-root", "id", "answer", "answer-file", "owner", "agent", "operation-id"],
  "qa-settle": [
    "project-root", "id", "interpretation", "interpretation-file", "reply", "reply-file",
    "consequences", "documents", "open-points", "next-id", "next-question",
    "next-question-file", "next-rationale", "next-module", "owner", "operation-id",
    // The answer that finishes a module closes it in the same transaction, using
    // the rules `record` uses rather than a second copy of them.
    "complete-module", "module-answer-file", "module-summary",
  ],
  "qa-close": ["project-root", "id", "kind", "reason", "reason-file", "owner", "operation-id"],
  "qa-supersede": [
    "project-root", "id", "new-id", "question", "question-file", "rationale", "rationale-file",
    "reason", "reason-file", "module", "owner", "agent", "operation-id",
    "crosscutting", "crosscutting-reason",
  ],
  "qa-log": ["project-root", "open", "last", "json", "regenerate", "id"],
};

function assertKnownOptions(command: string, flags: Flags): void {
  const allowed = COMMAND_OPTIONS[command];
  if (!allowed) return;
  // Two options are accepted everywhere and are not command input.
  //
  // `--operation-id` is caller identity: required by every mutation, harmless on
  // a read, and refusing it on a read would break the ordinary pattern of passing
  // one command's arguments to the command that previews it.
  //
  // `--idempotency-key` is a deliberate distinguisher. Every flag except the
  // operation id feeds the idempotency payload hash, so an otherwise-identical
  // repeat of an operation is recognised as a retry — and this is how a caller
  // says "this really is a second, different operation". That is also the reason
  // unknown options could not simply be ignored: they were never inert, they
  // silently changed which operations counted as the same one.
  const universal = new Set(["operation-id", "idempotency-key"]);
  const unknown = Object.keys(flags).filter((key) => !universal.has(key) && !allowed.includes(key));
  if (!unknown.length) return;
  throw new BeaveError(
    `Unknown option${unknown.length > 1 ? "s" : ""} for ${command}: ${unknown.map((key) => `--${key}`).join(", ")}. ` +
      `Accepted: ${allowed.map((key) => `--${key}`).join(", ")}. Nothing was written — an option Beave does not store is refused rather than dropped.`
  );
}

function parse(argv: string[]): { command: string; flags: Flags } {
  const [command, ...rest] = argv;
  const flags: Flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new BeaveError(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      flags[key] = true;
      continue;
    }
    const value = rest[index + 1];
    // `!value` also rejected an empty string, which is a *supplied* value, not a
    // missing one. It surfaced the moment a refused preview started withholding
    // its confirmation token: a caller forwarding that empty token was told
    // "Missing value for --confirm-token" instead of the reason the preview was
    // refused in the first place.
    if (value === undefined || value.startsWith("--")) throw new BeaveError(`Missing value for --${key}`);
    // A repeated option used to overwrite the earlier one without a word:
    // `--sources DEC-1 --sources DEC-2` recorded provenance on DEC-2 alone, and
    // the caller was told the save succeeded. Same family as an unknown option —
    // supplied input discarded in silence — so it gets the same answer.
    if (Object.prototype.hasOwnProperty.call(flags, key)) {
      throw new BeaveError(
        `Option --${key} was given more than once, and only the last value would have been kept. Supply it once; a list goes in one value, comma-separated. Nothing was written.`
      );
    }
    flags[key] = value;
    index += 1;
  }
  return { command, flags };
}

function required(flags: Flags, key: string): string {
  const val = flags[key];
  if (typeof val !== "string") throw new BeaveError(`Missing required option --${key}`);
  return val;
}

function resolveProject(value: string): string {
  const root = path.resolve(value);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new BeaveError(`Project root is not a directory: ${root}`);
  return root;
}

function stateRoot(root: string): string {
  const target = path.resolve(root, ".beave");
  const realRoot = fs.realpathSync.native(root);
  const resolvedTarget = fs.existsSync(target) ? fs.realpathSync.native(target) : target;
  if (path.relative(realRoot, resolvedTarget).startsWith("..")) throw new BeaveError("State must stay inside the project root");
  return target;
}

function boundedOutput(base: string, relative: string): string {
  const candidate = path.join(base, relative);
  let probe = path.dirname(candidate);
  while (!fs.existsSync(probe) && probe !== path.dirname(base)) probe = path.dirname(probe);
  const realBase = fs.realpathSync.native(base);
  const realProbe = fs.realpathSync.native(probe);
  const rebuilt = path.join(realProbe, path.relative(probe, candidate));
  if (path.relative(realBase, rebuilt).startsWith("..")) throw new BeaveError("Output path resolves outside the approved state directory");
  return candidate;
}

/**
 * One leading UTF-8 byte-order mark, and nothing else.
 *
 * Windows PowerShell 5.1 writes one in front of every file `Set-Content
 * -Encoding utf8` produces, so the first file a Windows user creates —
 * `owners.json`, for the very first Beave command — looks correct in every
 * editor and is refused by `JSON.parse`. The tutorial documented a workaround
 * (`[System.IO.File]::WriteAllText`) for a defect that should not have needed
 * one (ALN-009).
 *
 * Exactly one mark, and only at position 0. A second mark, a mark anywhere else,
 * and anything else that is not valid JSON are still refused: this accepts a
 * known encoding artefact, it does not become tolerant of damaged input.
 */
function stripLeadingBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readJson(location: string): any {
  try {
    const value = JSON.parse(stripLeadingBom(fs.readFileSync(location, "utf8")));
    if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("expected an object");
    return value;
  } catch (error: any) {
    throw new BeaveError(`Cannot read JSON ${location}: ${error.message}`);
  }
}

function backupName(location: string): string {
  const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
  return path.join(path.dirname(location), "backups", `${path.basename(location)}.${stamp}.bak`);
}

function atomicWrite(location: string, content: string | Buffer): void {
  fs.mkdirSync(path.dirname(location), { recursive: true });
  if (fs.existsSync(location)) {
    const existing = fs.readFileSync(location);
    const next = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    // A backup exists so the previous bytes stay recoverable. When the new
    // content *starts with* the previous content the write is a pure append:
    // every one of those bytes is still there afterwards, so the copy protects
    // nothing and costs a full duplicate of the file.
    //
    // Measured on the ALN-005 pilot A project: 482 backup files, 104.1 MB,
    // against 220 KB of governed documents — 485 to 1. `events.jsonl` was 86.8 MB
    // of that, because every mutation copied the whole append-only log, so the
    // cost grew with the *square* of the number of operations: ~1.8 GB projected
    // at 1000 mutations, on a project that had not written a line of software.
    // `state.json` is rewritten wholesale and still gets a copy every time, which
    // is the one you actually roll back to.
    const pureAppend =
      next.length >= existing.length && next.subarray(0, existing.length).equals(existing);
    if (!pureAppend) {
      const backup = backupName(location);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(location, backup);
    }
  }
  const temporary = path.join(path.dirname(location), `.${path.basename(location)}.${crypto.randomUUID()}.tmp`);
  const handle = fs.openSync(temporary, "wx");
  try {
    fs.writeFileSync(handle, content);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temporary, location);
}

// ---------------------------------------------------------------------------
// Durable history: canonical form, state patches and the event chain
//
// The engine used to record *digests* of what changed — `question_sha256`,
// `record_revision` — and nothing else. That is enough to prove a record was not
// altered afterwards and not nearly enough to rebuild it, so "the events are the
// history" was a sentence no code supported: no command has ever re-read them.
//
// The fix is not a hand-written reducer per event type. Thirty types today, one
// more with every command, each free to forget a field the day it is added: that
// is a matrix that goes stale silently, and the brief's own warning — do not call
// the replay complete if some fields are quietly copied from `state.json` — names
// exactly how it would fail.
//
// So the mutation itself is recorded. `commitState` computes the difference
// between the state on disk and the state about to be written, stores it as the
// event's `state_patch`, and **verifies before writing** that applying that patch
// to the previous state reproduces the new one digest for digest. An event that
// cannot rebuild its own effect is refused. Completeness is therefore a property
// of every single write rather than a claim about the collection.
// ---------------------------------------------------------------------------

/** The event shape this engine writes. Older events stay exactly as they are. */
const EVENT_FORMAT = 2;
/** The reducer that reads them. Bumped when replay semantics change. */
const REDUCER_VERSION = 1;

type PatchOp = { op: "set" | "del" | "trim"; path: Array<string | number>; value?: unknown };

/**
 * Serialization that depends on content and never on insertion order.
 *
 * `JSON.stringify` writes keys in the order the object happens to hold them, so
 * two states that are the same state produce different bytes — and a digest over
 * those bytes would report a difference nobody made. Keys are sorted, `undefined`
 * properties are dropped exactly as `JSON.stringify` drops them when writing the
 * file, so the digest of a state in memory equals the digest of the same state
 * read back from disk.
 */
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined || typeof value !== "object") {
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function digestOf(value: unknown): string {
  return sha256(canonicalJson(value));
}

/**
 * The difference between two states, as operations a reducer can apply.
 *
 * Three operations, and no more: `set` a path, `del` an object key, `trim` an
 * array to a length. A ledger grows by appending, so the ordinary patch is one
 * `set` at one index; nothing here is tuned for that case, it simply falls out
 * of comparing index by index.
 */
function diffValue(before: unknown, after: unknown, at: Array<string | number>, out: PatchOp[]): void {
  if (canonicalJson(before) === canonicalJson(after) && (before !== undefined || after === undefined)) return;
  const comparable =
    before !== null &&
    before !== undefined &&
    after !== null &&
    after !== undefined &&
    typeof before === "object" &&
    typeof after === "object" &&
    Array.isArray(before) === Array.isArray(after);
  if (!comparable) {
    out.push({ op: "set", path: at, value: after === undefined ? null : after });
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const shared = Math.min(before.length, after.length);
    for (let index = 0; index < shared; index += 1) diffValue(before[index], after[index], [...at, index], out);
    if (after.length > before.length) {
      for (let index = before.length; index < after.length; index += 1) {
        out.push({ op: "set", path: [...at, index], value: after[index] === undefined ? null : after[index] });
      }
    } else if (after.length < before.length) {
      out.push({ op: "trim", path: at, value: after.length });
    }
    return;
  }
  const left = before as Record<string, unknown>;
  const right = after as Record<string, unknown>;
  for (const key of Object.keys(left).sort()) {
    if (!(key in right) || right[key] === undefined) out.push({ op: "del", path: [...at, key] });
  }
  for (const key of Object.keys(right).sort()) {
    if (right[key] === undefined) continue;
    // A key the previous state did not carry is always written out: comparing
    // `undefined` with `null` would otherwise look like no change and leave the
    // key missing after a replay.
    if (!(key in left)) out.push({ op: "set", path: [...at, key], value: right[key] });
    else diffValue(left[key], right[key], [...at, key], out);
  }
}

function applyPatch(base: unknown, ops: unknown): unknown {
  if (!Array.isArray(ops)) throw new BeaveError("Event carries no state patch; it was written by an engine that did not record one.");
  let root: any = base === undefined || base === null ? null : structuredClone(base);
  for (const candidate of ops) {
    const op = candidate as PatchOp;
    if (!op || typeof op !== "object" || !Array.isArray(op.path)) throw new BeaveError(`Malformed patch operation: ${JSON.stringify(candidate)}`);
    if (op.op !== "set" && op.op !== "del" && op.op !== "trim") throw new BeaveError(`Unsupported patch operation "${(op as any).op}"; this engine reads reducer version ${REDUCER_VERSION}.`);
    if (!op.path.length) {
      if (op.op !== "set") throw new BeaveError(`Patch operation "${op.op}" cannot apply to the whole state.`);
      root = structuredClone(op.value);
      continue;
    }
    let cursor: any = root;
    for (let index = 0; index < op.path.length - 1; index += 1) {
      const key = op.path[index];
      if (cursor === null || typeof cursor !== "object") throw new BeaveError(`Patch path ${op.path.join("/")} does not exist in the state being rebuilt.`);
      if (cursor[key] === undefined) cursor[key] = typeof op.path[index + 1] === "number" ? [] : {};
      cursor = cursor[key];
    }
    if (cursor === null || typeof cursor !== "object") throw new BeaveError(`Patch path ${op.path.join("/")} does not exist in the state being rebuilt.`);
    const last = op.path[op.path.length - 1];
    if (op.op === "set") cursor[last] = structuredClone(op.value);
    else if (op.op === "del") delete cursor[last];
    else {
      const target = cursor[last];
      if (!Array.isArray(target)) throw new BeaveError(`Patch tried to trim ${op.path.join("/")}, which is not a list.`);
      target.length = Number(op.value);
    }
  }
  return root;
}

/** Every line of the event log, with the raw text each one was written as. */
function eventLines(root: string): Array<{ line: string; event: any; malformed: boolean }> {
  const location = path.join(stateRoot(root), "events.jsonl");
  if (!fs.existsSync(location)) return [];
  return fs
    .readFileSync(location, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return { line, event: JSON.parse(line), malformed: false };
      } catch {
        return { line, event: null, malformed: true };
      }
    });
}

function lastEventLine(root: string): { line: string; event: any } | null {
  const lines = eventLines(root);
  const last = lines[lines.length - 1];
  return last && !last.malformed ? { line: last.line, event: last.event } : null;
}

// ---------------------------------------------------------------------------
// The transaction journal
//
// `atomicWrite` makes one file replacement atomic. It does not make a *mutation*
// atomic: a save touches a document, the history folder, the event log, the state
// and a derived view, and an interruption between any two of them leaves a
// project that is half one thing and half another. A sequence of atomic renames
// is still a sequence.
//
// The journal is written before anything moves and names the point of no return:
// the moment the event is appended. Before it, an interrupted operation is rolled
// back and never happened. After it, the operation is completed from content the
// journal staged, because the history already says it happened and the honest
// repair is to make the project agree with its own history rather than to argue
// with it.
// ---------------------------------------------------------------------------

/**
 * Three phases, because three is how many the engine writes.
 *
 * A fourth — `APPLYING_FILES` — was declared here and handled in recovery and
 * never once set, which the same review caught by running all eight fault points
 * and seeing only these three. Recovery treated it exactly like `PREPARED`, so
 * it was a distinction with no behaviour behind it and a sentence in the
 * contract that described something that did not happen.
 */
type TransactionPhase = "PREPARED" | "COMMITTING" | "COMMITTED";

interface TransactionHandle {
  directory: string;
  root: string;
}

let activeTransaction: TransactionHandle | null = null;

/**
 * A deliberate crash, for the fault-injection tests and for nothing else.
 *
 * `process.exit` rather than a thrown error on purpose: an exception unwinds
 * through every `finally` and every `catch`, which is precisely the cleanup a
 * real interruption does not get. The tests run the CLI as a child process, so
 * what they observe is what a killed process leaves behind.
 */
function faultPoint(label: string): void {
  if (process.env.BEAVE_FAULT_AT === label) {
    process.stderr.write(`BEAVE FAULT INJECTED: ${label}\n`);
    process.exit(97);
  }
}

// ---------------------------------------------------------------------------
// The project lock
//
// Everything below the journal assumed one writer. `appendEvent` reads the file,
// appends a line and writes it back, and `commitState` reads the state, computes
// a patch against it and writes the result: two processes that reach either at
// the same revision produce a lost event or a state built on a revision that has
// already moved. A review ran forty parallel mutations without a collision and
// said the right thing about it — an overlap that was never forced is not
// evidence of safety.
//
// The lock is a file created with `wx`: `O_CREAT | O_EXCL`, which is atomic on
// every platform Node supports, so the winner is decided by the filesystem and
// not by a check-then-act in this process.
//
// Three states are kept apart on purpose, because the wrong answer to any of
// them loses work:
//
//  - **held by a live process on this host** — refused, never taken. A slow
//    operation is not an abandoned one.
//  - **held by a dead process on this host** — taken over, and the takeover is
//    recorded. A process that was killed must not lock its project for ever.
//  - **held by another host, or unreadable** — refused, and no amount of waiting
//    changes it: this engine cannot ask a machine it cannot see whether a PID is
//    alive, and guessing would be how a shared folder loses a day's work. It
//    takes an explicit `beave unlock --force`.
// ---------------------------------------------------------------------------

const LOCK_FILE = "lock.json";
/** How long a second process waits for a live holder before giving up. */
const LOCK_WAIT_MS = 10_000;
const LOCK_POLL_MS = 100;

interface LockRecord {
  lock_id: string;
  pid: number;
  host: string;
  at: string;
  command: string;
  operation_id: string | null;
  observed_revision: number | null;
  /** Present only when this lock was taken over from a process that had died. */
  took_over?: { lock_id: string; pid: number; at: string };
}

let runningCommand = "beave";
let heldLock: { file: string; record: LockRecord } | null = null;
let lockReleaseRegistered = false;

function lockFile(root: string): string {
  return path.join(stateRoot(root), LOCK_FILE);
}

/** Synchronous sleep with no dependency and no busy loop. */
function sleepMs(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Is this PID a process that still exists on this host?
 *
 * Signal 0 asks exactly that. `EPERM` means it exists and belongs to somebody
 * else, which still counts as alive: the one thing this must never do is report
 * a running process as dead.
 */
function processIsAlive(pid: unknown): boolean | null {
  // `null` is "cannot tell", and it is not the same answer as `false`. A pid this
  // engine cannot read is a pid it must not declare dead: the second review
  // showed a record with `"56404"` as a *string* being treated as a gone process
  // and its lock taken in silence, from a process that was running.
  const numeric = typeof pid === "number" ? pid : Number(pid);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  try {
    process.kill(numeric, 0);
    return true;
  } catch (error: any) {
    return error?.code === "EPERM" ? true : false;
  }
}

function parseLockRecord(file: string): LockRecord | null {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as LockRecord;
  } catch {
    return null;
  }
}

/**
 * Read the lock, and do not mistake a lock being born for a broken one.
 *
 * `writeLockRecord` creates the file with `O_CREAT | O_EXCL` and fills it
 * immediately afterwards, which is what makes the acquisition atomic - but it
 * leaves a window of a few microseconds in which the file exists and is empty.
 * A second process reading in that window used to conclude the lock could not be
 * read, and that conclusion is expensive: it is a hard refusal telling a person
 * to go and delete a file by hand, produced by two perfectly ordinary commands
 * overlapping. It surfaced as one failing test in a suite that runs its files in
 * parallel, on a project neither test was writing to.
 *
 * So an unreadable lock has to stay unreadable to be believed. `patient` waits
 * out that window - briefly, and only while the file is still there - before
 * saying so. A lock that is genuinely damaged answers the same as before, a few
 * hundred milliseconds later.
 */
function readLockRecord(file: string, patient = false): LockRecord | null {
  const record = parseLockRecord(file);
  if (record || !patient) return record;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!fs.existsSync(file)) return null;
    sleepMs(20);
    const retried = parseLockRecord(file);
    if (retried) return retried;
  }
  return null;
}

function describeLock(record: LockRecord | null, file: string): string {
  if (!record) return `The lock file at ${file} cannot be read, so Beave cannot tell whether anything holds it.`;
  // A record with no host does not name a machine called "undefined".
  if (typeof record.host !== "string" || !record.host.trim()) {
    return `Held by ${record.command ?? "a Beave command"} as process ${record.pid}, on a machine the lock does not name, since ${record.at}.`;
  }
  return (
    `Held by ${record.command ?? "a Beave command"} as process ${record.pid} on ${record.host}, since ${record.at}` +
    `${record.operation_id ? `, operation ${record.operation_id}` : ""}` +
    `${record.observed_revision === null || record.observed_revision === undefined ? "" : `, at revision ${record.observed_revision}`}.`
  );
}

/**
 * A synchronisation point that exists for the concurrency tests and nothing else.
 *
 * `BEAVE_TEST_SYNC` names a path: once the process reaches the point named by
 * `BEAVE_TEST_SYNC_AT` it writes `<path>.ready` and waits for `<path>.go`, so two
 * processes can be made to overlap deterministically instead of being raced and
 * hoped over.
 *
 * There are two points, because the second independent review showed one is not
 * enough. `locked` -- the default -- stops a process just after it takes the lock,
 * which forces the overlap the lock is meant to refuse and demonstrates mutual
 * exclusion. It cannot demonstrate anything about the *read-modify-write* the lock
 * exists to protect: by the time the second process is running, the first has not
 * yet read `state.json`. `read` stops it just after it has read the revision it is
 * going to build on, which is the window in which a lost update is possible -- and
 * with the lock removed (`BEAVE_TEST_UNSAFE_NO_LOCK`) that window can be entered by
 * two processes at once and the damage observed. A guarantee is worth what its
 * counter-example costs to produce.
 */
function testSyncPoint(at: "locked" | "read" = "locked"): void {
  const marker = process.env.BEAVE_TEST_SYNC;
  if (!marker) return;
  if ((process.env.BEAVE_TEST_SYNC_AT ?? "locked") !== at) return;
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(`${marker}.ready`, `${process.pid}\n`);
  const deadline = Date.now() + 60_000;
  while (!fs.existsSync(`${marker}.go`) && Date.now() < deadline) sleepMs(20);
}

/**
 * A file that exists only while an operation is in flight.
 *
 * `atomicWrite` keeps a copy of what it replaces under `backups/`, which is right
 * for a document and wrong for these: the lock record is rewritten by every
 * command, and the staging marker by every phase. The second review found both
 * consequences — an unbounded pile of `backups/lock.json.*.bak` in every project,
 * and, worse, a `backups/` directory *inside* every staging that was then renamed
 * into the package, so a handoff carried the exporter's hostname, PID and
 * absolute paths in files the manifest never declared.
 */
function writeTransientJson(location: string, value: unknown): void {
  fs.mkdirSync(path.dirname(location), { recursive: true });
  const temporary = path.join(path.dirname(location), `.${path.basename(location)}.${crypto.randomUUID()}.tmp`);
  const handle = fs.openSync(temporary, "wx");
  try {
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}${NL}`);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temporary, location);
}

function writeLockRecord(file: string, record: LockRecord): void {
  const handle = fs.openSync(file, "wx");
  try {
    fs.writeFileSync(handle, `${JSON.stringify(record, null, 2)}\n`);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Take the project lock, or explain precisely why not.
 *
 * Acquired *before* recovery, before the idempotency question, before the
 * revision is read and before anything is written — the whole of what a command
 * does to a project happens inside it.
 */
function acquireProjectLock(root: string, command: string): void {
  if (heldLock) return;
  /*
   * The lock, removed on purpose, for the one test that has to show what it
   * prevents. Everything else here proves that a second process is kept out;
   * nothing proves that being kept out matters, and a guarantee nobody has seen
   * fail is a claim. The seam announces itself on stderr every time, because a
   * process that has disabled the exclusion it depends on must not look like an
   * ordinary one in a log.
   */
  if (process.env.BEAVE_TEST_UNSAFE_NO_LOCK === "1") {
    process.stderr.write(`beave: BEAVE_TEST_UNSAFE_NO_LOCK is set - running WITHOUT the project lock (${command}). This is a test seam and it is not safe.\n`);
    return;
  }
  const file = lockFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const record: LockRecord = {
    lock_id: crypto.randomUUID(),
    pid: process.pid,
    host: os.hostname(),
    at: now(),
    command,
    operation_id: pendingOperation?.id ?? null,
    observed_revision: null,
  };

  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      writeLockRecord(file, record);
      heldLock = { file, record };
      if (!lockReleaseRegistered) {
        lockReleaseRegistered = true;
        // A normal exit releases it. A kill does not, which is the point: the
        // file left behind is what the next process reads to decide.
        process.on("exit", () => releaseProjectLock());
      }
      testSyncPoint();
      return;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
    }

    const existing = readLockRecord(file, true);
    if (existing === null) {
      throw new BeaveError(
        `This project is locked and the lock cannot be read: ${path.relative(root, file).replaceAll("\\", "/")}. ` +
          `Beave will not remove a lock it cannot understand, and neither will \`beave unlock --force\`: it has no way to tell whether a process is holding it. ` +
          `Make sure no Beave command is running on this project, then delete that file yourself.`,
      );
    }
    if (typeof existing.host !== "string" || !existing.host.trim() || existing.host !== os.hostname()) {
      throw new BeaveError(
        `This project is locked by another machine. ${describeLock(existing, file)} ` +
          `Beave cannot ask that host whether the process is still running, so it will not take the lock on its own. ` +
          `If you are certain nothing is using the project, release it with: beave unlock --project-root . --force`,
      );
    }
    const holderAlive = processIsAlive(existing.pid);
    if (holderAlive === null) {
      throw new BeaveError(
        `This project is locked and the lock does not say which process holds it: ${path.relative(root, file).replaceAll("\\", "/")} records \`pid: ${JSON.stringify(existing.pid)}\`. ` +
          `Beave will not take a lock it cannot reason about. Make sure no Beave command is running, then delete that file yourself.`,
      );
    }
    if (holderAlive === false) {
      /*
       * A lock left by a process on this host that is certainly gone. Removing
       * it is safe *and* is recorded: the next lock says what it took over, so
       * an unexplained takeover cannot pass for an ordinary acquisition.
       */
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // Somebody else won the race to clean it up; the next attempt decides.
      }
      record.took_over = { lock_id: existing.lock_id, pid: existing.pid, at: existing.at };
      continue;
    }
    if (Date.now() >= deadline) {
      throw new BeaveError(
        `This project is in use by another Beave process and did not become free within ${Math.round(LOCK_WAIT_MS / 1000)} seconds. ` +
          `${describeLock(existing, file)} Nothing was changed. Wait for it to finish and run the same command again.`,
      );
    }
    sleepMs(LOCK_POLL_MS);
  }
}

/** Record the revision this command actually observed, for the next reader. */
function noteObservedRevision(revision: number | null): void {
  if (!heldLock || revision === null || revision === undefined) return;
  heldLock.record.observed_revision = revision;
  try {
    writeTransientJson(heldLock.file, heldLock.record);
  } catch {
    // Diagnostics, not correctness: a project that cannot update its own lock
    // record still holds the lock.
  }
}

function releaseProjectLock(): void {
  if (!heldLock) return;
  const { file, record } = heldLock;
  heldLock = null;
  try {
    // Only if it is still ours. A lock taken over by somebody else after a
    // takeover must not be deleted by the process that lost it.
    const current = readLockRecord(file);
    if (current && current.lock_id !== record.lock_id) return;
    fs.rmSync(file, { force: true });
    /*
     * A refused command must leave no trace, including the `.beave` the lock had
     * to create to exist. Removed only when it is completely empty, which is
     * true exactly when nothing else was written -- a refused `init` -- and
     * never when a project is there.
     */
    const directory = path.dirname(file);
    if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  } catch {
    // Nothing to do: the next process reads what is there and decides.
  }
}

/**
 * Release a lock this process does not hold.
 *
 * Deliberately a command of its own with `--force`: this is the only route that
 * removes a lock belonging to a live process or to another machine, and it has
 * to be something a person chose rather than something a retry did.
 */
function unlock(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const file = lockFile(root);
  if (!fs.existsSync(file)) {
    console.log("This project is not locked.");
    return;
  }
  // Patient, for the same reason the acquisition is: this command's whole job is
  // to say what holds the lock, and "unreadable" is the one answer that sends a
  // person to delete a file by hand.
  const record = readLockRecord(file, true);
  const relative = path.relative(root, file).replaceAll("\\", "/");
  /*
   * A record that does not say which machine it came from is not a record from
   * another machine.
   *
   * `mine` was `record.host === os.hostname()`, so a lock with no `host` field,
   * or a blank one, fell into the another-machine branch — which `--force` is
   * allowed to release, deliberately, because this engine cannot ask a host it
   * cannot see. A third review wrote such a record naming a *live local* PID and
   * `--force` released it. A missing host is the unknown case, and unknown is
   * refused.
   */
  const host = typeof record?.host === "string" ? record.host.trim() : "";
  if (record !== null && !host) {
    console.log(`The lock at ${relative} does not say which machine holds it, and it records \`pid: ${JSON.stringify(record.pid)}\`.`);
    console.log("  state       unreadable: a lock with no host is one Beave cannot reason about");
    console.log(`\nNothing was changed, and --force will not change it either. Make sure no Beave command is running, then delete ${relative} yourself.`);
    if (flags.force === true) throw new BeaveError(`Refusing to force a lock that does not name the machine holding it: ${relative}. Nothing was changed.`);
    return;
  }
  const mine = record !== null && host === os.hostname();
  // Three values, not two. `null` — the record cannot be read, or does not say
  // which process holds it — is the case the second review broke `--force` on:
  // it was folded into "not alive" and the lock was taken from a running process.
  const alive = record === null ? null : mine ? processIsAlive(record.pid) : false;

  if (flags.force !== true) {
    console.log(describeLock(record, relative));
    if (alive === null) console.log("  state       unreadable: Beave cannot tell what holds it, or whether anything does");
    else if (!mine) console.log("  state       held by another machine, which this engine cannot ask about");
    else if (alive) console.log("  state       the process is still running on this machine");
    else console.log("  state       the process that took it is gone from this machine");
    console.log(
      alive === null
        ? `\nNothing was changed, and --force will not change it either: a lock Beave cannot read is a lock it cannot reason about. Make sure no Beave command is running, then delete ${relative} yourself.`
        : alive
          ? "\nNothing was changed. A running command is not an abandoned one: wait for it, or stop that process first."
          : "\nNothing was changed. Run the same command with --force to release it.",
    );
    return;
  }

  if (alive === null) {
    /*
     * The hole the second review found. An unreadable record made `mine` false
     * and `alive` false, the live-process guard did not fire, and `--force`
     * removed a lock a running process was holding — while the acquisition
     * message was busy telling the user to do exactly that.
     *
     * There is no safe automatic answer here: Beave cannot tell whether anything
     * holds it. So it refuses and hands the decision to a person, in the same
     * words it uses for a journal it cannot read.
     */
    throw new BeaveError(
      `${record === null ? "This lock cannot be read" : `This lock records \`pid: ${JSON.stringify(record.pid)}\`, which is not a process id`}, so Beave cannot tell whether a process is holding it: ${relative}. ` +
        `--force will not remove it — that is how a running command loses its work. Make sure no Beave command is running on this project, then delete that file yourself. Nothing was changed.`,
    );
  }

  if (alive) {
    throw new BeaveError(
      `The process holding this lock is still running on this machine. ${describeLock(record, relative)} ` +
        `Beave will not take a lock from a live process, with or without --force: stop that process first. Nothing was changed.`,
    );
  }
  fs.rmSync(file, { force: true });
  console.log(`Released the lock at ${relative}.`);
  console.log(record === null ? "It could not be read, so nothing is known about what held it." : describeLock(record, relative));
}

function transactionDirectory(root: string, eventId: string): string {
  return path.join(stateRoot(root), "transactions", eventId);
}

function journalPath(directory: string): string {
  return path.join(directory, "journal.json");
}

function writeJournal(directory: string, journal: any): void {
  journal.updated_at = now();
  // The journal is transient too, and it is rewritten at every phase.
  writeTransientJson(journalPath(directory), journal);
}

function setPhase(handle: TransactionHandle, phase: TransactionPhase): void {
  const journal = readJson(journalPath(handle.directory));
  journal.phase = phase;
  writeJournal(handle.directory, journal);
}

/**
 * Open a transaction over a set of files.
 *
 * `locations` are the files the operation is about to change *before* the event
 * is appended — documents, history entries, archived reasons. The state and the
 * event log are always covered and are not listed by the caller.
 */
function beginFileTransaction(root: string, event: any, locations: string[]): string {
  faultPoint("before-prepare");
  const directory = transactionDirectory(root, event.event_id);
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory, { recursive: false });
  const unique = [...new Set([path.join(stateRoot(root), "state.json"), path.join(stateRoot(root), "events.jsonl"), ...locations].map((item) => path.resolve(item)))];
  const files = unique.map((location, index) => {
    const relative = path.relative(root, location);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new BeaveError(`Transaction path escapes project root: ${location}`);
    const existed = fs.existsSync(location);
    const backup = existed ? `backup-${index}` : null;
    if (existed) copyFileCreatingParents(location, path.join(directory, backup!));
    return {
      path: relative.replaceAll("\\", "/"),
      existed,
      backup,
      before_sha256: existed ? sha256(fs.readFileSync(location)) : null,
    };
  });
  writeJournal(directory, {
    format: "beave-file-transaction-v2",
    phase: "PREPARED" satisfies TransactionPhase,
    event_id: event.event_id,
    event_type: event.type,
    operation_id: pendingOperation?.id ?? null,
    operation_payload_hash: pendingOperation?.payloadHash ?? null,
    operation_payload_version: pendingOperation?.payloadVersion ?? null,
    idempotency_key: event.idempotency_key ?? null,
    state_revision: event.state_revision,
    created_at: event.at ?? now(),
    files,
    // Filled in by `commitState`, which is the only thing that knows them.
    staged: null,
  });
  faultPoint("after-journal");
  activeTransaction = { directory, root };
  return directory;
}

function rollbackFileTransaction(root: string, directory: string): void {
  const journal = readJson(journalPath(directory));
  const restored: string[] = [];
  for (const item of journal.files ?? []) {
    const destination = path.resolve(root, item.path);
    if (item.existed) {
      const backup = path.join(directory, item.backup);
      // `before_sha256` was recorded and never looked at. It is the one thing
      // that can tell a restored file from a restored *wrong* file, so it is
      // checked here and the result is written into the receipt.
      const intact = !item.before_sha256 || sha256(fs.readFileSync(backup)) === item.before_sha256;
      copyFileCreatingParents(backup, destination);
      restored.push(`${item.path}${intact ? "" : " (the backup no longer matches the digest recorded for it)"}`);
    } else if (fs.existsSync(destination)) {
      fs.rmSync(destination, { force: true });
      restored.push(`${item.path} (removed: it did not exist before)`);
    }
  }
  const recovery = path.join(stateRoot(root), "recovery", `${journal.event_id}.rolled-back.json`);
  writeJson(recovery, { ...journal, recovered_at: now(), outcome: "ABORTED", restored });
  fs.rmSync(directory, { recursive: true, force: true });
  if (activeTransaction?.directory === directory) activeTransaction = null;
}

function completeFileTransaction(directory: string): void {
  if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
  if (activeTransaction?.directory === directory) activeTransaction = null;
}

/**
 * Finish an operation the journal says had already passed the point of no return.
 *
 * Nothing here decides anything: the staged content is the exact content the
 * interrupted command had already computed and validated, and every file is left
 * carrying the digest the journal recorded for it.
 */
function rollForwardTransaction(root: string, directory: string, journal: any): string[] {
  const notes: string[] = [];
  const staged = journal.staged;
  const stagedStateFile = path.join(directory, "staged-state.json");
  /*
   * Everything the roll-forward needs is read before anything is written.
   *
   * This used to append the event and *then* read the staged state, so a journal
   * whose staged file was missing — the durability limit this contract itself
   * declares — left the event in the log, the state behind it, and every
   * subsequent command dying on a raw ENOENT with no way out. The refusal has to
   * come first for the promise above it to be true: it stops, it names the
   * directory, and it changes nothing.
   */
  if (!staged || !fs.existsSync(stagedStateFile)) {
    throw new BeaveError(
      `Transaction ${journal.event_id} (${journal.event_type ?? "operation"}) passed the point of no return and its staged result is not there, so it can neither be completed nor safely undone. Nothing was changed.\n` +
        `Inspect ${path.relative(root, directory).replaceAll("\\", "/")}. If you are certain the operation should be abandoned, remove that directory and run: beave replay --project-root . --repair --operation-id <id>`,
    );
  }
  const stagedState = fs.readFileSync(stagedStateFile, "utf8");

  const eventsLocation = path.join(stateRoot(root), "events.jsonl");
  const existing = fs.existsSync(eventsLocation) ? fs.readFileSync(eventsLocation, "utf8") : "";
  const alreadyAppended = existing.split(/\r?\n/).some((line) => {
    try { return JSON.parse(line).event_id === journal.event_id; } catch { return false; }
  });
  if (!alreadyAppended) {
    // Truncate any partial tail first: a half-written line is not an event, and
    // appending after it would produce two malformed ones instead of one.
    const prior = existing.slice(0, Number(staged.events_prior_bytes ?? 0));
    atomicWrite(eventsLocation, `${prior ? `${prior.replace(/\n+$/, "")}\n` : ""}${staged.event_line}\n`);
    notes.push("appended the recorded event");
  }

  const stateLocation = path.join(stateRoot(root), "state.json");
  if (!fs.existsSync(stateLocation) || sha256(fs.readFileSync(stateLocation)) !== staged.state_sha256_file) {
    atomicWrite(stateLocation, stagedState);
    notes.push("completed the state write");
  }
  return notes;
}

/**
 * Derived documents, rebuilt from the recovered state.
 *
 * They are never staged and never rolled forward: they are a pure function of
 * the state, so regenerating them is cheaper than transporting them and cannot
 * disagree with what they describe.
 */
function regenerateDerivedViews(root: string): string[] {
  const stateLocation = path.join(stateRoot(root), "state.json");
  if (!fs.existsSync(stateLocation)) return [];
  let state: any;
  try { state = readJson(stateLocation); } catch { return []; }
  if (!state || !state.interview_view || !Array.isArray(state.interview_log)) return [];
  const rendered = renderInterviewView(state);
  if (sha256(rendered) !== state.interview_view.sha256) return [];
  const file = path.join(root, QA_VIEW_RELATIVE);
  if (fs.existsSync(file) && sha256(fs.readFileSync(file)) === state.interview_view.sha256) return [];
  writeInterviewView(root, rendered);
  return [`regenerated ${QA_VIEW_RELATIVE}`];
}

/**
 * What a command does before it reads or writes anything.
 *
 * An interrupted transaction is never ignored and never left for later: it is
 * completed, undone, or the command stops and says why. "Later" is the state in
 * which a project looks fine and is not.
 */
/**
 * Interrupted operations resolved by the last run. Read by `resume`, which says
 * so out loud rather than letting a recovery pass unmentioned.
 */
let recoveredInThisRun: string[] = [];

function recoverFileTransactions(root: string): void {
  // Recovery is a mutation, so it is inside the lock like every other one. This
  // is also the single place the boundary is decided: every command that can
  // read a project and then change it -- or trigger a recovery by reading it --
  // arrives here or at `loadState`, which takes it too.
  acquireProjectLock(root, runningCommand);
  const transactions = path.join(stateRoot(root), "transactions");
  if (!fs.existsSync(transactions)) return;
  for (const entry of fs.readdirSync(transactions)) {
    const directory = path.join(transactions, entry);
    if (!fs.statSync(directory).isDirectory()) continue;
    const journalFile = journalPath(directory);
    const legacyFile = path.join(directory, "manifest.json");
    if (!fs.existsSync(journalFile)) {
      if (!fs.existsSync(legacyFile)) continue;
      recoverLegacyTransaction(root, directory, readJson(legacyFile));
      continue;
    }
    let journal: any;
    try {
      journal = readJson(journalFile);
    } catch {
      // Damage, and the honest answer is to say so rather than to die on a raw
      // JSON error inside whatever command happened to be entering the project.
      throw new BeaveError(
        `The journal of an interrupted operation cannot be read: ${path.relative(root, journalFile).replaceAll("\\", "/")}. ` +
          `Beave will not guess what it was doing, so nothing has been changed. Run \`beave recover --project-root .\` to see what is there; ` +
          `once you have looked at it, remove that directory and run \`beave replay --project-root . --verify\` to check what the project is.`,
      );
    }
    const notes: string[] = [];
    if (journal.phase === "PREPARED" || journal.phase === "APPLYING_FILES") {
      // `APPLYING_FILES` is accepted, never written: a journal from the build
      // that declared it is still resolved by the rule it was resolved by then.
      rollbackFileTransaction(root, directory);
      recoveredInThisRun.push(`${journal.event_type ?? "operation"} ${journal.event_id} (undone)`);
      process.stderr.write(`BEAVE RECOVERED: ${journal.event_type ?? "operation"} ${journal.event_id} was interrupted before it took effect and has been undone. The project is as it was before it started.\n`);
      continue;
    }
    if (journal.phase === "COMMITTING") notes.push(...rollForwardTransaction(root, directory, journal));
    // `regenerate_views` is what the operation said about itself. A commit that
    // touched no derived document does not need one rebuilt, and checking the
    // flag is the difference between using what the journal records and writing
    // it for decoration.
    if (journal.staged?.regenerate_views !== false) notes.push(...regenerateDerivedViews(root));
    const receipt = path.join(stateRoot(root), "recovery", `${journal.event_id}.recovered.json`);
    writeJson(receipt, { ...journal, recovered_at: now(), outcome: "RECOVERED", actions: notes });
    completeFileTransaction(directory);
    // Announced, never silent: a command that quietly finishes somebody else's
    // interrupted write is a command that hides an interruption. It goes to
    // stderr so a caller parsing JSON on stdout still gets JSON.
    recoveredInThisRun.push(`${journal.event_type ?? "operation"} ${journal.event_id} (${notes.join("; ") || "journal closed"})`);
    process.stderr.write(`BEAVE RECOVERED: ${journal.event_type ?? "operation"} ${journal.event_id} was interrupted after the point of no return and has been completed. ${notes.join("; ")}\n`);
  }
}

/** A journal written before the phases existed. Its rule is the one it shipped with. */
function recoverLegacyTransaction(root: string, directory: string, manifest: any): void {
  let state: any = null;
  try { state = readJson(path.join(stateRoot(root), "state.json")); } catch {}
  const committed = state?.revision >= manifest.state_revision && eventLines(root).some((item) => item.event?.event_id === manifest.event_id);
  if (committed) {
    completeFileTransaction(directory);
    return;
  }
  for (const item of manifest.files ?? []) {
    const destination = path.resolve(root, item.path);
    if (item.existed) copyFileCreatingParents(path.join(directory, item.backup), destination);
    else if (fs.existsSync(destination)) fs.rmSync(destination, { force: true });
  }
  writeJson(path.join(stateRoot(root), "recovery", `${manifest.event_id}.rolled-back.json`), { ...manifest, recovered_at: now(), outcome: "ROLLED_BACK" });
  fs.rmSync(directory, { recursive: true, force: true });
}

function writeJson(location: string, value: any): void {
  atomicWrite(location, `${JSON.stringify(value, null, 2)}\n`);
}

function appendEvent(root: string, event: any): void {
  const location = path.join(stateRoot(root), "events.jsonl");
  const prior = fs.existsSync(location) ? fs.readFileSync(location, "utf8").trimEnd() : "";
  atomicWrite(location, `${prior ? `${prior}\n` : ""}${JSON.stringify(event)}\n`);
}

let pendingOperation: {
  id: string;
  payloadHash: string;
  payloadVersion: number;
  legacyPayloadHash: string;
  legacyKey: string;
  fileInputs: string[];
} | null = null;

/**
 * The version of the algorithm that turns a command line into a payload digest.
 *
 * Version 1 was `sha256(JSON.stringify(flags))` with the operation id removed:
 * the digest of the *text as typed*, in the order it was typed. Two invocations
 * that ask for exactly the same thing produced different digests if the options
 * were written in a different order, or if `--project-root` was spelled `.` the
 * second time — so the retry the contract teaches after an interruption was
 * refused as "different input". And the reverse was worse: a `--content-file`
 * appeared in the digest as its *path*, so the same operation id pointed at the
 * same filename holding entirely different text was accepted as a no-op, and
 * the second content was silently discarded.
 *
 * Version 2 digests what the operation *is*: the command, and its options sorted
 * by name, each tagged with what kind of thing it is. Version 1 is not deleted —
 * it is how every event written before today is recognised, and a project from
 * `alpha.1` or `alpha.2` must keep working.
 */
const OPERATION_INPUT_VERSION = 2;

/**
 * Options whose *content* is the input, not their path.
 *
 * A file passed to one of these is read and digested. Two paths holding
 * identical bytes are therefore the same operation, and the same path holding
 * different bytes is a different one — which is the case that used to pass as a
 * no-op while the new content was thrown away.
 */
const FILE_VALUED_FLAGS = new Set([
  "answer-file", "content-file", "evidence-file", "file", "instruction-file",
  "interpretation-file", "module-answer-file", "next-question-file", "owners-file",
  "question-file", "rationale-file", "reason-file", "reply-file", "source-file",
]);

/** Options that name a place on this filesystem: the location is the input. */
const DIRECTORY_VALUED_FLAGS = new Set(["output-dir", "package-dir"]);

/** Options that name a path *inside the project*, recorded as text in the ledger. */
const RECORDED_PATH_FLAGS = new Set(["base-path"]);

/**
 * One spelling for one location.
 *
 * Separators are forward slashes, a trailing one is dropped, and on Windows the
 * drive letter is upper-cased because `c:\x` and `C:\x` are the same directory
 * there. Nothing else is case-folded: on the systems where case matters, two
 * spellings that differ in case are two different files.
 */
function canonicalPathText(value: string): string {
  let resolved = path.resolve(value).replaceAll("\\", "/");
  if (resolved.length > 1 && resolved.endsWith("/")) resolved = resolved.slice(0, -1);
  if (process.platform === "win32" && /^[a-z]:/.test(resolved)) resolved = resolved[0].toUpperCase() + resolved.slice(1);
  return resolved;
}

/**
 * What this operation was asked to do, in a form that does not depend on typing.
 *
 * Sorted by option name, so order cannot change the digest. Tagged by kind, so a
 * value that happens to look like another kind cannot be confused with it. And
 * deliberately *not* clever about anything else:
 *
 *   - `--project-root` is left out. It says which project the operation belongs
 *     to, and the answer is already "the one whose event log is being read".
 *     Leaving it in meant that running the same command from inside the folder
 *     rather than beside it counted as different input.
 *   - a value that carries a comma-separated list is passed through untouched.
 *     Sorting it would be a guess about whether its order means anything, and
 *     `--sources DEC-1,DEC-2` records provenance in the order given.
 *   - a file that is not there is recorded by its path, marked as missing, so
 *     the digest still distinguishes two different missing files instead of
 *     silently agreeing.
 */
function canonicalOperationInput(command: string, flags: Flags): unknown {
  const options: unknown[] = [];
  for (const key of Object.keys(flags).sort()) {
    if (key === "operation-id" || key === "project-root") continue;
    const value = flags[key];
    if (typeof value === "boolean") {
      options.push([key, "flag", value]);
      continue;
    }
    if (value === undefined) continue;
    const text = String(value);
    if (FILE_VALUED_FLAGS.has(key)) {
      const resolved = path.resolve(text);
      let digest: string | null = null;
      try {
        if (fs.statSync(resolved).isFile()) digest = sha256(fs.readFileSync(resolved));
      } catch { digest = null; }
      options.push(digest ? [key, "file", digest] : [key, "file-missing", canonicalPathText(text)]);
      continue;
    }
    if (DIRECTORY_VALUED_FLAGS.has(key)) {
      options.push([key, "path", canonicalPathText(text)]);
      continue;
    }
    if (RECORDED_PATH_FLAGS.has(key)) {
      options.push([key, "recorded-path", text.replaceAll("\\", "/")]);
      continue;
    }
    options.push([key, "value", text]);
  }
  return { algorithm: OPERATION_INPUT_VERSION, command, options };
}

function idempotencyKey(flags: Flags): string {
  const operationId = required(flags, "operation-id").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(operationId)) throw new BeaveError(`Invalid --operation-id; use 3-128 letters, numbers, '.', '_', ':' or '-'`);
  // Both digests are computed, every time. The new one is what a new event
  // records; the old one is the only way to recognise an event written before
  // today, and recognising those is not optional — an unrecognised completed
  // operation is one that gets applied twice.
  const legacyFlags = { ...flags };
  delete legacyFlags["operation-id"];
  const legacyPayloadHash = sha256(JSON.stringify(legacyFlags));
  const payloadHash = sha256(canonicalJson(canonicalOperationInput(runningCommand, flags)));
  pendingOperation = {
    id: operationId,
    payloadHash,
    payloadVersion: OPERATION_INPUT_VERSION,
    legacyPayloadHash,
    legacyKey: sha256(`${operationId}:${legacyPayloadHash}`),
    // Which of this command's options are files. It decides whether a
    // version-1 record can be trusted to say "this is the same operation":
    // that digest saw the path and never the content.
    fileInputs: Object.keys(flags).filter((key) => FILE_VALUED_FLAGS.has(key)).sort(),
  };
  return sha256(`${operationId}:${payloadHash}`);
}

/**
 * Has this operation already happened?
 *
 * The answer is read from the event history, so an operation that was
 * interrupted *after* its event was appended and before its state was written
 * used to answer "yes" over a project that had not caught up — the command
 * reported `Idempotent retry` and exit 0 while `replay` reported the state as
 * diverged. The mirror case was as bad: interrupted before the append, the retry
 * answered "no", `loadState` then completed the original operation underneath
 * it, and the command failed on its own now-unsatisfiable preconditions.
 *
 * One line fixes both, and it is the line that says what the order means:
 * finish what was interrupted, *then* ask whether this is a repeat. Found by an
 * independent review on 2026-09-12, in seventeen commands at once.
 */
function checkIdempotency(root: string, key: string): boolean {
  const eventsPath = path.join(stateRoot(root), "events.jsonl");
  if (!fs.existsSync(eventsPath)) return false;
  recoverFileTransactions(root);
  const lines = fs.readFileSync(eventsPath, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.some((line) => {
    let event: any;
    try { event = JSON.parse(line); } catch { return false; }
    /*
     * The same operation id, different input.
     *
     * The refusal is right — an operation id names one operation, and letting a
     * second one borrow it would make the idempotency record meaningless. What
     * was wrong is that it said nothing about the situation a user is usually in
     * when they see it: the second review reached it by following the documented
     * recovery route after an interrupted `doc-save` (a fresh `doc-diff`, then
     * `doc-save` with the same id), where the input differs precisely because
     * the first attempt already succeeded. Exit 2 and nothing written was
     * correct; "was already used with different input" was not enough to act on.
     */
    /*
     * Compared with the algorithm the record itself declares.
     *
     * An event with no `operation_payload_version` was written by version 1 and
     * is judged by version 1: its digest is over the text as typed, and this
     * engine cannot recompute a version-2 digest for input it never saw. So a
     * reordered retry of an operation recorded by an older engine still
     * conflicts — correctly, because nothing here can prove the two are the
     * same. From today's records on, order does not matter.
     */
    const recordedVersion = Number(event.operation_payload_version ?? 1);
    const mine = pendingOperation
      ? recordedVersion >= OPERATION_INPUT_VERSION
        ? pendingOperation.payloadHash
        : pendingOperation.legacyPayloadHash
      : null;
    if (pendingOperation && event.operation_id === pendingOperation.id && event.operation_payload_hash !== mine) {
      throw new BeaveError(
        `Operation ID ${pendingOperation.id} was already used with different input: it recorded ${event.type ?? "an event"} at revision ${event.state_revision ?? "?"}, ${event.at ?? "an earlier instant"}. No changes written.
` +
          `If you are retrying an interrupted operation, it already finished - \`beave status --project-root .\` shows it, and repeating it is not needed. ` +
          `If this is new work, give it a new operation id.`,
      );
    }
    // Either generation of the key identifies the same completed operation. A
    // record this engine cannot recognise is one it would apply a second time.
    const matches = event.idempotency_key === key || (pendingOperation !== null && event.idempotency_key === pendingOperation.legacyKey);
    /*
     * A version-1 record cannot certify a file-valued operation as a repeat.
     *
     * Version 1 digested the *path* of a `--*-file` option and never its
     * content, so the same id, the same filename and entirely different text
     * produced the same digest — and the engine answered `Idempotent retry`
     * while the new content was discarded. Version 2 fixed that for records it
     * writes; it could not fix it for records written before today, because a
     * version-2 digest cannot be recomputed for input no engine ever saw. A
     * fourth independent review demonstrated it end to end with the shipped
     * `alpha.2` tarball: a human override reading "do NOT ship" was thrown away
     * over one reading "ship on Friday", exit 0.
     *
     * So the answer here is neither "yes" nor a silent "no". It is a refusal
     * that says why, changes nothing, and leaves the decision with a person —
     * the conservative direction, because the alternative discards their work.
     */
    if (matches && pendingOperation && Number(event.operation_payload_version ?? 1) < OPERATION_INPUT_VERSION && pendingOperation.fileInputs.length) {
      throw new BeaveError(
        `Operation ID ${pendingOperation.id} was recorded by an earlier version of Beave, and this command reads ${pendingOperation.fileInputs.map((key) => `--${key}`).join(", ")}.\n` +
          `That older record digested the *path* of a file and not its content, so Beave cannot tell whether this is the same operation or the same filename holding something new — and answering "already applied" would throw away whatever the file says now. Nothing was written.\n` +
          `If the earlier operation completed, there is nothing to do: \`beave status --project-root .\` and \`beave validate --project-root .\` show the recorded result. If this is new input, give it a new operation id.`,
      );
    }
    return matches;
  });
}

function assertNotBlocked(state: State): void {
  if (state.needs_reconciliation) {
    throw new BeaveError("State is BLOCKED pending human reconciliation. Resolve open overrides before continuing.");
  }
}

/**
 * The sentence a divergent project gets, once, with the way out.
 *
 * It is not a repair and not a refusal to work forever: it says which two things
 * disagree and which command reconciles them.
 */
function divergenceRefusal(): string {
  return (
    "The state on disk does not match the history that produced it: its digest is not the one the last event recorded. " +
    "Something rewrote .beave/state.json outside Beave. Nothing was written. " +
    "Run `beave replay --project-root . --verify` to see exactly which fields differ, then either restore the file or rebuild it with `beave replay --project-root . --repair --operation-id <id>`."
  );
}

/**
 * The one place a project's durable state changes.
 *
 * It validates, then records the mutation itself — not a digest of it — and
 * proves, before writing a byte, that the recorded mutation reproduces the state
 * it describes. Then it writes through the journal: event first, state second,
 * because the event is the point at which the operation has happened.
 */
function commitState(root: string, location: string, state: State, event: any, options: { views?: boolean; origin?: boolean } = {}): void {
  if (pendingOperation && event.idempotency_key) {
    Object.assign(event, {
      operation_id: pendingOperation.id,
      operation_payload_hash: pendingOperation.payloadHash,
      // Declared, not inferred: a digest whose algorithm is a guess is a digest
      // that stops matching the day the algorithm changes again.
      operation_payload_version: pendingOperation.payloadVersion,
    });
  }
  const errors = stateErrors(root, state, event);
  if (errors.length) {
    throw new BeaveError(`Transaction failed validation:\n- ${errors.join("\n- ")}`);
  }

  const before = fs.existsSync(location) ? readJson(location) : null;
  const tail = lastEventLine(root);
  // A state edited by hand is not overwritten in silence. Only checkable where
  // the previous event recorded a digest: a project whose history predates this
  // format carries none, and no check is invented for it.
  if (tail?.event?.state_sha256 && digestOf(before) !== tail.event.state_sha256) {
    throw new BeaveError(divergenceRefusal());
  }

  const patch: PatchOp[] = [];
  if (options.origin === true) patch.push({ op: "set", path: [], value: structuredClone(state) });
  else diffValue(before, state, [], patch);
  const stateAfter = digestOf(state);
  const rebuilt = digestOf(applyPatch(before, patch));
  if (rebuilt !== stateAfter) {
    throw new BeaveError("Internal: the mutation this event would record does not reproduce the state it describes. Nothing was written. This is a defect in the engine, not in the project.");
  }

  Object.assign(event, {
    format: EVENT_FORMAT,
    previous_revision: before ? Number(before.revision ?? 0) : 0,
    previous_state_sha256: before ? digestOf(before) : null,
    state_sha256: stateAfter,
    state_patch: patch,
    previous_event_sha256: tail ? sha256(tail.line) : null,
  });
  if (event.replay_origin !== true) delete event.replay_origin;
  event.payload_sha256 = digestOf({ ...event, payload_sha256: undefined });

  const owned = activeTransaction === null;
  const directory = owned ? beginFileTransaction(root, event, []) : activeTransaction!.directory;
  const handle: TransactionHandle = { directory, root };

  const eventLine = JSON.stringify(event);
  const stateContent = `${JSON.stringify(state, null, 2)}\n`;
  const eventsLocation = path.join(stateRoot(root), "events.jsonl");
  atomicWrite(path.join(directory, "staged-state.json"), stateContent);
  const journal = readJson(journalPath(directory));
  journal.staged = {
    event_line: eventLine,
    events_prior_bytes: fs.existsSync(eventsLocation) ? fs.statSync(eventsLocation).size : 0,
    state_sha256_file: sha256(stateContent),
    regenerate_views: options.views === true,
  };
  journal.phase = "COMMITTING" satisfies TransactionPhase;
  writeJournal(directory, journal);
  faultPoint("after-staged");
  faultPoint("before-commit");

  appendEvent(root, event);
  faultPoint("after-events");
  writeJson(location, state);
  faultPoint("after-state");
  setPhase(handle, "COMMITTED");
  faultPoint("after-commit");
  if (owned) completeFileTransaction(directory);
}

// ---------------------------------------------------------------------------
// The reducer
//
// Deterministic by construction: it reads `events.jsonl` and nothing else. No
// clock, no filesystem beyond that one file, no field copied across from
// `state.json` — which is the failure mode the brief names, and the reason the
// result is compared digest for digest at every single step rather than only at
// the end. An event whose patch does not reproduce the digest it recorded stops
// the replay where it is and says which revision failed.
// ---------------------------------------------------------------------------

interface ReplayOutcome {
  replayable: boolean;
  /** Why not, when it is not. Always a sentence with a way forward in it. */
  reason: string | null;
  state: any;
  originIndex: number;
  originType: string | null;
  applied: number;
  throughRevision: number | null;
  /** Events before the origin: present in the file, outside what replay proves. */
  unprovenBefore: number;
}

function replayFromEvents(root: string): ReplayOutcome {
  const empty: ReplayOutcome = { replayable: false, reason: null, state: null, originIndex: -1, originType: null, applied: 0, throughRevision: null, unprovenBefore: 0 };
  const lines = eventLines(root);
  if (!lines.length) return { ...empty, reason: "This project has no event history to replay." };

  const malformed = lines.findIndex((item) => item.malformed);
  if (malformed >= 0) {
    return { ...empty, reason: `Line ${malformed + 1} of .beave/events.jsonl is not valid JSON, so the history cannot be read past it. Nothing was changed.` };
  }

  // The chain, checked over the whole file rather than only over the replayed
  // part: it is the tamper-evidence, and it is worth as much before the origin
  // as after it.
  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const event = lines[index].event;
    if (typeof event.event_id === "string") {
      if (seen.has(event.event_id)) return { ...empty, reason: `Event ${event.event_id} appears twice in .beave/events.jsonl (line ${index + 1}). A history with a duplicated event cannot be replayed.` };
      seen.add(event.event_id);
    }
    if (typeof event.format !== "number") continue;
    if (event.format > EVENT_FORMAT) {
      return { ...empty, reason: `Line ${index + 1} was written in event format ${event.format}; this engine reads up to ${EVENT_FORMAT}. Upgrade Beave rather than replaying it with an older reader.` };
    }
    const expected = index === 0 ? null : sha256(lines[index - 1].line);
    if ((event.previous_event_sha256 ?? null) !== expected) {
      return { ...empty, reason: `The event chain breaks at line ${index + 1} (${event.type}): it records a different predecessor than the line before it. The history was edited outside Beave.` };
    }
    /*
     * The event's own digest, checked rather than merely stored.
     *
     * It was written on every event and read by nothing, which an independent
     * review demonstrated the cost of: editing an event's metadata — an owner,
     * a reason — and recomputing only the chain produced a history that
     * verified. The detector was already in the file and was not being used.
     */
    if (typeof event.payload_sha256 === "string") {
      const recomputed = digestOf({ ...event, payload_sha256: undefined });
      if (recomputed !== event.payload_sha256) {
        return { ...empty, reason: `Line ${index + 1} (${event.type}) does not match the digest it records of itself. The event was edited after it was written.` };
      }
    }
  }

  let originIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const event = lines[index].event;
    if (typeof event.format === "number" && event.replay_origin === true) {
      originIndex = index;
      break;
    }
  }
  if (originIndex < 0) {
    return {
      ...empty,
      reason:
        "This project's history has no point the state can be rebuilt from. Its events were written by an engine that recorded digests of each change rather than the change itself, so they cannot be replayed and nothing will be invented for them. " +
        "Record a starting point with `beave baseline --project-root . --reason \"<why>\" --owner <name> --operation-id <id>`: everything from there on is reproducible, and everything before it stays in the file, unproven and marked as such.",
    };
  }

  let state: any = null;
  let applied = 0;
  for (let index = originIndex; index < lines.length; index += 1) {
    const event = lines[index].event;
    const where = `line ${index + 1} (${event.type ?? "no type"}, revision ${event.state_revision ?? "?"})`;
    if (typeof event.format !== "number") {
      return { ...empty, originIndex, originType: lines[originIndex].event.type, reason: `The history after the replay origin is not uniform: ${where} carries no event format, so it records no mutation to apply.` };
    }
    if (index > originIndex) {
      const expectedPrevious = digestOf(state);
      if (event.previous_state_sha256 !== expectedPrevious) {
        return { ...empty, originIndex, originType: lines[originIndex].event.type, reason: `At ${where} the recorded previous state does not match the state rebuilt so far. The history is not continuous here.` };
      }
      if (Number(event.previous_revision) !== Number(state?.revision ?? 0)) {
        return { ...empty, originIndex, originType: lines[originIndex].event.type, reason: `At ${where} the recorded previous revision is ${event.previous_revision}, but the state rebuilt so far is at revision ${state?.revision ?? 0}. Events are out of order or one is missing.` };
      }
      /*
       * A revision that does not advance.
       *
       * Every command builds revision N+1 from the N it read, so an event whose
       * revision equals its predecessor's is not a history this engine wrote.
       * That is precisely the shape a lost update leaves: two processes read
       * revision N, the second commits against what it finds on disk, and the
       * chain stays continuous while the first process's work is overwritten
       * inside the patch. Everything else here — digests, chain, patch — passes
       * on such a file, and `validate` was the only command that caught it. It
       * is caught here now, and `tests/project-lock.test.mjs` builds the
       * counter-example by removing the lock rather than describing it.
       */
      if (Number(event.state_revision) !== Number(event.previous_revision) + 1) {
        return { ...empty, originIndex, originType: lines[originIndex].event.type, reason: `At ${where} the revision does not advance: the event follows revision ${event.previous_revision} and records revision ${event.state_revision}. Two events cannot occupy one revision, and a write that overwrote another's is the usual cause.` };
      }
    }
    try {
      state = applyPatch(state, event.state_patch);
    } catch (error: any) {
      return { ...empty, originIndex, originType: lines[originIndex].event.type, reason: `${where} could not be applied: ${error.message}` };
    }
    const produced = digestOf(state);
    if (produced !== event.state_sha256) {
      return { ...empty, originIndex, originType: lines[originIndex].event.type, reason: `${where} does not produce the state it recorded: rebuilding it gives ${produced.slice(0, 12)}… where the event claims ${String(event.state_sha256).slice(0, 12)}…. The event was altered after it was written.` };
    }
    if (Number(state?.revision) !== Number(event.state_revision)) {
      return { ...empty, originIndex, originType: lines[originIndex].event.type, reason: `${where} rebuilds a state at revision ${state?.revision}, which is not the revision the event records.` };
    }
    applied += 1;
  }

  return {
    replayable: true,
    reason: null,
    state,
    originIndex,
    originType: lines[originIndex].event.type,
    applied,
    throughRevision: Number(state?.revision ?? 0),
    unprovenBefore: originIndex,
  };
}

/** Field-by-field, in the words of the paths that differ. */
function describeDifferences(current: unknown, rebuilt: unknown, limit = 40): string[] {
  const ops: PatchOp[] = [];
  diffValue(current, rebuilt, [], ops);
  const lines = ops.slice(0, limit).map((op) => {
    const at = op.path.length ? op.path.join(".") : "<the whole state>";
    if (op.op === "del") return `  ${at}: present on disk, absent in the rebuilt state`;
    if (op.op === "trim") return `  ${at}: the rebuilt state holds ${op.value} entries, the file holds more`;
    const value = canonicalJson(op.value);
    return `  ${at}: rebuilt as ${value.length > 120 ? `${value.slice(0, 117)}…` : value}`;
  });
  if (ops.length > limit) lines.push(`  … and ${ops.length - limit} more`);
  return lines;
}

/** The sentence Resume, validate and replay all print, so they cannot disagree. */
function replaySummary(root: string, outcome: ReplayOutcome, current: any): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  if (!outcome.replayable) {
    lines.push(`History replay: NOT REPRODUCIBLE. ${outcome.reason}`);
    return { ok: false, lines };
  }
  const rebuilt = digestOf(outcome.state);
  const live = digestOf(current);
  if (rebuilt === live) {
    lines.push(`History replay: the state matches its history exactly (${outcome.applied} event${outcome.applied === 1 ? "" : "s"} from ${outcome.originType}, through revision ${outcome.throughRevision}).`);
    if (outcome.unprovenBefore > 0) {
      lines.push(outcome.unprovenBefore === 1
        ? `  1 earlier event is kept in the file and is not covered by this proof: it predates the replay origin.`
        : `  ${outcome.unprovenBefore} earlier events are kept in the file and are not covered by this proof: they predate the replay origin.`);
    }
    return { ok: true, lines };
  }
  lines.push("History replay: DIVERGED. The state on disk is not what its own events produce.");
  lines.push(...describeDifferences(current, outcome.state));
  lines.push("Repair it with: beave replay --project-root . --repair --operation-id <id>");
  return { ok: false, lines };
}

function replay(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const repair = flags.repair === true;
  // `--verify` is the default, so it is accepted and means what it says. Asking
  // for both is a caller who has not decided which one they want, and an option
  // this engine accepts and ignores is the defect it refuses everywhere else.
  if (repair && flags.verify === true) {
    throw new BeaveError("--verify and --repair ask for different things: one reads and reports, the other writes. Choose one. Nothing was changed.");
  }
  if (!repair) {
    // Verification changes nothing, so it does not run recovery either: a
    // command that reports the state must not be the command that alters it.
    const location = path.join(stateRoot(root), "state.json");
    if (!fs.existsSync(location)) {
      // The command the contract recommends for diagnosing a project must say
      // something useful about the one shape of damage it exists to repair.
      throw new BeaveError(
        fs.existsSync(path.join(stateRoot(root), "events.jsonl"))
          ? `.beave/state.json is missing, and the event history is still here. Rebuild the state from it:\n  beave replay --project-root . --repair --operation-id <id>\nNothing was changed.`
          : `No Beave state at ${stateRoot(root)}`,
      );
    }
    const current = readJson(location);
    /*
     * Verification does not recover -- a command that reports must not be the
     * command that alters -- so it says what is outstanding instead of reporting
     * a recoverable project as a damaged one.
     */
    const pending = pendingTransactions(root);
    if (pending.length) {
      console.log(`${pending.length} operation${pending.length === 1 ? " was" : "s were"} interrupted and ${pending.length === 1 ? "is" : "are"} waiting to be resolved: ${pending.map((item) => `${item.journal.event_type ?? "operation"} (${item.journal.phase})`).join(", ")}.`);
      console.log(`Any command that touches this project resolves them, or run \`beave recover --project-root . --apply\`. Until then the comparison below describes a project that is mid-operation.`);
    }
    const outcome = replayFromEvents(root);
    const summary = replaySummary(root, outcome, current);
    for (const line of summary.lines) console.log(line);
    if (!summary.ok) throw new BeaveError("The project state cannot be verified against its history.");
    return;
  }

  const key = idempotencyKey(flags);
  recoverFileTransactions(root);
  const location = path.join(stateRoot(root), "state.json");
  /*
   * A missing state file is the case this command exists for.
   *
   * It used to go through `loadState`, which reads `state.json` — so the one
   * situation in which rebuilding from the history would actually save a project
   * was the one situation the command could not handle. It died on a raw ENOENT.
   * An independent review found it by deleting the file and asking for a repair.
   */
  const current = fs.existsSync(location) ? (readJson(location) as State) : null;
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: this repair is already recorded.`);
  const outcome = replayFromEvents(root);
  if (!outcome.replayable) throw new BeaveError(`Nothing can be rebuilt: ${outcome.reason}`);
  if (current !== null && digestOf(outcome.state) === digestOf(current)) {
    return console.log("Nothing to repair: the state already matches its history exactly.");
  }

  const at = now();
  const eventId = crypto.randomUUID();
  const rebuilt = structuredClone(outcome.state);
  const differences = current === null
    ? [`  .beave/state.json was missing and has been rebuilt from ${outcome.applied} recorded event${outcome.applied === 1 ? "" : "s"}.`]
    : describeDifferences(current, outcome.state);

  /*
   * Backups first, and of both files.
   *
   * What this command replaces is a state somebody may have edited on purpose.
   * The bytes it overwrites are preserved under `.beave/backups/` before a single
   * write, so "repair" never means "discard what was there".
   */
  const backupState = current === null ? null : backupName(location);
  if (backupState) {
    fs.mkdirSync(path.dirname(backupState), { recursive: true });
    fs.copyFileSync(location, backupState);
  }
  const eventsLocation = path.join(stateRoot(root), "events.jsonl");
  const backupEvents = backupName(eventsLocation);
  fs.mkdirSync(path.dirname(backupEvents), { recursive: true });
  fs.copyFileSync(eventsLocation, backupEvents);

  const event: any = {
    event_id: eventId,
    type: "STATE_REPAIRED_FROM_EVENTS",
    state_revision: Number(rebuilt.revision) + 1,
    at,
    idempotency_key: key,
    rebuilt_from: outcome.originType,
    events_applied: outcome.applied,
    replaced_state_sha256: current === null ? null : digestOf(current),
    rebuilt_state_sha256: digestOf(rebuilt),
    differences: differences.length,
    state_backup: backupState === null ? null : path.relative(root, backupState).replaceAll("\\", "/"),
    events_backup: path.relative(root, backupEvents).replaceAll("\\", "/"),
  };

  const transaction = beginFileTransaction(root, event, [path.join(root, QA_VIEW_RELATIVE)]);
  try {
    // The rebuilt state is put back first, so the event that records the repair
    // is written on top of a state that already agrees with its own history.
    // Recording it the other way round would put the divergent digest into the
    // chain and make the next replay fail on this very event.
    atomicWrite(location, `${JSON.stringify(rebuilt, null, 2)}\n`);
    const repaired = structuredClone(rebuilt);
    repaired.revision = event.state_revision;
    repaired.last_event_id = eventId;
    repaired.updated_at = at;
    if (repaired.interview_view) repaired.interview_view = { path: QA_VIEW_RELATIVE, sha256: sha256(renderInterviewView(repaired)) };
    commitState(root, location, repaired, event, { views: true });
    if (Array.isArray(repaired.interview_log)) writeInterviewView(root, renderInterviewView(repaired));
    faultPoint("after-view");
    completeFileTransaction(transaction);
  } catch (error) {
    if (fs.existsSync(transaction)) rollbackFileTransaction(root, transaction);
    throw error;
  }

  console.log(`Rebuilt the state from ${outcome.applied} recorded event${outcome.applied === 1 ? "" : "s"}.`);
  if (event.state_backup) console.log(`What the file said before is preserved at ${event.state_backup}.`);
  else console.log(`There was no state file to preserve: it was missing, and the history is where this came from.`);
  for (const line of differences) console.log(line);
  console.log(`Recorded as ${eventId}. Run \`beave validate --project-root .\` to confirm.`);
}

/**
 * A verifiable starting point for a project whose earlier events cannot be replayed.
 *
 * It records the current state in full, with a digest, a reason and an instant.
 * It does not delete, rewrite or reinterpret anything before it: those events
 * stay in the file and stay outside what replay proves, which is the honest
 * description of a history that was written without the information.
 */
function baseline(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  const { location, state } = loadState(root);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: this baseline is already recorded.`);
  assertKnownOwner(state, required(flags, "owner"));
  const reason = required(flags, "reason").trim();
  if (!reason) throw new BeaveError("--reason cannot be empty: a baseline records why the history before it is not reproducible.");

  const existing = replayFromEvents(root);
  if (existing.replayable && digestOf(existing.state) === digestOf(state)) {
    console.log(`Nothing to do: this project already replays from ${existing.originType} through revision ${existing.throughRevision}.`);
    if (existing.unprovenBefore > 0) console.log(`  ${existing.unprovenBefore} earlier event${existing.unprovenBefore === 1 ? "" : "s"} remain outside that proof.`);
    return;
  }

  const at = now();
  const eventId = crypto.randomUUID();
  const lines = eventLines(root);
  const stateBackup = backupName(location);
  fs.mkdirSync(path.dirname(stateBackup), { recursive: true });
  fs.copyFileSync(location, stateBackup);
  const eventsLocation = path.join(stateRoot(root), "events.jsonl");
  const eventsBackup = backupName(eventsLocation);
  if (fs.existsSync(eventsLocation)) fs.copyFileSync(eventsLocation, eventsBackup);

  const previousDigest = digestOf(state);
  state.revision = Number(state.revision) + 1;
  state.last_event_id = eventId;
  state.updated_at = at;
  const event: any = {
    event_id: eventId,
    type: "BASELINE_RECORDED",
    state_revision: state.revision,
    at,
    idempotency_key: key,
    replay_origin: true,
    owner: required(flags, "owner"),
    reason,
    reducer_version: REDUCER_VERSION,
    baseline_state_sha256: previousDigest,
    events_before: lines.length,
    unreproducible_before_revision: Number(state.revision) - 1,
    state_backup: path.relative(root, stateBackup).replaceAll("\\", "/"),
    events_backup: fs.existsSync(eventsBackup) ? path.relative(root, eventsBackup).replaceAll("\\", "/") : null,
  };

  commitState(root, location, state, event, { origin: true });
  console.log(`Recorded a replay baseline at revision ${state.revision}.`);
  console.log(`Everything from here on can be rebuilt from the events. The ${lines.length} event${lines.length === 1 ? "" : "s"} before it stay in the file and stay outside that proof: they were written without the information a replay needs, and none of it has been invented.`);
  console.log(`The previous state and history are preserved at ${event.state_backup} and ${event.events_backup ?? "<no history file>"}.`);
}

/**
 * Interrupted transactions: what they are, and what finishing them would do.
 *
 * Inspection is the default and touches nothing, because the command someone
 * runs when they are frightened should not be the command that changes things.
 */
/**
 * Every directory under `transactions/`, including the ones that are not a
 * transaction any more.
 *
 * A journal that will not parse, and a directory with no journal at all, used to
 * be invisible: the first killed every command with a raw JSON error and the
 * second was skipped for ever while `recover` said everything had finished.
 * Both are now *named*, which is the least a recovery tool owes its user.
 */
function pendingTransactions(root: string): Array<{ id: string; journal: any }> {
  const directory = path.join(stateRoot(root), "transactions");
  const pending: Array<{ id: string; journal: any }> = [];
  if (!fs.existsSync(directory)) return pending;
  for (const entry of fs.readdirSync(directory)) {
    const candidate = path.join(directory, entry);
    if (!fs.statSync(candidate).isDirectory()) continue;
    const journalFile = journalPath(candidate);
    const legacy = path.join(candidate, "manifest.json");
    if (fs.existsSync(journalFile)) {
      try {
        pending.push({ id: entry, journal: readJson(journalFile) });
      } catch {
        pending.push({ id: entry, journal: { phase: "UNREADABLE", event_id: entry, event_type: null } });
      }
    } else if (fs.existsSync(legacy)) {
      try {
        pending.push({ id: entry, journal: { ...readJson(legacy), phase: "LEGACY" } });
      } catch {
        pending.push({ id: entry, journal: { phase: "UNREADABLE", event_id: entry, event_type: null } });
      }
    } else {
      pending.push({ id: entry, journal: { phase: "NO_JOURNAL", event_id: entry, event_type: null } });
    }
  }
  return pending;
}

/**
 * A history whose final line was cut off mid-write.
 *
 * Returns the index of that line, or -1. Only the *last* line qualifies: a
 * malformed line with complete lines after it is damage nobody can undo, and it
 * stays a refusal.
 */
function tornTrailingEvent(root: string): number {
  const lines = eventLines(root);
  if (!lines.length) return -1;
  const last = lines.length - 1;
  if (!lines[last].malformed) return -1;
  if (lines.slice(0, last).some((item) => item.malformed)) return -1;
  return last;
}

function recover(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const pending = pendingTransactions(root);
  const torn = tornTrailingEvent(root);

  const stagings = outstandingStagings(root);
  if (!pending.length && torn < 0 && !stagings.length) {
    console.log("No interrupted operation. Every transaction this project started was finished.");
    return;
  }

  for (const item of stagings) {
    console.log(`${item.note.kind} to ${item.note.destination}`);
    console.log(`  started     ${item.note.created_at} by process ${item.note.pid} on ${item.note.host}`);
    console.log(`  phase       ${item.note.phase}`);
    if (!item.present) {
      console.log(
        (item as any).leftover
          ? `  would be    cleared: the package was promoted and still carries its ${STAGING_MARKER}, which records this machine — removing it is what makes the package handable`
          : `  would be    forgotten: the staging directory is no longer there, so the operation left nothing behind`,
      );
    } else if (item.alive) {
      console.log(`  would be    left alone: that process is still running on this machine`);
    } else {
      console.log(`  would be    discarded: an unfinished package is never promoted, and re-running the export costs nothing`);
    }
  }

  if (torn >= 0) {
    console.log(`The last line of .beave/events.jsonl was cut off mid-write (line ${torn + 1}).`);
    console.log(`  An append is the last durable write of an operation, so a partial final line cannot be a completed one:`);
    console.log(`  dropping it can only discard an operation that never finished. Every earlier line reads correctly.`);
    console.log(`  would be    removed, after a copy of the whole file is kept under .beave/backups/`);
  }

  for (const item of pending) {
    const phase = item.journal.phase;
    const plan =
      phase === "COMMITTING"
        ? "completed: its event is the point at which it happened, so recovery finishes the write from the content the journal staged"
        : phase === "COMMITTED"
          ? "closed: every file was written and only the journal is left"
          : phase === "LEGACY"
            ? "decided by the rule its own journal shipped with: finished if the event is in the history, undone otherwise"
            : phase === "UNREADABLE"
              ? "left alone, and reported: its journal cannot be read, so nothing here knows what it was doing. Nothing will be changed automatically"
              : phase === "NO_JOURNAL"
                ? "left alone, and reported: the directory carries no journal, so there is nothing to complete or undo. Remove it by hand once you have looked at it"
                : "undone: it never reached the point where it happened, so the project goes back to before it started";
    console.log(`${item.journal.event_type ?? "operation"} ${item.id}`);
    console.log(`  phase       ${phase}`);
    console.log(`  started     ${item.journal.created_at ?? "not recorded"}`);
    console.log(`  operation   ${item.journal.operation_id ?? "not recorded"}`);
    console.log(`  would be    ${plan}`);
  }

  if (flags.apply !== true) {
    console.log(`\nNothing was changed. Run the same command with --apply to carry that out, or — for an interrupted operation — let the next command that touches this project do it: recovery is not optional and every command runs it. A torn final line is the one thing that is never repaired automatically.`);
    return;
  }

  for (const note of clearOwnAbandonedStagings(root)) console.log(note);

  if (torn >= 0) {
    const location = path.join(stateRoot(root), "events.jsonl");
    const backup = backupName(location);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(location, backup);
    const kept = eventLines(root).slice(0, torn).map((item) => item.line);
    atomicWrite(location, kept.length ? `${kept.join(NL)}${NL}` : "");
    console.log(`Removed the torn final line. The file as it was is at ${path.relative(root, backup).replaceAll("\\", "/")}.`);
  }

  recoverFileTransactions(root);
  if (pending.length) console.log(`${pending.length} interrupted operation${pending.length === 1 ? "" : "s"} resolved; the receipts are under .beave/recovery/.`);
  console.log(`Run \`beave replay --project-root . --verify\` to see what the project is now.`);
}

function assertPendingState(root: string, state: State, event: any): void {
  const errors = stateErrors(root, state, event);
  if (errors.length) throw new BeaveError(`Transaction preflight failed:\n- ${errors.join("\n- ")}\nNo changes written.`);
}

function assertKnownOwner(state: any, owner: string): void {
  const known = new Set(Object.values(state.decision_owners ?? {}).map((value) => String(value).trim()));
  if (!known.has(owner.trim())) throw new BeaveError(`Owner is not one of the confirmed decision owners: ${owner}`);
}

function questionnaire(): any[] {
  const text = fs.readFileSync(path.join(SKILL_ROOT, "references", "questionnaire.md"), "utf8");
  const modules: any[] = [];
  let current: any = null;
  for (const line of text.split(/\r?\n/)) {
    const match = /^##\s+(\d+)\.\s+(.+?)\s*$/.exec(line);
    if (match) {
      current = { id: Number(match[1]), title: match[2], questions: [] };
      modules.push(current);
    } else if (current && line.startsWith("- ") && line.includes("?")) {
      current.questions.push(line.slice(2).trim());
    }
  }
  if (modules.map((item) => item.id).join(",") !== Array.from({ length: 17 }, (_, index) => index).join(",")) {
    throw new BeaveError("Questionnaire module IDs must be 0..16");
  }
  return modules;
}

function loadState(root: string): { location: string; state: State } {
  acquireProjectLock(root, runningCommand);
  recoverFileTransactions(root);
  const location = path.join(stateRoot(root), "state.json");
  // A project whose state file is gone but whose history is intact is a project
  // that can be rebuilt, and saying so is more use than the ENOENT this used to
  // raise from four different commands.
  if (!fs.existsSync(location) && fs.existsSync(path.join(stateRoot(root), "events.jsonl"))) {
    throw new BeaveError(
      `.beave/state.json is missing, and the event history is still here. Rebuild the state from it:\n` +
        `  beave replay --project-root . --repair --operation-id <id>\n` +
        `Nothing was changed.`,
    );
  }
  const state = readJson(location) as State;
  // The revision this command is working from, written into the lock so a second
  // process can say what it is waiting behind rather than only that it is waiting.
  noteObservedRevision(Number(state?.revision ?? 0));
  // The read-modify-write window opens here: the revision this command will
  // build on has been read. `BEAVE_TEST_SYNC_AT=read` stops the process inside it.
  testSyncPoint("read");
  return { location, state };
}

function activeModule(state: State): Module | null {
  return state.modules.find((item) => !new Set(["CONFIRMED", "DEFERRED", "NOT APPLICABLE"]).has(item.status)) ?? null;
}

function detectCycles(dependencies: Dependency[]): string[] {
  const adj = new Map<string, string[]>();
  for (const dep of dependencies) {
    if (!adj.has(dep.from)) adj.set(dep.from, []);
    adj.get(dep.from)!.push(dep.to);
  }
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const cycles: string[] = [];

  function dfs(node: string) {
    if (recStack.has(node)) {
      cycles.push(`Cycle detected involving node ${node}`);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    recStack.add(node);
    for (const neighbor of adj.get(node) || []) {
      dfs(neighbor);
    }
    recStack.delete(node);
  }

  for (const node of adj.keys()) dfs(node);
  return cycles;
}

const LEDGER_RULES: Record<string, { prefix: string; statuses?: Set<string>; array: keyof State }> = {
  decision: { prefix: "DEC", statuses: new Set(["PROPOSED", "APPROVED", "REJECTED", "SUPERSEDED"]), array: "decisions" },
  requirement: { prefix: "REQ", statuses: new Set(["DRAFT", "ACTIVE", "DEFERRED", "OBSOLETE"]), array: "requirements" },
  task: { prefix: "TSK", statuses: new Set(["BACKLOG", "READY", "IN_PROGRESS", "REVIEW", "DONE", "BLOCKED"]), array: "tasks" },
  dependency: { prefix: "DEP", statuses: new Set(["BLOCKS", "REQUIRES", "RELATES_TO"]), array: "dependencies" },
  risk: { prefix: "RSK", statuses: new Set(["IDENTIFIED", "MITIGATED", "ACCEPTED", "REALIZED"]), array: "risks" },
  evidence: { prefix: "EVD", array: "evidence" },
  agent: { prefix: "AGT", statuses: new Set(["PROPOSED", "ACTIVE", "RETIRED"]), array: "agents" },
  checkpoint: { prefix: "CHK", array: "checkpoints" }
};

// The exact next action has two possible authors: this engine, and a person who
// recorded one deliberately with `checkpoint --next-action` or `reconcile
// --next-action`. Nothing in schema v3 records which, so the engine recognises
// its own sentences instead. A false positive here would suppress a warning; a
// false negative would print one that is merely noise. Both are recoverable, and
// the list is exact rather than fuzzy for that reason.
const GENERATED_NEXT_ACTIONS: RegExp[] = [
  /^Run `beave next --project-root \.` and discuss module 1\.$/,
  /^Discuss module \d+ — [\s\S]*\.$/,
  /^Review coverage, then proceed to G2\.$/,
  /^Reconcile OVR-[a-f0-9]+(?:: identify impacted decisions, artifacts, tasks, agents, tests, and gates\.| before continuing\.)$/,
  /^Reconciled OVR-[a-f0-9]+\. Continue from the recorded plan; no next action was supplied\.$/,
  /^Proceed to G\d+\.$/,
  /^Proceed to G\d+\. G\d+ passed with a condition owned by [\s\S]+, to review by \d{4}-\d{2}-\d{2}: [\s\S]+$/,
  /^Resolve blockers for G\d+ and retry\.$/,
  /^Answer the open questions? \(QNA-\d{4,}(?:, QNA-\d{4,})*\) with beave qa-answer, then settle (?:it|each) with beave qa-settle\.$/,
  /*
   * `qa-settle` writes these, and they were missing from this list — so the
   * engine treated its own sentence as a person's and refused to move it. A
   * fifth fresh-agent pilot recorded a question and then read a context pack
   * that said, at the top, "no next question is recorded yet" and, twenty lines
   * below, "Ask QNA-0002, which is recorded as planned". A file that asserts and
   * denies the same thing is the defect this list exists to prevent; a sentence
   * missing from it turns the protection into the fault.
   *
   * A bounded check then found three more ways to escape the list, all of them
   * the engine failing to recognise its own handwriting: a question id of five
   * digits or more (`QNA-10000` is legal, and `\d{4}` did not match it), a
   * multi-line `--next-question`, and a multi-line gate `--consequence` — `.*`
   * does not cross a newline without the `s` flag. The patterns are widened
   * here, and `generatedSentence()` flattens the free text that goes into them,
   * so the two halves cannot drift apart again by the width of a line break.
   */
  /^Ask QNA-\d{4,}: [\s\S]*$/,
  /^Continue the interview from QNA-\d{4,}; no next question is recorded yet\.$/,
  /^The interview has nothing open\. Ask the next question with beave qa-ask, or record what module \d+ has settled\.$/,
];

/**
 * One line, always.
 *
 * Free text from a caller — a next question, a gate condition — used to be
 * dropped into the recorded next action verbatim. A newline in it broke the
 * pattern that recognises the sentence as the engine's own *and* broke the
 * `- Exact next action:` list item in every report that renders it. Flattened
 * here, once, rather than guarded for at each of the places that read it.
 */
function generatedSentence(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, " ").trim();
}

/**
 * What the interview is actually waiting for, as a sentence.
 *
 * Built from the ledger every time, because the alternative is what the bounded
 * check found twice: `qa-settle` announcing "no next question is recorded yet"
 * while three were, and `qa-close` / `qa-supersede` leaving the recorded action
 * naming questions that can no longer be answered — a fresh recipient told to
 * obey an instruction that fails.
 */
function openQuestionsSentence(state: State): string {
  const open = (state.interview_log ?? [])
    .filter((item: any) => new Set(["ASKED", "PLANNED"]).has(item.status))
    .map((item: any) => item.id);
  if (!open.length) {
    const active = activeModule(state);
    return `The interview has nothing open. Ask the next question with beave qa-ask, or record what module ${active ? active.id : 1} has settled.`;
  }
  return `Answer the open question${open.length === 1 ? "" : "s"} (${open.join(", ")}) with beave qa-answer, then settle ${open.length === 1 ? "it" : "each"} with beave qa-settle.`;
}

function engineWroteNextAction(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return true;
  return GENERATED_NEXT_ACTIONS.some((pattern) => pattern.test(value.trim()));
}

/**
 * Advance the exact next action, but only when the engine is the one who wrote it.
 *
 * A command that moves the interview forward may replace its own sentence. It may
 * not replace a person's: `exact_next_action` is what a fresh recipient of the
 * folder is told to obey, and a recipient reads the delivered folder, not the
 * terminal of whoever prepared it. Warning about the loss was not enough — the
 * warning stays with the operator while the wrong instruction travels.
 *
 * Returns the note to print. When a human action was preserved, the note carries
 * the suggestion instead of applying it.
 */
function advanceGeneratedNextAction(state: State, generated: string): string | null {
  const previous = state.exact_next_action;
  if (engineWroteNextAction(previous)) {
    state.exact_next_action = generated;
    return null;
  }
  return `The recorded exact next action was written by a person, so it is kept unchanged. Suggested instead: ${generated}\nTo replace it deliberately, use beave checkpoint --next-action or beave reconcile --next-action.`;
}

function validTypedId(value: unknown, prefix: string): boolean {
  return typeof value === "string" && new RegExp(`^${prefix}-[A-Z0-9][A-Z0-9_-]{0,63}$`).test(value);
}

function nonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * The one spelling every persisted relative path is written in: `/`.
 *
 * A ledger written on Windows used to record `ans\m1.md`. On the POSIX machine
 * that receives the package that is not a path at all, it is a file name with a
 * backslash in it — so `validate` reported the file missing, and the delivery to
 * another agent is the declared scenario, not an edge case.
 *
 * The rule (project decision, blocker 4): `/` is canonical for every relative
 * path persisted in the ledger, the events, the manifest and the package. A
 * reader must accept both forms, because records written before the rule exist
 * and must stay readable — that is what this function is for. It is applied at
 * the three choke points every recorded relative path passes through
 * (`safeProjectRelative`, `safeArtifactPath`, `existingFileInside`), so a
 * Windows-spelled record resolves and is contained the same way on both
 * platforms.
 *
 * The cost, stated: a POSIX file whose name genuinely contains a backslash
 * cannot be recorded. That is the safe direction of the trade. Without it,
 * `..\..\etc` and `.beave\secret` pass POSIX containment checks as single
 * segments — a package exported from Windows would arrive weaker than it left.
 */
function canonicalRelative(value: unknown): string {
  return typeof value === "string" ? value.replaceAll("\\", "/") : "";
}

/** True when two recorded relative paths name the same file in either spelling. */
function sameRecordedPath(left: unknown, right: unknown): boolean {
  return canonicalRelative(left) === canonicalRelative(right);
}

/** Absolute location of a path the ledger recorded, in either spelling. */
function resolveRecorded(root: string, relative: unknown): string {
  return path.resolve(root, canonicalRelative(relative));
}

function safeProjectRelative(value: unknown): boolean {
  if (!nonEmpty(value)) return false;
  const canonical = canonicalRelative(value);
  if (!canonical || path.isAbsolute(canonical) || path.isAbsolute(String(value))) return false;
  const normalized = path.normalize(canonical);
  return normalized !== ".." && !normalized.startsWith(`..${path.sep}`);
}

function safeArtifactPath(value: unknown): boolean {
  if (!safeProjectRelative(value)) return false;
  return path.normalize(canonicalRelative(value)).split(path.sep)[0].toLowerCase() !== ".beave";
}

/**
 * Why an artifact path was refused, in the words of the reason it was refused for.
 *
 * `safeArtifactPath` answers no to two unrelated questions — the path leaves the
 * project, or the path is inside the reserved directory — and the callers all
 * reported the second. Somebody who passed an absolute path, or one climbing out
 * with `..`, was told about `.beave`, which is not what happened and does not
 * suggest the fix.
 */
function artifactPathRefusal(kind: string, value: unknown): string | null {
  if (safeArtifactPath(value)) return null;
  if (!safeProjectRelative(value)) {
    return `${kind} must be a path inside the project, written relative to its root. ` +
      `\`${String(value)}\` is not: an absolute path, or one that climbs out with "..", ` +
      `would put the record outside the folder that travels with it.`;
  }
  return `${kind} must stay outside the reserved .beave directory, which holds the ledger itself.`;
}

function existingFileInside(root: string, relative: string): string | null {
  if (!safeProjectRelative(relative)) return null;
  // Both spellings resolve to the same file: see `canonicalRelative`.
  const candidate = path.resolve(root, canonicalRelative(relative));
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return null;
  const realRoot = fs.realpathSync.native(root);
  const realFile = fs.realpathSync.native(candidate);
  const relation = path.relative(realRoot, realFile);
  if (relation === ".." || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) return null;
  return realFile;
}

function duplicateIds(items: any[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seen.has(item?.id)) duplicates.add(item.id);
    seen.add(item?.id);
  }
  return [...duplicates];
}

// ---------------------------------------------------------------------------
// D5 / FR-024 — progress forecast and rework-loop detection.
//
// The requirement is `docs/decisions/2026-09-10-progress-forecast-and-loop-detection.md`
// and `planning/CLAUDE_PROGRESS_FORECAST_ADDENDUM.md`. The observed defect is an
// agent that says "one operation remains" and is then contradicted by a
// verification that had not run yet: the statement is true against the plan and
// still misleads, because the plan does not contain the work the verification is
// about to create.
//
// Two rules shape everything below.
//
//  1. **No percentage is stored anywhere.** A percentage whose denominator can
//     still change is presented as a fact and is not one. Quantities are ranges
//     of observable things — questions, operations, cycles — and a single number
//     means "known", not "guessed precisely".
//  2. **The engine never overwrites the caller's judgement, and never accepts a
//     wrong one in silence.** It records `cycle_state` exactly as supplied, derives
//     what it can see for itself into `signals[]`, and says out loud when the two
//     disagree. Silently correcting a person and silently agreeing with a person
//     are the same failure seen from two sides.
// ---------------------------------------------------------------------------

function readEvents(root: string): any[] {
  const location = path.join(stateRoot(root), "events.jsonl");
  if (!fs.existsSync(location)) return [];
  const parsed: any[] = [];
  for (const line of fs.readFileSync(location, "utf8").split(/\r?\n/).filter(Boolean)) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return parsed;
}

function forecastRangeText(range: ForecastRange): string {
  return range.min === range.max ? `${range.min} (known)` : `${range.min}-${range.max}`;
}

/**
 * Read one `MIN-MAX` option.
 *
 * A percentage gets its own refusal rather than falling through to "unparseable",
 * because someone typing `--questions 60%` is doing the exact thing the decision
 * forbids and deserves to be told which rule they hit.
 */
function parseForecastRange(flags: Flags, key: string): ForecastRange {
  const raw = required(flags, key).trim();
  if (raw.includes("%")) {
    throw new BeaveError(
      `--${key} does not take a percentage. A percentage whose denominator can still change is presented as a fact and is not one, which is what FR-024 exists to prevent. Give an observable range like 3-8, or a single number when the quantity is known. Nothing was written.`
    );
  }
  const match = /^(\d{1,6})(?:\s*-\s*(\d{1,6}))?$/.exec(raw);
  if (!match) {
    throw new BeaveError(
      `--${key} must be a range like 3-8, or a single number when the quantity is known; received ${raw}. Nothing was written.`
    );
  }
  const min = Number(match[1]);
  const max = match[2] === undefined ? min : Number(match[2]);
  if (max < min) {
    throw new BeaveError(`--${key} has an inverted range: ${raw}. The lower bound must not exceed the upper bound. Nothing was written.`);
  }
  return { min, max };
}

/** What the engine counts for itself. See `ForecastDerived`. */
function forecastDerived(state: State, events: any[]): ForecastDerived {
  return {
    open_blockers: (state.blockers ?? []).length,
    open_overrides: (state.human_overrides ?? []).filter((item) => item.status === "OPEN").length,
    tasks_by_status: Object.fromEntries(
      TASK_STATUSES.map((status) => [status, (state.tasks ?? []).filter((item) => item.status === status).length])
    ),
    // Counted from `current_gate`, not from the gate ledger. G0 is passed by `init`
    // and never written as a gate record, so counting recorded outcomes would
    // overstate the remainder by one on every project ever created.
    gates_remaining: Math.max(0, 13 - Number(String(state.current_gate ?? "G0").slice(1))),
    unresolved_modules: (state.modules ?? []).filter((item) => !MODULE_TERMINAL_STATUSES.has(item.status)).map((item) => item.id),
    open_findings: (state.risks ?? []).filter((item) => OPEN_RISK_STATUSES.has(item.status)).length,
    evidence_records: (state.evidence ?? []).length,
    status_history_events: events.filter((event) => typeof event?.record_status === "string").length,
  };
}

/**
 * Work that was declared finished and came back, per ledger record.
 *
 * Read from `record_status` on the ledger events, which is the only place a
 * project's status history exists. A **reopening** is deliberately narrow:
 *
 *  - a task that left `DONE` for anything else — work declared finished that
 *    returned;
 *  - a risk that left `MITIGATED` or `ACCEPTED` for `IDENTIFIED` or `REALIZED`.
 *
 * `REVIEW -> IN_PROGRESS` is not counted. A review sending work back is the
 * review working, and counting it would make the loop signal fire on healthy
 * projects, which is the fastest way to make a warning unreadable.
 *
 * The map is empty for every project written before ALN-008, because those events
 * carry no `record_status`. That is why `derived.status_history_events` is stored:
 * an absent signal must be readable as "not observable here" rather than as
 * "did not happen".
 */
function reopenedRecords(events: any[]): Map<string, number> {
  const last = new Map<string, string>();
  const reopenings = new Map<string, number>();
  for (const event of events) {
    const id = event?.ledger_id;
    const status = event?.record_status;
    if (typeof id !== "string" || typeof status !== "string") continue;
    const previous = last.get(id);
    last.set(id, status);
    if (previous === undefined) continue;
    const isTaskReopening = String(event.type ?? "").startsWith("TASK_") && previous === "DONE" && status !== "DONE";
    const isRiskReopening =
      String(event.type ?? "").startsWith("RISK_") && CLOSED_RISK_STATUSES.has(previous) && OPEN_RISK_STATUSES.has(status);
    if (isTaskReopening || isRiskReopening) reopenings.set(id, (reopenings.get(id) ?? 0) + 1);
  }
  return reopenings;
}

function forecastResidual(entry: { questions: ForecastRange; operations: ForecastRange; cycles: ForecastRange }): number {
  return entry.questions.max + entry.operations.max + entry.cycles.max;
}

/**
 * The D5 conditions the engine can actually observe, computed from recorded data.
 *
 * What is NOT here, and why: *"the agent announced a final step more than once and
 * then added work"* is a fact about the conversation. Nothing in `state.json` or
 * `events.jsonl` records what was said, so the engine cannot see it and must not
 * pretend to. It stays the caller's responsibility, enforced in the semantic skill.
 */
function forecastSignals(
  entry: ProgressForecast,
  previous: ProgressForecast | null,
  history: ProgressForecast[],
  reopenings: Map<string, number>,
  operationsSincePrevious: number
): ForecastSignal[] {
  const signals: ForecastSignal[] = [];

  if (previous) {
    const residual = forecastResidual(entry);
    const previousResidual = forecastResidual(previous);
    const phaseClosed =
      entry.phase.trim() !== previous.phase.trim() ||
      entry.derived.gates_remaining < (previous.derived?.gates_remaining ?? entry.derived.gates_remaining);
    if (residual > previousResidual && !phaseClosed) {
      // How many consecutive updates the residual has now grown for. The addendum
      // says "per due aggiornamenti consecutivi"; the contract says "across two
      // consecutive forecasts", which is one growth step. The signal is raised on
      // the contract's reading and the count is reported, so a reader can tell a
      // first growth from a third without the engine choosing for them.
      // Every forecast this project has recorded, oldest first, with the one being
      // written at the end. `history` does not yet contain `previous` at this point
      // — `previous` is still the current `progress_forecast` — so it is put back in
      // explicitly rather than counted as absent.
      const chain = [...history, previous, entry];
      let consecutive = 0;
      for (let index = chain.length - 1; index > 0; index -= 1) {
        if (forecastResidual(chain[index]) > forecastResidual(chain[index - 1])) consecutive += 1;
        else break;
      }
      signals.push({
        code: "RESIDUAL_GREW_WITHOUT_PHASE_CLOSING",
        implies_cycle_state: "RISCHIO_LOOP",
        observed: `The residual grew from ${previousResidual} to ${residual} without a phase closing (phase is still "${entry.phase}" and ${entry.derived.gates_remaining} gates remain, as before). It has now grown for ${consecutive} consecutive forecast${consecutive === 1 ? "" : "s"}.`,
        detail: {
          previous_residual: previousResidual,
          residual,
          consecutive_growths: consecutive,
          phase: entry.phase,
          gates_remaining: entry.derived.gates_remaining,
        },
      });
    }

    if (entry.phase.trim() === previous.phase.trim()) {
      const widened = (["questions", "operations", "cycles"] as const).filter(
        (key) => entry[key].max - entry[key].min > previous[key].max - previous[key].min
      );
      if (widened.length) {
        signals.push({
          code: "SAME_PHASE_WIDER_RANGE",
          implies_cycle_state: "RISCHIO_LOOP",
          observed: `Two consecutive forecasts carry the same phase ("${entry.phase}") and a wider range: ${widened
            .map((key) => `${key} ${forecastRangeText(previous[key])} became ${forecastRangeText(entry[key])}`)
            .join("; ")}.`,
          detail: { phase: entry.phase, widened },
        });
      }
    }

    // "Operations repeated without producing new evidence or reducing blockers and
    // findings." All three clauses of the addendum are required, not just the one
    // the contract summarises. Without "repeated" and "no new evidence" the signal
    // fires on any project that records two ordinary ledger writes, and a warning
    // that is always on is not a warning. The counts are in `detail` either way.
    const openNow = entry.derived.open_blockers + entry.derived.open_findings;
    const openBefore = (previous.derived?.open_blockers ?? 0) + (previous.derived?.open_findings ?? 0);
    const newEvidence = entry.derived.evidence_records - (previous.derived?.evidence_records ?? 0);
    if (operationsSincePrevious >= 2 && openNow > 0 && openNow >= openBefore && newEvidence <= 0) {
      signals.push({
        code: "OPERATIONS_WITHOUT_A_FALL_IN_BLOCKERS_OR_FINDINGS",
        implies_cycle_state: "RISCHIO_LOOP",
        observed: `${operationsSincePrevious} operations were recorded since the previous forecast, no evidence record was added, and open blockers plus findings did not fall (${openBefore} before, ${openNow} now).`,
        detail: {
          operations_since_previous_forecast: operationsSincePrevious,
          open_blockers_and_findings_before: openBefore,
          open_blockers_and_findings_now: openNow,
          new_evidence_records: newEvidence,
        },
      });
    }
  }

  // A "family" here is one ledger record. Nothing in the ledgers groups defects
  // into families, so the engine uses the identity it actually has and names it,
  // rather than inferring a grouping nobody recorded.
  const repeated = [...reopenings.entries()].filter(([, count]) => count >= 2).sort(([a], [b]) => (a < b ? -1 : 1));
  if (repeated.length) {
    signals.push({
      code: "DEFECT_FAMILY_REOPENED_AFTER_TWO_CYCLES",
      implies_cycle_state: "RISCHIO_LOOP",
      observed: `Work declared finished returned after two correction cycles: ${repeated
        .map(([id, count]) => `${id} reopened ${count} times`)
        .join("; ")}. One ledger record is treated as one defect family, because nothing in the ledgers groups defects.`,
      detail: { records: Object.fromEntries(repeated) },
    });
  }

  return signals;
}

function impliedCycleState(signals: ForecastSignal[]): string | null {
  let best: string | null = null;
  for (const signal of signals) {
    const rank = CYCLE_STATE_RANK[signal.implies_cycle_state];
    if (rank === undefined) continue;
    if (best === null || rank > CYCLE_STATE_RANK[best]) best = signal.implies_cycle_state;
  }
  return best;
}

/**
 * The sentence printed and shown when the recorded cycle state is weaker than what
 * the derived signals imply. `null` when there is no disagreement.
 *
 * It is a sentence and not a correction, and that is the whole design: the engine
 * records what the caller said, records the signal beside it, and names the gap.
 */
function forecastDisagreement(entry: ProgressForecast): string | null {
  const implied = impliedCycleState(entry.signals ?? []);
  if (!implied) return null;
  const declared = CYCLE_STATE_RANK[entry.cycle_state];
  if (declared === undefined || CYCLE_STATE_RANK[implied] <= declared) return null;
  return [
    `Derived signals disagree with the recorded cycle state.`,
    `  Recorded by the caller: ${entry.cycle_state}`,
    `  Derived by the engine from recorded data: ${implied}`,
    ...(entry.signals ?? []).map((signal) => `  - ${signal.code}: ${signal.observed}`),
    `The recorded cycle state was NOT changed. Beave does not overwrite a person's judgement and does not accept it in silence either; the signals are stored beside it in progress_forecast.signals.`,
  ].join("\n");
}

const FORECAST_RECORD_COMMAND =
  `beave forecast --project-root . --owner NAME --phase TEXT --known-work TEXT --conditional-work TEXT ` +
  `--questions MIN-MAX --operations MIN-MAX --cycles MIN-MAX --confidence ALTA|MEDIA|BASSA ` +
  `--confidence-reason TEXT --cycle-state REGOLARE|IN_ESPANSIONE|RISCHIO_LOOP|BLOCCATO --operation-id OP-ID`;

const FORECAST_NEVER_RECORDED =
  `No progress forecast has ever been recorded for this project. That is not zero remaining work, not a default and not a measurement: nothing was recorded.`;

/** The forecast block shown by `resume`, `context-pack` and any other reader of the pack. */
function forecastMarkdown(state: State, historyEntries = 0): string[] {
  const entry = state.progress_forecast;
  const lines = ["## Progress forecast", ""];
  if (!entry) {
    lines.push(`- ${FORECAST_NEVER_RECORDED}`, `- Record one with: ${FORECAST_RECORD_COMMAND}`, "");
    return lines;
  }
  lines.push(
    `- Phase: ${entry.phase}`,
    `- Known work remaining: ${entry.known_work}`,
    `- Conditional work: ${entry.conditional_work}`,
    `- Questions: ${forecastRangeText(entry.questions)}`,
    `- Operations: ${forecastRangeText(entry.operations)}`,
    `- Cycles: ${forecastRangeText(entry.cycles)}`,
    `- Confidence: ${entry.confidence} — ${entry.confidence_reason}`,
    `- Cycle state, as recorded by the caller: ${entry.cycle_state}`,
    `- Recorded by ${entry.recorded_by} at ${entry.recorded_at}, state revision ${entry.state_revision}`,
    `- Why it changed: ${entry.change_reason ?? "first forecast recorded for this project"}`,
    `- Counted by the engine from the ledgers: open blockers ${entry.derived.open_blockers}${entry.derived.open_blockers === 0 ? " (nothing writes that ledger, so this is not a verified zero)" : ""}, open overrides ${entry.derived.open_overrides}, gates remaining ${entry.derived.gates_remaining}, unresolved modules ${entry.derived.unresolved_modules.length}, open findings ${entry.derived.open_findings ?? 0}, tasks ${TASK_STATUSES.map((status) => `${status} ${entry.derived.tasks_by_status?.[status] ?? 0}`).join(", ")}`
  );
  if ((entry.signals ?? []).length) {
    lines.push("- Derived loop signals:");
    for (const signal of entry.signals) lines.push(`  - ${signal.code} (implies ${signal.implies_cycle_state}): ${signal.observed}`);
  } else {
    lines.push("- Derived loop signals: none in the recorded data.");
  }
  if (!entry.derived.status_history_events && ((state.tasks ?? []).length || (state.risks ?? []).length)) {
    lines.push(
      `- Reopening signals are not observable in this project: no ledger event recorded the status of the record it changed, so the engine cannot see whether a task or risk returned to an earlier status. Absence of that signal here is not evidence of absence.`
    );
  }
  const disagreement = forecastDisagreement(entry);
  if (disagreement) lines.push("", ...disagreement.split("\n"));
  lines.push("");
  if (historyEntries > 0) {
    const history = (state.forecast_history ?? []).slice(-historyEntries).reverse();
    lines.push("## Progress forecast history", "");
    if (!history.length) lines.push("- No previous forecast; the current one is the first.");
    for (const item of history) {
      lines.push(
        `- ${item.recorded_at} (revision ${item.state_revision}, ${item.recorded_by}): ${item.phase} — ${item.cycle_state}, confidence ${item.confidence}, questions ${forecastRangeText(item.questions)}, operations ${forecastRangeText(item.operations)}, cycles ${forecastRangeText(item.cycles)} — ${item.change_reason ?? "first forecast recorded for this project"}`
      );
    }
    lines.push("");
  }
  return lines;
}

/** Structural validation of one stored entry. Runs on every mutation, via `stateErrors`. */
function forecastEntryErrors(entry: any, label: string): string[] {
  const errors: string[] = [];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [`${label} must be an object`];
  for (const key of ["phase", "known_work", "conditional_work", "confidence_reason", "recorded_by", "recorded_at"]) {
    if (!nonEmpty(entry[key])) errors.push(`${label}.${key} is required`);
  }
  for (const key of ["questions", "operations", "cycles"]) {
    const range = entry[key];
    if (!range || typeof range !== "object" || !Number.isInteger(range.min) || !Number.isInteger(range.max) || range.min < 0 || range.max < range.min) {
      errors.push(`${label}.${key} must be a range {min,max} of non-negative integers with min <= max`);
    }
  }
  if (!CONFIDENCE_LEVELS.includes(entry.confidence)) errors.push(`${label}.confidence must be one of ${CONFIDENCE_LEVELS.join(", ")}`);
  if (!CYCLE_STATES.includes(entry.cycle_state)) errors.push(`${label}.cycle_state must be one of ${CYCLE_STATES.join(", ")}`);
  if (entry.change_reason !== null && !nonEmpty(entry.change_reason)) errors.push(`${label}.change_reason must be a non-empty string or null`);
  if (!Number.isInteger(entry.state_revision) || entry.state_revision < 1) errors.push(`${label}.state_revision must be a positive integer`);
  if (!entry.derived || typeof entry.derived !== "object" || Array.isArray(entry.derived)) errors.push(`${label}.derived must be an object`);
  if (!Array.isArray(entry.signals)) errors.push(`${label}.signals must be an array`);
  // Stated as a rule and not only as an absent field: nothing in a forecast may be
  // a percentage.
  for (const key of Object.keys(entry)) {
    if (/percent|percentage|progress_pct|pct$/i.test(key)) errors.push(`${label}.${key} stores a percentage, which a forecast may never carry`);
  }
  return errors;
}

function stateErrors(root: string, state: State, pendingEvent?: any): string[] {
  const errors: string[] = [];
  if (state.schema_version !== SCHEMA_VERSION) errors.push(`unsupported schema_version=${state.schema_version}`);
  // A refusal that blocks every command has to say what unblocks it. See the
  // matching message in `docop.rs`: both implementations say the same thing.
  if (state.project?.root !== root)
    errors.push(
      `project root does not match requested root: the ledger records ${state.project?.root ?? "<nothing>"} and this is ${root}. A Beave project is not portable by copying — the recorded root is checked before every command. Re-root it with: beave project-export --project-root <original> --output-dir <package>, then beave project-import --package-dir <package> --project-root <destination>. This is the tool being unusable here, not the project state being broken: nothing in the folder is damaged.`
    );
  if (!PROJECT_MODES.has(state.project?.mode)) errors.push(`unsupported project mode=${state.project?.mode}`);
  if (!INTERACTION_MODES.has(state.interaction_mode)) errors.push(`unsupported interaction mode=${state.interaction_mode}`);
  if (!LIFECYCLE_STATES.has(state.lifecycle_state)) errors.push(`unsupported lifecycle state=${state.lifecycle_state}`);
  
  if (!Array.isArray(state.modules) || state.modules.map((item) => item.id).join(",") !== Array.from({ length: 17 }, (_, index) => index).join(",")) errors.push("modules must contain ordered IDs 0..16");
  else if (state.modules.some((item) => !MODULE_STATUSES.has(item.status))) errors.push("invalid module status");
  
  if (!state.decision_owners || Object.keys(state.decision_owners).sort().join(",") !== OWNER_KEYS.slice().sort().join(",")) errors.push("decision owners are incomplete or contain unknown keys");
  if (!Array.isArray(state.human_overrides)) errors.push("human_overrides must be an array");
  else {
    if (state.human_overrides.some((item) => !item.id || !new Set(["OPEN", "RECONCILED"]).has(item.status))) errors.push("invalid human override");
    if (Boolean(state.needs_reconciliation) !== state.human_overrides.some((item) => item.status === "OPEN")) errors.push("needs_reconciliation does not match open overrides");
  }

  // Validate v3 ledgers
  if (!Array.isArray(state.decisions)) errors.push("decisions must be an array");
  if (!Array.isArray(state.requirements)) errors.push("requirements must be an array");
  if (!Array.isArray(state.artifacts)) errors.push("artifacts must be an array");
  if (!Array.isArray(state.tasks)) errors.push("tasks must be an array");
  if (!Array.isArray(state.dependencies)) errors.push("dependencies must be an array");
  if (!Array.isArray(state.gates)) errors.push("gates must be an array");
  if (!Array.isArray(state.risks)) errors.push("risks must be an array");
  if (!Array.isArray(state.evidence)) errors.push("evidence must be an array");
  if (!Array.isArray(state.agents)) errors.push("agents must be an array");
  if (!Array.isArray(state.operations)) errors.push("operations must be an array");
  if (!Array.isArray(state.checkpoints)) errors.push("checkpoints must be an array");

  const ledgers = [state.decisions, state.requirements, state.artifacts, state.tasks, state.dependencies, state.gates, state.risks, state.evidence, state.agents, state.operations, state.checkpoints].filter(Array.isArray) as any[][];
  const duplicates = duplicateIds(ledgers.flat());
  if (duplicates.length) errors.push(`duplicate ledger IDs: ${duplicates.join(", ")}`);

  const validateRevision = (item: any, label: string) => {
    if (!Number.isInteger(item?.revision) || item.revision < 1) errors.push(`${label} ${item?.id ?? "<missing>"} has invalid revision`);
    if (!nonEmpty(item?.owner)) errors.push(`${label} ${item?.id ?? "<missing>"} has no owner`);
    if (!nonEmpty(item?.updated_at)) errors.push(`${label} ${item?.id ?? "<missing>"} has no updated_at`);
  };
  for (const item of state.decisions ?? []) {
    if (!validTypedId(item.id, "DEC") || !nonEmpty(item.title) || !LEDGER_RULES.decision.statuses!.has(item.status)) errors.push(`invalid decision ${item?.id ?? "<missing>"}`);
    validateRevision(item, "decision");
  }
  for (const item of state.requirements ?? []) {
    if (!validTypedId(item.id, "REQ") || !nonEmpty(item.title) || !LEDGER_RULES.requirement.statuses!.has(item.status)) errors.push(`invalid requirement ${item?.id ?? "<missing>"}`);
    validateRevision(item, "requirement");
  }
  for (const item of state.tasks ?? []) {
    if (!validTypedId(item.id, "TSK") || !nonEmpty(item.title) || !LEDGER_RULES.task.statuses!.has(item.status)) errors.push(`invalid task ${item?.id ?? "<missing>"}`);
    validateRevision(item, "task");
  }
  for (const item of state.dependencies ?? []) {
    if (!validTypedId(item.id, "DEP") || !nonEmpty(item.from) || !nonEmpty(item.to) || !LEDGER_RULES.dependency.statuses!.has(item.type)) errors.push(`invalid dependency ${item?.id ?? "<missing>"}`);
    validateRevision(item, "dependency");
  }
  for (const item of state.risks ?? []) {
    if (!validTypedId(item.id, "RSK") || !nonEmpty(item.title) || !new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).has(item.severity) || !LEDGER_RULES.risk.statuses!.has(item.status)) errors.push(`invalid risk ${item?.id ?? "<missing>"}`);
    validateRevision(item, "risk");
  }
  for (const item of state.evidence ?? []) {
    if (!validTypedId(item.id, "EVD") || !safeArtifactPath(item.path) || !/^[a-f0-9]{64}$/.test(item.sha256 ?? "")) errors.push(`invalid evidence ${item?.id ?? "<missing>"}`);
    validateRevision(item, "evidence");
    if (safeArtifactPath(item.path)) {
      const evidenceFile = existingFileInside(root, item.path);
      if (!evidenceFile) errors.push(`evidence ${item.id} file is missing or escapes the project root`);
      // This one check refuses every mutation, not just the one that caused it:
      // it runs inside `commitState`. An ALN-005 pilot hit it by legitimately
      // correcting an evidence file and found a project that answered
      // "hash does not match" to everything and named no way out. The route
      // exists — re-record the evidence at its current revision — so the
      // refusal now states it. Both implementations must produce this string
      // byte for byte; see `docop.rs`.
      else if (sha256(fs.readFileSync(evidenceFile)) !== item.sha256) errors.push(`evidence ${item.id} no longer matches ${item.path}: re-record it with \`beave evidence --id ${item.id} --file ${item.path} --owner <owner> --expected-revision ${Number.isInteger((item as any).revision) ? (item as any).revision : "?"}\`. Until then every mutation is refused, because this check runs inside the transaction.`);
    }
  }
  for (const item of state.agents ?? []) {
    if (!validTypedId(item.id, "AGT") || !nonEmpty(item.name) || !LEDGER_RULES.agent.statuses!.has(item.status)) errors.push(`invalid agent ${item?.id ?? "<missing>"}`);
    validateRevision(item, "agent");
  }
  for (const item of state.checkpoints ?? []) {
    if (!validTypedId(item.id, "CHK") || !nonEmpty(item.name) || !nonEmpty(item.created_at)) errors.push(`invalid checkpoint ${item?.id ?? "<missing>"}`);
    validateRevision(item, "checkpoint");
  }
  for (const item of state.artifacts ?? []) {
    if (!validTypedId(item.id, "ART") || !safeArtifactPath(item.base_path) || !safeArtifactPath(item.working_path) || !new Set(["DRAFT", "PUBLISHED", "DEPRECATED"]).has(item.status) || !Number.isInteger(item.revision) || item.revision < 1 || !/^[a-f0-9]{64}$/.test(item.content_hash ?? "")) errors.push(`invalid artifact ${item?.id ?? "<missing>"}`);
  }
  const duplicateBasePaths = duplicateIds((state.artifacts ?? []).map((item) => ({ id: item.base_path.toLowerCase() })));
  if (duplicateBasePaths.length) errors.push(`artifact base_path collisions: ${duplicateBasePaths.join(", ")}`);
  const duplicateWorkingPaths = duplicateIds((state.artifacts ?? []).filter((item) => item.working_path).map((item) => ({ id: item.working_path.toLowerCase() })));
  if (duplicateWorkingPaths.length) errors.push(`artifact working_path collisions: ${duplicateWorkingPaths.join(", ")}`);

  if (Array.isArray(state.dependencies)) {
    const nodes = new Set([...(state.decisions ?? []), ...(state.requirements ?? []), ...(state.artifacts ?? []), ...(state.tasks ?? []), ...(state.risks ?? []), ...(state.evidence ?? []), ...(state.agents ?? []), ...(state.checkpoints ?? [])].map((item: any) => item.id));
    const allowedProvenance = new Set([...(state.decisions ?? []), ...(state.evidence ?? [])].map((item: any) => item.id));
    for (const artifact of state.artifacts ?? []) {
      if (!Array.isArray(artifact.provenance) || artifact.provenance.some((source: unknown) => !nonEmpty(source) || !allowedProvenance.has(String(source)))) errors.push(`artifact ${artifact.id} has invalid or dangling provenance; sources must reference DEC/EVD records`);
    }
    for (const dep of state.dependencies) {
      if (!nodes.has(dep.from)) errors.push(`dependency ${dep.id} has missing from node ${dep.from}`);
      if (!nodes.has(dep.to)) errors.push(`dependency ${dep.id} has missing to node ${dep.to}`);
      if (dep.from === dep.to) errors.push(`dependency ${dep.id} cannot reference the same node twice`);
    }
    const cycleErrors = detectCycles(state.dependencies);
    errors.push(...cycleErrors);
  }

  // Both fields are optional: a project that never recorded a forecast is valid,
  // and the two ALN-005 pilots are exactly that project. Present means checked.
  if (state.progress_forecast !== undefined) errors.push(...forecastEntryErrors(state.progress_forecast, "progress_forecast"));
  if (state.forecast_history !== undefined) {
    if (!Array.isArray(state.forecast_history)) errors.push("forecast_history must be an array");
    else state.forecast_history.forEach((entry, index) => errors.push(...forecastEntryErrors(entry, `forecast_history[${index}]`)));
  }
  if (state.progress_forecast === undefined && (state.forecast_history ?? []).length) {
    errors.push("forecast_history holds entries while progress_forecast is unset; the current forecast cannot be missing from a project that recorded one");
  }

  // The interview ledger is optional: a project created before it existed is
  // valid and carries none. Present means checked, in full.
  if (state.interview_log !== undefined) errors.push(...interviewLogErrors(root, state));

  const events = path.join(stateRoot(root), "events.jsonl");
  let parsed: any[] = [];
  if (!fs.existsSync(events) && !pendingEvent) errors.push("events.jsonl is missing");
  else if (fs.existsSync(events)) {
    const ids = new Set<string>();
    let priorAt = "";
    let priorRevision = 0;
    for (const [index, line] of fs.readFileSync(events, "utf8").split(/\r?\n/).filter(Boolean).entries()) {
      try {
        const event = JSON.parse(line);
        if (!event.event_id || !event.type) errors.push(`invalid event at line ${index + 1}`);
        else {
          parsed.push(event);
          if (ids.has(event.event_id)) errors.push(`duplicate event_id at line ${index + 1}`);
          ids.add(event.event_id);
          if (priorAt && event.at && event.at < priorAt) errors.push(`event at line ${index + 1} is out of chronological order`);
          priorAt = event.at || priorAt;
          if (event.state_revision !== undefined) {
            if (!Number.isInteger(event.state_revision) || event.state_revision <= priorRevision) errors.push(`invalid state_revision at line ${index + 1}`);
            else priorRevision = event.state_revision;
          }
        }
      } catch {
        errors.push(`invalid JSON event at line ${index + 1}`);
      }
    }
  }
  
  if (pendingEvent) parsed.push(pendingEvent);
  
  if (!Number.isInteger(state.revision) || state.revision < 1) errors.push("revision must be a positive integer");
  if (!state.last_event_id) errors.push("last_event_id is required");
  if (!parsed.length) errors.push("events.jsonl must contain at least one event");
  else {
    const latest = parsed.at(-1);
    if (latest.event_id !== state.last_event_id) errors.push("last_event_id does not match the latest event");
    if (latest.state_revision !== state.revision) errors.push("state revision does not match the latest event");
  }
  return errors;
}

function contextMarkdown(state: State, forecastHistoryEntries = 0): string {
  const active = activeModule(state);
  const lines = [
    "# Beave Context Pack", "",
    `- Project: ${state.project.name}`,
    `- Mode: ${state.project.mode}`,
    `- Lifecycle: ${state.lifecycle_state}`,
    `- Gate: ${state.current_gate}`,
    `- Interaction: ${state.interaction_mode}`,
    `- Exact next action: ${state.exact_next_action}`, "",
    // Deliberately next to status and the next action, and above everything else:
    // resume is what a fresh agent reads instead of the chat, so a forecast it
    // cannot see does not exist.
    ...forecastMarkdown(state, forecastHistoryEntries),
    "## Decision owners", "",
    ...OWNER_KEYS.map((key) => `- ${key}: ${state.decision_owners[key]}`), "",
    "## Gates", "",
    ...((state.gates ?? []).length ? (state.gates ?? []).map((item) => `- ${item.name || item.id}: ${item.status}`) : ["- None passed yet."]), "",
    "## Active module", "",
    active ? `- ${active.id} — ${active.title} [${active.status}]` : "- None; questionnaire coverage is complete.", "",
    "## Coverage evidence", "",
    ...state.modules.filter((item) => item.status !== "NOT STARTED").flatMap((item) => [`- M${item.id}: ${item.status} — ${item.evidence || "not recorded"}`, ...(item.summary ? [`  Summary: ${item.summary}`] : [])]), "",
    "## Blockers", "",
    // An empty list is not evidence that there are none: no command writes this
    // ledger, so `status` and this pack have always printed "none" on projects
    // carrying real, documented blockers.
    ...(state.blockers?.length
      ? state.blockers.map((item) => `- ${item}`)
      : ["- None recorded in state. No command writes this ledger today, so an empty list is not evidence that the project has no blockers: look for them in the governed documents."]), "",
    "## Risks", "",
    ...(state.risks?.length ? state.risks.map((item) => `- ${item.title}`) : ["- None recorded."]), "",
    "## Authoritative evidence", "",
    ...(state.evidence?.length ? state.evidence.map((item) => `- ${item.path}`) : ["- None recorded in state; inspect canonical project sources."]), "",
    "## Human overrides", "",
    ...((state.human_overrides ?? []).filter((item) => item.status === "OPEN").map((item) => `- ${item.id}: OPEN — ${item.summary || item.source}`).length ? (state.human_overrides ?? []).filter((item) => item.status === "OPEN").map((item) => `- ${item.id}: OPEN — ${item.summary || item.source}`) : ["- None open."]), "",
    "Read canonical project sources before acting; this pack is operational state, not product truth.", ""
  ];
  return lines.join("\n");
}

function capabilities(): void {
  console.log(JSON.stringify({
    beave_version: VERSION,
    schema_version: SCHEMA_VERSION,
    node: process.versions.node,
    node_supported: Number(process.versions.node.split(".")[0]) >= 20,
    external_dependencies: [],
    network_required: false,
    profiles: ["Hybrid", "Semantic-only"],
    project_modes: [...PROJECT_MODES].sort(),
    interaction_modes: ["Guided", "Standard", "Expert"]
  }, null, 2));
}

function init(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  recoverFileTransactions(root);
  const destination = stateRoot(root);
  const key = idempotencyKey(flags);
  if (fs.existsSync(path.join(destination, "events.jsonl")) && checkIdempotency(root, key)) return console.log(`Idempotent retry: init already applied.`);
  if (fs.existsSync(path.join(destination, "state.json")) || fs.existsSync(path.join(destination, "events.jsonl"))) throw new BeaveError(`State already exists at ${destination}; use resume`);
  const projectMode = required(flags, "project-mode");
  const interactionMode = required(flags, "interaction-mode");
  if (!PROJECT_MODES.has(projectMode)) throw new BeaveError(`Unsupported project mode: ${projectMode}`);
  if (!INTERACTION_MODES.has(interactionMode)) throw new BeaveError(`Unsupported interaction mode: ${interactionMode}`);
  const owners = readJson(path.resolve(required(flags, "owners-file")));
  // Schema v3 closes `decision_owners` to exactly five roles, so a sixth cannot be
  // stored. It used to be dropped in silence: pilot B supplied `compliance` and
  // `quality` for a CE-marked product and `init` reported success without them.
  const unknownOwners = Object.keys(owners ?? {}).filter((key) => !OWNER_KEYS.includes(key));
  if (unknownOwners.length) {
    throw new BeaveError(
      `Owners file declares roles Beave cannot store: ${unknownOwners.join(", ")}. ` +
        `Recognised roles are ${OWNER_KEYS.join(", ")}. Record the other authorities in a governed document and reference them there; nothing was written.`
    );
  }
  for (const key of OWNER_KEYS) if (!String(owners[key] ?? "").trim()) throw new BeaveError(`Owners file requires ${OWNER_KEYS.join(", ")}`);
  const timestamp = now();
  const eventId = crypto.randomUUID();
  const state: State = {
    schema_version: SCHEMA_VERSION,
    beave_version: VERSION,
    project: { name: required(flags, "project-name"), root, mode: projectMode },
    interaction_mode: interactionMode,
    intake_strategy: "Adaptive",
    decision_owners: Object.fromEntries(OWNER_KEYS.map((key) => [key, String(owners[key]).trim()])),
    lifecycle_state: "INTERVIEW",
    current_gate: "G1",
    modules: questionnaire().map((item: any) => ({ id: item.id, title: item.title, status: item.id === 0 ? "CONFIRMED" : "NOT STARTED", owner: item.id === 0 ? "human authorities" : null, evidence: item.id === 0 ? "Gate G0 init arguments" : null, updated_at: item.id === 0 ? timestamp : null })),
    
    decisions: [],
    requirements: [],
    artifacts: [],
    tasks: [],
    dependencies: [],
    gates: [],
    risks: [],
    evidence: [],
    agents: [],
    operations: [],
    checkpoints: [],

    blockers: [], 
    interview_log: [],
    // A new project records its interview from the first question. The marker
    // matters for the other case: a project that existed before this ledger did,
    // where `migrate` sets it to the migration instant so nothing before that
    // date can be read as "no questions were asked".
    interview_log_since: timestamp,
    interview_view: null,
    human_overrides: [], 
    needs_reconciliation: false, 
    revision: 1, 
    last_event_id: eventId,
    exact_next_action: "Run `beave next --project-root .` and discuss module 1.",
    created_at: timestamp, 
    updated_at: timestamp
  };
  /*
   * The history document exists from the first minute, saying that nothing has
   * been asked yet.
   *
   * It was created lazily, on the first `qa-ask`, and a new project therefore had
   * an empty ledger and no document — so "the history is at
   * QUESTION_ANSWER_HISTORY.md" was a promise that came true later. A reader
   * opening the folder finds a file that tells them what it is, or they find
   * nothing and conclude there is nothing to find.
   */
  const initialView = stampInterviewView(state);
  /*
   * `replay_origin` is what makes a new project reproducible from nothing.
   *
   * This event's patch sets the whole state, so replaying from here needs no
   * earlier history and no separate snapshot file: initialization *is* the
   * baseline. An imported or migrated project gets one the other way round, from
   * `beave baseline`, and says so.
   */
  const event = { event_id: eventId, type: "PROJECT_INITIALIZED", state_revision: 1, at: timestamp, project: state.project.name, project_mode: projectMode, interaction_mode: interactionMode, idempotency_key: key, replay_origin: true, operation_id: pendingOperation!.id, operation_payload_hash: pendingOperation!.payloadHash, operation_payload_version: pendingOperation!.payloadVersion };
  const errors = stateErrors(root, state, event);
  if (errors.length) throw new BeaveError(`Initialization failed validation:\n- ${errors.join("\n- ")}`);
  fs.mkdirSync(destination, { recursive: true });
  const transaction = beginFileTransaction(root, event, [path.join(root, QA_VIEW_RELATIVE)]);
  try {
    /*
     * `views: true`, like every other command that writes a derived document.
     *
     * Without it the journal recorded `regenerate_views: false`, so a recovery
     * rolled the state forward and skipped the document — and `init` writes the
     * document *after* `commitState`. A project interrupted past the point of no
     * return came back with a state recording the digest of a file that was not
     * there: `init`, `status`, `recover` and `replay` all reported success and
     * only `validate` refused. Found by the second independent review; `migrate`
     * and the `qa-*` commands were passing it and this one was not.
     */
    commitState(root, path.join(destination, "state.json"), state, event, { views: true });
    writeInterviewView(root, initialView);
    faultPoint("after-view");
    completeFileTransaction(transaction);
  } catch (error) {
    if (fs.existsSync(transaction)) rollbackFileTransaction(root, transaction);
    throw error;
  }
  console.log(`Initialized Beave state at ${destination}`);
}

/**
 * Recorded digests that no longer describe the file they point at.
 *
 * `stateErrors()` re-hashes `state.evidence[]` records and `documentIntegrityErrors()`
 * re-hashes artifacts, but `modules[].evidence_sha256` was compared in exactly one
 * place — the gate-2 prerequisite check — and `human_overrides[].source_sha256` in
 * none at all. Gate 2 is unreachable until gate 1 passes, so a project could report
 * "Beave state is valid." for the whole interview while a confirmed module pointed
 * at content that no longer existed (ALN-005, reproduced 2026-09-10).
 *
 * Deliberately NOT part of `stateErrors()`. That runs inside `commitState()` on
 * every mutation, and this drift is *expected* whenever a governed evidence
 * document advances to a new `-vN`: putting it there would refuse every later
 * operation on a project whose answer document was legitimately re-recorded. It
 * belongs to `validate`, which is the command whose whole job is to say whether
 * what is recorded still matches what is on disk.
 */
function recordedDigestErrors(root: string, state: State): string[] {
  const errors: string[] = [];
  const check = (label: string, relative: unknown, digest: unknown, remedy: string) => {
    if (typeof relative !== "string" || !relative.trim()) return;
    if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) return;
    const file = existingFileInside(root, relative);
    if (!file) {
      errors.push(`${label} records evidence at ${relative}, which is missing or escapes the project root. Restore the file, or point the record at the file that stands in its place: ${remedy}`);
      return;
    }
    if (sha256(fs.readFileSync(file)) !== digest) {
      errors.push(
        `${label} recorded ${relative} with a digest that no longer matches the file. Re-record it against the current file, or restore the recorded content. To re-record: ${remedy}`
      );
    }
  };

  for (const item of state.modules ?? []) {
    check(
      `module ${item.id}`,
      item.evidence,
      (item as any).evidence_sha256,
      `beave record --project-root . --module ${item.id} --status ${item.status?.replaceAll(" ", "_") ?? "<status>"} --owner <owner> --answer-file ${item.evidence} --operation-id <id>`
    );
  }
  for (const item of state.human_overrides ?? []) {
    check(
      `override ${item.id}`,
      (item as any).source,
      (item as any).source_sha256,
      `beave re-record --project-root . --kind override --id ${item.id} --source-file ${(item as any).source} --owner <owner> --reason "<why the source changed>" --operation-id <id>`
    );
  }
  // B5. A gate is the record that says a phase may end, and its evidence is the
  // only reason to believe it — and it was the one recorded digest nothing ever
  // re-verified outside the gate-2 prerequisite check, which is unreachable until
  // gate 1 has already passed.
  //
  // **The compatibility rule, stated rather than implied.** Only the *live record*
  // in `state.json` is checked, and only when it carries both a path and a 64-hex
  // digest. Two things follow, both deliberate:
  //
  //  - A gate written while the record was still `{id, name, status}` claims
  //    nothing, so nothing is refused. Same shape as L26's "only markers that
  //    recorded an archive are checked for one".
  //  - The `GATE_UPDATED` *events* do carry `evidence_sha256`, so a digest for
  //    those old gates is technically recoverable — and reconstructing one from
  //    history is exactly the L26 mistake repeated. Measured on the two ALN-005
  //    pilots on 2026-09-10: four of the five recorded `GATE_UPDATED` events point
  //    at a digest the file no longer has, and two of those four are *superseded*
  //    outcomes (pilot A's G0, and its first G1 WARN). An event records what was
  //    true when it was written; re-checking it turns every legitimate later
  //    revision of an evidence document into a validation failure.
  //
  // The route out of "claims nothing" is a governed operation, not a silent
  // backfill: `beave re-record --kind gate`. `validate` names the gates that carry
  // no digest without failing on them, so the silence is audible.
  for (const item of state.gates ?? []) {
    check(
      `gate ${item.name || item.id}`,
      (item as any).evidence,
      (item as any).evidence_sha256,
      `beave re-record --project-root . --kind gate --id ${item.name || item.id} --source-file ${(item as any).evidence} --owner <owner> --reason "<why the evidence changed>" --operation-id <id>`
    );
  }

  // A deletion marker whose reason cannot be read is a marker nobody can act on
  // (L26). Reported here rather than in `stateErrors`, on purpose: a lost reason
  // is a documentation loss, and refusing every mutation over it would make the
  // project unusable for a defect that damages nothing.
  const eventsFile = path.join(stateRoot(root), "events.jsonl");
  if (fs.existsSync(eventsFile)) {
    for (const line of fs.readFileSync(eventsFile, "utf8").split(/\r?\n/).filter(Boolean)) {
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event?.type !== "DOCUMENT_DELETION_INTENT_RECORDED") continue;
      // Only markers that recorded an archive are checked for one. A marker
      // written before this rule existed has no archive and never claimed to:
      // reporting those would flood `validate` on every project that predates
      // L26 and say nothing true — the reason was already lost when the rule was
      // introduced, which is why the rule exists.
      if (typeof event.reason_archive_path !== "string" || !event.reason_archive_path) continue;
      const digest = typeof event.reason_sha256 === "string" ? event.reason_sha256 : "";
      if (!/^[a-f0-9]{64}$/.test(digest)) continue;
      const archive = deletionReasonArchive(root, digest);
      const label = `deletion intent ${event.deletion_intent_id ?? "<missing>"}`;
      if (!fs.existsSync(archive.absolute)) {
        errors.push(`${label} records a reason at .beave/${archive.relative}, which is not there. The reason it was removed cannot be read any more.`);
        continue;
      }
      if (sha256(fs.readFileSync(archive.absolute)) !== digest) {
        errors.push(`${label} has an archived reason at .beave/${archive.relative} that no longer matches its recorded digest.`);
      }
    }
  }
  return errors;
}

/**
 * Gate records `validate` has nothing to re-verify, and the sentence that says so.
 *
 * A skip that says nothing is what let B5 live: a project could report
 * "Beave state is valid." while every gate in it rested on a file the engine had
 * never looked at again. The skip is still the right behaviour for a record that
 * predates the rule — see `recordedDigestErrors` — so it is reported instead of
 * enforced. `null` when there is nothing to say.
 */
function unverifiableGateNote(state: State): string | null {
  const gates = state.gates ?? [];
  const unverifiable = gates.filter(
    (item) =>
      !nonEmpty((item as any).evidence) || !/^[a-f0-9]{64}$/.test(String((item as any).evidence_sha256 ?? ""))
  );
  if (!unverifiable.length) return null;
  const names = unverifiable.map((item) => item.name || item.id).join(", ");
  return (
    `${unverifiable.length} of ${gates.length} gate record${gates.length === 1 ? "" : "s"} carr${unverifiable.length === 1 ? "ies" : "y"} no evidence digest, so validate re-verified nothing for them: ${names}. ` +
    `They were recorded before the gate record kept its evidence; failing them would report a drift nobody can prove. ` +
    `Attach the file the gate was passed on with: beave re-record --project-root . --kind gate --id ${unverifiable[0].name || unverifiable[0].id} --source-file <file> --owner <owner> --reason "<why>" --operation-id <id>`
  );
}

/**
 * Re-point a recorded source at the file that supersedes it — `OD-012`, option 1.
 *
 * The refusal in `recordedDigestErrors` has always named a remedy — "re-record it
 * against the current file" — that no command performed. `override` only ever
 * creates a *new* override, and the other route the message offered, restoring
 * the recorded bytes, discards a revision somebody wanted. This repository's own
 * project sat refused on exactly that: `OVR-48a5f5aa37aa` recorded the D4 decision
 * document on 2026-09-09, the document was legitimately revised on 2026-09-10.
 *
 * **Why this option and not the other two OD-012 listed.** Snapshotting an
 * override's source into the governed area at record time, as L26 does for
 * deletion reasons, is right for a one-shot rationale and wrong here: an override
 * points at a *living* governed document, and comparing a private copy with
 * itself would make the check pass by construction and stop meaning anything.
 * Declaring the source informational and dropping the check throws away the only
 * mechanism that noticed a real drift on a real project.
 *
 * What it does and does not do:
 *
 *  - it never edits a stored digest; the new one is computed from the file's bytes;
 *  - the previous path and digest, the authority, the reason and the event are all
 *    kept — on the record in `source_history`, and in `RECORDED_SOURCE_UPDATED`;
 *  - it changes provenance only. It cannot change a gate's status, pass anything,
 *    reopen anything, or move the lifecycle.
 *
 * It is deliberately NOT behind `assertNotBlocked`. Reconciliation blocks work
 * that moves the project forward; this is a repair, and an OPEN override whose own
 * source drifted could otherwise never be corrected — the block would be the thing
 * preventing its own removal.
 */
function reRecord(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: re-record already applied.`);
  const { location, state } = loadState(root);
  const kind = required(flags, "kind").trim().toLowerCase();
  if (kind !== "override" && kind !== "gate") {
    throw new BeaveError(
      `Unsupported --kind: ${required(flags, "kind")}. Beave can re-record the source of an override or the evidence of a gate. Nothing was written.`
    );
  }
  const owner = required(flags, "owner").trim();
  assertKnownOwner(state, owner);
  const reason = required(flags, "reason").trim();
  if (!reason) {
    throw new BeaveError(
      `--reason cannot be empty. Re-recording replaces the file a governed record stands on, and the reason is the only account of why it was allowed. Nothing was written.`
    );
  }
  const id = required(flags, "id").trim();

  let label: string;
  let target: any;
  let previousPath: string | null;
  let previousDigest: string | null;
  let relative: string;
  let digest: string;

  if (kind === "override") {
    target = (state.human_overrides ?? []).find((item) => item.id === id);
    if (!target) throw new BeaveError(`Override not found: ${id}. Nothing was written.`);
    label = `override ${target.id}`;
    previousPath = nonEmpty(target.source) ? String(target.source) : null;
    previousDigest = /^[a-f0-9]{64}$/.test(String(target.source_sha256 ?? "")) ? String(target.source_sha256) : null;
    // An override's source may live under `.beave/`: several on this repository do,
    // and `recordedDigestErrors` re-reads them there. So containment inside the
    // project root is required and the artifact rule is not.
    const sourcePath = path.resolve(required(flags, "source-file"));
    const candidate = path.relative(root, sourcePath);
    const confined = existingFileInside(root, candidate);
    if (!confined) throw new BeaveError(`The new source must be an existing file inside the project root: ${sourcePath}`);
    const bytes = fs.readFileSync(confined);
    if (!bytes.length || !bytes.toString("utf8").trim()) throw new BeaveError(`The new source cannot be empty: ${candidate}`);
    relative = candidate.replaceAll("\\", "/");
    digest = sha256(bytes);
  } else {
    target = (state.gates ?? []).find((item) => item.name === id || item.id === id);
    if (!target) throw new BeaveError(`Gate not found: ${id}. Nothing was written.`);
    label = `gate ${target.name || target.id}`;
    previousPath = nonEmpty((target as any).evidence) ? String((target as any).evidence) : null;
    previousDigest = /^[a-f0-9]{64}$/.test(String((target as any).evidence_sha256 ?? "")) ? String((target as any).evidence_sha256) : null;
    // Gate evidence obeys the rule `beave gate` enforces, unchanged: an existing,
    // non-empty file inside the project and outside the reserved `.beave`.
    const evidence = verifiedEvidence(root, path.resolve(required(flags, "source-file")));
    relative = evidence.relative;
    digest = evidence.hash;
  }

  if (previousPath !== null && previousDigest !== null && previousPath.replaceAll("\\", "/") === relative && previousDigest === digest) {
    throw new BeaveError(
      `${label} already records ${relative} at that digest. There is nothing to re-record; no changes written.`
    );
  }

  const timestamp = now();
  const eventId = crypto.randomUUID();
  const supersession: RecordedSourceSupersession = {
    path: previousPath,
    sha256: previousDigest,
    superseded_at: timestamp,
    superseded_by: owner,
    reason,
    event_id: eventId,
  };
  const history: RecordedSourceSupersession[] = [...((target.source_history as RecordedSourceSupersession[]) ?? []), supersession];
  if (kind === "override") Object.assign(target, { source: relative, source_sha256: digest, source_history: history });
  else Object.assign(target, { evidence: relative, evidence_sha256: digest, source_history: history });

  state.updated_at = timestamp;
  const revision = state.revision + 1;
  state.revision = revision;
  state.last_event_id = eventId;
  const event = {
    event_id: eventId,
    type: "RECORDED_SOURCE_UPDATED",
    state_revision: revision,
    at: timestamp,
    idempotency_key: key,
    kind,
    target_id: kind === "override" ? target.id : target.name || target.id,
    previous_source: previousPath,
    previous_source_sha256: previousDigest,
    source: relative,
    source_sha256: digest,
    reason,
    owner,
  };
  const transaction = beginFileTransaction(root, event, []);
  try {
    commitState(root, location, state, event);
    completeFileTransaction(transaction);
  } catch (error) {
    if (fs.existsSync(transaction)) rollbackFileTransaction(root, transaction);
    throw error;
  }
  console.log(
    `Re-recorded the source of ${label}.\n` +
      `  was: ${previousPath ?? "<nothing recorded>"}${previousDigest ? ` @${previousDigest}` : ""}\n` +
      `  now: ${relative} @${digest}\n` +
      `The previous path and digest are kept on the record in source_history and in event ${eventId}. No stored digest was edited: the new one was computed from the file.`
  );
}

// Everything `forecast` writes with. `--project-root` and `--operation-id` are not
// in the list: the first says where, the second says who, and neither is a
// statement about the project. So `beave forecast --project-root .` reads.
const FORECAST_WRITE_OPTIONS = [
  "owner", "phase", "known-work", "conditional-work", "questions", "operations", "cycles",
  "confidence", "confidence-reason", "cycle-state", "change-reason", "expected-revision",
];

/**
 * D5 / FR-024 — record or read the progress forecast.
 *
 * Not behind `assertNotBlocked`, and the reason is in the vocabulary: `BLOCCATO` is
 * one of the four cycle states. A command that refused while the project was
 * blocked could never record the state that says the project is blocked, which is
 * the moment the forecast matters most. Same reasoning as `re-record`: this
 * observes and describes, it does not move the project forward. It cannot pass a
 * gate, change a status, close a module or touch the exact next action.
 */
function forecast(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const writing = FORECAST_WRITE_OPTIONS.some((option) => flags[option] !== undefined);

  if (!writing) {
    const state = validateRoot(root);
    const entry = state.progress_forecast;
    if (!entry) {
      console.log(`${FORECAST_NEVER_RECORDED}\nRecord one with: ${FORECAST_RECORD_COMMAND}`);
      return;
    }
    console.log(forecastMarkdown(state, 3).join("\n").trimEnd());
    return;
  }

  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: forecast already applied.`);
  const { location, state } = loadState(root);
  const owner = required(flags, "owner").trim();
  assertKnownOwner(state, owner);

  const previous = state.progress_forecast ?? null;
  const history = state.forecast_history ?? [];

  if (flags["expected-revision"] !== undefined) {
    const expected = Number(required(flags, "expected-revision"));
    if (!previous) {
      throw new BeaveError(
        `--expected-revision was given, but this project has never recorded a progress forecast, so there is no revision to match. Nothing was written.`
      );
    }
    if (!Number.isInteger(expected) || expected !== previous.state_revision) {
      throw new BeaveError(`Stale progress forecast: expected revision ${previous.state_revision}. No changes written.`);
    }
  }

  // The cause of a change is the whole point of keeping a history. A forecast that
  // moved and cannot say why is the failure D5 was recorded against.
  const changeReason = typeof flags["change-reason"] === "string" ? flags["change-reason"].trim() : "";
  if (previous && !changeReason) {
    throw new BeaveError(
      `--change-reason is required: this project already recorded a progress forecast on ${previous.recorded_at} at revision ${previous.state_revision}, and a forecast that changes without its cause cannot explain itself later. Supply --change-reason "<what changed and why>". Nothing was written.`
    );
  }
  if (!previous && changeReason) {
    throw new BeaveError(
      `--change-reason was given, but this is the first forecast for this project, so there is nothing it changed from. Put the reasoning in --confidence-reason. Nothing was written.`
    );
  }

  const confidence = required(flags, "confidence").trim().toUpperCase();
  if (!CONFIDENCE_LEVELS.includes(confidence)) {
    throw new BeaveError(`Unsupported --confidence: ${confidence}. Use one of ${CONFIDENCE_LEVELS.join(", ")}. Nothing was written.`);
  }
  const cycleState = required(flags, "cycle-state").trim().toUpperCase().replaceAll(" ", "_");
  if (!CYCLE_STATES.includes(cycleState)) {
    throw new BeaveError(`Unsupported --cycle-state: ${cycleState}. Use one of ${CYCLE_STATES.join(", ")}. Nothing was written.`);
  }
  const phase = required(flags, "phase").trim();
  const knownWork = required(flags, "known-work").trim();
  const conditionalWork = required(flags, "conditional-work").trim();
  const confidenceReason = required(flags, "confidence-reason").trim();
  for (const [option, value] of [["phase", phase], ["known-work", knownWork], ["conditional-work", conditionalWork], ["confidence-reason", confidenceReason]] as const) {
    if (!value) throw new BeaveError(`--${option} cannot be empty. Nothing was written.`);
  }
  const questions = parseForecastRange(flags, "questions");
  const operations = parseForecastRange(flags, "operations");
  const cycles = parseForecastRange(flags, "cycles");

  const events = readEvents(root);
  const derived = forecastDerived(state, events);
  const timestamp = now();
  const eventId = crypto.randomUUID();
  const revision = state.revision + 1;

  const entry: ProgressForecast = {
    phase,
    known_work: knownWork,
    conditional_work: conditionalWork,
    questions,
    operations,
    cycles,
    confidence,
    confidence_reason: confidenceReason,
    cycle_state: cycleState,
    change_reason: previous ? changeReason : null,
    recorded_by: owner,
    recorded_at: timestamp,
    state_revision: revision,
    derived,
    signals: [],
  };
  // Distinct governed operations recorded since the previous forecast, which is
  // what the fourth D5 condition counts. Events with no operation id predate the
  // rule that requires one and are not counted as operations here.
  const operationsSincePrevious = previous
    ? new Set(
        events
          .filter((event) => Number.isInteger(event?.state_revision) && event.state_revision > previous.state_revision)
          .map((event) => event?.operation_id)
          .filter((id) => typeof id === "string")
      ).size
    : 0;
  entry.signals = forecastSignals(entry, previous, history, reopenedRecords(events), operationsSincePrevious);

  if (previous) state.forecast_history = [...history, previous];
  else if (state.forecast_history === undefined) state.forecast_history = [];
  state.progress_forecast = entry;
  state.updated_at = timestamp;
  state.revision = revision;
  state.last_event_id = eventId;

  const event = {
    event_id: eventId,
    type: "PROGRESS_FORECAST_RECORDED",
    state_revision: revision,
    at: timestamp,
    idempotency_key: key,
    owner,
    phase,
    known_work: knownWork,
    conditional_work: conditionalWork,
    questions,
    operations,
    cycles,
    confidence,
    confidence_reason: confidenceReason,
    cycle_state: cycleState,
    change_reason: entry.change_reason,
    derived,
    signals: entry.signals,
    previous_state_revision: previous ? previous.state_revision : null,
  };
  const transaction = beginFileTransaction(root, event, []);
  try {
    commitState(root, location, state, event);
    completeFileTransaction(transaction);
  } catch (error) {
    if (fs.existsSync(transaction)) rollbackFileTransaction(root, transaction);
    throw error;
  }

  console.log(
    [
      `Recorded progress forecast at state revision ${revision}.`,
      `  Phase: ${phase}`,
      `  Known work remaining: ${knownWork}`,
      `  Conditional work: ${conditionalWork}`,
      `  Questions: ${forecastRangeText(questions)} | Operations: ${forecastRangeText(operations)} | Cycles: ${forecastRangeText(cycles)}`,
      `  Confidence: ${confidence} — ${confidenceReason}`,
      `  Cycle state, as recorded by you: ${cycleState}`,
      `  Why it changed: ${entry.change_reason ?? "first forecast recorded for this project"}`,
      `  Counted by the engine from the ledgers: open blockers ${derived.open_blockers}${derived.open_blockers === 0 ? " (nothing writes that ledger, so this is not a verified zero)" : ""}, open overrides ${derived.open_overrides}, gates remaining ${derived.gates_remaining}, unresolved modules ${derived.unresolved_modules.length}, open findings ${derived.open_findings}`,
      entry.signals.length
        ? `  Derived loop signals: ${entry.signals.map((signal) => signal.code).join(", ")}`
        : `  Derived loop signals: none in the recorded data.`,
    ].join("\n")
  );
  for (const signal of entry.signals) console.log(`\n${signal.code}: ${signal.observed}`);
  const disagreement = forecastDisagreement(entry);
  if (disagreement) console.log(`\n${disagreement}`);
  if (!derived.status_history_events && ((state.tasks ?? []).length || (state.risks ?? []).length)) {
    console.log(
      `\nReopening signals are not observable in this project: no ledger event recorded the status of the record it changed, so the engine cannot see whether a task or risk returned to an earlier status. Events written from now on do record it. Absence of that signal here is not evidence of absence.`
    );
  }
}

/**
 * The history, checked as history rather than as a file that happens to parse.
 *
 * Two different failures and one note, kept apart on purpose:
 *
 *  - a broken chain or a diverged state is a refusal: the project is not what it
 *    says it is, and continuing would build on it;
 *  - a history with no replay origin is a *note*. Every project written before
 *    this format is in that position, and it is not damaged. It is told what it
 *    cannot prove and which command gives it a starting point.
 */
function historyErrors(root: string, state: State): { errors: string[]; notes: string[] } {
  const outcome = replayFromEvents(root);
  if (outcome.replayable) {
    if (digestOf(outcome.state) !== digestOf(state)) {
      return { errors: [`the state does not match its own history. ${describeDifferences(state, outcome.state, 8).join("; ").trim()}. Rebuild it with: beave replay --project-root . --repair --operation-id <id>`], notes: [] };
    }
    const notes = outcome.unprovenBefore > 0
      ? [outcome.unprovenBefore === 1
          ? `1 event before the replay baseline is kept and is not covered by the replay proof.`
          : `${outcome.unprovenBefore} events before the replay baseline are kept and are not covered by the replay proof.`]
      : [];
    return { errors: [], notes };
  }
  // A chain that is broken, a duplicated event or a line that is not JSON are
  // damage. A history that simply predates the format is not.
  const missingOrigin = outcome.reason?.startsWith("This project's history has no point") === true;
  const emptyHistory = outcome.reason?.startsWith("This project has no event history") === true;
  if (missingOrigin || emptyHistory) return { errors: [], notes: [outcome.reason!] };
  return { errors: [outcome.reason!], notes: [] };
}

function validateRoot(root: string, includeDocuments = false): State {
  const { state } = loadState(root);
  const errors = stateErrors(root, state);
  if (includeDocuments && !errors.length) errors.push(...documentIntegrityErrors(root, state));
  if (includeDocuments && !errors.length) errors.push(...interviewViewErrors(root, state));
  if (errors.length) throw new BeaveError(`Validation failed:\n- ${errors.join("\n- ")}`);
  return state;
}

/**
 * What is actually known about this project's blockers.
 *
 * `status --json` reported `"blockers": []`, which in every language a consumer
 * is written in means *there are none*. The truth was narrower and less
 * comforting: no command writes that ledger, so the array was empty in exactly
 * the same way for a project with no blockers and for a project with ten that
 * nobody had a way to record. `resume` said so in words and the machine-readable
 * output did not, which is the wrong way round — a person reading a paragraph
 * can notice a caveat, a program reading an array cannot.
 *
 * So the absence of knowledge has its own shape. `blockers` is `null` when
 * nothing authoritative is known, and the two companion fields say why:
 *
 *   RECORDED    entries exist in the ledger; `blockers` is that array
 *   NONE_VERIFIED  something checked and found none (no command does this today)
 *   UNKNOWN     nothing writes this ledger, so its emptiness proves nothing
 *   UNTRUSTED   the state does not agree with its history
 *
 * `UNTRUSTED` is unreachable from this command, which refuses such a project
 * outright; it is in the vocabulary because a consumer that handles four values
 * does not break the day a fifth caller can return it. `NONE_VERIFIED` is
 * unreachable today and is named so that "verified none" and "nobody looked"
 * cannot collapse into each other later. `ALN-015` holds the writable ledger.
 */
function blockerAssurance(state: State): { blockers: string[] | null; blockers_recorded: boolean; blockers_assurance: string; blockers_note: string } {
  const recorded = Array.isArray(state.blockers) ? state.blockers : [];
  if (recorded.length) {
    return {
      blockers: recorded,
      blockers_recorded: true,
      blockers_assurance: "RECORDED",
      blockers_note: "These are the blockers recorded in the ledger. Nothing guarantees they are all of them.",
    };
  }
  return {
    blockers: null,
    blockers_recorded: false,
    blockers_assurance: "UNKNOWN",
    blockers_note:
      "No blocker is recorded, and no Beave command writes this ledger, so this is not evidence that the project has none. Look in the governed documents. `blockers` is null rather than [] because an empty list would read as a verified absence.",
  };
}

function status(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const state = validateRoot(root);
  /*
   * A project whose state does not match its history has no status worth
   * printing.
   *
   * `validate`, `resume` and `replay --verify` all exit 2 on such a project;
   * `status` printed the state's own account of itself as fact and exited 0. A
   * third independent review noticed it beside the areas it had been asked
   * about. It is the same defect as the two before it, in the one remaining
   * command that answers the question "how is this project?".
   */
  const history = historyErrors(root, state);
  if (history.errors.length) {
    throw new BeaveError(
      `This project's state does not agree with its history, so its status cannot be reported as fact:\n- ${history.errors.join("\n- ")}\n` +
        `Rebuild it from the history with \`beave replay --project-root . --repair --operation-id <id>\`, or restore the state. Nothing was changed.`,
    );
  }
  const active = activeModule(state);
  console.log(JSON.stringify({ project: state.project.name, project_mode: state.project.mode, interaction_mode: state.interaction_mode, lifecycle_state: state.lifecycle_state, current_gate: state.current_gate, coverage: `${state.modules.filter((item) => new Set(["CONFIRMED", "DEFERRED", "NOT APPLICABLE"]).has(item.status)).length}/${state.modules.length}`, active_module: active && { id: active.id, title: active.title, status: active.status }, needs_reconciliation: state.needs_reconciliation, open_overrides: state.human_overrides.filter((item) => item.status === "OPEN").length, ...blockerAssurance(state), progress_forecast: statusForecast(state), exact_next_action: state.exact_next_action, updated_at: state.updated_at }, null, 2));
}

/**
 * The compact forecast `status` carries.
 *
 * Always an object, and always carrying `recorded`. `null` would have been shorter
 * and would have made "never recorded" indistinguishable from "a field a reader
 * forgot to check": a machine consumer that renders a missing forecast as an empty
 * range or a zero is precisely the failure D5 names.
 */
function statusForecast(state: State): Record<string, unknown> {
  const entry = state.progress_forecast;
  if (!entry) return { recorded: false, note: FORECAST_NEVER_RECORDED, record_with: FORECAST_RECORD_COMMAND };
  return {
    recorded: true,
    phase: entry.phase,
    questions: entry.questions,
    operations: entry.operations,
    cycles: entry.cycles,
    confidence: entry.confidence,
    cycle_state: entry.cycle_state,
    // Derived from the stored signals only; `status` re-derives nothing from the
    // ledger, so what it shows is what was recorded.
    derived_cycle_state: impliedCycleState(entry.signals ?? []),
    signals: (entry.signals ?? []).map((signal) => signal.code),
    recorded_by: entry.recorded_by,
    recorded_at: entry.recorded_at,
    state_revision: entry.state_revision,
    history_entries: (state.forecast_history ?? []).length,
  };
}

function nextQuestions(state: State, requestedCount?: string | boolean): string {
  const active = activeModule(state);
  if (!active) return "Questionnaire coverage complete. Next: approve the research/synthesis gate.\n";
  const count = requestedCount ? Number(requestedCount) : (({ Guided: 1, Standard: 2, Expert: 3 } as any)[state.interaction_mode] ?? 2);
  if (![1, 2, 3].includes(count)) throw new BeaveError("--count must be 1, 2, or 3");
  const catalog = questionnaire().find((item: any) => item.id === active.id);
  /*
   * A catalog question the ledger already answers is marked, not printed clean.
   *
   * `next` had no idea the interview ledger existed, so it reprinted, word for
   * word, a question recorded as ANSWERED and applied. Matching is on the exact
   * text: crude, and it is the only comparison that cannot claim more than it
   * knows. A paraphrase is not detected, and nothing here pretends otherwise --
   * which is why these are marked rather than removed.
   */
  const answered = new Map<string, string>();
  for (const item of interviewLog(state)) {
    if (item.status === "ANSWERED" && nonEmpty(item.answer)) answered.set(item.question.trim(), item.id);
  }
  const lines = catalog!.questions.slice(0, count).map((question: string, index: number) => {
    const recorded = answered.get(question.trim());
    return recorded
      ? `${index + 1}. ${question}${NL}   Already recorded as answered in ${recorded}. Do not ask it again unless that answer was invalidated.`
      : `${index + 1}. ${question}`;
  });
  return [`Module ${active.id} — ${active.title} [${active.status}]`, ...lines, "Stop after the user's answers; confirm them before recording the module outcome.", ""].join("\n");
}

function next(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const state = validateRoot(root);
  if (state.needs_reconciliation) {
    const open = state.human_overrides.find((item) => item.status === "OPEN");
    console.log(`BLOCKED: reconcile ${open?.id} before asking further questionnaire questions.`);
    return;
  }
  console.log(nextQuestions(state, flags.count).trimEnd());
}

// ---------------------------------------------------------------------------
// The interview ledger
// ---------------------------------------------------------------------------

/**
 * One recorded interaction.
 *
 * Everything here is either supplied by the caller or computed from state at the
 * moment of recording. Nothing is inferred later: an entry says what was asked,
 * what came back, and what was done about it, and a field nobody filled reads as
 * `null` rather than as a plausible default.
 */
interface InterviewEntry {
  id: string;
  status: string;
  module: number | null;
  /**
   * The question belongs to a module other than the one the interview is on.
   *
   * Recorded rather than inferred, with the reason beside it, because the two
   * ALN-011 pilots both ended with questions on module 2 while the active module
   * was 1 and nothing in either folder said why.
   */
  crosscutting?: boolean;
  crosscutting_reason?: string | null;
  lifecycle_state: string;
  gate: string;
  agent: string | null;
  /** Who recorded the answer, when that is not who asked. Never overwrites it. */
  answered_by_agent?: string | null;
  owner: string;
  question: string;
  rationale: string;
  asked_at: string | null;
  answer: string | null;
  answered_at: string | null;
  interpretation: string | null;
  reply: string | null;
  consequences: string[];
  documents: string[];
  open_points: string[];
  /** Set only by `qa-settle`, and only after the consequences are recorded. */
  consequences_recorded_at: string | null;
  next_id: string | null;
  next_question: string | null;
  supersedes: string | null;
  superseded_by: string | null;
  closed_reason: string | null;
  /** True only for an entry rebuilt from durable evidence, never from a guess. */
  reconstructed: boolean;
  /** The file that evidence is in. Required whenever `reconstructed` is true. */
  reconstructed_from?: string | null;
  created_at: string;
  updated_at: string;
}

/** A state that predates the ledger gets the empty one, in memory, on read. */
function interviewLog(state: any): InterviewEntry[] {
  return Array.isArray(state.interview_log) ? state.interview_log : [];
}

function findInterviewEntry(state: any, id: string): InterviewEntry | undefined {
  return interviewLog(state).find((entry) => entry.id === id);
}

/** Accepts `7`, `QNA-7` and `QNA-0007`; records the padded form, always. */
function normalizeQuestionId(value: string): string {
  const trimmed = String(value).trim().toUpperCase();
  const bare = trimmed.startsWith("QNA-") ? trimmed.slice(4) : trimmed;
  if (!/^[0-9]+$/.test(bare)) throw new BeaveError(`Invalid question id: ${value}. Use QNA-0007, or 7.`);
  const padded = `QNA-${bare.padStart(4, "0")}`;
  if (!QA_ID_PATTERN.test(padded)) throw new BeaveError(`Invalid question id: ${value}`);
  return padded;
}

/**
 * A value supplied inline or in a file, never both.
 *
 * The file form exists because an exact answer is the one field that must not be
 * reshaped by a shell: a multi-line reply with quotes in it survives a file and
 * does not always survive an argument list.
 */
function textOrFile(flags: Flags, name: string, label: string, optional = false): string | null {
  const inline = flags[name];
  const fromFile = flags[`${name}-file`];
  if (nonEmpty(inline) && nonEmpty(fromFile)) throw new BeaveError(`Pass either --${name} or --${name}-file for ${label}, not both`);
  if (nonEmpty(inline)) return String(inline).trim();
  if (nonEmpty(fromFile)) {
    const resolved = path.resolve(String(fromFile));
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) throw new BeaveError(`${label} file does not exist: ${resolved}`);
    const text = fs.readFileSync(resolved, "utf8").trim();
    if (!text) throw new BeaveError(`${label} file is empty: ${resolved}`);
    return text;
  }
  if (optional) return null;
  throw new BeaveError(`${label} is required: pass --${name} or --${name}-file`);
}

function listFlag(flags: Flags, name: string): string[] {
  const raw = flags[name];
  if (!nonEmpty(raw)) return [];
  const items = String(raw).split(",").map((value) => value.trim()).filter(Boolean);
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) throw new BeaveError(`--${name} repeats ${item}`);
    seen.add(item);
  }
  return items;
}

/** The record behind a consequence id, for the checks that need its timestamp. */
function recordById(state: any, id: string): any {
  const ledgers = [
    state.decisions, state.requirements, state.artifacts, state.tasks, state.dependencies,
    state.risks, state.evidence, state.agents, state.checkpoints, state.gates,
  ];
  for (const ledger of ledgers) {
    const found = (ledger ?? []).find((item: any) => String(item?.id) === id);
    if (found) return found;
  }
  return null;
}

/** Ledger ids a consequence may name. A consequence pointing nowhere is refused. */
function knownRecordIds(state: any): Set<string> {
  return new Set(
    [
      ...(state.decisions ?? []), ...(state.requirements ?? []), ...(state.artifacts ?? []),
      ...(state.tasks ?? []), ...(state.dependencies ?? []), ...(state.risks ?? []),
      ...(state.evidence ?? []), ...(state.agents ?? []), ...(state.checkpoints ?? []),
      ...(state.gates ?? []),
    ].map((item: any) => String(item.id))
  );
}

/**
 * Everything wrong with the interview ledger, in the caller's words.
 *
 * Chronological order is checked against `created_at` rather than against array
 * position alone: a hand-edited state that reorders entries is the case the
 * brief asks for, and position would accept it.
 */
function interviewLogErrors(root: string, state: any): string[] {
  const errors: string[] = [];
  if (!Array.isArray(state.interview_log)) {
    errors.push("interview_log must be an array");
    return errors;
  }
  const entries: InterviewEntry[] = state.interview_log;
  const byId = new Map<string, InterviewEntry>();
  let priorCreated = "";

  for (const [index, entry] of entries.entries()) {
    const where = `interview_log[${index}]`;
    if (!nonEmpty(entry?.id) || !QA_ID_PATTERN.test(entry.id)) {
      errors.push(`${where} has an invalid id`);
      continue;
    }
    if (byId.has(entry.id)) errors.push(`duplicate interview entry ${entry.id}`);
    byId.set(entry.id, entry);

    if (!QA_STATUSES.has(entry.status)) errors.push(`${entry.id} has unknown status ${entry.status}`);
    if (!nonEmpty(entry.question)) errors.push(`${entry.id} has no question`);
    if (!nonEmpty(entry.rationale)) errors.push(`${entry.id} has no rationale`);
    if (!nonEmpty(entry.owner)) errors.push(`${entry.id} has no owner`);
    if (!nonEmpty(entry.created_at)) errors.push(`${entry.id} has no created_at`);
    else {
      if (priorCreated && entry.created_at < priorCreated) errors.push(`${entry.id} is out of chronological order: created ${entry.created_at} after ${priorCreated}`);
      priorCreated = entry.created_at;
    }

    // The states the brief requires Resume to tell apart, enforced rather than
    // described: an answer with no timestamp, or consequences recorded for an
    // answer that does not exist, would make an interrupted turn look finished.
    if (entry.status === "ANSWERED") {
      if (!nonEmpty(entry.answer)) errors.push(`${entry.id} is ANSWERED with no recorded answer`);
      if (!nonEmpty(entry.answered_at)) errors.push(`${entry.id} is ANSWERED with no answered_at`);
      if (!nonEmpty(entry.asked_at)) errors.push(`${entry.id} is ANSWERED but was never recorded as asked`);
    }
    if (entry.status === "ASKED" && nonEmpty(entry.answer)) errors.push(`${entry.id} is ASKED but carries an answer`);
    if (entry.status === "PLANNED" && nonEmpty(entry.asked_at)) errors.push(`${entry.id} is PLANNED but carries asked_at`);
    /*
     * The guarantee is "an unanswered question can never look applied", not "an
     * applied answer can never be superseded". The first version of this rule
     * demanded `ANSWERED`, which made a correction impossible: superseding a
     * settled entry moves it to `SUPERSEDED` while it rightly keeps the
     * consequences it had. The engine refused the first `qa-supersede` and was
     * pointing at the rule, not at the operation.
     */
    if (nonEmpty(entry.consequences_recorded_at) && new Set(["PLANNED", "ASKED", "DEFERRED", "SKIPPED"]).has(entry.status)) {
      errors.push(`${entry.id} is ${entry.status} and records applied consequences; only an answered question can have been applied`);
    }
    if (nonEmpty(entry.consequences_recorded_at) && !nonEmpty(entry.answer)) errors.push(`${entry.id} records consequences for an answer that is not there`);
    if (new Set(["DEFERRED", "SKIPPED", "INVALIDATED"]).has(entry.status) && !nonEmpty(entry.closed_reason)) errors.push(`${entry.id} is ${entry.status} without a recorded reason`);
    if (entry.status === "SUPERSEDED" && !nonEmpty(entry.superseded_by)) errors.push(`${entry.id} is SUPERSEDED without naming what replaced it`);
    if (entry.reconstructed !== true && entry.reconstructed !== false) errors.push(`${entry.id} does not say whether it was reconstructed`);
    if (entry.reconstructed === true && !nonEmpty(entry.reconstructed_from)) errors.push(`${entry.id} claims to be reconstructed and names no evidence`);
    if (entry.reconstructed !== true && nonEmpty(entry.reconstructed_from)) errors.push(`${entry.id} names reconstruction evidence without being marked reconstructed`);
  }

  const records = knownRecordIds(state);
  for (const entry of entries) {
    if (!nonEmpty(entry?.id)) continue;
    for (const field of ["supersedes", "superseded_by", "next_id"] as const) {
      const target = entry[field];
      if (nonEmpty(target) && !byId.has(String(target))) errors.push(`${entry.id}.${field} points at ${target}, which is not in the ledger`);
    }
    if (nonEmpty(entry.superseded_by) && entry.status !== "SUPERSEDED") errors.push(`${entry.id} names a replacement while not SUPERSEDED`);
    for (const consequence of entry.consequences ?? []) {
      if (!records.has(consequence)) errors.push(`${entry.id} records consequence ${consequence}, which is not a record in this project`);
    }
    for (const document of entry.documents ?? []) {
      if (!nonEmpty(document)) errors.push(`${entry.id} records an empty document path`);
    }
  }

  /*
   * State's agreement with itself is checked here; its agreement with the file on
   * disk is not, and that split is load-bearing.
   *
   * `stateErrors` runs inside every transaction, before anything is written. The
   * derived document is written *after* the commit, because the ledger is the
   * record and a view that failed to write must not roll back a recorded answer.
   * Checking the file here made the first `qa-ask` on a new project refuse itself:
   * the digest was in the state being validated and the file it describes did not
   * exist yet. The engine caught it on the first run, which is the right place for
   * it to be caught, and the on-disk comparison now lives in
   * `interviewViewErrors`, called by `validate`.
   */
  if (state.interview_view !== undefined && state.interview_view !== null) {
    const view = state.interview_view;
    if (view.path !== QA_VIEW_RELATIVE) errors.push(`interview_view.path must be ${QA_VIEW_RELATIVE}`);
    if (!nonEmpty(view.sha256)) errors.push("interview_view.sha256 is missing");
    else if (sha256(renderInterviewView(state)) !== view.sha256) {
      errors.push(`interview_view.sha256 does not describe what this state renders; regenerate with: beave qa-log --project-root . --regenerate`);
    }
  }

  return errors;
}

/**
 * Whether the derived document on disk still matches the ledger.
 *
 * Separate from `interviewLogErrors` because it is a fact about the filesystem
 * rather than about the state, and because it must not run inside a transaction:
 * see the comment above. A hand edit to the document is reported here, with the
 * one command that repairs it, and nothing about the recorded history changes.
 */
function interviewViewErrors(root: string, state: any): string[] {
  const view = state.interview_view;
  if (view === undefined || view === null || !nonEmpty(view.sha256)) return [];
  const file = path.join(root, QA_VIEW_RELATIVE);
  if (!fs.existsSync(file)) return [`${QA_VIEW_RELATIVE} is recorded in state and missing from the project; regenerate with: beave qa-log --project-root . --regenerate`];
  if (sha256(fs.readFileSync(file)) !== view.sha256) {
    return [`${QA_VIEW_RELATIVE} was edited outside Beave. It is a derived view: the history is in .beave/state.json, so nothing in it was changed by that edit. Regenerate with: beave qa-log --project-root . --regenerate`];
  }
  return [];
}

// ---------------------------------------------------------------------------
// The derived document
// ---------------------------------------------------------------------------

function quoteBlock(value: string): string[] {
  return String(value).split(/\r?\n/).map((line) => (line.trim() ? `> ${line}` : ">"));
}

/** What the entry is, in one line, including whether the answer was applied. */
function entryHeadline(entry: InterviewEntry): string {
  if (entry.status !== "ANSWERED") return entry.status;
  return entry.consequences_recorded_at ? "ANSWERED, applied" : "ANSWERED, not yet applied";
}

/**
 * The whole document, as a pure function of state.
 *
 * Pure on purpose: no clock, no environment. Regenerating it twice produces the
 * same bytes, so the digest in state is stable and a difference on disk means
 * somebody edited the file rather than that time passed.
 */
function renderInterviewView(state: any): string {
  const entries = interviewLog(state);
  const moduleTitle = (id: number | null) => {
    if (id === null || id === undefined) return null;
    const module = (state.modules ?? []).find((item: any) => item.id === id);
    return module ? `${id} — ${module.title}` : String(id);
  };

  const lines: string[] = [
    "# Question and answer history",
    "",
    "<!-- Generated by Beave from .beave/state.json. Do not edit this file. -->",
    "<!-- Regenerate with: beave qa-log --project-root . --regenerate -->",
    "",
    `- Project: ${state.project?.name ?? "not recorded"}`,
    `- History recorded since: ${state.interview_log_since ?? "not recorded"}`,
    `- Interactions: ${entries.length}`,
    "",
    "This is the record of what Beave asked, what you answered, and what Beave did",
    "with the answer. It is append-only: a correction adds an entry that supersedes",
    "the earlier one, and the earlier one stays where it is.",
    "",
    "It is a **derived view**, regenerated from the Beave state. Editing this file",
    "changes nothing and is reported by `beave validate`; the history lives in",
    "`.beave/state.json`, with `.beave/events.jsonl` recording how it got there.",
    "",
  ];

  if (!entries.length) {
    lines.push("## No interaction recorded yet", "");
    lines.push(
      state.interview_log_since
        ? `Nothing has been asked through Beave since ${state.interview_log_since}. Interactions from before that instant, if any, were never recorded and are not reconstructed here.`
        : "Nothing has been recorded yet.",
      ""
    );
  }

  for (const entry of entries) {
    lines.push(`## ${entry.id} — ${entryHeadline(entry)}`, "");
    lines.push(`- Status: ${entry.status}`);
    lines.push(
      `- Consequences recorded: ${
        entry.consequences_recorded_at ??
        (nonEmpty(entry.answer)
          ? "not yet — the answer is recorded and has not been applied to the project records"
          : "nothing to apply — no answer is recorded")
      }`
    );
    lines.push(
      `- Module: ${moduleTitle(entry.module) ?? "not recorded"}${entry.crosscutting === true ? " — asked outside the module the interview was on" : ""}`,
    );
    if (entry.crosscutting === true) {
      lines.push(`- Why it was asked there: ${entry.crosscutting_reason ?? "not recorded"}`);
    }
    lines.push(`- Phase: ${entry.lifecycle_state} · Gate: ${entry.gate}`);
    lines.push(`- Asked by: ${entry.agent ?? "not recorded"}`);
    if (nonEmpty(entry.answered_by_agent)) lines.push(`- Answer recorded by: ${entry.answered_by_agent}`);
    if (entry.reconstructed && nonEmpty(entry.reconstructed_from)) lines.push(`- Reconstructed from: ${entry.reconstructed_from}`);
    lines.push(`- Recorded by: ${entry.owner}`);
    lines.push(`- Asked at: ${entry.asked_at ?? "not asked"}`);
    lines.push(`- Answered at: ${entry.answered_at ?? "no answer recorded"}`);
    if (entry.supersedes) lines.push(`- Replaces: ${entry.supersedes}`);
    if (entry.superseded_by) lines.push(`- Replaced by: ${entry.superseded_by}`);
    if (entry.reconstructed) lines.push("- **Reconstructed from durable evidence**, not recorded at the time it happened.");
    lines.push("");

    lines.push("**Question**", "", ...quoteBlock(entry.question), "");
    lines.push("**Why it was asked**", "", entry.rationale, "");

    if (nonEmpty(entry.answer)) lines.push("**Answer, verbatim**", "", ...quoteBlock(entry.answer as string), "");
    else lines.push("**Answer**", "", "No answer is recorded for this question.", "");

    if (nonEmpty(entry.interpretation)) lines.push("**What Beave understood**", "", entry.interpretation as string, "");
    if (nonEmpty(entry.reply)) lines.push("**What Beave replied**", "", entry.reply as string, "");
    if (nonEmpty(entry.closed_reason)) lines.push("**Why it was closed**", "", entry.closed_reason as string, "");

    if ((entry.consequences ?? []).length) lines.push("**Records created or changed**", "", ...entry.consequences.map((id) => `- ${id}`), "");
    if ((entry.documents ?? []).length) lines.push("**Documents**", "", ...entry.documents.map((item) => `- ${item}`), "");
    if ((entry.open_points ?? []).length) lines.push("**Still open**", "", ...entry.open_points.map((item) => `- ${item}`), "");

    if (nonEmpty(entry.next_question) || nonEmpty(entry.next_id)) {
      const nextEntry = entry.next_id ? findInterviewEntry(state, entry.next_id) : undefined;
      lines.push(
        "**Next question proposed**",
        "",
        `- ${entry.next_id ?? "not yet opened"} (${nextEntry ? nextEntry.status : "not yet opened"}): ${entry.next_question ?? (nextEntry ? nextEntry.question : "not recorded")}`,
        ""
      );
    }
    lines.push("---", "");
  }

  const open = openInterviewEntries(state);
  lines.push("## Open right now", "");
  if (!open.asked.length && !open.unapplied.length && !open.planned.length) lines.push("- Nothing open: every recorded question is answered and applied.", "");
  else {
    for (const entry of open.asked) lines.push(`- ${entry.id} was asked and has no answer.`);
    for (const entry of open.unapplied) lines.push(`- ${entry.id} was answered and the answer is not applied yet.`);
    for (const entry of open.planned) lines.push(`- ${entry.id} is planned and has not been asked.`);
    lines.push("");
  }

  return lines.join("\n");
}

/** The three kinds of unfinished business, which Resume has to tell apart. */
function openInterviewEntries(state: any): { planned: InterviewEntry[]; asked: InterviewEntry[]; unapplied: InterviewEntry[] } {
  const entries = interviewLog(state);
  return {
    planned: entries.filter((entry) => entry.status === "PLANNED"),
    asked: entries.filter((entry) => entry.status === "ASKED"),
    unapplied: entries.filter((entry) => entry.status === "ANSWERED" && !nonEmpty(entry.consequences_recorded_at)),
  };
}

/**
 * Write the document and record its digest in the state about to be committed.
 *
 * Called before `commitState`, so the digest travels in the same transaction as
 * the entry it describes. The file itself is written after the commit: the
 * ledger is the record, and a file that failed to write is a stale view that
 * `validate` reports and one command repairs -- which is the right way round.
 */
function stampInterviewView(state: any): string {
  const rendered = renderInterviewView(state);
  state.interview_view = { path: QA_VIEW_RELATIVE, sha256: sha256(rendered) };
  return rendered;
}

function writeInterviewView(root: string, rendered: string): void {
  atomicWrite(path.join(root, QA_VIEW_RELATIVE), Buffer.from(rendered, "utf8"));
}

/**
 * Every qa command ends the same way, so the ending is written once.
 *
 * The document is written inside the transaction, and the journal is told that
 * this operation regenerates a view: an interruption between the state write and
 * the document leaves a state recording a digest for a file that is not there,
 * and recovery rebuilds it rather than leaving `validate` to refuse.
 */
function commitInterview(root: string, location: string, state: any, event: any): void {
  const rendered = stampInterviewView(state);
  state.updated_at = event.at;
  state.revision = event.state_revision;
  state.last_event_id = event.event_id;
  const owned = activeTransaction === null;
  const directory = owned ? beginFileTransaction(root, event, [path.join(root, QA_VIEW_RELATIVE)]) : activeTransaction!.directory;
  try {
    commitState(root, location, state, event, { views: true });
    writeInterviewView(root, rendered);
    faultPoint("after-view");
    if (owned) completeFileTransaction(directory);
  } catch (error) {
    if (owned && fs.existsSync(directory)) rollbackFileTransaction(root, directory);
    throw error;
  }
}

function beginInterviewEvent(state: any, type: string, key: string, extra: Record<string, unknown>): any {
  const at = now();
  return { event_id: crypto.randomUUID(), type, state_revision: state.revision + 1, at, idempotency_key: key, ...extra };
}

/**
 * The ledger must exist before it can be written to.
 *
 * A project created before this feature has no `interview_log`. It is created
 * empty on first write, with the marker set to that instant: what came before is
 * not reconstructed and is not claimed to be absent either.
 */
/**
 * The ledger must exist before it can be written to, and the type has to know.
 *
 * The return value is the array rather than `void`: `state.interview_log` is
 * optional by design, so every caller would otherwise need a non-null assertion
 * and one of them would eventually be wrong.
 */
function ensureInterviewLog(state: any, at: string): InterviewEntry[] {
  if (!Array.isArray(state.interview_log)) {
    state.interview_log = [];
    state.interview_log_since = at;
  }
  if (state.interview_log_since === undefined) state.interview_log_since = at;
  return state.interview_log;
}

/**
 * Which module a question belongs to, and whether that is a deviation.
 *
 * The rule, in one place:
 *
 *  - no `--module` means the module the interview is actually on. A question
 *    with no module at all was how the two pilots ended up with QNA-0001 and
 *    QNA-0002 recorded against module 2 while `active_module` said 1, and
 *    nothing in either folder explained it.
 *  - a module that is *not* the active one is a deviation. It is allowed — a
 *    question genuinely can cut across modules, or reopen an earlier one — but
 *    it has to be asked for with `--crosscutting` and a `--crosscutting-reason`,
 *    it is recorded on the entry, and Resume shows it as a deviation rather than
 *    as ordinary progress.
 *  - either way the active module does **not** move. A module can take several
 *    questions, so advancing on an answer would be guessing; the module advances
 *    when it is recorded in a terminal state, and nowhere else.
 */
function resolveQuestionModule(
  state: any,
  flags: Flags,
): { module: number | null; crosscutting: boolean; reason: string | null } {
  const active = activeModule(state);
  const asked = moduleFlag(state, flags.module);
  const wantsDeviation = flags.crosscutting === true;
  const reason = nonEmpty(flags["crosscutting-reason"]) ? String(flags["crosscutting-reason"]).trim() : null;

  if (asked === null) {
    if (wantsDeviation || reason) {
      throw new BeaveError(
        `--crosscutting describes a question that belongs to a module other than the one the interview is on, so it needs --module as well. Nothing was written.`,
      );
    }
    // No module recorded anywhere is the state that produced the pilots'
    // discrepancy. The active module is the honest default.
    return { module: active ? active.id : null, crosscutting: false, reason: null };
  }

  if (active && asked !== active.id) {
    if (!wantsDeviation) {
      throw new BeaveError(
        `Module ${asked} is not the module this interview is on (${active.id} — ${active.title}, ${active.status}). ` +
          `Recording a question against a later module makes the earlier ones look settled when they are not, and against an earlier one hides that you are reopening it. ` +
          `If the question really belongs there, say so: add --crosscutting --crosscutting-reason "<why>". ` +
          `If module ${active.id} is finished, record it first with \`beave record\`. Nothing was written.`,
      );
    }
    if (!reason) {
      throw new BeaveError(`--crosscutting needs --crosscutting-reason: a deviation nobody explained is a deviation nobody can review. Nothing was written.`);
    }
    return { module: asked, crosscutting: true, reason };
  }

  if (wantsDeviation) {
    throw new BeaveError(
      `Module ${asked} is the module this interview is on, so --crosscutting describes nothing. Drop it. Nothing was written.`,
    );
  }
  return { module: asked, crosscutting: false, reason: null };
}

function moduleFlag(state: any, raw: unknown): number | null {
  if (!nonEmpty(raw) && typeof raw !== "number") return null;
  const moduleId = Number(raw);
  if (!Number.isInteger(moduleId) || !(state.modules ?? []).some((item: any) => item.id === moduleId)) {
    throw new BeaveError(`Unknown module: ${raw}`);
  }
  return moduleId;
}

interface NewEntryInput {
  id: string;
  question: string;
  rationale: string;
  module: number | null;
  crosscutting: boolean;
  crosscuttingReason: string | null;
  agent: string | null;
  owner: string;
  planned: boolean;
  reconstructed: boolean;
  reconstructedFrom: string | null;
}

function newInterviewEntry(state: any, input: NewEntryInput, at: string): InterviewEntry {
  return {
    id: input.id,
    status: input.planned ? "PLANNED" : "ASKED",
    module: input.module,
    crosscutting: input.crosscutting === true,
    crosscutting_reason: input.crosscutting === true ? (input.crosscuttingReason ?? null) : null,
    lifecycle_state: state.lifecycle_state,
    gate: state.current_gate,
    agent: input.agent,
    answered_by_agent: null,
    owner: input.owner,
    question: input.question,
    rationale: input.rationale,
    asked_at: input.planned ? null : at,
    answer: null,
    answered_at: null,
    interpretation: null,
    reply: null,
    consequences: [],
    documents: [],
    open_points: [],
    consequences_recorded_at: null,
    next_id: null,
    next_question: null,
    supersedes: null,
    superseded_by: null,
    closed_reason: null,
    reconstructed: input.reconstructed,
    reconstructed_from: input.reconstructedFrom,
    created_at: at,
    updated_at: at,
  };
}

/** The shape `qa-ask` and `qa-supersede` both build from the caller's flags. */
function entryInputFromFlags(state: any, flags: Flags, id: string, planned: boolean): NewEntryInput {
  const questionModule = resolveQuestionModule(state, flags);
  return {
    id,
    question: textOrFile(flags, "question", "Question") as string,
    rationale: textOrFile(flags, "rationale", "Rationale") as string,
    module: questionModule.module,
    crosscutting: questionModule.crosscutting,
    crosscuttingReason: questionModule.reason,
    agent: nonEmpty(flags.agent) ? String(flags.agent).trim() : null,
    owner: String(flags.owner).trim(),
    planned,
    reconstructed: flags.reconstructed === true,
    reconstructedFrom: nonEmpty(flags["reconstructed-from"]) ? canonicalRelative(String(flags["reconstructed-from"])) : null,
  };
}

function qaAsk(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: question already recorded.`);
  const { location, state } = loadState(root);
  // Opening a *new* question while a human override is unreconciled is exactly
  // what `beave next` already refuses. Answering one already in flight is not.
  assertNotBlocked(state);
  /*
   * And the same for an unfinished settlement.
   *
   * "Complete or reconcile that transaction before putting a new question" was
   * advice printed by Resume, which means it held exactly as long as the next
   * agent read it. Here it is a refusal, so the half-applied state cannot be
   * buried under a newer question by an agent that did not read carefully.
   * Answering and settling are not blocked: closing out work in flight is the
   * thing this refusal exists to make happen.
   */
  const unfinished = openInterviewEntries(state).unapplied;
  if (unfinished.length) {
    throw new BeaveError(
      `${unfinished[0].id} has a recorded answer and no recorded consequences. Settle it first: beave qa-settle --project-root . --id ${unfinished[0].id} --interpretation "..." --reply "..." --owner <owner> --operation-id <id>. Nothing was written.`
    );
  }
  assertKnownOwner(state, required(flags, "owner"));
  const at = now();
  const log = ensureInterviewLog(state, at);
  const id = normalizeQuestionId(required(flags, "id"));
  if (findInterviewEntry(state, id)) throw new BeaveError(`Question ${id} already exists. Use qa-supersede to replace it; the history is append-only.`);
  const entry = newInterviewEntry(state, entryInputFromFlags(state, flags, id, flags.planned === true), at);
  /*
   * "Reconstructed from durable evidence" was an unverified self-declaration:
   * the flag set a sentence in the document asserting a provenance nothing had
   * seen. It now has to name the evidence, and the evidence has to exist in the
   * project. `asked_at` is left null as well -- stamping `now()` on an entry
   * that describes something that happened earlier fabricates a timestamp and
   * then prints it without qualification.
   */
  if (entry.reconstructed) {
    if (!nonEmpty(entry.reconstructed_from)) {
      throw new BeaveError(`--reconstructed needs --reconstructed-from <file>: an entry that claims to come from durable evidence has to name it. Nothing was written.`);
    }
    if (!existingFileInside(root, entry.reconstructed_from as string)) {
      throw new BeaveError(`Reconstruction evidence does not exist inside the project: ${entry.reconstructed_from}. Nothing was written.`);
    }
    entry.asked_at = null;
    entry.status = "PLANNED";
  }
  log.push(entry);
  const event = beginInterviewEvent(state, "QUESTION_OPENED", key, {
    at,
    question_id: id,
    status: entry.status,
    module: entry.module,
    owner: entry.owner,
    agent: entry.agent,
    question_sha256: sha256(entry.question),
    reconstructed: entry.reconstructed,
  });
  event.at = at;
  /*
   * The recorded next action moves with the ledger, or it lies to the next agent.
   *
   * A pilot opened two questions and `resume` then printed, as its highest
   * priority instruction, "Continue the interview from QNA-0001; no next
   * question is recorded yet" -- false, and two paragraphs above the list of the
   * two questions that were in fact open. `qa-ask` wrote the ledger and left
   * `exact_next_action` where it was, and Resume's precedence puts the recorded
   * action above an open question, so the stale field won.
   *
   * A person's sentence is still never replaced: `advanceGeneratedNextAction`
   * decides, and when it declines it says what it would have written.
   */
  const note = advanceGeneratedNextAction(state, openQuestionsSentence(state));
  commitInterview(root, location, state, event);
  console.log(`Recorded ${id} as ${entry.status}.`);
  if (note) console.log(note);
}

function qaAnswer(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: answer already recorded.`);
  const { location, state } = loadState(root);
  assertKnownOwner(state, required(flags, "owner"));
  const at = now();
  ensureInterviewLog(state, at);
  const id = normalizeQuestionId(required(flags, "id"));
  const entry = findInterviewEntry(state, id);
  if (!entry) throw new BeaveError(`Unknown question: ${id}`);
  if (entry.status === "ANSWERED") throw new BeaveError(`${id} already carries an answer. Record a correction with qa-supersede so the earlier answer is preserved.`);
  if (!new Set(["PLANNED", "ASKED"]).has(entry.status)) throw new BeaveError(`${id} is ${entry.status} and cannot be answered.`);
  const answer = textOrFile(flags, "answer", "Answer") as string;
  entry.answer = answer;
  entry.answered_at = at;
  // A question answered without ever being marked asked is still a question that
  // was put to someone; recording the instant keeps the pair ordered.
  if (!entry.asked_at) entry.asked_at = at;
  entry.status = "ANSWERED";
  /*
   * The agent that recorded the answer is a different fact from the agent that
   * asked, and this used to overwrite the second with the first. The document
   * then attributed the question to whoever happened to be there at the end --
   * an assertion about provenance that could simply be false.
   */
  if (nonEmpty(flags.agent)) entry.answered_by_agent = String(flags.agent).trim();
  entry.updated_at = at;
  const event = beginInterviewEvent(state, "QUESTION_ANSWERED", key, {
    at,
    question_id: id,
    owner: String(flags.owner).trim(),
    answer_sha256: sha256(answer),
    answered_at: at,
  });
  event.at = at;
  commitInterview(root, location, state, event);
  console.log(`Recorded the answer to ${id}. It is not applied yet: run qa-settle to record what it changed.`);
}

function qaSettle(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: interaction already settled.`);
  const { location, state } = loadState(root);
  assertKnownOwner(state, required(flags, "owner"));
  const at = now();
  const log = ensureInterviewLog(state, at);
  const id = normalizeQuestionId(required(flags, "id"));
  const entry = findInterviewEntry(state, id);
  if (!entry) throw new BeaveError(`Unknown question: ${id}`);
  if (entry.status !== "ANSWERED") throw new BeaveError(`${id} is ${entry.status}; there is no answer to apply.`);
  if (entry.consequences_recorded_at) throw new BeaveError(`${id} was already settled at ${entry.consequences_recorded_at}. Record a correction with qa-supersede.`);

  const consequences = listFlag(flags, "consequences");
  const records = knownRecordIds(state);
  const unknown = consequences.filter((value) => !records.has(value));
  if (unknown.length) throw new BeaveError(`These consequences are not records in this project: ${unknown.join(", ")}. Record them first; nothing was written.`);

  /*
   * And it has to be a record this answer actually touched.
   *
   * The document prints these under "Records created or changed". Only the id
   * was checked, so a decision recorded *before* the question was even asked
   * could be listed there, and the document then presented a pre-existing
   * decision as the product of the interaction -- the mirror image of the
   * inference SKILL.md forbids. A record the answer created or changed has an
   * `updated_at` at or after the moment the question was put.
   */
  const askedAt = entry.asked_at ?? entry.created_at;
  const stale = consequences.filter((id) => {
    const record = recordById(state, id);
    const updated = record?.updated_at;
    return typeof updated === "string" && updated < askedAt;
  });
  if (stale.length) {
    throw new BeaveError(
      `These records were last changed before ${entry.id} was asked, so this answer did not create or change them: ${stale.join(", ")}. Record the change first, or leave them out — the history says "created or changed" and must mean it. Nothing was written.`
    );
  }

  const documents = listFlag(flags, "documents").map((value) => canonicalRelative(value));
  for (const document of documents) {
    if (!existingFileInside(root, document)) throw new BeaveError(`Document does not exist inside the project: ${document}`);
  }

  entry.interpretation = textOrFile(flags, "interpretation", "Interpretation") as string;
  entry.reply = textOrFile(flags, "reply", "Reply to the user") as string;
  entry.consequences = consequences;
  entry.documents = documents;
  entry.open_points = listFlag(flags, "open-points");
  /*
   * The next question is opened here, in this transaction, or not at all.
   *
   * A pointer to a question that does not exist yet is a dangling reference, and
   * the validator refuses one -- correctly: the first run of this code proposed
   * `QNA-0002` and the engine rejected the whole settlement. Recording the
   * proposal and opening the entry as two steps would reintroduce exactly the
   * half-finished state this ledger exists to make impossible, so `qa-settle`
   * does both or neither.
   */
  entry.next_question = textOrFile(flags, "next-question", "Next question", true);
  entry.next_id = nonEmpty(flags["next-id"]) ? normalizeQuestionId(String(flags["next-id"])) : null;
  if (entry.next_id && !findInterviewEntry(state, entry.next_id)) {
    if (!nonEmpty(entry.next_question)) {
      throw new BeaveError(`--next-id ${entry.next_id} is not in the ledger. Supply --next-question so it can be opened, or name a question that already exists.`);
    }
    log.push(
      newInterviewEntry(
        state,
        {
          id: entry.next_id,
          question: entry.next_question as string,
          // Derived from what just happened, not invented: this entry exists
          // because settling the previous one proposed it.
          rationale: nonEmpty(flags["next-rationale"])
            ? String(flags["next-rationale"]).trim()
            : `Proposed by ${entry.id} when its answer was settled.`,
          /*
           * The follow-up inherits the module of the question that proposed it,
           * including its crosscutting status: a question raised by a
           * crosscutting one is on the same detour, and pretending otherwise
           * would make the deviation disappear after a single turn.
           */
          module: moduleFlag(state, flags["next-module"] ?? entry.module),
          crosscutting: entry.crosscutting === true,
          crosscuttingReason: entry.crosscutting === true ? (entry.crosscutting_reason ?? null) : null,
          agent: entry.agent,
          owner: String(flags.owner).trim(),
          planned: true,
          reconstructed: false,
          reconstructedFrom: null,
        },
        at
      )
    );
  }
  entry.consequences_recorded_at = at;
  entry.updated_at = at;

  /*
   * Settling moves the project on, so it moves the recorded next action on.
   *
   * It did not, and the consequence was the loudest thing the review found: the
   * frontier ranks the exact next action third, so every project driven by this
   * ledger kept printing `init`'s placeholder -- "discuss module 1" -- above the
   * interview it was actually in. An agent obeying the bold line would do the
   * one thing SKILL.md forbids.
   *
   * `advanceGeneratedNextAction` is the existing rule and is used unchanged: a
   * sentence a person wrote is kept and the suggestion is reported instead.
   */
  /*
   * The answer that finishes a module closes it here, in the same transaction.
   *
   * A module takes several questions, so nothing advances it automatically: the
   * agent says when the module is done, with the same three things `record`
   * needs — an outcome, the evidence file, the owner. It calls
   * `applyModuleOutcome`, which is the code `record` calls, so the rules are not
   * duplicated and cannot drift. Doing it in one transaction is the point: the
   * settlement and the module outcome are one fact about the interview, and an
   * interruption between two commands is how a module stays open under an
   * answer that finished it.
   */
  let moduleNote: string | null = null;
  let completedModule: { id: number; status: string } | null = null;
  const wantsModule = nonEmpty(flags["complete-module"]);
  if (wantsModule || nonEmpty(flags["module-answer-file"])) {
    if (!wantsModule || !nonEmpty(flags["module-answer-file"])) {
      throw new BeaveError(`--complete-module and --module-answer-file go together: a module outcome without its recorded evidence is not a record. Nothing was written.`);
    }
    if (entry.module === null || entry.module === undefined) {
      throw new BeaveError(`${entry.id} is not recorded against any module, so settling it cannot complete one. Nothing was written.`);
    }
    if (entry.crosscutting === true) {
      throw new BeaveError(
        `${entry.id} is a crosscutting question (module ${entry.module}: ${entry.crosscutting_reason ?? "no reason recorded"}). ` +
          `A detour does not close the module it detoured into. Record that module with \`beave record\` when its own questions are done. Nothing was written.`,
      );
    }
    const applied = applyModuleOutcome(
      root,
      state,
      {
        moduleId: entry.module,
        status: String(flags["complete-module"]),
        answerFile: String(flags["module-answer-file"]),
        owner: String(flags.owner).trim(),
        summary: flags["module-summary"],
      },
      at,
    );
    completedModule = { id: entry.module, status: applied.outcome };
    moduleNote = applied.nextActionNote;
  }

  /*
   * The sentence is read off the ledger, not off this one entry.
   *
   * It used to look only at `entry.next_id`, so settling a question while three
   * others were open announced "no next question is recorded yet" — and `resume`
   * printed that at the top and listed the three fifty lines below. The
   * follow-up this settlement opens is still named when there is one, because
   * that is the more useful sentence; everything else comes from the log.
   */
  const nextActionNote = completedModule
    ? moduleNote
    : advanceGeneratedNextAction(
        state,
        entry.next_id
          ? generatedSentence(`Ask ${entry.next_id}: ${entry.next_question ?? findInterviewEntry(state, entry.next_id)?.question ?? "the recorded next question"}`)
          : openQuestionsSentence(state),
      );

  const event = beginInterviewEvent(state, "QUESTION_SETTLED", key, {
    at,
    question_id: id,
    owner: String(flags.owner).trim(),
    consequences,
    documents,
    open_points: entry.open_points,
    next_id: entry.next_id,
    module_completed: completedModule,
  });
  event.at = at;
  commitInterview(root, location, state, event);
  console.log(`Settled ${id}: ${consequences.length} record(s), ${documents.length} document(s).`);
  if (completedModule) console.log(`Recorded module ${completedModule.id} as ${completedModule.status} in the same operation.`);
  if (entry.open_points.length) console.log(`${entry.open_points.length} point(s) still open on this answer.`);
  if (nextActionNote) console.log(`${NL}${nextActionNote}`);
}

function qaClose(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: question already closed.`);
  const { location, state } = loadState(root);
  assertKnownOwner(state, required(flags, "owner"));
  const at = now();
  ensureInterviewLog(state, at);
  const kind = String(required(flags, "kind")).toLowerCase();
  if (!QA_CLOSE_KINDS.has(kind)) throw new BeaveError(`--kind must be one of ${[...QA_CLOSE_KINDS].join(", ")}`);
  const id = normalizeQuestionId(required(flags, "id"));
  const entry = findInterviewEntry(state, id);
  if (!entry) throw new BeaveError(`Unknown question: ${id}`);
  if (new Set(["SUPERSEDED", "DEFERRED", "SKIPPED", "INVALIDATED"]).has(entry.status)) throw new BeaveError(`${id} is already ${entry.status}.`);
  if (kind !== "invalidated" && entry.status === "ANSWERED") throw new BeaveError(`${id} has an answer; it cannot be ${kind}. Use --kind invalidated if the answer no longer holds.`);
  const reason = textOrFile(flags, "reason", "Reason") as string;
  entry.status = kind.toUpperCase();
  entry.closed_reason = reason;
  entry.updated_at = at;
  const event = beginInterviewEvent(state, "QUESTION_CLOSED", key, {
    at,
    question_id: id,
    status: entry.status,
    owner: String(flags.owner).trim(),
    reason_sha256: sha256(reason),
  });
  event.at = at;
  // Closing a question changes what the interview is waiting for, and the
  // recorded action has to follow: it used to keep naming a question that
  // `qa-answer` then refuses as DEFERRED.
  const closedNote = advanceGeneratedNextAction(state, openQuestionsSentence(state));
  commitInterview(root, location, state, event);
  console.log(`${id} is now ${entry.status}.`);
  if (closedNote) console.log(closedNote);
}

function qaSupersede(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: replacement already recorded.`);
  const { location, state } = loadState(root);
  /*
   * The same two guards `qa-ask` applies, because this opens a question too.
   *
   * It did not, and an independent review walked through the hole: with an
   * unsettled answer, `qa-ask` refuses and `qa-supersede` opened a new ASKED
   * entry anyway -- and because the superseded entry leaves `status: ANSWERED`,
   * the unsettled answer dropped out of `openInterviewEntries` and Resume
   * stopped reporting it. The same route bypassed an unreconciled override.
   */
  assertNotBlocked(state);
  assertKnownOwner(state, required(flags, "owner"));
  const at = now();
  const log = ensureInterviewLog(state, at);
  const unsettled = openInterviewEntries(state).unapplied;
  if (unsettled.length) {
    throw new BeaveError(
      `${unsettled[0].id} has a recorded answer and no recorded consequences. Settle it before replacing any question: a superseded entry stops being reported as open, so this would hide the unfinished work rather than finish it. Nothing was written.`
    );
  }
  const oldId = normalizeQuestionId(required(flags, "id"));
  const newId = normalizeQuestionId(required(flags, "new-id"));
  if (oldId === newId) throw new BeaveError(`A question cannot supersede itself.`);
  const previous = findInterviewEntry(state, oldId);
  if (!previous) throw new BeaveError(`Unknown question: ${oldId}`);
  if (previous.status === "SUPERSEDED") throw new BeaveError(`${oldId} was already superseded by ${previous.superseded_by}.`);
  if (findInterviewEntry(state, newId)) throw new BeaveError(`${newId} already exists.`);
  const reason = textOrFile(flags, "reason", "Reason") as string;

  // The replacement is a new entry. The old one keeps its question, its answer
  // and its consequences, and gains only the pointer: a correction that erased
  // what it corrected would be a correction nobody could audit.
  const replacement = newInterviewEntry(state, entryInputFromFlags(state, flags, newId, false), at);
  replacement.supersedes = oldId;
  previous.status = "SUPERSEDED";
  previous.superseded_by = newId;
  previous.closed_reason = reason;
  previous.updated_at = at;
  log.push(replacement);

  const event = beginInterviewEvent(state, "QUESTION_SUPERSEDED", key, {
    at,
    question_id: oldId,
    replaced_by: newId,
    owner: String(flags.owner).trim(),
    reason_sha256: sha256(reason),
    question_sha256: sha256(replacement.question),
  });
  event.at = at;
  // Same reason as `qa-close`: the replacement is what is open now, and the
  // recorded action named the question it replaced.
  const supersededNote = advanceGeneratedNextAction(state, openQuestionsSentence(state));
  commitInterview(root, location, state, event);
  console.log(`${oldId} is SUPERSEDED by ${newId}; both remain in the history.`);
  if (supersededNote) console.log(supersededNote);
}

function qaLog(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const { state } = loadState(root);
  const entries = interviewLog(state);

  if (flags.regenerate === true) {
    const rendered = renderInterviewView(state);
    const digest = sha256(rendered);
    const recorded = state.interview_view?.sha256 ?? null;
    writeInterviewView(root, rendered);
    if (recorded && recorded !== digest) {
      console.log(`Regenerated ${QA_VIEW_RELATIVE}. The digest recorded in state (${recorded.slice(0, 12)}) does not match what this state renders (${digest.slice(0, 12)}): the state was changed by something other than a qa command. Run beave validate.`);
      return;
    }
    console.log(`Regenerated ${QA_VIEW_RELATIVE} from the ledger.`);
    return;
  }

  if (nonEmpty(flags.id)) {
    const entry = findInterviewEntry(state, normalizeQuestionId(String(flags.id)));
    if (!entry) throw new BeaveError(`Unknown question: ${flags.id}`);
    console.log(JSON.stringify(entry, null, 2));
    return;
  }

  const open = openInterviewEntries(state);
  if (flags.json === true) {
    console.log(JSON.stringify({
      recorded_since: state.interview_log_since ?? null,
      entries: entries.length,
      last: entries.at(-1) ?? null,
      open_asked: open.asked.map((entry) => entry.id),
      open_planned: open.planned.map((entry) => entry.id),
      answered_not_applied: open.unapplied.map((entry) => entry.id),
    }, null, 2));
    return;
  }

  if (flags.last === true) {
    const last = entries.at(-1);
    console.log(last ? JSON.stringify(last, null, 2) : "No interaction is recorded for this project.");
    return;
  }

  if (flags.open === true) {
    if (!open.asked.length && !open.unapplied.length && !open.planned.length) {
      console.log("Nothing open: every recorded question is answered and applied.");
      return;
    }
    for (const entry of open.asked) console.log(`ASKED, no answer      ${entry.id}  ${entry.question}`);
    for (const entry of open.unapplied) console.log(`ANSWERED, not applied ${entry.id}  ${entry.question}`);
    for (const entry of open.planned) console.log(`PLANNED, not asked    ${entry.id}  ${entry.question}`);
    return;
  }

  console.log(renderInterviewView(state));
}

/**
 * What Resume prints about the interview, and the frontier it computes from it.
 *
 * The order below is the recorded precedence and is not a heuristic: integrity
 * and reconciliation first, then a human override, then the exact next action a
 * person wrote, then the gate, then a question actually recorded as open, then
 * open decisions, and only then the questionnaire catalog. The catalog is last
 * because restarting the interview over a project that already has a state is
 * the failure this whole ledger exists to prevent.
 */
function interviewMarkdown(state: any): string[] {
  const entries = interviewLog(state);
  const open = openInterviewEntries(state);
  /*
   * Completed means the answer was applied, not that the entry is still current.
   *
   * This filtered on `status === "ANSWERED"` and reported "no interaction has
   * been completed" on a project whose first question had been asked, answered,
   * settled and then superseded by a correction. Every one of those steps
   * happened; the entry simply is not the current one any more. A superseded
   * entry is history, and history is what this section is.
   */
  const settled = entries.filter((entry) => nonEmpty(entry.consequences_recorded_at));
  const last = settled.at(-1) ?? null;
  const lines = ["## Interview history", ""];

  if (!Array.isArray(state.interview_log)) {
    lines.push(
      "- This project predates the interview ledger. No question or answer was recorded, which is not the same as no question having been asked.",
      "- Start recording with `beave qa-ask`; earlier interactions are not reconstructed.",
      ""
    );
    return lines;
  }

  lines.push(`- Recorded interactions: ${entries.length} (history available since ${state.interview_log_since ?? "not recorded"})`);
  lines.push(`- Readable at: ${QA_VIEW_RELATIVE}`);
  /*
   * A question asked outside the active module is a deviation, and Resume says
   * so. Both ALN-011 pilots found questions on module 2 while the active module
   * was 1 and reported that the folder did not explain it; the engine refuses
   * that silently-created state now, and where a deviation is deliberate it is
   * named here rather than left for a reader to notice.
   */
  const active = activeModule(state);
  const detours = entries.filter((entry: any) => entry.crosscutting === true && !QA_CLOSE_KINDS.has(String(entry.status).toLowerCase()) && entry.status !== "SUPERSEDED");
  if (detours.length) {
    lines.push(
      `- ${detours.length} question${detours.length === 1 ? " was" : "s were"} asked outside the module the interview is on${active ? ` (module ${active.id} — ${active.title})` : ""}. They do not mean the earlier modules are finished:`,
    );
    for (const entry of detours) {
      lines.push(`  - ${entry.id} on module ${entry.module}: ${entry.crosscutting_reason ?? "no reason recorded"}`);
    }
  }
  lines.push(
    last
      ? `- Last completed interaction: ${last.id}${last.status === "SUPERSEDED" ? ` (since superseded by ${last.superseded_by})` : ""} — ${last.question}`
      : "- Last completed interaction: none; no answer has been applied yet."
  );
  if (last) {
    lines.push(`  - Module: ${last.module ?? "not recorded"}`);
    lines.push(`  - Records changed: ${(last.consequences ?? []).length ? last.consequences.join(", ") : "none recorded"}`);
    lines.push(`  - Documents changed: ${(last.documents ?? []).length ? last.documents.join(", ") : "none recorded"}`);
  }

  /*
   * Points recorded as still open, from any settled answer.
   *
   * They were written into the document and nowhere else, so `resume` -- the one
   * thing a fresh agent is told to read -- never mentioned them. An ambiguity
   * recorded and never surfaced is an ambiguity nobody resolves.
   */
  const outstanding = entries.flatMap((item) =>
    (item.open_points ?? []).map((point) => `  - ${item.id}: ${point}`)
  );
  if (outstanding.length) {
    lines.push("- Points recorded as still open:");
    lines.push(...outstanding);
  }
  for (const entry of open.asked) lines.push(`- **Asked and unanswered:** ${entry.id} — ${entry.question}`);
  for (const entry of open.unapplied) lines.push(`- **Answered and not applied:** ${entry.id} — the answer is recorded and its consequences are not. Settle it with \`beave qa-settle\` before asking anything else.`);
  for (const entry of open.planned) lines.push(`- Planned, not asked: ${entry.id} — ${entry.question}`);
  if (!open.asked.length && !open.unapplied.length && !open.planned.length) lines.push("- Nothing open in the interview.");

  const conflicts: string[] = [];
  if (open.unapplied.length && state.needs_reconciliation) conflicts.push("an answer is unapplied while a human override is open; reconcile first, then settle.");
  for (const entry of settled) {
    for (const consequence of entry.consequences ?? []) {
      if (!knownRecordIds(state).has(consequence)) conflicts.push(`${entry.id} names ${consequence}, which is no longer a record in this project.`);
    }
  }
  if (conflicts.length) {
    lines.push("", "### Conflicts between the history and the project", "");
    for (const conflict of conflicts) lines.push(`- ${conflict}`);
  }
  lines.push("");
  return lines;
}

function resumeFrontier(state: any): string[] {
  const open = openInterviewEntries(state);
  const openOverride = (state.human_overrides ?? []).find((item: any) => item.status === "OPEN");
  const openDecisions = (state.decisions ?? []).filter((item: any) => item.status === "PROPOSED" || item.status === "DRAFT");

  /*
   * The recorded precedence, in its recorded order.
   *
   * An unfinished settlement is deliberately **not** one of these ranks. It is a
   * precondition printed above them: the rule is "complete that transaction
   * before asking a new question", not "do it before everything else". The first
   * version of this function ranked it third, above the exact next action, and a
   * fresh agent reading the output noticed the difference — correctly. The two
   * statements are not the same, and the one written down is this one.
   */
  const candidates: { rank: number; line: string }[] = [];
  if (state.needs_reconciliation) candidates.push({ rank: 1, line: `Reconcile ${openOverride?.id ?? "the open human override"} before any other work.` });
  else if (openOverride) candidates.push({ rank: 2, line: `Apply the recorded human override ${openOverride.id}.` });
  if (nonEmpty(state.exact_next_action)) candidates.push({ rank: 3, line: `Exact next action, as recorded: ${state.exact_next_action}` });
  candidates.push({ rank: 4, line: `Current position: ${state.lifecycle_state}, gate ${state.current_gate}.` });
  if (open.asked.length) candidates.push({ rank: 5, line: `Put ${open.asked[0].id} to the user again, with its context. It was asked and never answered; do not treat it as answered.` });
  if (open.planned.length) candidates.push({ rank: 5.5, line: `Ask ${open.planned[0].id}, which is recorded as planned.` });
  if (openDecisions.length) candidates.push({ rank: 6, line: `Close the open decisions: ${openDecisions.map((item: any) => item.id).join(", ")}.` });
  candidates.sort((left, right) => left.rank - right.rank);

  const lines = ["## Where to continue", ""];

  if (open.unapplied.length) {
    lines.push(
      `**First, finish what is open.** ${open.unapplied[0].id} has a recorded answer and no recorded consequences. Settle it with \`beave qa-settle\` before putting any new question to the user: until then the interview has an unfinished transaction, and \`qa-ask\` will refuse.`,
      ""
    );
  }

  if (!candidates.length) {
    lines.push("- Nothing is recorded as outstanding. Read the canonical documents before concluding the project is complete.", "");
    return lines;
  }
  lines.push(`**Start here.** ${candidates[0].line}`, "");
  if (candidates.length > 1) {
    lines.push("Then, in this order:", "");
    for (const candidate of candidates.slice(1)) lines.push(`- ${candidate.line}`);
    lines.push("");
  }
  lines.push(
    "The questionnaire catalog below is last in this order on purpose: a project that has a state does not restart its interview.",
    ""
  );
  return lines;
}

function resume(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  /*
   * The order is the contract, and it is this one:
   *
   *   1. finish or undo an interrupted write   (`validateRoot` -> `loadState`)
   *   2. verify the event chain and the replay (`historyErrors`)
   *   3. stop if the state and its history disagree
   *   4. regenerate derived views, but only once the canonical source is intact
   *   5. only then, say where to continue
   *
   * Putting step 5 before steps 1-3 is how an agent ends up working confidently
   * on a project that was interrupted mid-write, which is the situation this
   * whole mechanism exists for.
   */
  const state = validateRoot(root);
  const history = historyErrors(root, state);
  const recovered = recoveredInThisRun.slice();
  if (history.errors.length) {
    console.log(`# Resume blocked\n\nThe durable state and the history that produced it do not agree, so nothing here can be trusted as the project's position.\n\n- ${history.errors.join("\n- ")}\n\nNothing was changed. Resolve this before answering any question or writing any file.`);
    // And it exits non-zero. It used to print that and return 0, so a caller
    // checking the exit code saw success on the one output that says the project
    // cannot be trusted — `validate` has always exited 2 on the same condition.
    throw new BeaveError("Resume is blocked: the state does not agree with its history. The report above says which fields, and how to rebuild them.");
  }
  const regenerated = regenerateDerivedViews(root);
  if (state.needs_reconciliation) {
    console.log(`${contextMarkdown(state)}\n## Resume blocked\n\nReconcile the open human override before continuing normal work.`);
    // Non-zero, for the same reason the divergence branch is: a caller checking
    // the status code must not see success on an output whose heading is
    // "Resume blocked". The second review found this branch still returning 0
    // after the other one had been fixed.
    throw new BeaveError("Resume is blocked: an open human override has to be reconciled before normal work continues. The report above says which.");
  }
  // The heading used to read "Resume questions", and a fresh recipient in the
  // ALN-005 handoff test took it as an instruction: it went to interview the user
  // about the active module while the dossier said the interview was over and the
  // remaining work was a physical survey a conversation cannot produce. The
  // recorded exact next action is the authority; these are catalog prompts, and
  // the heading now says which is which.
  const integrity: string[] = [];
  if (recovered.length) {
    integrity.push("## An interrupted operation was recovered", "", "The last run of Beave on this project did not finish. It has been resolved before anything below was read:", "");
    for (const line of recovered) integrity.push(`- ${line}`);
    integrity.push("");
  }
  const stagings = outstandingStagings(root).filter((item) => item.present);
  if (stagings.length) {
    integrity.push("## An export did not finish", "");
    for (const item of stagings) {
      integrity.push(`- a package for \`${item.note.destination}\` was left at phase ${item.note.phase}, started ${item.note.created_at}${item.alive ? " by a process that is still running" : ""}.`);
    }
    integrity.push("", "Nothing in the project changed: an export only ever reads it. Run `beave recover --project-root . --apply` to clear what is left beside the destination, then export again.", "");
  }
  if (regenerated.length) {
    integrity.push("## A derived view was regenerated", "", `${regenerated.join("; ")}. The canonical state was intact, so the document was rebuilt from it rather than the other way round.`, "");
  }
  if (history.notes.length) {
    integrity.push("## What the history can and cannot prove", "", ...history.notes.map((note) => `- ${note}`), "");
  }
  console.log(`${contextMarkdown(state)}\n${integrity.join("\n")}\n${interviewMarkdown(state).join("\n")}\n${resumeFrontier(state).join("\n")}\n## Catalog questions for the active module\n\nThese come from the questionnaire catalog, not from this project. The recorded exact next action above prevails; ask these only if the module is genuinely still open and an answer would change the outcome.\n\n${nextQuestions(state).trimEnd()}\n\nRe-verify canonical sources before changing files.`);
}

/**
 * Record a module outcome on a state already in hand.
 *
 * Extracted from `record` so that `qa-settle --complete-module` can close a
 * module in the same transaction as the answer that closed it, without a second
 * copy of the rules. Both callers validate the status against `MODULE_STATUSES`,
 * both confine the evidence inside the project, both refuse an empty file, and
 * both advance the engine's own next action while keeping a person's.
 *
 * It returns what the caller has to put in its event, and mutates nothing else.
 */
function applyModuleOutcome(
  root: string,
  state: State,
  input: { moduleId: number; status: string; answerFile: string; owner: string; summary?: unknown },
  at: string,
): { module: Module; outcome: string; nextActionNote: string | null } {
  const outcome = input.status.toUpperCase().replaceAll("_", " ");
  if (!MODULE_STATUSES.has(outcome)) throw new BeaveError(`Unsupported module status: ${outcome}`);
  const sourcePath = path.resolve(input.answerFile);
  const answerRelative = path.relative(root, sourcePath);
  const answerRefusal = artifactPathRefusal("Answer evidence", answerRelative);
  if (answerRefusal) throw new BeaveError(answerRefusal);
  const confinedAnswer = existingFileInside(root, answerRelative);
  if (!confinedAnswer) throw new BeaveError(`Answer evidence must be an existing file inside the project root`);
  const bytes = fs.readFileSync(confinedAnswer);
  if (!bytes.length || !bytes.toString("utf8").trim()) throw new BeaveError(`Answer evidence cannot be empty: ${sourcePath}`);
  const module = state.modules.find((item) => item.id === input.moduleId);
  if (!module) throw new BeaveError(`Unknown module: ${input.moduleId}`);
  Object.assign(module, {
    status: outcome,
    owner: input.owner,
    evidence: canonicalRelative(path.relative(root, sourcePath)) || path.basename(sourcePath),
    evidence_sha256: sha256(bytes),
    summary: input.summary && typeof input.summary === "string" ? input.summary.trim().slice(0, 240) : null,
    updated_at: at,
  });
  const active = activeModule(state);
  const nextActionNote = advanceGeneratedNextAction(
    state,
    active ? `Discuss module ${active.id} — ${active.title}.` : "Review coverage, then proceed to G2.",
  );
  return { module, outcome, nextActionNote };
}

function record(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: record already applied.`);
  const { location, state } = loadState(root);
  assertNotBlocked(state);
  assertKnownOwner(state, required(flags, "owner"));
  const moduleId = Number(required(flags, "module"));
  const timestamp = now();
  // `/`, always: `path.relative` hands back `ans\m1.md` on Windows, and that is a
  // file name rather than a path on the POSIX machine the folder is handed to.
  // Recording a module advances the interview, so it proposes the next module to
  // discuss — over its own sentence only. A next action a person wrote is kept
  // and the suggestion reported instead, because that field is what a fresh
  // recipient is told to obey and the recipient reads the folder, not this
  // terminal.
  const { module, outcome, nextActionNote } = applyModuleOutcome(
    root,
    state,
    { moduleId, status: required(flags, "status"), answerFile: required(flags, "answer-file"), owner: String(flags.owner), summary: flags.summary },
    timestamp,
  );
  state.updated_at = timestamp;
  const revision = state.revision + 1;
  const eventId = crypto.randomUUID();
  state.revision = revision;
  state.last_event_id = eventId;
  const event = { event_id: eventId, type: "MODULE_RECORDED", state_revision: revision, at: timestamp, idempotency_key: key, module: moduleId, status: outcome, owner: flags.owner, evidence: module.evidence, evidence_sha256: module.evidence_sha256 };
  commitState(root, location, state, event);
  console.log(`Recorded module ${moduleId} as ${outcome}`);
  if (nextActionNote) console.log(`\n${nextActionNote}`);
}

function override(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: override already applied.`);
  const { location, state } = loadState(root);
  assertKnownOwner(state, required(flags, "owner"));
  const sourcePath = path.resolve(required(flags, "instruction-file"));
  const bytes = fs.readFileSync(sourcePath);
  const timestamp = now();
  const item = { id: `OVR-${crypto.randomBytes(6).toString("hex")}`, status: "OPEN", owner: required(flags, "owner"), reason: typeof flags.reason === 'string' ? flags.reason : "Human direction changed by prompt", source: canonicalRelative(path.relative(root, sourcePath)) || path.basename(sourcePath), source_sha256: sha256(bytes), summary: bytes.toString("utf8").replace(/\s+/g, " ").slice(0, 240), created_at: timestamp };
  state.human_overrides.push(item);
  state.needs_reconciliation = true;
  // `needs_reconciliation` already carries the block, and `beave next` refuses on
  // it, so the reconciliation requirement does not need this field to be heard.
  // A next action a person wrote does need it, and an override recorded on a
  // folder carrying a handoff instruction used to destroy it without a word.
  const overrideNextActionNote = advanceGeneratedNextAction(
    state,
    `Reconcile ${item.id}: identify impacted decisions, artifacts, tasks, agents, tests, and gates.`
  );
  state.updated_at = timestamp;
  const revision = state.revision + 1;
  const eventId = crypto.randomUUID();
  state.revision = revision;
  state.last_event_id = eventId;
  const event = { event_id: eventId, type: "HUMAN_OVERRIDE_RECORDED", state_revision: revision, at: timestamp, idempotency_key: key, ...item };
  commitState(root, location, state, event);
  console.log(`Recorded human override ${item.id}; downstream work requires reconciliation.`);
  if (overrideNextActionNote) console.log(`
${overrideNextActionNote}`);
}

/**
 * Close an open human override, without overwriting a person's next action by default.
 *
 * `reconcile` is the step the engine *orders* after every override — the message
 * `override` prints names this command. It also assigned `--next-action`
 * unconditionally, bypassing `advanceGeneratedNextAction`, which `record`, `gate`
 * and `override` all go through. So the one command a human is told to run next
 * was the one command that destroyed the sentence a human had written, in
 * `state.json` and in `events.jsonl` alike. It survived only in `.beave/backups/`,
 * and backups do not travel in the package.
 *
 * `--next-action` is now optional, which is the root of the fix: it used to be
 * mandatory, so the operator did not replace the sentence because they wanted to,
 * they replaced it because the command left no other way to run. Four outcomes,
 * all of them named in the event:
 *
 *  - `generated`   — nothing human was recorded and none was supplied.
 *  - `preserved`   — a human sentence was recorded and none was supplied: kept.
 *  - `replaced`    — a human sentence was recorded and `--replace-human-next-action`
 *                    was given with a different `--next-action`.
 *  - `blocked_by_open_override` — another override is still open, so the blocker
 *                    sentence wins, as it always has.
 *
 * Supplying a `--next-action` identical to what is already recorded is not a
 * replacement and is not refused: nothing changes.
 */
function reconcile(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: reconcile already applied.`);
  const { location, state } = loadState(root);
  assertKnownOwner(state, required(flags, "owner"));
  const item = state.human_overrides.find((entry) => entry.id === required(flags, "override-id"));
  if (!item || item.status !== "OPEN") throw new BeaveError(`Open override not found: ${flags["override-id"]}`);
  // Reconciliation evidence is a document the recipient has to be able to read,
  // so it obeys the rule every other travelling record obeys: an existing,
  // non-empty file inside the project and outside the reserved `.beave`. It used
  // to be read from any absolute path the caller named, which is how a ledger
  // came to carry the digest of a document the package could not contain.
  const evidencePath = path.resolve(required(flags, "evidence-file"));
  const evidenceRelative = canonicalRelative(path.relative(root, evidencePath));
  const evidenceRefusal = artifactPathRefusal("Reconciliation evidence", evidenceRelative);
  if (evidenceRefusal) throw new BeaveError(`${evidenceRefusal}\nNothing was written.`);
  const confinedEvidence = existingFileInside(root, evidenceRelative);
  if (!confinedEvidence) throw new BeaveError(`Reconciliation evidence must be an existing file inside the project root: ${evidencePath}\nNothing was written.`);
  const bytes = fs.readFileSync(confinedEvidence);
  if (!bytes.length || !bytes.toString("utf8").trim()) throw new BeaveError(`Reconciliation evidence cannot be empty: ${evidenceRelative}\nNothing was written.`);

  const supplied = typeof flags["next-action"] === "string" ? String(flags["next-action"]).trim() : null;
  if (typeof flags["next-action"] === "string" && !supplied) throw new BeaveError(`--next-action cannot be empty. Omit it to keep what is recorded. Nothing was written.`);
  const replaceRequested = Boolean(flags["replace-human-next-action"]);
  const previousAction = typeof state.exact_next_action === "string" ? state.exact_next_action : "";
  const humanWroteIt = !engineWroteNextAction(previousAction);
  const open = state.human_overrides.filter((entry) => entry.status === "OPEN" && entry.id !== item.id);

  // The refusal is decided before anything is written, and it is skipped when
  // another override is still open: in that case nothing the caller supplied is
  // applied anyway, so there is no replacement to consent to.
  if (!open.length && humanWroteIt && supplied && supplied !== previousAction && !replaceRequested) {
    throw new BeaveError(
      `Refusing to replace the exact next action: it was written by a person, and --next-action alone is not the intention to replace it.\n` +
      `  recorded: ${previousAction}\n` +
      `  supplied: ${supplied}\n` +
      `To keep the recorded sentence, re-run without --next-action.\n` +
      `To replace it deliberately, add --replace-human-next-action.\n` +
      `Nothing was written; ${item.id} is still OPEN.`
    );
  }
  if (replaceRequested && !supplied) {
    throw new BeaveError(`--replace-human-next-action needs the sentence that replaces it: pass --next-action TEXT as well. Nothing was written.`);
  }

  const timestamp = now();
  Object.assign(item, { status: "RECONCILED", reconciled_by: required(flags, "owner"), reconciled_at: timestamp, reconciliation_evidence: evidenceRelative || path.basename(evidencePath), reconciliation_sha256: sha256(bytes) });
  state.needs_reconciliation = open.length > 0;

  let outcome: "generated" | "preserved" | "replaced" | "blocked_by_open_override";
  let resulting: string;
  if (open.length) {
    // With another override still open the blocker sentence has to win: the next
    // action is not what the operator planned, it is the reconciliation that has
    // to happen first. What is not allowed is doing that in silence — the operator
    // supplied a sentence and it went nowhere, which is the shape this release
    // refuses everywhere else it occurs.
    outcome = "blocked_by_open_override";
    resulting = `Reconcile ${open[0].id} before continuing.`;
  } else if (humanWroteIt && !supplied) {
    outcome = "preserved";
    resulting = previousAction;
  } else if (humanWroteIt) {
    outcome = supplied === previousAction ? "preserved" : "replaced";
    resulting = supplied!;
  } else {
    outcome = "generated";
    resulting = supplied ?? `Reconciled ${item.id}. Continue from the recorded plan; no next action was supplied.`;
  }
  state.exact_next_action = resulting;
  // `generated` means the engine owns the resulting sentence; the other three
  // leave the field belonging to whoever wrote it before, or to the operator who
  // deliberately replaced it.
  const provenance = outcome === "generated" ? "engine" : outcome === "blocked_by_open_override" ? "engine" : "human";

  state.updated_at = timestamp;
  const revision = state.revision + 1;
  const eventId = crypto.randomUUID();
  state.revision = revision;
  state.last_event_id = eventId;
  // `next_action_before` is the point of the whole record: the sentence a person
  // wrote used to vanish from the ledger, and the recipient of the folder must be
  // able to read what was replaced and by whom.
  const event = {
    event_id: eventId, type: "HUMAN_OVERRIDE_RECONCILED", state_revision: revision, at: timestamp,
    idempotency_key: key, override_id: item.id, owner: flags.owner,
    evidence: item.reconciliation_evidence, evidence_sha256: item.reconciliation_sha256,
    next_action_outcome: outcome,
    next_action_before: previousAction,
    next_action_after: resulting,
    next_action_provenance: provenance,
    next_action_supplied: supplied,
  };
  commitState(root, location, state, event);
  console.log(`Reconciled human override ${item.id}`);
  if (outcome === "preserved") {
    console.log(`
The exact next action was written by a person and is kept unchanged: "${resulting}"${supplied ? `
You supplied the same sentence, so nothing was replaced.` : ``}
To replace it deliberately, re-run with --next-action TEXT --replace-human-next-action, or use beave checkpoint --next-action.`);
  } else if (outcome === "replaced") {
    console.log(`
The exact next action written by a person was replaced, as --replace-human-next-action asked.
  was: ${previousAction}
  now: ${resulting}
The previous sentence is kept verbatim in event ${eventId} as next_action_before.`);
  } else if (outcome === "blocked_by_open_override") {
    const others = open.length === 1 ? "one override is" : `${open.length} overrides are`;
    console.log(`
The next action was set to the blocker sentence, because ${others} still open and reconciling ${open[0].id} has to come first.
  was: ${previousAction || "<nothing recorded>"}
  now: ${resulting}${supplied ? `
The sentence you supplied was NOT recorded in state: "${supplied}"
Supply it again on the reconcile that closes the last open override, or write it deliberately afterwards with beave checkpoint --next-action.` : ``}
The previous sentence is kept verbatim in event ${eventId} as next_action_before.`);
  } else {
    console.log(`
The exact next action is now: ${resulting}${supplied ? `` : `
No --next-action was supplied and nothing a person had written was recorded, so the engine wrote its own sentence. Replace it whenever you want with beave checkpoint --next-action.`}`);
  }
}

function ledgerMutation(kind: string, flags: Flags): void {
  const rule = LEDGER_RULES[kind];
  if (!rule) throw new BeaveError(`Unsupported ledger: ${kind}`);
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: ${kind} already applied.`);
  const { location, state } = loadState(root);
  assertNotBlocked(state);
  const owner = required(flags, "owner").trim();
  assertKnownOwner(state, owner);
  const id = required(flags, "id").toUpperCase();
  if (!validTypedId(id, rule.prefix)) throw new BeaveError(`Invalid ${kind} ID: ${id}. Expected ${rule.prefix}- followed by uppercase letters, numbers, _ or -.`);
  const ledger = state[rule.array] as unknown as any[];
  const existing = ledger.find((item) => item.id === id);
  if (existing) {
    const expected = Number(required(flags, "expected-revision"));
    if (!Number.isInteger(expected) || expected !== existing.revision) throw new BeaveError(`Stale ${kind} ${id}: expected revision ${existing.revision}. No changes written.`);
  }
  const timestamp = now();
  let record: any;
  if (kind === "decision" || kind === "requirement" || kind === "task") {
    const status = required(flags, "status").toUpperCase();
    if (!rule.statuses!.has(status)) throw new BeaveError(`Unsupported ${kind} status: ${status}`);
    record = { id, title: required(flags, "title").trim(), status, owner };
    if (!record.title) throw new BeaveError(`--title cannot be empty`);
  } else if (kind === "dependency") {
    const type = required(flags, "type").toUpperCase();
    if (!rule.statuses!.has(type)) throw new BeaveError(`Unsupported dependency type: ${type}`);
    record = { id, from: required(flags, "from").toUpperCase(), to: required(flags, "to").toUpperCase(), type, owner };
  } else if (kind === "risk") {
    const status = required(flags, "status").toUpperCase();
    const severity = required(flags, "severity").toUpperCase();
    if (!rule.statuses!.has(status)) throw new BeaveError(`Unsupported risk status: ${status}`);
    if (!new Set(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).has(severity)) throw new BeaveError(`Unsupported risk severity: ${severity}`);
    record = { id, title: required(flags, "title").trim(), severity, status, owner };
    if (!record.title) throw new BeaveError(`--title cannot be empty`);
  } else if (kind === "agent") {
    const status = required(flags, "status").toUpperCase();
    if (!rule.statuses!.has(status)) throw new BeaveError(`Unsupported agent status: ${status}`);
    record = { id, name: required(flags, "name").trim(), status, owner };
    if (!record.name) throw new BeaveError(`--name cannot be empty`);
  } else if (kind === "evidence") {
    const file = path.resolve(required(flags, "file"));
    const relative = path.relative(root, file);
    const evidenceRefusal = artifactPathRefusal("Evidence", relative);
    if (evidenceRefusal) throw new BeaveError(evidenceRefusal);
    const confined = existingFileInside(root, relative);
    if (!confined) throw new BeaveError(`Evidence must be an existing file inside the project root`);
    const bytes = fs.readFileSync(confined);
    if (!bytes.length) throw new BeaveError(`Evidence file is empty: ${relative}`);
    record = { id, path: relative.replaceAll("\\", "/"), sha256: sha256(bytes), owner };
  } else {
    record = { id, name: required(flags, "name").trim(), owner };
    if (!record.name) throw new BeaveError(`--name cannot be empty`);
    if (!existing) record.created_at = timestamp;
  }
  record.revision = (existing?.revision ?? 0) + 1;
  record.updated_at = timestamp;
  if (existing && kind === "checkpoint") record.created_at = existing.created_at;
  if (existing) Object.assign(existing, record);
  else ledger.push(record);

  if (kind === "checkpoint" && typeof flags["next-action"] === "string") {
    const nextAction = String(flags["next-action"]).trim();
    if (!nextAction) throw new BeaveError(`--next-action cannot be empty`);
    state.exact_next_action = nextAction;
  }

  state.updated_at = timestamp;
  const revision = state.revision + 1;
  const eventId = crypto.randomUUID();
  state.revision = revision;
  state.last_event_id = eventId;
  // D5. The status a ledger record was moved *to* was recorded nowhere: the event
  // carried the id, the revision and the owner, and the state carried only the
  // latest value. So no reader could tell that a task had been DONE and came back,
  // which is the observation the third loop condition is made of. It is written as
  // `record_status` — the ledger record's status, not the operation's — and it is
  // additive: every project written before this carries events without it, and
  // `reopenedRecords` simply sees nothing there rather than guessing.
  const event: any = { event_id: eventId, type: `${kind.toUpperCase()}_${existing ? "UPDATED" : "CREATED"}`, state_revision: revision, at: timestamp, idempotency_key: key, ledger_id: id, record_revision: record.revision, owner };
  if (typeof record.status === "string") event.record_status = record.status;
  commitState(root, location, state, event);
  console.log(`${existing ? "Updated" : "Created"} ${kind} ${id} at revision ${record.revision}`);
}

function verifiedEvidence(root: string, sourcePath: string): { relative: string; hash: string } {
  const relative = path.relative(root, sourcePath);
  const evidenceRefusal = artifactPathRefusal("Evidence", relative);
    if (evidenceRefusal) throw new BeaveError(evidenceRefusal);
  const confined = existingFileInside(root, relative);
  if (!confined) throw new BeaveError(`Evidence must be an existing file inside the project root`);
  const bytes = fs.readFileSync(confined);
  if (!bytes.length || !bytes.toString("utf8").trim()) throw new BeaveError(`Evidence file is empty: ${sourcePath}`);
  return { relative: (relative || path.basename(sourcePath)).replaceAll("\\", "/"), hash: sha256(bytes) };
}

function gatePrerequisiteErrors(root: string, state: State, gateId: string): string[] {
  const errors: string[] = [];
  const terminal = new Set(["CONFIRMED", "DEFERRED", "NOT APPLICABLE"]);
  const gate = Number(gateId.slice(1));
  const passed = (id: string) => state.gates.some((item) => item.name === id && new Set(["PASSED", "WARN", "NOT_APPLICABLE"]).has(item.status));
  if (gate > 1 && !passed(`G${gate - 1}`)) errors.push(`G${gate - 1} must be complete`);
  if (gate === 1 && !terminal.has(state.modules.find((item) => item.id === 1)?.status ?? "")) errors.push("module 1 must be resolved");
  if (gate === 2) {
    const unresolved = state.modules.filter((item) => !terminal.has(item.status)).map((item) => item.id);
    if (unresolved.length) errors.push(`all questionnaire modules must be resolved; open: ${unresolved.join(", ")}`);
    for (const item of state.modules.filter((module) => module.id > 0 && terminal.has(module.status) && module.status !== "NOT APPLICABLE")) {
      if (!item.evidence || !item.evidence_sha256) errors.push(`module ${item.id} has no hashed evidence`);
      else {
        const file = existingFileInside(root, item.evidence);
        if (!file) errors.push(`module ${item.id} evidence is missing or escapes the project root`);
        else if (sha256(fs.readFileSync(file)) !== item.evidence_sha256) errors.push(`module ${item.id} evidence hash does not match`);
      }
    }
  }
  if (gate === 4) {
    if (!state.decisions.some((item) => item.status === "APPROVED")) errors.push("at least one approved decision is required");
    if (!state.requirements.some((item) => item.status === "ACTIVE")) errors.push("at least one active requirement is required");
    if (!state.artifacts.some((item) => item.status === "PUBLISHED")) errors.push("at least one published artifact is required");
  }
  if (gate === 5 && !state.agents.some((item) => item.status === "ACTIVE")) errors.push("at least one active execution agent is required");
  if (gate === 6 && !state.checkpoints.length) errors.push("at least one checkpoint is required");
  if (gate === 7) {
    if (!state.tasks.length) errors.push("at least one task is required");
    const taskIds = new Set(state.tasks.map((item) => item.id));
    const directlyLinked = new Set(state.dependencies.flatMap((item) => taskIds.has(item.to) ? [item.from] : taskIds.has(item.from) ? [item.to] : []));
    const unmapped = state.requirements.filter((item) => item.status === "ACTIVE" && !directlyLinked.has(item.id)).map((item) => item.id);
    if (unmapped.length) errors.push(`active requirements lack task traceability: ${unmapped.join(", ")}`);
  }
  if (gate === 8 && state.tasks.some((item) => item.status !== "DONE")) errors.push("all tasks must be DONE");
  if (gate === 9 && !state.evidence.length) errors.push("verification evidence is required");
  if (gate >= 10) {
    const unsafe = state.risks.filter((item) => new Set(["HIGH", "CRITICAL"]).has(item.severity) && new Set(["IDENTIFIED", "REALIZED"]).has(item.status));
    if (unsafe.length) errors.push(`unresolved high risks: ${unsafe.map((item) => item.id).join(", ")}`);
  }
  if (gate >= 11 && (state.blockers.length || state.needs_reconciliation)) errors.push("open blockers or reconciliation remain");
  if (gate === 12 && !state.checkpoints.length) errors.push("an operational checkpoint is required");
  return errors;
}

function lifecycleForGate(gateNumber: number): string {
  return gateNumber >= 12 ? "OPERATE" : gateNumber >= 11 ? "RELEASE" : gateNumber >= 8 ? "VERIFY" : gateNumber >= 7 ? "EXECUTE" : gateNumber >= 6 ? "PLAN" : gateNumber >= 5 ? "FOUNDATION" : gateNumber >= 4 ? "BLUEPRINT" : gateNumber >= 3 ? "RESEARCH" : gateNumber >= 2 ? "INTERVIEW" : "DISCOVERY";
}

function gate(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: gate already applied.`);
  const state = validateRoot(root, true);
  const location = path.join(stateRoot(root), "state.json");
  assertNotBlocked(state);
  assertKnownOwner(state, required(flags, "owner"));
  const gateId = required(flags, "id");
  const status = required(flags, "status");
  if (!new Set(["PASSED", "WARN", "BLOCKED", "NOT_APPLICABLE"]).has(status)) {
    throw new BeaveError(`Invalid gate status: ${status}. Must be PASSED, WARN, BLOCKED, or NOT_APPLICABLE.`);
  }
  if (!/^G([0-9]|1[0-2])$/.test(gateId)) {
    throw new BeaveError(`Invalid gate ID: ${gateId}. Must be G0 through G12.`);
  }
  
  const gateNumber = parseInt(gateId.slice(1), 10);
  const currentGateNumber = parseInt(state.current_gate.slice(1), 10);
  if (gateNumber > currentGateNumber) {
    throw new BeaveError(`Cannot process ${gateId} before completing ${state.current_gate}`);
  }
  
  const sourcePath = flags["evidence-file"] ? path.resolve(String(flags["evidence-file"])) : null;
  let evidenceStr = null, evidenceSha256 = null;
  if (sourcePath) {
    const evidence = verifiedEvidence(root, sourcePath);
    evidenceStr = evidence.relative;
    evidenceSha256 = evidence.hash;
  } else {
    throw new BeaveError("--evidence-file is required for every gate outcome");
  }

  if (status === "PASSED" || status === "WARN" || status === "NOT_APPLICABLE") {
    const prerequisiteErrors = gatePrerequisiteErrors(root, state, gateId);
    if (prerequisiteErrors.length) throw new BeaveError(`Cannot complete ${gateId}:\n- ${prerequisiteErrors.join("\n- ")}`);
  }

  // `lifecycle.md` line 55: "WARN requires an owner, consequence, and review
  // date." The engine kept none of the three, and advanced the lifecycle exactly
  // as a PASSED would — so a conditional pass and an unconditional one were
  // indistinguishable in the state, in `status`, and in the next gate's
  // prerequisite check. Demonstrated by an A/B pair of identical projects during
  // the ALN-005 pilots: every observable field matched.
  const consequence = flags.consequence ? String(flags.consequence).trim() : "";
  const reviewDate = flags["review-date"] ? String(flags["review-date"]).trim() : "";
  if (status === "WARN") {
    if (!consequence || !reviewDate) {
      throw new BeaveError(
        `A WARN gate requires --consequence and --review-date as well as --owner (lifecycle.md: "WARN requires an owner, consequence, and review date"). Nothing was written.`
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) {
      throw new BeaveError(`--review-date must be an ISO date (YYYY-MM-DD); received ${reviewDate}`);
    }
  } else if (consequence || reviewDate) {
    throw new BeaveError(`--consequence and --review-date belong to a WARN outcome, not to ${status}`);
  }
  
  const timestamp = now();
  // The gate record used to carry `{id, name, status}` and nothing else: the
  // owner, the evidence and its digest existed only on the event, so a reader of
  // `state.json` — Studio included — could see that a gate had passed and not on
  // what authority or against which file.
  const record = {
    status,
    owner: String(flags.owner),
    evidence: evidenceStr,
    evidence_sha256: evidenceSha256,
    updated_at: timestamp,
    consequence: status === "WARN" ? consequence : null,
    review_date: status === "WARN" ? reviewDate : null,
  };
  const existing = state.gates.find((g) => g.id === gateId || g.name === gateId);
  if (existing) {
    Object.assign(existing, record);
  } else {
    // Generate a proper GAT- ID, use the provided id as name for easy lookup
    state.gates.push({ id: `GAT-${crypto.randomBytes(4).toString("hex")}`, name: gateId, ...record });
  }
  
  let gateNextActionNote: string | null = null;
  if ((status === "PASSED" || status === "WARN" || status === "NOT_APPLICABLE") && gateId === state.current_gate) {
    const nextNum = gateNumber + 1;
    if (nextNum <= 12) {
      state.current_gate = `G${nextNum}`;
      state.lifecycle_state = lifecycleForGate(nextNum);
    }
    // Same rule as `record`: the engine advances its own sentence and keeps a
    // person's. A gate outcome is not an instruction to whoever receives the
    // folder.
    // Flattened like every other generated sentence: a multi-line `--consequence`
    // used to break the `- Exact next action:` item in `resume` and the context
    // pack, spilling the rest into a bare paragraph. The re-check of the earlier
    // fix found this branch had been missed while the one with no free text in
    // it was flattened.
    gateNextActionNote = advanceGeneratedNextAction(
      state,
      generatedSentence(
        status === "WARN"
          ? `Proceed to ${state.current_gate}. ${gateId} passed with a condition owned by ${flags.owner}, to review by ${reviewDate}: ${consequence}`
          : `Proceed to ${state.current_gate}.`,
      ),
    );
  } else if (status === "BLOCKED") {
    if (gateNumber < currentGateNumber) {
      state.current_gate = gateId;
      state.lifecycle_state = lifecycleForGate(gateNumber);
    }
    gateNextActionNote = advanceGeneratedNextAction(state, generatedSentence(`Resolve blockers for ${gateId} and retry.`));
  }
  
  state.updated_at = timestamp;
  const revision = state.revision + 1;
  const eventId = crypto.randomUUID();
  state.revision = revision;
  state.last_event_id = eventId;
  const event = { event_id: eventId, type: "GATE_UPDATED", state_revision: revision, at: timestamp, idempotency_key: key, gate_id: gateId, status, owner: flags.owner, evidence: evidenceStr, evidence_sha256: evidenceSha256, consequence: record.consequence, review_date: record.review_date };
  commitState(root, location, state, event);
  console.log(`Recorded gate ${gateId} as ${status}`);
  if (gateNextActionNote) console.log(`
${gateNextActionNote}`);
}

function contextPack(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  // The pack carries the last few history entries as well as the current forecast:
  // a recipient has to be able to see that a forecast changed and why, not only
  // where it landed.
  const content = contextMarkdown(validateRoot(root), 3);
  if (!flags.output) return console.log(content.trimEnd());
  const relative = String(flags.output);
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw new BeaveError("Context output must stay under .beave/context");
  const output = boundedOutput(stateRoot(root), path.join("context", relative));
  atomicWrite(output, content);
  console.log(`Wrote context pack to ${output}`);
}

function copyFileCreatingParents(source: string, destination: string): void {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function packageManifest(packageRoot: string): any {
  const location = path.join(packageRoot, "manifest.json");
  const manifest = readJson(location);
  if (manifest.format !== "beave-project-package-v1" || !Array.isArray(manifest.files)) throw new BeaveError(`Unsupported project package manifest`);
  const seen = new Set<string>();
  for (const item of manifest.files) {
    if (!safeProjectRelative(item?.path) || !/^[a-f0-9]{64}$/.test(item?.sha256 ?? "") || !Number.isInteger(item?.bytes) || item.bytes < 0) throw new BeaveError(`Invalid package file entry`);
    // Blocker 4. The package is the thing that crosses machines, so its manifest
    // is held to the canonical spelling rather than merely tolerating both: a
    // `files\docs\plan.md` entry is a single file name on the recipient's POSIX
    // filesystem, and the package would unpack into something nobody asked for.
    if (String(item.path).includes("\\")) throw new BeaveError(`Package file entry must use "/" as its separator, not "\\": ${item.path}`);
    if (!(item.path === "state/state.json" || item.path === "state/events.jsonl" || item.path === manifest.entrypoint || item.path.startsWith("files/") || item.path.startsWith("history/") || item.path.startsWith("deletion-reasons/"))) throw new BeaveError(`Unsupported package file entry: ${item.path}`);
    // `history/` lands in `.beave/history/` on import, which is a directory the
    // engine owns: one flat filename, no separators, no traversal.
    if (item.path.startsWith("history/")) {
      const name = item.path.slice("history/".length);
      if (!name || name.includes("/") || name.includes("\\") || name.startsWith(".")) throw new BeaveError(`Unsafe history entry: ${item.path}`);
    }
    // Same shape, same rule: `deletion-reasons/` lands in `.beave/deletion-reasons/`.
    if (item.path.startsWith("deletion-reasons/")) {
      const name = item.path.slice("deletion-reasons/".length);
      if (!name || name.includes("/") || name.includes("\\") || name.startsWith(".")) throw new BeaveError(`Unsafe deletion-reason entry: ${item.path}`);
    }
    if (item.path.startsWith("files/") && !safeArtifactPath(item.path.slice("files/".length))) throw new BeaveError(`Package file targets a reserved or unsafe project path: ${item.path}`);
    if (seen.has(item.path)) throw new BeaveError(`Duplicate package file entry: ${item.path}`);
    seen.add(item.path);
    const location = existingFileInside(packageRoot, item.path);
    if (!location) throw new BeaveError(`Package file is missing or escapes the package root: ${item.path}`);
    if (fs.statSync(location).size !== item.bytes) throw new BeaveError(`Package byte count mismatch: ${item.path}`);
    if (sha256(fs.readFileSync(location)) !== item.sha256) throw new BeaveError(`Package digest mismatch: ${item.path}`);
  }
  for (const requiredFile of ["state/state.json", "state/events.jsonl"]) if (!seen.has(requiredFile)) throw new BeaveError(`Package is missing ${requiredFile}`);
  if (!safeProjectRelative(manifest.entrypoint) || !seen.has(manifest.entrypoint)) throw new BeaveError(`Package entrypoint is invalid or missing`);
  const embedded = readJson(path.join(packageRoot, "state", "state.json"));
  if (manifest.project_name !== embedded.project?.name || manifest.state_revision !== embedded.revision || manifest.schema_version !== embedded.schema_version) throw new BeaveError(`Package metadata does not match embedded state`);
  const embeddedEvents = fs.readFileSync(path.join(packageRoot, "state", "events.jsonl"), "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => { try { return JSON.parse(line); } catch { throw new BeaveError(`Invalid embedded event JSON at line ${index + 1}`); } });
  const latest = embeddedEvents.at(-1);
  if (!latest || latest.event_id !== embedded.last_event_id || latest.state_revision !== embedded.revision) throw new BeaveError(`Embedded state does not match its latest event`);
  for (const artifact of embedded.artifacts ?? []) {
    if (!safeArtifactPath(artifact.working_path)) throw new BeaveError(`Embedded artifact has unsafe path: ${artifact.id}`);
    const workingEntry = `files/${canonicalRelative(artifact.working_path)}`;
    if (!seen.has(workingEntry)) throw new BeaveError(`Package is missing current artifact file: ${workingEntry}`);
    if (sha256(fs.readFileSync(path.join(packageRoot, workingEntry))) !== artifact.content_hash) throw new BeaveError(`Embedded artifact hash mismatch: ${artifact.id}`);
    if (artifact.status === "PUBLISHED" && !seen.has(`files/${canonicalRelative(artifact.base_path)}`)) throw new BeaveError(`Package is missing published artifact: ${artifact.base_path}`);
  }
  for (const evidence of embedded.evidence ?? []) {
    if (!safeArtifactPath(evidence.path) || !seen.has(`files/${canonicalRelative(evidence.path)}`)) throw new BeaveError(`Package is missing or contains unsafe evidence: ${evidence.id}`);
  }
  // Blocker 3. Same rule for the account of what was done about a human override:
  // the ledger carries a digest, so the package has to carry the document, and a
  // recipient has to be told when it does not — or when what arrived is not what
  // the digest describes.
  const reconciliationRecovery =
    `\nSafe next action: reject this package and return to the source project. Restore the evidence file recorded by the ledger, ` +
    `or resolve its loss through a new governed override and reconciliation cycle; then run project-export into a new empty directory ` +
    `and run project-verify on that new package. Do not edit the rejected package or its manifest.`;
  for (const override of embedded.human_overrides ?? []) {
    const relative = override?.reconciliation_evidence;
    if (typeof relative !== "string" || !relative.trim()) continue;
    if (!safeArtifactPath(relative)) throw new BeaveError(`Package carries an unsafe reconciliation evidence path for ${override.id}: ${relative}${reconciliationRecovery}`);
    const entry = `files/${canonicalRelative(relative)}`;
    if (!seen.has(entry)) throw new BeaveError(`Package is missing the reconciliation evidence for ${override.id}: ${entry}${reconciliationRecovery}`);
    const digest = override.reconciliation_sha256;
    if (typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest)) {
      const location = existingFileInside(packageRoot, entry);
      if (!location) throw new BeaveError(`Package is missing the reconciliation evidence for ${override.id}: ${entry}${reconciliationRecovery}`);
      if (sha256(fs.readFileSync(location)) !== digest) throw new BeaveError(`Reconciliation evidence digest mismatch for ${override.id}: ${entry} does not match the digest recorded in the ledger${reconciliationRecovery}`);
    }
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// Staging directories, for export and import
//
// A rename promotes a whole directory at once, which is why the final folder is
// never half a package. What was missing is everything before the rename: a
// killed process left `.name.<uuid>.tmp` beside the destination and no command
// would ever mention it again.
//
// The marker is what makes the directory recognisable as Beave's own. Nothing
// removes a directory that does not carry one -- a user's folder that happens to
// look temporary is a user's folder.
// ---------------------------------------------------------------------------

const STAGING_MARKER = ".beave-staging.json";

type StagingPhase = "OPENED" | "COPYING" | "MANIFEST" | "VERIFIED" | "PROMOTING";

interface StagingMarker {
  format: "beave-staging-v1";
  kind: "export" | "import";
  staging_id: string;
  operation_id: string | null;
  source: string;
  destination: string;
  phase: StagingPhase;
  pid: number;
  host: string;
  created_at: string;
  updated_at: string;
  /** Set once the content is complete, so a recovery can tell what it is holding. */
  expected_files: number | null;
  expected_manifest_sha256: string | null;
}

function stagingMarkerPath(staging: string): string {
  return path.join(staging, STAGING_MARKER);
}

/**
 * A pointer inside the project, so `recover` and `resume` can see an export that
 * did not finish.
 *
 * The staging itself lives beside the *destination*, which is wherever the user
 * asked for the package — not somewhere a command run inside the project would
 * ever look. The pointer is what closes that gap. An import has no project to
 * point from until it succeeds, which is stated rather than papered over: an
 * interrupted import is resolved by the next import to the same destination.
 */
function noteStagingInProject(root: string | null, staging: string, marker: StagingMarker): void {
  if (!root) return;
  try {
    writeJson(path.join(stateRoot(root), "staging", `${marker.staging_id}.json`), { ...marker, staging_directory: staging });
  } catch {
    // Diagnostics. An export must not fail because a note could not be written.
  }
}

function forgetStagingNote(root: string | null, stagingId: string): void {
  if (!root) return;
  try {
    fs.rmSync(path.join(stateRoot(root), "staging", `${stagingId}.json`), { force: true });
  } catch {
    // Same reasoning.
  }
}

/**
 * Clear every staging this project recorded and never finished.
 *
 * Keyed on the project's own notes rather than on a destination, because an
 * export interrupted on the way to one folder must not survive because the next
 * export happens to be going somewhere else. A staging whose process is still
 * running is left alone by `resolveAbandonedStagings`.
 */
function clearOwnAbandonedStagings(root: string): string[] {
  const notes: string[] = [];
  for (const item of outstandingStagings(root)) {
    if (item.alive) continue;
    /*
     * The staging is gone but its destination may be carrying the marker: that
     * is a crash in the window between the rename and the marker's removal, and
     * it means the operation *finished*. Clear the one file it left.
     */
    const destination = String(item.note.destination);
    if (!item.present && fs.existsSync(stagingMarkerPath(destination))) {
      const stray = readStagingMarker(destination);
      if (stray && path.resolve(stray.destination) === path.resolve(destination)) {
        fs.rmSync(stagingMarkerPath(destination), { force: true });
        notes.push(`cleared the staging marker left inside the completed ${item.note.kind} at ${path.basename(destination)}`);
      }
    }
    if (item.present) {
      const directory = String(item.note.staging_directory);
      const parent = path.dirname(directory);
      notes.push(...resolveAbandonedStagings(parent, String(item.note.destination), root));
      /*
       * The marker leaves just before the rename, so a crash in that window
       * leaves a directory with nothing inside it saying whose it is. The note
       * in this project's own `.beave/` is the provenance instead, and it is
       * the stronger of the two: Beave wrote it, it names this exact path, and
       * that path is not the destination. Without this the directory would sit
       * there for ever — which is the defect this whole section exists for.
       */
      if (fs.existsSync(directory) && path.resolve(directory) !== path.resolve(String(item.note.destination))) {
        fs.rmSync(directory, { recursive: true, force: true });
        notes.push(`discarded an unfinished ${item.note.kind} staging recorded by this project at ${path.basename(directory)}`);
      }
    }
    forgetStagingNote(root, String(item.note.staging_id));
  }
  return notes;
}

/** Export stagings this project started and never finished. */
function outstandingStagings(root: string): Array<{ note: any; present: boolean; alive: boolean; leftover?: boolean }> {
  const directory = path.join(stateRoot(root), "staging");
  if (!fs.existsSync(directory)) return [];
  const found: Array<{ note: any; present: boolean; alive: boolean; leftover?: boolean }> = [];
  for (const entry of fs.readdirSync(directory)) {
    if (!entry.endsWith(".json")) continue;
    let note: any;
    try {
      note = readJson(path.join(directory, entry));
    } catch {
      continue;
    }
    const present = typeof note.staging_directory === "string" && fs.existsSync(note.staging_directory);
    // `!== false` on purpose: a pid this engine cannot read counts as possibly
    // alive, so an unreadable note is reported rather than quietly discarded.
    const alive = note.host === os.hostname() && processIsAlive(note.pid) !== false;
    // The note is a snapshot taken when the staging opened; the marker inside it
    // is what the operation actually reached. Reporting the snapshot would tell
    // the user a phase the operation left behind long ago.
    /*
     * Where the marker actually is, which is not always the staging directory.
     *
     * Past the rename there is no staging directory any more: the marker is
     * inside the *promoted* destination, which is what makes that promotion
     * recognisable. Reading only the staging meant `recover` reported "the
     * staging directory is no longer there, so the operation left nothing
     * behind" — and then `--apply` removed the marker it had just said did not
     * exist, and reported a phase (`OPENED`) the operation had left long before.
     * A fourth independent review read the two outputs side by side.
     */
    const promotedMarker = typeof note.destination === "string" ? readStagingMarker(String(note.destination)) : null;
    const live = present ? readStagingMarker(String(note.staging_directory)) : promotedMarker;
    found.push({
      note: live ? { ...note, ...live, staging_directory: note.staging_directory } : note,
      present,
      alive,
      leftover: !present && promotedMarker !== null,
    } as any);
  }
  return found;
}

function openStaging(
  staging: string,
  marker: Omit<StagingMarker, "format" | "phase" | "pid" | "host" | "created_at" | "updated_at" | "expected_files" | "expected_manifest_sha256">,
  projectRoot: string | null = null,
): void {
  faultPoint("staging-before-open");
  fs.mkdirSync(staging, { recursive: true });
  const at = now();
  writeTransientJson(stagingMarkerPath(staging), {
    format: "beave-staging-v1",
    ...marker,
    phase: "OPENED" satisfies StagingPhase,
    pid: process.pid,
    host: os.hostname(),
    created_at: at,
    updated_at: at,
    expected_files: null,
    expected_manifest_sha256: null,
  } satisfies StagingMarker);
  // The note goes in before the fault point, not after the function returns: a
  // crash between the two left a staging directory the project had no record of,
  // which only an export to the very same destination would ever clear.
  noteStagingInProject(projectRoot, staging, readStagingMarker(staging)!);
  faultPoint("staging-after-marker");
}

function stagingPhase(staging: string, phase: StagingPhase, extra: Partial<StagingMarker> = {}): void {
  const marker = readJson(stagingMarkerPath(staging)) as StagingMarker;
  writeTransientJson(stagingMarkerPath(staging), { ...marker, ...extra, phase, updated_at: now() });
}

function readStagingMarker(staging: string): StagingMarker | null {
  const file = stagingMarkerPath(staging);
  if (!fs.existsSync(file)) return null;
  try {
    const value = readJson(file) as StagingMarker;
    return value?.format === "beave-staging-v1" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Beave's own abandoned staging directories beside a destination.
 *
 * Identified by the marker and by nothing else -- not by the name, not by the
 * extension. A directory without one is left exactly where it is and is not even
 * reported as Beave's, because it is not.
 */
function abandonedStagings(parent: string, destination: string | null): Array<{ directory: string; marker: StagingMarker }> {
  if (!fs.existsSync(parent)) return [];
  const found: Array<{ directory: string; marker: StagingMarker }> = [];
  // The destination itself is scanned too: a marker that survived the rename is
  // sitting inside the finished folder, and that is the case below.
  for (const entry of fs.readdirSync(parent)) {
    const candidate = path.join(parent, entry);
    let isDirectory = false;
    try {
      isDirectory = fs.statSync(candidate).isDirectory();
    } catch {
      continue;
    }
    if (!isDirectory) continue;
    const marker = readStagingMarker(candidate);
    if (!marker) continue;
    if (destination !== null && path.resolve(marker.destination) !== path.resolve(destination)) continue;
    found.push({ directory: candidate, marker });
  }
  return found;
}

/**
 * Resolve a staging directory left by a process that is gone.
 *
 * The rule is the one the rename already implies: the destination appears whole
 * or not at all, so an interrupted staging is *discarded*, never promoted. There
 * is no half-finished package worth keeping -- the operation is cheap to repeat
 * and the inputs are all still there. A staging whose process is still alive is
 * left alone.
 */
function resolveAbandonedStagings(parent: string, destination: string | null, receiptRoot: string | null): string[] {
  const notes: string[] = [];
  for (const { directory, marker } of abandonedStagings(parent, destination)) {
    /*
     * The marker is inside the directory it was going to become. The rename
     * happened, so the operation finished and only the marker is left. The
     * marker goes; the directory, which is now somebody's package or somebody's
     * project, is not touched.
     */
    if (path.resolve(directory) === path.resolve(marker.destination)) {
      fs.rmSync(stagingMarkerPath(directory), { force: true });
      notes.push(`cleared the staging marker left inside the completed ${marker.kind} at ${path.basename(directory)}`);
      continue;
    }
    if (marker.host === os.hostname() && marker.pid !== process.pid && processIsAlive(marker.pid) !== false) {
      throw new BeaveError(
        `Another Beave ${marker.kind} is running against ${marker.destination}: process ${marker.pid} on ${marker.host}, since ${marker.created_at}. ` +
          `Nothing was changed. Wait for it to finish, or stop that process.`,
      );
    }
    if (marker.host !== os.hostname()) {
      throw new BeaveError(
        `An unfinished Beave ${marker.kind} from another machine is beside this destination: ${path.basename(directory)}, from ${marker.host}, since ${marker.created_at}. ` +
          `Beave cannot tell whether that machine is still working, so it will not remove it. Look at it, then delete it by hand and run this command again. Nothing was changed.`,
      );
    }
    // This host, and the process is gone. The directory is Beave's own, it is
    // incomplete by definition, and discarding it loses nothing that is not
    // still in the project it came from.
    fs.rmSync(directory, { recursive: true, force: true });
    notes.push(`discarded an unfinished ${marker.kind} staging left by process ${marker.pid} at phase ${marker.phase} (${marker.created_at})`);
    if (receiptRoot) {
      writeJson(path.join(stateRoot(receiptRoot), "recovery", `${marker.staging_id}.staging-discarded.json`), {
        ...marker,
        recovered_at: now(),
        outcome: "DISCARDED",
        reason: "the process that opened it is no longer running on this host, and an unfinished package is never promoted",
      });
    }
  }
  return notes;
}

function projectExport(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const state = validateRoot(root, true);
  const destination = path.resolve(required(flags, "output-dir"));
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true });
  /*
   * Recovery first, refusal second.
   *
   * "The destination already exists" was checked before any of this, so a
   * package left carrying a staging marker by a crash in the rename window could
   * only be cleaned by exporting somewhere *else* — the one command that
   * recognises the marker refused before reaching it.
   */
  for (const note of clearOwnAbandonedStagings(root)) console.log(`Recovered: ${note}.`);
  for (const note of resolveAbandonedStagings(parent, destination, root)) console.log(`Recovered: ${note}.`);
  if (fs.existsSync(destination)) throw new BeaveError(`Refusing to overwrite existing project package: ${destination}`);
  const staging = path.join(parent, `.${path.basename(destination)}.${crypto.randomUUID()}.tmp`);
  const published = state.artifacts.filter((item) => item.status === "PUBLISHED" && item.base_path.toLowerCase().endsWith(".md"));
  // Blocker 6. This refusal named the rule and not the way out — the only engine
  // error that told the operator what was wrong without telling them what to do.
  // The gate is unchanged and nothing is published automatically: publishing a
  // document is a human decision, and an export command that made it would be a
  // worse defect than an unhelpful message.
  if (!published.length) {
    const drafts = state.artifacts.filter((item) => item.status !== "PUBLISHED" && item.base_path.toLowerCase().endsWith(".md"));
    const nonMarkdown = state.artifacts.filter((item) => item.status === "PUBLISHED" && !item.base_path.toLowerCase().endsWith(".md"));
    const lines = [
      `Nothing to hand off: the package must carry at least one PUBLISHED Markdown document, and this project has none.`,
      ``,
      `What is missing: a document whose status is PUBLISHED and whose base_path ends in .md. A recipient reads the folder, not your terminal, so a package of state without a document to act on is a package nobody can use.`,
      ``,
    ];
    if (drafts.length) {
      const candidate = drafts[0];
      lines.push(
        `What you have: ${drafts.length} Markdown document${drafts.length === 1 ? "" : "s"} still in DRAFT — ${drafts.slice(0, 5).map((item) => `${item.id} (${item.base_path})`).join(", ")}${drafts.length > 5 ? ", …" : ""}.`,
        ``,
        `The safe action, for a document you have decided is ready:`,
        `  beave doc-finalize --project-root . --id ${candidate.id} --owner <owner> --operation-id <id>`,
        ``,
        `That is the step that publishes ${candidate.base_path}; this command will not take it for you. Then re-run project-export.`,
      );
    } else if (nonMarkdown.length) {
      lines.push(
        `What you have: ${nonMarkdown.length} PUBLISHED document${nonMarkdown.length === 1 ? "" : "s"}, none of them Markdown — ${nonMarkdown.slice(0, 5).map((item) => `${item.id} (${item.base_path})`).join(", ")}${nonMarkdown.length > 5 ? ", …" : ""}.`,
        ``,
        `The safe action: record the handoff document as Markdown and publish it.`,
        `  beave doc-diff --project-root . --id ART-HANDOFF --base-path docs/HANDOFF.md --content-file <file> --owner <owner>`,
        `  beave doc-save --project-root . --id ART-HANDOFF --base-path docs/HANDOFF.md --content-file <file> --owner <owner> --confirm-token <token from doc-diff> --operation-id <id>`,
        `  beave doc-finalize --project-root . --id ART-HANDOFF --owner <owner> --operation-id <id>`,
        ``,
        `Then re-run project-export.`,
      );
    } else {
      lines.push(
        `What you have: no documents at all in the ledger.`,
        ``,
        `The safe action: write the handoff document, record it, then publish it.`,
        `  beave doc-diff --project-root . --id ART-HANDOFF --base-path docs/HANDOFF.md --content-file <file> --owner <owner>`,
        `  beave doc-save --project-root . --id ART-HANDOFF --base-path docs/HANDOFF.md --content-file <file> --owner <owner> --confirm-token <token from doc-diff> --operation-id <id>`,
        `  beave doc-finalize --project-root . --id ART-HANDOFF --owner <owner> --operation-id <id>`,
        ``,
        `Then re-run project-export.`,
      );
    }
    lines.push(``, `Nothing was written and no document was published.`);
    throw new BeaveError(lines.join("\n"));
  }
  const sources = new Map<string, string>();
  /*
   * The two state files are *built* for the package, not copied into it.
   *
   * `project.root` is an absolute path on the exporting machine, and it was in
   * two places: `state.json`, and the first event's patch, which is where the
   * whole state was written when the project began. A handoff therefore carried
   * the user's name, the drive letter and the folder layout of whoever made it —
   * to anybody they gave it to, for ever, in a file the recipient has no reason
   * to read. It is also useless there: the import rewrites it on arrival.
   *
   * Rewriting the recorded events was never an option — this system does not
   * edit history. So the package gets a *portable replay origin* instead: one
   * event, `PROJECT_PACKAGE_EXPORTED`, whose patch is the whole state with the
   * root emptied, and which records the digest, the length and the last event id
   * of the history it was made from. The recipient can replay everything from
   * the moment the package was made. What came before is attested by that digest
   * and is not claimed to be reproduced, because it is not there.
   *
   * The source project is not touched: nothing below writes into `root`.
   */
  const generated = new Map<string, string>();
  for (const artifact of state.artifacts) {
    if (artifact.working_path) sources.set(`files/${artifact.working_path.replaceAll("\\", "/")}`, resolveRecorded(root, artifact.working_path));
    if (artifact.status === "PUBLISHED") sources.set(`files/${artifact.base_path.replaceAll("\\", "/")}`, resolveRecorded(root, artifact.base_path));
  }
  for (const evidence of state.evidence) sources.set(`files/${evidence.path.replaceAll("\\", "/")}`, resolveRecorded(root, evidence.path));
  // Everything else the ledger points at, for the same reason: a delivered folder
  // whose state references a file the package left behind fails `validate` in the
  // recipient's hands, and for a gate it failed without even saying which file.
  for (const override of state.human_overrides ?? []) {
    const relative = (override as any).source;
    if (typeof relative === "string" && safeArtifactPath(relative) && existingFileInside(root, relative)) {
      sources.set(`files/${canonicalRelative(relative)}`, resolveRecorded(root, relative));
    }
    // Blocker 3. The reconciliation evidence is the account of what was done about
    // a human override, and the ledger carries its SHA-256. The package carried the
    // digest and not the document: `validate`, `project-verify` and `status` all
    // exited 0 on a folder whose ledger pointed at a file that was not in it.
    const reconciliation = (override as any).reconciliation_evidence;
    if (typeof reconciliation === "string" && reconciliation.trim()) {
      if (!safeArtifactPath(reconciliation)) {
        throw new BeaveError(
          `Override ${(override as any).id} records reconciliation evidence at ${reconciliation}, which cannot travel in the package: it is absolute, climbs out of the project with "..", or sits inside the reserved .beave directory.\n` +
          `A package must carry every document its ledger points at. Move the file inside the project, outside .beave, and record the reconciliation against it. Nothing was written.`
        );
      }
      if (!existingFileInside(root, reconciliation)) {
        throw new BeaveError(
          `Override ${(override as any).id} records reconciliation evidence at ${reconciliation}, and that file is missing from the project.\n` +
          `Restore it, then re-run project-export. A package that carried the digest without the document is exactly the defect this refusal exists for. Nothing was written.`
        );
      }
      sources.set(`files/${canonicalRelative(reconciliation)}`, resolveRecorded(root, reconciliation));
    }
  }
  for (const gate of state.gates ?? []) {
    const relative = (gate as any).evidence;
    if (typeof relative === "string" && safeArtifactPath(relative) && existingFileInside(root, relative)) {
      sources.set(`files/${relative.replaceAll("\\", "/")}`, resolveRecorded(root, relative));
    }
  }
  // `.beave/history/` is what makes `doc-restore` possible. Without it the
  // recipient inherits a ledger that lists revisions it cannot bring back, and
  // DOCOP-001's "restore selects a historical revision" is true only for whoever
  // exported. One flat directory of `<ART-ID>-vN.<ext>` files; nothing nested.
  const historyDir = path.join(stateRoot(root), "history");
  if (fs.existsSync(historyDir)) {
    for (const entry of fs.readdirSync(historyDir).sort()) {
      const candidate = path.join(historyDir, entry);
      if (!fs.statSync(candidate).isFile()) continue;
      sources.set(`history/${entry}`, candidate);
    }
  }
  // A deletion marker without its reason is a marker nobody can act on. The
  // recipient reads the folder, so the reason travels with it (L26).
  const reasonsDir = path.join(stateRoot(root), "deletion-reasons");
  if (fs.existsSync(reasonsDir)) {
    for (const entry of fs.readdirSync(reasonsDir).sort()) {
      const candidate = path.join(reasonsDir, entry);
      if (!fs.statSync(candidate).isFile()) continue;
      sources.set(`deletion-reasons/${entry}`, candidate);
    }
  }
  for (const module of state.modules) {
    if (module.evidence && safeProjectRelative(module.evidence)) {
      const source = resolveRecorded(root, module.evidence);
      if (fs.existsSync(source) && fs.statSync(source).isFile()) sources.set(`files/${module.evidence.replaceAll("\\", "/")}`, source);
    }
  }
  /*
   * Built here, before anything is written, so a failure leaves nothing behind.
   * `last_event_id` moves to the origin as well: a state that names an event its
   * own history does not contain is a state `validate` would refuse.
   */
  const sourceHistory = fs.readFileSync(path.join(stateRoot(root), "events.jsonl"), "utf8");
  const sourceLineCount = sourceHistory.split(/\r?\n/).filter(Boolean).length;
  const portableState: any = structuredClone(state);
  // Not the empty string: the schema requires a non-empty root, and a reader who
  // meets this value should be unable to mistake it for a path. The import
  // replaces it with the destination before anything validates it.
  portableState.project.root = "<packaged>";
  const originEvent: any = {
    event_id: crypto.randomUUID(),
    type: "PROJECT_PACKAGE_EXPORTED",
    state_revision: portableState.revision,
    at: now(),
    replay_origin: true,
    format: EVENT_FORMAT,
    source_state_revision: state.revision,
    source_event_count: sourceLineCount,
    source_history_sha256: sha256(sourceHistory),
    source_last_event_id: state.last_event_id ?? null,
  };
  portableState.last_event_id = originEvent.event_id;
  Object.assign(originEvent, {
    previous_revision: Number(portableState.revision) - 1,
    previous_state_sha256: null,
    previous_event_sha256: null,
    state_sha256: digestOf(portableState),
    state_patch: [{ op: "set", path: [], value: structuredClone(portableState) }],
  });
  originEvent.payload_sha256 = digestOf({ ...originEvent, payload_sha256: undefined });
  generated.set("state/state.json", `${JSON.stringify(portableState, null, 2)}${NL}`);
  generated.set("state/events.jsonl", `${JSON.stringify(originEvent)}${NL}`);

  const exportStagingId = crypto.randomUUID();
  openStaging(staging, {
    kind: "export",
    staging_id: exportStagingId,
    operation_id: pendingOperation?.id ?? null,
    source: root,
    destination,
  }, root);
  try {
    stagingPhase(staging, "COPYING");
    let copied = 0;
    const entries: [string, string | null][] = [...[...generated.keys()].map((relative) => [relative, null] as [string, null]), ...sources];
    const files = entries.sort(([a], [b]) => a.localeCompare(b)).map(([relative, source]) => {
      if (source === null) {
        const body = generated.get(relative)!;
        const target = path.join(staging, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, body);
        copied += 1;
        if (relative === "state/state.json") faultPoint("staging-after-state");
        if (relative === "state/events.jsonl") faultPoint("staging-after-events");
        return { path: relative, sha256: sha256(body), bytes: Buffer.byteLength(body) };
      }
      const sourceRelative = path.relative(root, source);
      const confined = existingFileInside(root, sourceRelative);
      if (!safeProjectRelative(relative) || !confined) throw new BeaveError(`Cannot package missing or unsafe file: ${relative}`);
      // A history entry is one flat filename under `history/`. Anything with a
      // separator in it is not something this format produces.
      if (relative.startsWith("history/") && relative.slice("history/".length).includes("/")) {
        throw new BeaveError(`Cannot package a nested history entry: ${relative}`);
      }
      copyFileCreatingParents(confined, path.join(staging, relative));
      copied += 1;
      if (copied === 1) faultPoint("staging-during-copy");
      if (relative === "state/state.json") faultPoint("staging-after-state");
      if (relative === "state/events.jsonl") faultPoint("staging-after-events");
      return { path: relative, sha256: sha256(fs.readFileSync(confined)), bytes: fs.statSync(confined).size };
    });
    const entry = `# ${state.project.name}\n\nThis folder is a verified Beave project handoff.\n\n1. Read \`state/state.json\` and \`state/events.jsonl\`.\n2. Read the approved project documents under \`files/\`.\n3. Verify \`manifest.json\` before execution.\n4. Resume from the exact next action recorded in state.\n\nThe project's own entry point, wherever the state names it, takes precedence over this file: this one describes the package, not the project.\n\n\`history/\` holds the recorded document revisions as files. \`beave project-import\` puts them back under \`.beave/history/\`, so \`beave doc-restore\` brings an earlier revision back exactly as it did for whoever exported. \`beave doc-history\` will be **empty** for anything that happened before this package was made: it reads the event log, and the log this package carries begins at the moment of the export (see below). The revisions themselves are here; the account of who wrote each one, when, and from which sources stayed with the exporting project.\n\n## What this package's history is\n\n\`state/events.jsonl\` holds **one** event: the point at which this package was made, carrying the whole project state. Everything the project decided, asked, answered, recorded and published is in \`state/state.json\` and is complete; what is not here is the exporting project's own event-by-event log, because it recorded that project's absolute path on the machine that made it. \`manifest.json\` records the digest of that history, its length and its last event id, so the two can be matched later without either being disclosed.\n`;
    atomicWrite(path.join(staging, "PROJECT_ENTRY.md"), entry);
    files.push({ path: "PROJECT_ENTRY.md", sha256: sha256(entry), bytes: Buffer.byteLength(entry) });
    files.sort((a, b) => a.path.localeCompare(b.path));
    const manifest = {
      format: "beave-project-package-v1",
      created_at: now(),
      beave_version: VERSION,
      schema_version: state.schema_version,
      project_name: state.project.name,
      state_revision: state.revision,
      entrypoint: "PROJECT_ENTRY.md",
      // Declared, because a transformation nobody is told about is indistinguishable
      // from a package somebody edited. The digest is of the history this package
      // was made from: it proves which history, and discloses nothing from it.
      history_transform: {
        kind: "portable-replay-origin",
        reason: "The exporting machine's absolute project path is not carried into a handoff.",
        origin_event_id: originEvent.event_id,
        origin_event_type: originEvent.type,
        source_state_revision: state.revision,
        source_event_count: sourceLineCount,
        source_history_sha256: originEvent.source_history_sha256,
        source_last_event_id: originEvent.source_last_event_id,
        replayable_from: "the origin event in state/events.jsonl; the history before it stays with the exporting project and is attested by source_history_sha256, not reproduced here",
      },
      files,
    };
    writeJson(path.join(staging, "manifest.json"), manifest);
    stagingPhase(staging, "MANIFEST", { expected_files: files.length, expected_manifest_sha256: sha256(fs.readFileSync(path.join(staging, "manifest.json"))) });
    faultPoint("staging-after-manifest");
    packageManifest(staging);
    stagingPhase(staging, "VERIFIED");
    faultPoint("staging-after-verify");
    faultPoint("staging-before-rename");
    fs.renameSync(staging, destination);
    faultPoint("staging-after-rename");
    // Removed from the promoted directory, not from the staging: a marker that
    // disappears first can leave a directory nothing recognises. See
    // `resolveAbandonedStagings`.
    fs.rmSync(stagingMarkerPath(destination), { force: true });
  } catch (error) {
    if (fs.existsSync(staging) && path.dirname(staging) === parent) fs.rmSync(staging, { recursive: true, force: true });
    forgetStagingNote(root, exportStagingId);
    throw error;
  }
  faultPoint("staging-before-cleanup");
  forgetStagingNote(root, exportStagingId);
  console.log(`Exported verified project package to ${destination}`);
}

/**
 * Every file actually in the package, relative and with `/` separators.
 *
 * `packageManifest` walks the *manifest*, so it has always caught a missing or
 * changed file and never an extra one — while the contract said it refuses
 * "missing, duplicate, changed or unexpected content". The second review put a
 * rogue file in three different directories and got `Verified` three times.
 */
function packageFilesOnDisk(packageRoot: string): string[] {
  const found: string[] = [];
  const walk = (directory: string, prefix: string) => {
    for (const entry of fs.readdirSync(directory).sort()) {
      const candidate = path.join(directory, entry);
      const relative = prefix ? `${prefix}/${entry}` : entry;
      if (fs.statSync(candidate).isDirectory()) walk(candidate, relative);
      else found.push(relative);
    }
  };
  walk(packageRoot, "");
  return found;
}

/**
 * A staging directory is not a package, and says so in a file.
 *
 * `.beave-staging.json` exists precisely to mark a directory that has not been
 * promoted. Neither `project-verify` nor `project-import` looked at it, so the
 * rule "an interrupted staging is discarded, never promoted" was one command
 * away from being false.
 */
function refuseUnpromotedStaging(directory: string, verb: string): void {
  const marker = readStagingMarker(directory);
  if (!marker) return;
  if (path.resolve(marker.destination) === path.resolve(directory)) return;
  throw new BeaveError(
    `${path.basename(directory)} is a Beave staging directory, not a package: it carries ${STAGING_MARKER}, which says the ${marker.kind} that was building it never finished (phase ${marker.phase}, started ${marker.created_at}).\n` +
      `Beave will not ${verb} an unfinished package. Re-run the export that was interrupted; nothing was changed.`,
  );
}

/**
 * A package holds what its manifest says it holds, and nothing else.
 *
 * The check lived only in `project-verify`, which is the command a careful
 * recipient runs and not the command that acts. A third independent review put a
 * rogue file in seven positions and got a refusal seven times from
 * `project-verify` and `Imported and resumed …` seven times from
 * `project-import`, followed by `Beave state is valid.` — the trust boundary
 * checked by the advisory command and not by the one that crosses it.
 *
 * The staging marker is the single file allowed to be here undeclared, and only
 * when it names *this* directory as its destination: that is what a crash
 * between the rename and the marker's removal leaves behind. The other case is
 * already refused by `refuseUnpromotedStaging`.
 */
function refuseUndeclaredPackageFiles(packageRoot: string, manifest: any, leftoverMarker: boolean): void {
  const declared = new Set((manifest.files ?? []).map((item: any) => String(item.path)));
  const unexpected = packageFilesOnDisk(packageRoot).filter(
    (relative) => relative !== "manifest.json" && !declared.has(relative) && !(leftoverMarker && relative === STAGING_MARKER),
  );
  if (!unexpected.length) return;
  throw new BeaveError(
    `The package holds ${unexpected.length} file${unexpected.length === 1 ? "" : "s"} its manifest does not declare: ${unexpected.slice(0, 8).join(", ")}${unexpected.length > 8 ? ", …" : ""}.\n` +
      `A handoff is what the manifest says it is. Something was added after the export, or the export was not made by this engine. Nothing was changed.`,
  );
}

/**
 * The attestation is compared with the thing it attests, by both commands.
 *
 * `history_transform` is what a recipient matches a package against its source
 * by, and nothing checked it against the origin event three files away: a review
 * set the digest to sixty-four zeroes and the count to 9999 and got `Verified`.
 * The event's own bytes are covered by the manifest's file list, so the two can
 * be compared.
 *
 * It lived in `project-verify` alone for one round, which the same review caught
 * on the re-check — and named the reason it matters more here than anywhere:
 * `project-import` writes `package_manifest_sha256` into the destination's event
 * log, so importing a falsified package *notarises* the false attestation in the
 * one place it will be read back later. The check belongs to the command that
 * acts, not only to the one that reports.
 */
function refuseContradictoryAttestation(packageRoot: string, manifest: any): void {
  const declared = manifest?.history_transform;
  const eventsPath = path.join(packageRoot, "state", "events.jsonl");
  const lines = fs.existsSync(eventsPath)
    ? fs.readFileSync(eventsPath, "utf8").split(/\r?\n/).filter(Boolean)
    : [];

  /*
   * The ledger's own bytes, checked here and not two commands later.
   *
   * Every event records `payload_sha256`, a digest of itself, and this engine
   * has verified it since `ALN-011` — but only on replay. So a package whose
   * origin event had been edited, with the manifest's digests repaired to
   * match, was reported `Verified`, imported with exit 0, and produced a project
   * that failed `validate` on the very next command: "the event was edited after
   * it was written". A gate that passes something the engine itself calls
   * tampered is not a gate.
   */
  for (const [index, line] of lines.entries()) {
    let event: any = null;
    try { event = JSON.parse(line); } catch { event = null; }
    if (!event) {
      throw new BeaveError(`Line ${index + 1} of the package's state/events.jsonl is not JSON. A package whose ledger cannot be read is not a package; nothing was changed.`);
    }
    if (typeof event.payload_sha256 !== "string") continue;
    const recomputed = digestOf({ ...event, payload_sha256: undefined });
    if (recomputed !== event.payload_sha256) {
      throw new BeaveError(
        `Line ${index + 1} (${event.type ?? "an event"}) of the package's ledger does not match the digest it records of itself. The event was edited after it was written. Nothing was changed.`,
      );
    }
  }

  const first = lines[0] ?? null;
  let origin: any = null;
  try { origin = first ? JSON.parse(first) : null; } catch { origin = null; }

  /*
   * An absent attestation is not a passed check.
   *
   * `if (!declared) return` meant an attacker did not have to falsify the
   * digest, the count or the last event id: deleting the block — or setting it
   * to `null`, `false`, `""` or `0` — was enough, and both commands answered
   * exit 0. The early return existed for packages made before the portable
   * origin, and the version gate for that is in the package itself: a package
   * whose ledger *begins* with a `PROJECT_PACKAGE_EXPORTED` event was made by
   * this format and must declare what it transformed. One made by an older
   * engine begins with the project's own history and declares nothing, which is
   * correct for it.
   */
  if (!declared) {
    if (origin?.type === "PROJECT_PACKAGE_EXPORTED") {
      throw new BeaveError(
        `This package's ledger begins with a ${origin.type} event, so it was made by an engine that replaces the exporting project's history with a portable origin — and its manifest declares no \`history_transform\` to say what it replaced.\n` +
          `That declaration is the only thing a recipient can match this package against the history it came from, and a package that drops it cannot be told from one that never had it. Nothing was changed.`,
      );
    }
    return;
  }

  if (!origin || origin.type !== declared.origin_event_type || origin.event_id !== declared.origin_event_id) {
    throw new BeaveError(
      `The manifest declares a history transformation whose origin event is not the first event in state/events.jsonl. The package contradicts itself; nothing was changed.`,
    );
  }
  for (const field of ["source_history_sha256", "source_event_count", "source_last_event_id", "source_state_revision"]) {
    if (String(origin[field] ?? "") !== String(declared[field] ?? "")) {
      throw new BeaveError(
        `The manifest and the package's own origin event disagree about \`${field}\`: the manifest says ${JSON.stringify(declared[field])} and the event says ${JSON.stringify(origin[field])}.\n` +
          `That field is how this package is matched against the history it was made from, so the disagreement matters. Nothing was changed.`,
      );
    }
  }
}

function projectVerify(flags: Flags): void {
  const packageRoot = resolveProject(required(flags, "package-dir"));
  refuseUnpromotedStaging(packageRoot, "verify");
  const manifest = packageManifest(packageRoot);
  /*
   * A package still carrying its staging marker is refused, not excused.
   *
   * This used to print "It is harmless and is not part of the package" and exit
   * 0. The marker is not harmless: it records the exporting machine's absolute
   * paths, its hostname and the PID of the process that made it — the exact
   * disclosure `ALN-014` exists to prevent, in a file the manifest does not
   * declare, waved through by the one command whose job is to check a package
   * before it is handed to somebody. A fourth independent review planted a
   * marker naming an invented victim's folder and got `Verified`.
   *
   * The way out costs nothing: the export left the package complete, and any
   * command on the exporting project clears the marker.
   */
  if (readStagingMarker(packageRoot) !== null) {
    const marker = readStagingMarker(packageRoot)!;
    throw new BeaveError(
      `This package carries ${STAGING_MARKER}, left by an export that was interrupted after the package was complete (phase ${marker.phase}, started ${marker.created_at}).\n` +
        `It is not a file the manifest declares and it records the exporting machine — its paths, its hostname, the process that made it — so this package must not be handed to anybody as it stands.\n` +
        `On the machine that exported it: \`beave recover --project-root <the exporting project> --apply\`, or simply run the export again. Either removes it. Nothing was changed here.`,
    );
  }
  refuseUndeclaredPackageFiles(packageRoot, manifest, false);
  refuseContradictoryAttestation(packageRoot, manifest);
  console.log(`Verified project package ${manifest.project_name} at state revision ${manifest.state_revision} (${manifest.files.length} files).`);
}

function projectImport(flags: Flags): void {
  const packageRoot = resolveProject(required(flags, "package-dir"));
  refuseUnpromotedStaging(packageRoot, "import");
  const manifest = packageManifest(packageRoot);
  // The checks `project-verify` makes, made by the command that acts on the
  // answer rather than only by the one that reports it.
  if (readStagingMarker(packageRoot) !== null) {
    throw new BeaveError(
      `This package carries ${STAGING_MARKER} from an interrupted export, which records the exporting machine's paths, hostname and process id.\n` +
        `Have it cleared where it was made — \`beave recover --project-root <the exporting project> --apply\`, or a re-run of the export — and import the package after that. Nothing was written.`,
    );
  }
  refuseUndeclaredPackageFiles(packageRoot, manifest, false);
  refuseContradictoryAttestation(packageRoot, manifest);
  const root = path.resolve(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  /*
   * The staging resolution runs before the idempotent shortcut, not after.
   *
   * A crash between the rename and the marker's removal leaves a finished
   * project carrying one extra file; the natural retry — same operation id — used
   * to answer `Idempotent retry` and return, so the only command that recognises
   * that marker never reached the code that removes it. The second review found
   * it after the same reasoning had already been applied one line further down.
   */
  for (const note of resolveAbandonedStagings(path.dirname(root), root, null)) console.log(`Recovered: ${note}.`);
  if (fs.existsSync(path.join(root, ".beave", "events.jsonl")) && checkIdempotency(root, key)) return console.log(`Idempotent retry: project import already applied.`);
  const parent = path.dirname(root);
  fs.mkdirSync(parent, { recursive: true });
  if (fs.existsSync(root) && (!fs.statSync(root).isDirectory() || fs.readdirSync(root).length)) throw new BeaveError(`Import destination must be a new or empty directory: ${root}`);
  const staging = path.join(parent, `.${path.basename(root)}.${crypto.randomUUID()}.tmp`);
  const destinationExisted = fs.existsSync(root);
  let projectName = manifest.project_name;
  // The staging directory has to exist before the first entry is placed, not as a
  // side effect of whichever entry happens to sort first. It used to be created
  // by `copyFileCreatingParents` on the `files/` branch, which worked only while
  // `files/` sorted ahead of everything else: adding `deletion-reasons/` put a `d`
  // in front of that `f` and every import of a package carrying a deletion reason
  // failed on `realpath` of a directory nobody had made yet.
  openStaging(staging, {
    kind: "import",
    staging_id: crypto.randomUUID(),
    operation_id: pendingOperation?.id ?? null,
    source: packageRoot,
    destination: root,
  });
  try {
    stagingPhase(staging, "COPYING");
    let copiedIn = 0;
    for (const item of manifest.files) {
      if (item.path.startsWith("files/")) copyFileCreatingParents(path.join(packageRoot, item.path), path.join(staging, item.path.slice("files/".length)));
      else if (item.path === "state/state.json") copyFileCreatingParents(path.join(packageRoot, item.path), path.join(stateRoot(staging), "state.json"));
      else if (item.path === "state/events.jsonl") copyFileCreatingParents(path.join(packageRoot, item.path), path.join(stateRoot(staging), "events.jsonl"));
      else if (item.path.startsWith("history/")) copyFileCreatingParents(path.join(packageRoot, item.path), path.join(stateRoot(staging), "history", item.path.slice("history/".length)));
      else if (item.path.startsWith("deletion-reasons/")) copyFileCreatingParents(path.join(packageRoot, item.path), path.join(stateRoot(staging), "deletion-reasons", item.path.slice("deletion-reasons/".length)));
      copiedIn += 1;
      if (copiedIn === 1) faultPoint("staging-during-copy");
      if (item.path === "state/state.json") faultPoint("staging-after-state");
      if (item.path === "state/events.jsonl") faultPoint("staging-after-events");
    }
    faultPoint("staging-after-manifest");
    const stagedState = readJson(path.join(stateRoot(staging), "state.json")) as State;
    stagedState.project.root = staging;
    const stagedErrors = stateErrors(staging, stagedState);
    if (!stagedErrors.length) stagedErrors.push(...documentIntegrityErrors(staging, stagedState));
    if (stagedErrors.length) throw new BeaveError(`Imported package state failed validation:\n- ${stagedErrors.join("\n- ")}`);

    const timestamp = now();
    const eventId = crypto.randomUUID();
    stagedState.revision += 1;
    stagedState.last_event_id = eventId;
    stagedState.updated_at = timestamp;
    /*
     * The import is a replay origin, and it has to be one.
     *
     * The package carries the exporter's events verbatim, and the destination
     * rewrites `project.root` — a change to the state that no event in that file
     * describes, because it happens to the copy rather than to the project. So a
     * replay of the imported history from the exporter's own beginning would
     * rebuild a state pointing at the exporter's folder. Recording the import as
     * an origin says the true thing: everything from the moment this folder came
     * into existence is reproducible, and the history that arrived with it is
     * kept, readable, and outside that proof.
     */
    const event: any = { event_id: eventId, type: "PROJECT_PACKAGE_IMPORTED", state_revision: stagedState.revision, at: timestamp, source_state_revision: manifest.state_revision, package_manifest_sha256: sha256(fs.readFileSync(path.join(packageRoot, "manifest.json"))), idempotency_key: key, replay_origin: true, operation_id: pendingOperation!.id, operation_payload_hash: pendingOperation!.payloadHash, operation_payload_version: pendingOperation!.payloadVersion };

    const validationState = structuredClone(stagedState);
    validationState.project.root = staging;
    const finalErrors = stateErrors(staging, validationState, event);
    if (!finalErrors.length) finalErrors.push(...documentIntegrityErrors(staging, validationState));
    if (finalErrors.length) throw new BeaveError(`Final imported project failed validation:\n- ${finalErrors.join("\n- ")}`);

    stagingPhase(staging, "VERIFIED");
    faultPoint("staging-after-verify");
    stagedState.project.root = root;
    // The same fields `commitState` would attach, because the destination is not
    // a project yet and the promotion is a directory rename rather than a write
    // into a live one. The patch is the whole state, which is what an origin is.
    const stagedTail = lastEventLine(staging);
    Object.assign(event, {
      format: EVENT_FORMAT,
      previous_revision: Number(stagedState.revision) - 1,
      previous_state_sha256: null,
      state_sha256: digestOf(stagedState),
      state_patch: [{ op: "set", path: [], value: structuredClone(stagedState) }],
      previous_event_sha256: stagedTail ? sha256(stagedTail.line) : null,
    });
    event.payload_sha256 = digestOf({ ...event, payload_sha256: undefined });
    writeJson(path.join(stateRoot(staging), "state.json"), stagedState);
    appendEvent(staging, event);
    /*
     * The derived document is written into the staging, not into the promoted
     * folder.
     *
     * It used to be written after the rename, which left a window: a crash in it
     * produced a project whose state recorded a digest for a document that was
     * not there, and `validate` refused it. Writing it before the rename closes
     * the window by construction -- the directory that appears is complete.
     */
    if (Array.isArray(stagedState.interview_log)) writeInterviewView(staging, renderInterviewView(stagedState));
    stagingPhase(staging, "PROMOTING");
    faultPoint("staging-before-rename");
    if (destinationExisted) fs.rmdirSync(root);
    fs.renameSync(staging, root);
    faultPoint("staging-after-rename");
    fs.rmSync(stagingMarkerPath(root), { force: true });
    /*
     * The history document is regenerated here, not shipped in the package.
     *
     * It is derived: the ledger travels in `state/`, and a derived file in a
     * handoff would be a second copy to keep in step and to verify. Regenerating
     * it at the destination also repairs a package produced before this ledger
     * existed, which carries no such file and needs none.
     *
     * Before `validateRoot`, because that check now includes the document, and
     * the first import after this feature landed failed exactly here — the state
     * recorded a digest and the folder had no file to match it.
     */
    validateRoot(root, true);
    projectName = stagedState.project.name;
  } catch (error) {
    if (fs.existsSync(staging) && path.dirname(staging) === parent) fs.rmSync(staging, { recursive: true, force: true });
    if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
    if (destinationExisted) fs.mkdirSync(root, { recursive: true });
    throw error;
  }
  faultPoint("staging-before-cleanup");
  console.log(`Imported and resumed ${projectName} at ${root}`);
}

/**
 * Rewrite `\` to `/` in every persisted relative path, and report what changed.
 *
 * Returns one entry per substitution — the field, the sentence before, the
 * sentence after — so the caller can put all of it in the event. Nothing is
 * touched on disk and no digest is recomputed: the bytes a digest describes do
 * not depend on how the path to them is spelled.
 */
function normalizeRecordedSeparators(state: any): Array<{ field: string; before: string; after: string }> {
  const rewrites: Array<{ field: string; before: string; after: string }> = [];
  const rewrite = (holder: any, key: string, field: string) => {
    const before = holder?.[key];
    if (typeof before !== "string" || !before.includes("\\")) return;
    const after = canonicalRelative(before);
    holder[key] = after;
    rewrites.push({ field, before, after });
  };
  (state.modules ?? []).forEach((item: any) => rewrite(item, "evidence", `modules[${item?.id}].evidence`));
  (state.evidence ?? []).forEach((item: any) => rewrite(item, "path", `evidence[${item?.id}].path`));
  (state.artifacts ?? []).forEach((item: any) => {
    rewrite(item, "base_path", `artifacts[${item?.id}].base_path`);
    rewrite(item, "working_path", `artifacts[${item?.id}].working_path`);
  });
  (state.gates ?? []).forEach((item: any) => {
    rewrite(item, "evidence", `gates[${item?.name || item?.id}].evidence`);
    (item?.source_history ?? []).forEach((entry: any, index: number) => rewrite(entry, "path", `gates[${item?.name || item?.id}].source_history[${index}].path`));
  });
  (state.human_overrides ?? []).forEach((item: any) => {
    rewrite(item, "source", `human_overrides[${item?.id}].source`);
    rewrite(item, "reconciliation_evidence", `human_overrides[${item?.id}].reconciliation_evidence`);
    (item?.source_history ?? []).forEach((entry: any, index: number) => rewrite(entry, "path", `human_overrides[${item?.id}].source_history[${index}].path`));
  });
  return rewrites;
}

function migrate(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: migration already applied.`);
  const location = path.join(stateRoot(root), "state.json");
  const rawState = readJson(location);
  
  if (rawState.schema_version === SCHEMA_VERSION) {
    // Blocker 4. A state already on the current schema can still carry relative
    // paths spelled `docs\plan.md`, because that is what `path.relative` returned
    // on Windows before the rule existed. Every reader accepts both spellings, so
    // nothing is broken and nothing is rewritten behind anyone's back: this is the
    // explicit, governed normalisation, and it records every single substitution
    // in the event so the provenance of a historic record is not lost by making it
    // look as though it had been born clean.
    const rewrites = normalizeRecordedSeparators(rawState);
    /*
     * A project created before the interview ledger existed gets an empty one,
     * and a marker saying when recording began.
     *
     * Nothing is reconstructed. The marker is the whole point: without it, an
     * empty history reads as "no question was ever asked", which is false and is
     * exactly the inference the brief forbids. With it, Resume can say that the
     * project predates the ledger and that earlier interactions were not
     * recorded — a different statement, and the true one.
     */
    const needsLedger = !Array.isArray(rawState.interview_log);
    if (!rewrites.length && !needsLedger) return console.log(`State already uses schema version ${SCHEMA_VERSION}, every recorded relative path already uses "/", and the interview ledger is present.`);
    const revision = Number(rawState.revision || 0) + 1;
    const eventId = crypto.randomUUID();
    const at = now();
    if (needsLedger) {
      rawState.interview_log = [];
      rawState.interview_log_since = at;
      rawState.interview_view = null;
    }
    Object.assign(rawState, { revision, last_event_id: eventId, updated_at: at });
    const renderedView = needsLedger ? stampInterviewView(rawState) : null;
    const event = { event_id: eventId, type: needsLedger ? "INTERVIEW_LEDGER_OPENED" : "RECORDED_PATHS_NORMALIZED", state_revision: revision, at, idempotency_key: key, separator: "/", rewrites, interview_log_since: needsLedger ? at : undefined };
    const transaction = beginFileTransaction(root, event, renderedView === null ? [] : [path.join(root, QA_VIEW_RELATIVE)]);
    try {
      commitState(root, location, rawState, event, { views: renderedView !== null });
      if (renderedView !== null) writeInterviewView(root, renderedView);
      faultPoint("after-view");
      completeFileTransaction(transaction);
    } catch (error) {
      if (fs.existsSync(transaction)) rollbackFileTransaction(root, transaction);
      throw error;
    }
    if (renderedView !== null) {
      console.log(`Opened the interview ledger for this project. Nothing before ${at} was recorded, and nothing has been reconstructed: ${QA_VIEW_RELATIVE} says so.`);
    }
    if (!rewrites.length) return;
    console.log(`Normalized ${rewrites.length} recorded path${rewrites.length === 1 ? "" : "s"} to "/" as the separator.`);
    for (const rewrite of rewrites) console.log(`  ${rewrite.field}: ${rewrite.before} -> ${rewrite.after}`);
    console.log(`No digest was recomputed and no file was touched: only the spelling of the path changed. Every substitution is recorded verbatim in event ${eventId}.`);
    return;
  }

  if (rawState.schema_version !== 1 && rawState.schema_version !== 2) {
    throw new BeaveError(`No migration path from schema_version=${rawState.schema_version}`);
  }

  const fromSchema = rawState.schema_version;
  const legacy = rawState.interaction_mode;
  rawState.interaction_mode = ({ Batch: "Standard", "Brief-led": "Standard" } as any)[legacy] ?? legacy;
  if (!INTERACTION_MODES.has(rawState.interaction_mode)) throw new BeaveError(`Unknown legacy interaction mode: ${legacy}`);
  
  const revision = Number(rawState.revision || 0) + 1;
  const eventId = crypto.randomUUID();

  // V2 -> V3 array initialization
  if (rawState.schema_version <= 2) {
    rawState.decisions = rawState.decisions || [];
    rawState.requirements = rawState.requirements || [];
    rawState.artifacts = rawState.artifacts || [];
    rawState.tasks = rawState.tasks || [];
    rawState.dependencies = rawState.dependencies || [];
    rawState.gates = rawState.gates || [];
    rawState.risks_legacy = rawState.risks || [];
    rawState.evidence_legacy = rawState.evidence || [];
    
    // reset real v3 arrays for evidence and risks since types changed from string[] to object[]
    rawState.risks = [];
    rawState.evidence = [];
    
    rawState.agents = rawState.agents || [];
    rawState.operations = rawState.operations || [];
    rawState.checkpoints = rawState.checkpoints || [];

    // D5. The history gets an empty array so a migrated project has somewhere to
    // put its first forecast. `progress_forecast` is deliberately NOT created: an
    // empty or zeroed forecast would be a measurement nobody made, which is the
    // failure FR-024 names. A migrated project has never recorded one, and says so.
    rawState.forecast_history = rawState.forecast_history || [];
  }

  Object.assign(rawState, { schema_version: SCHEMA_VERSION, beave_version: VERSION, intake_strategy: legacy === "Brief-led" ? "Brief-led" : "Adaptive", human_overrides: rawState.human_overrides || [], needs_reconciliation: Boolean(rawState.needs_reconciliation), revision, last_event_id: eventId, updated_at: now() });
  // Blocker 4, on the schema path too: a v1/v2 ledger written on Windows carries
  // the same `\` spellings, and each substitution is recorded in the event.
  const rewrites = normalizeRecordedSeparators(rawState);
  const event = { event_id: eventId, type: "STATE_MIGRATED", state_revision: revision, at: rawState.updated_at, from_schema: fromSchema, to_schema: SCHEMA_VERSION, legacy_interaction_mode: legacy, idempotency_key: key, separator: "/", path_rewrites: rewrites };
  commitState(root, location, rawState, event);
  console.log(`Migrated Beave state to schema ${SCHEMA_VERSION}.`);
}

function historyLocation(root: string, artifact: Artifact, revision: number): string {
  return path.join(stateRoot(root), "history", `${artifact.id}-v${revision}${path.parse(artifact.base_path).ext}`);
}

// Every digest Beave has ever produced for this artifact: the hashes recorded in
// the ledger plus whatever is preserved under `.beave/history/`. Content matching
// one of them is a Beave publication and may be replaced; anything else is content
// Beave never wrote, and overwriting it is irreversible because `.beave/backups/`
// only ever holds state.json and events.jsonl, never document bytes.
function recordedDigests(root: string, artifactId: string): Set<string> {
  const digests = new Set<string>();
  const eventsFile = path.join(stateRoot(root), "events.jsonl");
  if (fs.existsSync(eventsFile)) {
    for (const line of fs.readFileSync(eventsFile, "utf8").split(/\r?\n/).filter(Boolean)) {
      let event: any;
      try { event = JSON.parse(line); } catch { continue; }
      if (event.artifact_id === artifactId && typeof event.hash === "string") digests.add(event.hash);
    }
  }
  const historyDir = path.join(stateRoot(root), "history");
  if (fs.existsSync(historyDir)) {
    for (const entry of fs.readdirSync(historyDir)) {
      if (!entry.startsWith(`${artifactId}-`)) continue;
      if (!/^(v\d+|external-)/.test(entry.slice(artifactId.length + 1))) continue;
      digests.add(sha256(fs.readFileSync(path.join(historyDir, entry), "utf8")));
    }
  }
  return digests;
}

// DOCOP-001, "Locks": external editors are not locked, so every write revalidates
// the filesystem hash. Any command that consumes the current working file must
// call this first, otherwise a manual edit is swallowed without a trace.
function assertNoExternalEdit(root: string, artifact: Artifact): void {
  if (!artifact.working_path) return;
  const current = resolveRecorded(root, artifact.working_path);
  if (!fs.existsSync(current)) return;
  if (sha256(fs.readFileSync(current, "utf8")) !== artifact.content_hash) {
    throw new BeaveError(`External edit detected on ${artifact.working_path}. Hashes do not match. Reconcile manually.`);
  }
}

// DOCOP-001, "History and restore" / "Finalization": restore does not delete
// intervening history and finalization keeps all internal history. Archiving the
// current revision therefore obeys two hard rules:
//   1. a PUBLISHED base file is COPIED, never moved. After doc-finalize
//      working_path === base_path, so moving it would silently unpublish the
//      document while state.json still reports PUBLISHED.
//   2. an existing history entry is never replaced by different bytes, so an
//      authentic revision can never be destroyed by drifted or tampered content.
function archiveCurrentRevision(root: string, artifact: Artifact): void {
  if (!artifact.working_path) return;
  const current = resolveRecorded(root, artifact.working_path);
  if (!fs.existsSync(current)) return;
  const target = historyLocation(root, artifact, artifact.revision);
  const publishedBase = artifact.working_path === artifact.base_path;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    if (sha256(fs.readFileSync(target)) !== sha256(fs.readFileSync(current))) {
      throw new BeaveError(`History for ${artifact.id} revision ${artifact.revision} already exists with different content at ${path.relative(root, target).replaceAll("\\", "/")}. Refusing to overwrite recorded history.`);
    }
    if (!publishedBase) fs.rmSync(current);
    return;
  }
  if (publishedBase) fs.copyFileSync(current, target);
  else fs.renameSync(current, target);
}

// The ledger already records the hash of every saved and restored revision, but
// nothing ever compared it with the bytes on disk: damage was provable and never
// proved. `beave validate` now performs that comparison.
function documentIntegrityErrors(root: string, state: State): string[] {
  const errors: string[] = [];
  if (!Array.isArray(state.artifacts) || !state.artifacts.length) return errors;
  const recorded = new Map<string, string>();
  const eventsFile = path.join(stateRoot(root), "events.jsonl");
  if (fs.existsSync(eventsFile)) {
    for (const line of fs.readFileSync(eventsFile, "utf8").split(/\r?\n/).filter(Boolean)) {
      let event: any;
      try { event = JSON.parse(line); } catch { continue; }
      if (!event.artifact_id || typeof event.hash !== "string") continue;
      const revision = event.type === "DOCUMENT_RESTORED" ? event.new_revision : event.revision;
      if (Number.isInteger(revision)) recorded.set(`${event.artifact_id}@${revision}`, event.hash);
    }
  }
  for (const artifact of state.artifacts) {
    for (const [reference, expected] of recorded) {
      const separator = reference.lastIndexOf("@");
      if (reference.slice(0, separator) !== artifact.id) continue;
      const revision = Number(reference.slice(separator + 1));
      const location = historyLocation(root, artifact, revision);
      if (!fs.existsSync(location)) continue;
      if (sha256(fs.readFileSync(location, "utf8")) !== expected) {
        errors.push(`Refusing to overwrite recorded history: history file for ${artifact.id} revision ${revision} does not match the hash recorded in the ledger`);
      }
    }
    if (artifact.working_path) {
      const current = resolveRecorded(root, artifact.working_path);
      if (!fs.existsSync(current)) errors.push(`working file ${artifact.working_path} for ${artifact.id} is missing`);
      else if (sha256(fs.readFileSync(current, "utf8")) !== artifact.content_hash) errors.push(`External edit detected: working file ${artifact.working_path} for ${artifact.id} was edited outside Beave`);
    }
    if (artifact.status === "PUBLISHED" && !fs.existsSync(resolveRecorded(root, artifact.base_path))) {
      errors.push(`${artifact.id} is recorded as PUBLISHED but ${artifact.base_path} does not exist`);
    }
  }
  return errors;
}

function diffLines(before: string, after: string): Array<{ kind: string; text: string }> {
  const lines = (value: string) => {
    if (!value) return [] as string[];
    const result = value.split(/\r?\n/);
    if (result.at(-1) === "") result.pop();
    return result;
  };
  const oldLines = lines(before);
  const newLines = lines(after);
  if (oldLines.length > 4000 || newLines.length > 4000) return [{ kind: "info", text: `${oldLines.length} lines replaced by ${newLines.length} lines (file too large for a line-by-line preview)` }];
  const table = Array.from({ length: oldLines.length + 1 }, () => new Uint32Array(newLines.length + 1));
  for (let i = oldLines.length - 1; i >= 0; i -= 1) for (let j = newLines.length - 1; j >= 0; j -= 1) table[i][j] = oldLines[i] === newLines[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const result: Array<{ kind: string; text: string }> = [];
  let i = 0, j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) { result.push({ kind: "context", text: oldLines[i] }); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { result.push({ kind: "removed", text: oldLines[i] }); i += 1; }
    else { result.push({ kind: "added", text: newLines[j] }); j += 1; }
  }
  while (i < oldLines.length) result.push({ kind: "removed", text: oldLines[i++] });
  while (j < newLines.length) result.push({ kind: "added", text: newLines[j++] });
  return result;
}

function expectedArtifactErrors(flags: Flags, artifact?: Artifact): string[] {
  const revisionFlag = flags["expected-revision"];
  const hashFlag = flags["expected-hash"];
  if (revisionFlag === undefined && hashFlag === undefined) return [];
  if (typeof revisionFlag !== "string" || typeof hashFlag !== "string") return ["--expected-revision and --expected-hash must be supplied together"];
  const expectedRevision = Number(revisionFlag);
  const actualRevision = artifact?.revision ?? 0;
  const actualHash = artifact?.content_hash || "NEW";
  const errors: string[] = [];
  if (!Number.isInteger(expectedRevision) || expectedRevision !== actualRevision) errors.push(`stale revision: expected ${actualRevision}, received ${revisionFlag}`);
  if (hashFlag !== actualHash) errors.push(`stale hash: expected ${actualHash}, received ${hashFlag}`);
  return errors;
}

function previewConfirmationToken(id: string, basePath: string, owner: string, currentRevision: number, currentHash: string, nextHash: string): string {
  return sha256(JSON.stringify({ artifact_id: id, base_path: basePath.replaceAll("\\", "/"), owner, current_revision: currentRevision, current_hash: currentHash, next_hash: nextHash }));
}

function documentPreview(root: string, state: State, flags: Flags): any {
  const id = required(flags, "id").toUpperCase();
  // Blocker 4. `/` is the canonical separator for every persisted relative path,
  // so `docs\plan.md` and `docs/plan.md` name the same artifact and the ledger
  // records the portable spelling. The confirmation token already hashed the
  // canonical form, so no token changes.
  const basePath = canonicalRelative(required(flags, "base-path"));
  const owner = required(flags, "owner");
  const proposed = fs.readFileSync(path.resolve(required(flags, "content-file")), "utf8");
  const artifact = state.artifacts.find((item) => item.id === id);
  const blockers = expectedArtifactErrors(flags, artifact);
  // A path the save cannot accept must not preview cleanly. `stateErrors` rejects
  // an unsafe `base_path` at commit time, so the save was refused either way —
  // but only after the user had reviewed a diff and confirmed it.
  if (!safeArtifactPath(basePath)) blockers.push(`Artifact path must stay inside the project and outside the reserved .beave directory: ${basePath}`);
  let current = "";
  if (artifact) {
    if (!sameRecordedPath(artifact.base_path, basePath)) blockers.push(`Artifact ${id} base_path mismatch. Expected ${artifact.base_path}`);
    if (artifact.lock_owner && artifact.lock_owner !== owner) blockers.push(`Artifact ${id} is locked by ${artifact.lock_owner}`);
    try { assertNoExternalEdit(root, artifact); } catch (error: any) { blockers.push(error.message); }
    const currentPath = artifact.working_path && resolveRecorded(root, artifact.working_path);
    if (currentPath && fs.existsSync(currentPath)) current = fs.readFileSync(currentPath, "utf8");
  }
  const currentRevision = artifact?.revision ?? 0;
  const currentHash = artifact?.content_hash || "NEW";
  const nextHash = sha256(proposed);
  // A refused preview hands out no confirmation.
  //
  // The token is derived from the artifact's identity and digests, which are the
  // same whether or not the preview found blockers — so a preview reporting
  // "stale revision" returned a token byte-identical to a clean one, and
  // `doc-save` accepted it. Reproduced on 2026-09-10 during the ALN-005 pilots:
  // two previews of the same content, one blocked and one not, returned the same
  // token, and the blocked one's token applied the save. The remaining guards
  // (lock, base path, external edit) do re-run at save time, so nothing could be
  // lost through it; what was wrong is that a confirmation attested to a review
  // the engine had just refused.
  const confirmationToken = blockers.length ? "" : previewConfirmationToken(id, basePath, owner, currentRevision, currentHash, nextHash);
  return { artifact_id: id, base_path: basePath, known: Boolean(artifact), current_revision: currentRevision, next_revision: currentRevision + 1, current_hash: currentHash, next_hash: nextHash, confirmation_token: confirmationToken, unchanged: current === proposed, blockers, diff: diffLines(current, proposed) };
}

function docDiff(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const state = validateRoot(root, true);
  console.log(JSON.stringify(documentPreview(root, state, flags), null, 2));
}

function matchingDeletionIntents(root: string, artifactId: string, candidateHash: string, sourceRevision: number, sourceHash: string): string[] {
  const eventsFile = path.join(stateRoot(root), "events.jsonl");
  if (!fs.existsSync(eventsFile)) return [];
  const events = fs.readFileSync(eventsFile, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  const consumed = new Set(events.flatMap((event) => event.type === "DOCUMENT_SAVED" && Array.isArray(event.deletion_intent_ids) ? event.deletion_intent_ids : []));
  return events.flatMap((event) => event.type === "DOCUMENT_DELETION_INTENT_RECORDED" && event.artifact_id === artifactId && event.candidate_hash === candidateHash && event.artifact_revision === sourceRevision && event.artifact_hash === sourceHash && !consumed.has(event.deletion_intent_id) ? [event.deletion_intent_id] : []);
}

/**
 * Where a deletion reason is kept so that whoever receives the folder can read it.
 *
 * Content-addressed, which makes it immutable by construction: the same reason is
 * the same file, and a file that already exists is already correct. `reason_path`
 * in the event says where the author happened to write it; this says where it can
 * be read (L26).
 */
function deletionReasonArchive(root: string, digest: string): { absolute: string; relative: string } {
  return {
    absolute: path.join(stateRoot(root), "deletion-reasons", `${digest}.md`),
    relative: `deletion-reasons/${digest}.md`,
  };
}

function docMarkDeletion(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: doc-mark-deletion already applied.`);
  const state = validateRoot(root, true);
  const location = path.join(stateRoot(root), "state.json");
  assertNotBlocked(state);
  const id = required(flags, "id").toUpperCase();
  const owner = required(flags, "owner");
  const artifact = state.artifacts.find((item) => item.id === id);
  if (!artifact) throw new BeaveError(`Artifact ${id} not found.`);
  if (artifact.lock_owner && artifact.lock_owner !== owner) throw new BeaveError(`Artifact ${id} is locked by ${artifact.lock_owner}`);
  assertNoExternalEdit(root, artifact);
  const stale = expectedArtifactErrors(flags, artifact);
  if (stale.length) throw new BeaveError(`Deletion intent refused:\n- ${stale.join("\n- ")}\nNo changes written.`);
  const target = required(flags, "target").trim();
  if (!target) throw new BeaveError(`--target cannot be empty`);
  const reasonPath = path.resolve(required(flags, "reason-file"));
  const reasonRelative = path.relative(root, reasonPath);
  const confinedReason = existingFileInside(root, reasonRelative);
  if (!confinedReason) throw new BeaveError(`Deletion reason must be an existing file inside the project root`);
  const reason = fs.readFileSync(confinedReason);
  if (!reason.length || !reason.toString("utf8").trim()) throw new BeaveError(`Deletion reason cannot be empty`);
  const candidatePath = path.resolve(required(flags, "content-file"));
  const candidate = fs.readFileSync(candidatePath, "utf8");
  const candidateHash = sha256(candidate);
  const timestamp = now();
  const eventId = crypto.randomUUID();
  const deletionIntentId = `DEL-${crypto.randomBytes(6).toString("hex")}`;
  state.revision += 1;
  state.last_event_id = eventId;
  state.updated_at = timestamp;
  const reasonDigest = sha256(reason);
  const archive = deletionReasonArchive(root, reasonDigest);
  const event = { event_id: eventId, type: "DOCUMENT_DELETION_INTENT_RECORDED", state_revision: state.revision, at: timestamp, idempotency_key: key, deletion_intent_id: deletionIntentId, artifact_id: id, artifact_revision: artifact.revision, artifact_hash: artifact.content_hash, candidate_hash: candidateHash, target, reason_path: reasonRelative.replaceAll("\\", "/"), reason_sha256: reasonDigest, reason_archive_path: archive.relative, owner };
  // The copy goes in before the marker that points at it, inside the same
  // transaction: an interrupted operation must not leave a marker whose reason
  // was never stored, nor a reason no marker refers to.
  const transaction = beginFileTransaction(root, event, [archive.absolute]);
  try {
    if (!fs.existsSync(archive.absolute)) {
      fs.mkdirSync(path.dirname(archive.absolute), { recursive: true });
      atomicWrite(archive.absolute, reason.toString("utf8"));
    }
    commitState(root, location, state, event);
    completeFileTransaction(transaction);
  } catch (error) {
    if (fs.existsSync(transaction)) rollbackFileTransaction(root, transaction);
    throw error;
  }
  console.log(`Recorded deletion intent ${deletionIntentId} for ${id}; no document bytes were deleted. The reason is kept at .beave/${archive.relative}.`);
}

function docSave(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: doc-save already applied.`);
  const state = validateRoot(root, true);
  const location = path.join(stateRoot(root), "state.json");
  assertNotBlocked(state);
  
  const id = required(flags, "id").toUpperCase();
  // Blocker 4. `/` is the canonical separator for every persisted relative path,
  // so `docs\plan.md` and `docs/plan.md` name the same artifact and the ledger
  // records the portable spelling. The confirmation token already hashed the
  // canonical form, so no token changes.
  const basePath = canonicalRelative(required(flags, "base-path"));
  const owner = required(flags, "owner");
  const contentPath = path.resolve(required(flags, "content-file"));
  const sources = flags.sources ? String(flags.sources).split(",").map(s => s.trim().toUpperCase()).filter(Boolean) : [];
  
  const content = fs.readFileSync(contentPath, "utf8");
  const hash = sha256(content);
  
  let artifact = state.artifacts.find(a => a.id === id);
  const priorArtifact = artifact ? { ...artifact, provenance: [...(artifact.provenance ?? [])] } : null;
  const sourceRevision = artifact?.revision ?? 0;
  const sourceHash = artifact?.content_hash || "NEW";
  // Substantive refusals come first, deliberately.
  //
  // The confirmation check used to run before the lock and base-path checks, so
  // a save on a document another operation holds was refused with "run doc-diff
  // and pass its confirmation_token" — true, useless, and pointing at the wrong
  // problem. Now that a refused preview withholds its token, that ordering would
  // have replaced every actionable refusal with the token message. The invariant
  // is unchanged: no save is applied without a matching confirmation. Only the
  // order in which the user is told what is wrong has changed.
  if (artifact) {
    if (!sameRecordedPath(artifact.base_path, basePath)) throw new BeaveError(`Artifact ${id} base_path mismatch. Expected ${artifact.base_path}`);
    if (artifact.lock_owner && artifact.lock_owner !== owner) throw new BeaveError(`Artifact ${id} is locked by ${artifact.lock_owner}`);
    assertNoExternalEdit(root, artifact);
  }
  const stale = expectedArtifactErrors(flags, artifact);
  if (stale.length) throw new BeaveError(`Document save refused:\n- ${stale.join("\n- ")}\nNo changes written.`);
  const expectedToken = previewConfirmationToken(id, basePath, owner, sourceRevision, sourceHash, hash);
  if (flags["confirm-token"] !== expectedToken) throw new BeaveError(`Document save refused: run doc-diff and pass its confirmation_token with --confirm-token. No changes written.`);
  const diff = documentPreview(root, state, { ...flags, id }).diff;
  if (!artifact) {
    artifact = {
      id,
      base_path: basePath,
      working_path: "",
      status: "DRAFT",
      revision: 0,
      content_hash: "",
      lock_owner: owner,
      provenance: sources
    };
    state.artifacts.push(artifact);
  } else {
    if (!sameRecordedPath(artifact.base_path, basePath)) {
      throw new BeaveError(`Artifact ${id} base_path mismatch. Expected ${artifact.base_path}`);
    }
    if (artifact.lock_owner && artifact.lock_owner !== owner) {
      throw new BeaveError(`Artifact ${id} is locked by ${artifact.lock_owner}`);
    }
    assertNoExternalEdit(root, artifact);
  }
  
  const newRevision = artifact.revision + 1;
  const parsedPath = path.parse(basePath);
  const newWorkingPath = path.posix.join(parsedPath.dir, `${parsedPath.name}-v${newRevision}${parsedPath.ext}`);
  const absoluteNewWorkingPath = boundedOutput(root, newWorkingPath);
  if (fs.existsSync(absoluteNewWorkingPath) && absoluteNewWorkingPath !== resolveRecorded(root, artifact.working_path || "")) throw new BeaveError(`Refusing to overwrite untracked working file ${newWorkingPath}`);

  artifact.working_path = newWorkingPath;
  artifact.revision = newRevision;
  artifact.content_hash = hash;
  artifact.lock_owner = owner;
  artifact.provenance = sources;
  // A new working revision supersedes the publication: the base file keeps the
  // finalized bytes, but the artifact is no longer what doc-finalize published.
  artifact.status = "DRAFT";
  
  const timestamp = now();
  state.updated_at = timestamp;
  const stateRevision = state.revision + 1;
  const eventId = crypto.randomUUID();
  state.revision = stateRevision;
  state.last_event_id = eventId;
  const deletionIntentIds = matchingDeletionIntents(root, id, hash, sourceRevision, sourceHash);
  const event = { event_id: eventId, type: "DOCUMENT_SAVED", state_revision: stateRevision, at: timestamp, idempotency_key: key, artifact_id: id, revision: newRevision, hash, owner, sources, diff, deletion_intent_ids: deletionIntentIds };
  assertPendingState(root, state, event);
  const transaction = beginFileTransaction(root, event, [absoluteNewWorkingPath, ...(priorArtifact?.working_path ? [resolveRecorded(root, priorArtifact.working_path), historyLocation(root, priorArtifact, priorArtifact.revision)] : [])]);
  try {
    if (priorArtifact) archiveCurrentRevision(root, priorArtifact);
    atomicWrite(absoluteNewWorkingPath, content);
    commitState(root, location, state, event);
    completeFileTransaction(transaction);
  } catch (error) {
    if (fs.existsSync(transaction)) rollbackFileTransaction(root, transaction);
    throw error;
  }
  // `doc-mark-deletion` records a human-approved removal, and the next save links
  // the matching marker. Nothing ever *required* one: a save that removed 44
  // recorded lines went through with `deletion_intent_ids: []` and said nothing,
  // which makes the intentional-deletion guarantee ceremonial (ALN-005 pilot B).
  //
  // Refusing the save would be a `DOCOP-001` behaviour change and, under D3, needs
  // a corpus scenario before either implementation moves. Saying so does not: the
  // removal is reported, with the count, and the operation still applies.
  const removedLines = diff.filter((line: any) => line.kind === "removed").length;
  const warnings = removedLines && !deletionIntentIds.length
    ? [`This revision removes ${removedLines} recorded line${removedLines === 1 ? "" : "s"} and no deletion intent was linked. Content is preserved in .beave/history/. Use doc-mark-deletion first when a removal is deliberate, so the reason is recorded with it.`]
    : [];
  console.log(`${JSON.stringify({ artifact_id: id, working_path: newWorkingPath, revision: newRevision, hash, diff, deletion_intent_ids: deletionIntentIds, warnings }, null, 2)}`);
}

function docHistory(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const id = required(flags, "id").toUpperCase();
  const eventsFile = path.join(stateRoot(root), "events.jsonl");
  if (!fs.existsSync(eventsFile)) return;
  const lines = fs.readFileSync(eventsFile, "utf8").split(/\r?\n/).filter(Boolean);
  const history = [];
  for (const line of lines) {
    const event = JSON.parse(line);
    if (event.artifact_id === id) {
      history.push(event);
    }
  }
  console.log(JSON.stringify(history, null, 2));
}

function docRestore(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: doc-restore already applied.`);
  const state = validateRoot(root, true);
  const location = path.join(stateRoot(root), "state.json");
  assertNotBlocked(state);
  
  const id = required(flags, "id").toUpperCase();
  const restoreRevision = Number(required(flags, "revision"));
  const owner = required(flags, "owner");
  
  const artifact = state.artifacts.find(a => a.id === id);
  if (!artifact) throw new BeaveError(`Artifact ${id} not found.`);
  const stale = expectedArtifactErrors(flags, artifact);
  if (stale.length) throw new BeaveError(`Document restore refused:\n- ${stale.join("\n- ")}\nNo changes written.`);
  
  if (artifact.lock_owner && artifact.lock_owner !== owner) {
    throw new BeaveError(`Artifact ${id} is locked by ${artifact.lock_owner}`);
  }
  
  assertNoExternalEdit(root, artifact);

  const parsedPath = path.parse(artifact.base_path);
  const historyFile = historyLocation(root, artifact, restoreRevision);
  
  if (!fs.existsSync(historyFile)) {
    throw new BeaveError(`History file for revision ${restoreRevision} not found.`);
  }
  
  const content = fs.readFileSync(historyFile, "utf8");
  const hash = sha256(content);
  
  const newRevision = artifact.revision + 1;
  const newWorkingPath = path.posix.join(parsedPath.dir, `${parsedPath.name}-v${newRevision}${parsedPath.ext}`);
  const absoluteNewWorkingPath = boundedOutput(root, newWorkingPath);
  if (fs.existsSync(absoluteNewWorkingPath)) throw new BeaveError(`Refusing to overwrite untracked working file ${newWorkingPath}`);
  const priorArtifact = { ...artifact, provenance: [...(artifact.provenance ?? [])] };

  artifact.working_path = newWorkingPath;
  artifact.revision = newRevision;
  artifact.content_hash = hash;
  artifact.lock_owner = owner;
  artifact.status = "DRAFT";
  
  const timestamp = now();
  state.updated_at = timestamp;
  const stateRevision = state.revision + 1;
  const eventId = crypto.randomUUID();
  state.revision = stateRevision;
  state.last_event_id = eventId;
  const event = { event_id: eventId, type: "DOCUMENT_RESTORED", state_revision: stateRevision, at: timestamp, idempotency_key: key, artifact_id: id, restored_revision: restoreRevision, new_revision: newRevision, hash, owner };
  assertPendingState(root, state, event);
  const transaction = beginFileTransaction(root, event, [absoluteNewWorkingPath, resolveRecorded(root, priorArtifact.working_path), historyLocation(root, priorArtifact, priorArtifact.revision)]);
  try {
    archiveCurrentRevision(root, priorArtifact);
    atomicWrite(absoluteNewWorkingPath, content);
    commitState(root, location, state, event);
    completeFileTransaction(transaction);
  } catch (error) {
    if (fs.existsSync(transaction)) rollbackFileTransaction(root, transaction);
    throw error;
  }
  console.log(`Restored document ${id} to ${newWorkingPath} (from revision ${restoreRevision} as new revision ${newRevision})`);
}

function docFinalize(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const key = idempotencyKey(flags);
  if (checkIdempotency(root, key)) return console.log(`Idempotent retry: doc-finalize already applied.`);
  const state = validateRoot(root, true);
  const location = path.join(stateRoot(root), "state.json");
  assertNotBlocked(state);
  
  const id = required(flags, "id").toUpperCase();
  const owner = required(flags, "owner");
  
  const artifact = state.artifacts.find(a => a.id === id);
  if (!artifact) throw new BeaveError(`Artifact ${id} not found.`);
  const stale = expectedArtifactErrors(flags, artifact);
  if (stale.length) throw new BeaveError(`Document finalize refused:\n- ${stale.join("\n- ")}\nNo changes written.`);
  
  if (artifact.lock_owner && artifact.lock_owner !== owner) {
    throw new BeaveError(`Artifact ${id} is locked by ${artifact.lock_owner}`);
  }
  if (!artifact.working_path) {
    throw new BeaveError(`Artifact ${id} has no working path to finalize.`);
  }
  // Already published: working_path === base_path, so the previous code copied
  // the file onto itself and then moved it into history, deleting the publication.
  if (artifact.working_path === artifact.base_path) {
    throw new BeaveError(`Artifact ${id} is already finalized at ${artifact.base_path}. Save a new revision before finalizing again.`);
  }

  assertNoExternalEdit(root, artifact);

  const absoluteWorking = resolveRecorded(root, artifact.working_path);
  const absoluteBase = boundedOutput(root, artifact.base_path);

  if (!fs.existsSync(absoluteWorking)) {
    throw new BeaveError(`Working file ${absoluteWorking} does not exist.`);
  }

  // DOCOP-001, "Finalization": the audit "reports suspected accidental loss before
  // writing". The base file can hold content Beave never produced: a document that
  // predates the project, or a hand edit made while the artifact was in DRAFT,
  // which assertNoExternalEdit cannot see because it guards the working file.
  // Overwriting it is irreversible, so it is refused unless the human approves.
  let supersededPath: string | undefined;
  let supersededHash: string | undefined;
  let supersededSnapshot: string | undefined;
  const priorBase = fs.existsSync(absoluteBase) ? fs.readFileSync(absoluteBase) : null;
  if (fs.existsSync(absoluteBase)) {
    const baseHash = sha256(fs.readFileSync(absoluteBase, "utf8"));
    if (!recordedDigests(root, id).has(baseHash)) {
      if (!flags["accept-base-overwrite"]) {
        throw new BeaveError(`${artifact.base_path} already holds content Beave never recorded (sha256 ${baseHash}). Finalizing would overwrite it and no document backup exists. Import it with doc-save, move it aside, or re-run with --accept-base-overwrite to archive it under .beave/history/ first.`);
      }
      const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
      const snapshot = path.join(stateRoot(root), "history", `${id}-external-${stamp}${path.parse(artifact.base_path).ext}`);
      supersededSnapshot = snapshot;
      supersededPath = path.relative(root, snapshot).replaceAll("\\", "/");
      supersededHash = baseHash;
    }
  }
  const priorArtifact = { ...artifact, provenance: [...(artifact.provenance ?? [])] };
  const workingBytes = fs.readFileSync(absoluteWorking);
  artifact.working_path = artifact.base_path;
  artifact.status = "PUBLISHED";
  
  const timestamp = now();
  state.updated_at = timestamp;
  const stateRevision = state.revision + 1;
  const eventId = crypto.randomUUID();
  state.revision = stateRevision;
  state.last_event_id = eventId;
  const event = { event_id: eventId, type: "DOCUMENT_FINALIZED", state_revision: stateRevision, at: timestamp, idempotency_key: key, artifact_id: id, revision: artifact.revision, hash: artifact.content_hash, owner, ...(supersededPath ? { superseded_external_path: supersededPath, superseded_external_hash: supersededHash } : {}) };
  assertPendingState(root, state, event);
  const transaction = beginFileTransaction(root, event, [absoluteBase, absoluteWorking, historyLocation(root, priorArtifact, priorArtifact.revision), ...(supersededSnapshot ? [supersededSnapshot] : [])]);
  try {
    if (supersededSnapshot && priorBase) {
      fs.mkdirSync(path.dirname(supersededSnapshot), { recursive: true });
      fs.copyFileSync(absoluteBase, supersededSnapshot);
    }
    atomicWrite(absoluteBase, workingBytes);
    archiveCurrentRevision(root, priorArtifact);
    commitState(root, location, state, event);
    completeFileTransaction(transaction);
  } catch (error) {
    if (fs.existsSync(transaction)) rollbackFileTransaction(root, transaction);
    throw error;
  }
  if (supersededPath) console.log(`Archived the unrecorded content of ${artifact.base_path} to ${supersededPath}`);
  console.log(`Finalized document ${id} to ${artifact.base_path}`);
}

function portableMarkdown(): string {
  const paths = [path.join(SKILL_ROOT, "SKILL.md"), ...fs.readdirSync(path.join(SKILL_ROOT, "references")).filter((name: string) => name.endsWith(".md")).sort().map((name: string) => path.join(SKILL_ROOT, "references", name))];
  const sections = ["<!-- Generated by Beave. Edit canonical sources, not this file. -->", `<!-- Beave version: ${VERSION} -->`, "# Beave — Portable Semantic Edition", "", "Use this document when the AI runtime cannot install or execute the Beave skill. Follow the same human gates and preserve the final state block manually.", ""];
  for (const source of paths) {
    let text = fs.readFileSync(source, "utf8");
    if (path.basename(source) === "SKILL.md" && text.startsWith("---")) text = text.split("---", 3)[2].trimStart();
    sections.push(`\n---\n\n## Source: ${path.relative(SKILL_ROOT, source).replaceAll("\\", "/")}\n`, text.trimEnd(), "");
  }
  sections.splice(2, 0, `<!-- Canonical source digest: ${canonicalSourceDigest()} -->`);
  return `${sections.join("\n").trimEnd()}\n`;
}

function adapterRelative(target: string): string {
  if (["codex", "gemini", "agy"].includes(target)) return path.join(".agents", "skills", "beave");
  if (target === "claude") return path.join(".claude", "skills", "beave");
  throw new BeaveError(`Unsupported target: ${target}`);
}

function copySkill(destination: string, target: string): void {
  if (fs.existsSync(destination)) throw new BeaveError(`Destination already exists: ${destination}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(SKILL_ROOT, destination, { recursive: true });
  writeJson(path.join(destination, "beave-adapter.json"), { generated_by: `beave ${VERSION}`, target, generated_at: now(), canonical_source_sha256: canonicalSourceDigest() });
}

function installedSourceDigest(destination: string): string {
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name !== "beave-adapter.json") files.push(full);
    }
  };
  visit(destination);
  files.sort((left, right) => {
    const a = path.relative(destination, left).replaceAll("\\", "/");
    const b = path.relative(destination, right).replaceAll("\\", "/");
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const digest = crypto.createHash("sha256");
  for (const location of files) {
    digest.update(path.relative(destination, location).replaceAll("\\", "/"));
    digest.update("\0");
    digest.update(fs.readFileSync(location));
    digest.update("\0");
  }
  return digest.digest("hex");
}

function verifyInstall(flags: Flags): void {
  const target = required(flags, "target");
  const scope = typeof flags.scope === "string" ? flags.scope : "project";
  if (!new Set(["project", "workspace", "user"]).has(scope)) throw new BeaveError("--scope must be project, workspace, or user");
  const base = scope === "user" ? os.homedir() : path.resolve((typeof flags["project-root"] === "string" ? flags["project-root"] : undefined) ?? process.cwd());
  const destination = path.join(base, adapterRelative(target));
  
  if (!fs.existsSync(destination)) {
    throw new BeaveError(`Target ${target} is not installed at ${destination}`);
  }
  const manifestFile = path.join(destination, "beave-adapter.json");
  if (!fs.existsSync(manifestFile)) {
    throw new BeaveError(`Missing beave-adapter.json in ${destination}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (!manifest.canonical_source_sha256) {
    throw new BeaveError(`beave-adapter.json lacks canonical_source_sha256`);
  }
  
  const currentDigest = installedSourceDigest(destination);
  if (currentDigest !== manifest.canonical_source_sha256) {
    throw new BeaveError(`Drift detected in installed skill at ${destination}. Hashes do not match.`);
  }
  console.log(`Installation for ${target} at ${destination} is pristine and matches original source.`);
}

function exportTarget(flags: Flags): void {
  const target = required(flags, "target");
  const outputRoot = path.resolve(required(flags, "output-dir"));
  fs.mkdirSync(outputRoot, { recursive: true });
  if (target === "portable") {
    const destination = path.join(outputRoot, "beave-portable.md");
    if (fs.existsSync(destination)) throw new BeaveError(`Destination already exists: ${destination}`);
    atomicWrite(destination, portableMarkdown());
    return console.log(`Exported portable to ${destination}`);
  }
  const destination = path.join(outputRoot, adapterRelative(target));
  copySkill(destination, target);
  console.log(`Exported ${target} to ${destination}`);
}

function install(flags: Flags): void {
  const target = required(flags, "target");
  const scope = typeof flags.scope === "string" ? flags.scope : "project";
  if (!new Set(["project", "workspace", "user"]).has(scope)) throw new BeaveError("--scope must be project, workspace, or user");
  const base = scope === "user" ? os.homedir() : path.resolve((typeof flags["project-root"] === "string" ? flags["project-root"] : undefined) ?? process.cwd());
  const targets = target === "all" ? ["codex", "claude"] : [target];
  const destinations = targets.map((item) => ({ item, destination: path.join(base, adapterRelative(item)) }));
  for (const { destination } of destinations) if (fs.existsSync(destination)) throw new BeaveError(`Refusing to overwrite existing skill: ${destination}`);
  for (const { item, destination } of destinations) {
    console.log(`${flags["dry-run"] ? "Would install" : "Installing"} ${item} skill at ${destination}`);
    if (!flags["dry-run"]) copySkill(destination, item);
  }
  if (target === "all") console.log("Codex and Gemini share .agents/skills/beave; no duplicate Gemini copy was created.");
}

function help(): void {
  console.log("Mutation requirements: pass --operation-id OP-ID to every mutating command. For doc-save, first run doc-diff and pass its confirmation_token as --confirm-token TOKEN.\n");
  console.log(`Beave ${VERSION}\n\nUsage: beave <command> [options]\n\nEvery command that changes the project requires --operation-id <unique-id>, 3 to 128\ncharacters. It is how a retried command is recognised as the same operation rather\nthan applied twice, so it is required rather than generated, and it is omitted from\nthe lines below only because it belongs to all of them.\n\nThe first command needs an owners file. It is one JSON object with these five keys,\neach naming the person accountable for that kind of decision:\n\n  {\"product\":\"Ada\",\"technical\":\"Ada\",\"budget\":\"Ada\",\"safety\":\"Ada\",\"release\":\"Ada\"}\n\nSave it anywhere and pass its path to --owners-file; the same person may hold more\nthan one role. An unknown key is refused, and so is a missing or empty one. What the\nroles mean, and when they matter, is in skills/beave/references/user-guide.md.\n\nCommands:\n  capabilities\n  init --project-root . --project-name NAME --project-mode Resume --interaction-mode Standard --owners-file owners.json\n  status --project-root .\n  next --project-root . [--count 1|2|3]\n  resume --project-root .\n  record --project-root . --module N --status CONFIRMED --answer-file FILE --owner NAME\n  decision --project-root . --id DEC-ID --title TEXT --status APPROVED --owner NAME [--expected-revision N]\n  requirement --project-root . --id REQ-ID --title TEXT --status ACTIVE --owner NAME [--expected-revision N]\n  task --project-root . --id TSK-ID --title TEXT --status READY --owner NAME [--expected-revision N]\n  dependency --project-root . --id DEP-ID --from REQ-ID --to TSK-ID --type REQUIRES --owner NAME [--expected-revision N]\n  risk --project-root . --id RSK-ID --title TEXT --severity HIGH --status IDENTIFIED --owner NAME [--expected-revision N]\n  evidence --project-root . --id EVD-ID --file FILE --owner NAME [--expected-revision N]\n  agent --project-root . --id AGT-ID --name TEXT --status ACTIVE --owner NAME [--expected-revision N]\n  checkpoint --project-root . --id CHK-ID --name TEXT --owner NAME [--next-action TEXT] [--expected-revision N]\n  override --project-root . --instruction-file FILE --owner NAME [--reason TEXT]\n  re-record --project-root . --kind override|gate --id OVR-ID|G2 --source-file FILE --owner NAME --reason TEXT\n  reconcile --project-root . --override-id ID --evidence-file FILE --owner NAME [--next-action TEXT] [--replace-human-next-action]\n  forecast --project-root . --owner NAME --phase TEXT --known-work TEXT --conditional-work TEXT --questions MIN-MAX --operations MIN-MAX --cycles MIN-MAX --confidence ALTA|MEDIA|BASSA --confidence-reason TEXT --cycle-state REGOLARE|IN_ESPANSIONE|RISCHIO_LOOP|BLOCCATO [--change-reason TEXT: required from the second forecast on, refused on the first] [--expected-revision N]\n  forecast --project-root .    (reads the recorded forecast; ranges only, never a percentage)\n  gate --project-root . --id G2 --status PASSED --evidence-file FILE --owner NAME\n  doc-diff --project-root . --id ART-123 --base-path docs/design.md --content-file temp.md --owner NAME [--expected-revision N --expected-hash HASH]\n  doc-mark-deletion --project-root . --id ART-123 --target TEXT --reason-file FILE --content-file FILE --owner NAME [--expected-revision N --expected-hash HASH]\n  doc-save --project-root . --id ART-123 --base-path docs/design.md --content-file temp.md --owner NAME [--sources DEC-1] [--expected-revision N --expected-hash HASH]\n  doc-history --project-root . --id ART-123\n  doc-restore --project-root . --id ART-123 --revision N --owner NAME [--expected-revision N --expected-hash HASH]\n  doc-finalize --project-root . --id ART-123 --owner NAME [--expected-revision N --expected-hash HASH] [--accept-base-overwrite]\n  qa-ask --project-root . --id QNA-0001 --question TEXT --rationale TEXT --owner NAME [--module N] [--agent NAME] [--planned]
  qa-answer --project-root . --id QNA-0001 --answer-file FILE --owner NAME [--agent NAME]
  qa-settle --project-root . --id QNA-0001 --interpretation TEXT --reply-file FILE --owner NAME [--consequences DEC-1,REQ-2] [--documents docs/a.md] [--open-points TEXT] [--next-id QNA-0002] [--next-question TEXT]
  qa-close --project-root . --id QNA-0001 --kind deferred|skipped|invalidated --reason TEXT --owner NAME
  qa-supersede --project-root . --id QNA-0001 --new-id QNA-0009 --question TEXT --rationale TEXT --reason TEXT --owner NAME
  qa-log --project-root . [--open] [--last] [--json] [--id QNA-0001] [--regenerate]
  context-pack --project-root . [--output session.md]\n  validate --project-root .\n  migrate --project-root .\n  replay --project-root . [--verify]                     (rebuild the state from the events and compare)\n  replay --project-root . --repair --operation-id OP-ID  (put the rebuilt state back, keeping a backup)\n  baseline --project-root . --reason TEXT --owner NAME --operation-id OP-ID\n  recover --project-root . [--apply]                     (interrupted operations: what they are, and finish them)\n  unlock --project-root . [--force]                      (who holds the project lock, and release an abandoned one)\n  project-export --project-root . --output-dir DIR\n  project-verify --package-dir DIR\n  project-import --package-dir DIR --project-root NEW_DIR\n  export --target portable|codex|claude|gemini|agy --output-dir DIR\n  install --target codex|claude|gemini|agy|all [--scope project|workspace|user] [--project-root DIR] [--dry-run]\n  verify-install --target codex|claude|gemini|agy [--scope project|workspace|user] [--project-root DIR]\n  version`);
}

export async function main(argv: string[]): Promise<number> {
  // The tests drive `main` in one process, one command after another. A
  // transaction left open by a command that threw would otherwise be adopted by
  // the next one and completed under its name.
  activeTransaction = null;
  pendingOperation = null;
  recoveredInThisRun = [];
  runningCommand = argv[0] ?? "beave";
  try {
    const { command, flags } = parse(argv);
    assertKnownOptions(command, flags);
    if (!command || command === "help" || command === "--help" || command === "-h") help();
    else if (command === "version" || command === "--version" || command === "-v") console.log(VERSION);
    else if (command === "capabilities") capabilities();
    else if (command === "init") init(flags);
    else if (command === "status") status(flags);
    else if (command === "next") next(flags);
    else if (command === "resume") resume(flags);
    else if (command === "replay") replay(flags);
    else if (command === "baseline") baseline(flags);
    else if (command === "recover") recover(flags);
    else if (command === "unlock") unlock(flags);
    else if (command === "qa-ask") qaAsk(flags);
    else if (command === "qa-answer") qaAnswer(flags);
    else if (command === "qa-settle") qaSettle(flags);
    else if (command === "qa-close") qaClose(flags);
    else if (command === "qa-supersede") qaSupersede(flags);
    else if (command === "qa-log") qaLog(flags);
    else if (command === "record") record(flags);
    else if (LEDGER_RULES[command]) ledgerMutation(command, flags);
    else if (command === "override") override(flags);
    else if (command === "re-record") reRecord(flags);
    else if (command === "reconcile") reconcile(flags);
    else if (command === "forecast") forecast(flags);
    else if (command === "gate") gate(flags);
    else if (command === "doc-diff") docDiff(flags);
    else if (command === "doc-mark-deletion") docMarkDeletion(flags);
    else if (command === "doc-save") docSave(flags);
    else if (command === "doc-history") docHistory(flags);
    else if (command === "doc-restore") docRestore(flags);
    else if (command === "doc-finalize") docFinalize(flags);
    else if (command === "context-pack") contextPack(flags);
    else if (command === "validate") {
      const root = resolveProject(required(flags, "project-root"));
      const state = validateRoot(root, true);
      // Reported here and nowhere else: see `recordedDigestErrors`.
      const drift = recordedDigestErrors(root, state);
      if (drift.length) throw new BeaveError(`Validation failed:\n- ${drift.join("\n- ")}`);
      // The history is part of what "valid" means now. A project whose state does
      // not match its own events is not valid; one whose events predate the replay
      // format is, and is told what it cannot prove rather than refused.
      const history = historyErrors(root, state);
      if (history.errors.length) throw new BeaveError(`Validation failed:\n- ${history.errors.join("\n- ")}`);
      console.log("Beave state is valid.");
      // Said out loud, because the alternative is the defect B5 was: a project
      // reporting "valid" over gates whose evidence nothing had looked at since.
      const gapNote = unverifiableGateNote(state);
      if (gapNote) console.log(`\n${gapNote}`);
      for (const note of history.notes) console.log(`\n${note}`);
    }
    else if (command === "migrate") migrate(flags);
    else if (command === "project-export") projectExport(flags);
    else if (command === "project-verify") projectVerify(flags);
    else if (command === "project-import") projectImport(flags);
    else if (command === "export") exportTarget(flags);
    else if (command === "install") install(flags);
    else if (command === "verify-install") verifyInstall(flags);
    else throw new BeaveError(`Unknown command: ${command}`);
    return 0;
  } catch (error: any) {
    console.error(`BEAVE ERROR: ${error.message}`);
    return 2;
  } finally {
    // The lock is released on the way out however the command ended, and again
    // from the `exit` handler if something skipped this. A kill skips both,
    // which is exactly what the stale-lock rules above are for.
    releaseProjectLock();
  }
}
