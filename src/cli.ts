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
}

interface Decision { id: string; title: string; status: string; owner?: string; revision: number; updated_at: string; }
interface Requirement { id: string; title: string; status: string; revision: number; }
interface Artifact { id: string; path: string; status: string; revision: number; }
interface Task { id: string; title: string; status: string; revision: number; }
interface Dependency { id: string; from: string; to: string; type: string; }
interface Gate { id: string; name: string; status: string; }
interface Risk { id: string; title: string; severity: string; status: string; }
interface Evidence { id: string; path: string; sha256: string; }
interface Agent { id: string; name: string; status: string; }
interface Operation { id: string; type: string; status: string; }
interface Checkpoint { id: string; name: string; created_at: string; }

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
  human_overrides: Override[];
  needs_reconciliation: boolean;
  revision: number;
  last_event_id: string;
  exact_next_action: string;
  created_at?: string;
  updated_at?: string;
}

function parse(argv: string[]): { command: string; flags: Flags } {
  const [command, ...rest] = argv;
  const flags: Flags = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) throw new BeaveError(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    if (key === "dry-run") {
      flags[key] = true;
      continue;
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new BeaveError(`Missing value for --${key}`);
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

function readJson(location: string): any {
  try {
    const value = JSON.parse(fs.readFileSync(location, "utf8"));
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

function atomicWrite(location: string, content: string): void {
  fs.mkdirSync(path.dirname(location), { recursive: true });
  if (fs.existsSync(location)) {
    const backup = backupName(location);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(location, backup);
  }
  const temporary = path.join(path.dirname(location), `.${path.basename(location)}.${crypto.randomUUID()}.tmp`);
  const handle = fs.openSync(temporary, "wx");
  try {
    fs.writeFileSync(handle, content, "utf8");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  fs.renameSync(temporary, location);
}

function writeJson(location: string, value: any): void {
  atomicWrite(location, `${JSON.stringify(value, null, 2)}\n`);
}

function appendEvent(root: string, event: any): void {
  const location = path.join(stateRoot(root), "events.jsonl");
  const prior = fs.existsSync(location) ? fs.readFileSync(location, "utf8").trimEnd() : "";
  atomicWrite(location, `${prior ? `${prior}\n` : ""}${JSON.stringify(event)}\n`);
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
  const location = path.join(stateRoot(root), "state.json");
  return { location, state: readJson(location) as State };
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

function stateErrors(root: string, state: State): string[] {
  const errors: string[] = [];
  if (state.schema_version !== SCHEMA_VERSION) errors.push(`unsupported schema_version=${state.schema_version}`);
  if (state.project?.root !== root) errors.push("project root does not match requested root");
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

  if (Array.isArray(state.dependencies)) {
    const cycleErrors = detectCycles(state.dependencies);
    errors.push(...cycleErrors);
  }

  const events = path.join(stateRoot(root), "events.jsonl");
  if (!fs.existsSync(events)) errors.push("events.jsonl is missing");
  else {
    const parsed: any[] = [];
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
    if (!Number.isInteger(state.revision) || state.revision < 1) errors.push("revision must be a positive integer");
    if (!state.last_event_id) errors.push("last_event_id is required");
    if (!parsed.length) errors.push("events.jsonl must contain at least one event");
    else {
      const latest = parsed.at(-1);
      if (latest.event_id !== state.last_event_id) errors.push("last_event_id does not match the latest event");
      if (latest.state_revision !== state.revision) errors.push("state revision does not match the latest event");
    }
  }
  return errors;
}

function contextMarkdown(state: State): string {
  const active = activeModule(state);
  const lines = [
    "# Beave Context Pack", "",
    `- Project: ${state.project.name}`,
    `- Mode: ${state.project.mode}`,
    `- Lifecycle: ${state.lifecycle_state}`,
    `- Gate: ${state.current_gate}`,
    `- Interaction: ${state.interaction_mode}`,
    `- Exact next action: ${state.exact_next_action}`, "",
    "## Decision owners", "",
    ...OWNER_KEYS.map((key) => `- ${key}: ${state.decision_owners[key]}`), "",
    "## Active module", "",
    active ? `- ${active.id} — ${active.title} [${active.status}]` : "- None; questionnaire coverage is complete.", "",
    "## Coverage evidence", "",
    ...state.modules.filter((item) => item.status !== "NOT STARTED").flatMap((item) => [`- M${item.id}: ${item.status} — ${item.evidence || "not recorded"}`, ...(item.summary ? [`  Summary: ${item.summary}`] : [])]), "",
    "## Blockers", "",
    ...(state.blockers?.length ? state.blockers.map((item) => `- ${item}`) : ["- None recorded."]), "",
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
  const destination = stateRoot(root);
  if (fs.existsSync(path.join(destination, "state.json")) || fs.existsSync(path.join(destination, "events.jsonl"))) throw new BeaveError(`State already exists at ${destination}; use resume`);
  const projectMode = required(flags, "project-mode");
  const interactionMode = required(flags, "interaction-mode");
  if (!PROJECT_MODES.has(projectMode)) throw new BeaveError(`Unsupported project mode: ${projectMode}`);
  if (!INTERACTION_MODES.has(interactionMode)) throw new BeaveError(`Unsupported interaction mode: ${interactionMode}`);
  const owners = readJson(path.resolve(required(flags, "owners-file")));
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
    human_overrides: [], 
    needs_reconciliation: false, 
    revision: 1, 
    last_event_id: eventId,
    exact_next_action: "Run `beave next --project-root .` and discuss module 1.",
    created_at: timestamp, 
    updated_at: timestamp
  };
  writeJson(path.join(destination, "state.json"), state);
  appendEvent(root, { event_id: eventId, type: "PROJECT_INITIALIZED", state_revision: 1, at: timestamp, project: state.project.name, project_mode: projectMode, interaction_mode: interactionMode });
  console.log(`Initialized Beave state at ${destination}`);
}

function validateRoot(root: string): State {
  const { state } = loadState(root);
  const errors = stateErrors(root, state);
  if (errors.length) throw new BeaveError(`Validation failed:\n- ${errors.join("\n- ")}`);
  return state;
}

function status(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const state = validateRoot(root);
  const active = activeModule(state);
  console.log(JSON.stringify({ project: state.project.name, project_mode: state.project.mode, interaction_mode: state.interaction_mode, lifecycle_state: state.lifecycle_state, current_gate: state.current_gate, coverage: `${state.modules.filter((item) => new Set(["CONFIRMED", "DEFERRED", "NOT APPLICABLE"]).has(item.status)).length}/${state.modules.length}`, active_module: active && { id: active.id, title: active.title, status: active.status }, needs_reconciliation: state.needs_reconciliation, open_overrides: state.human_overrides.filter((item) => item.status === "OPEN").length, blockers: state.blockers, exact_next_action: state.exact_next_action, updated_at: state.updated_at }, null, 2));
}

function nextQuestions(state: State, requestedCount?: string | boolean): string {
  const active = activeModule(state);
  if (!active) return "Questionnaire coverage complete. Next: approve the research/synthesis gate.\n";
  const count = requestedCount ? Number(requestedCount) : (({ Guided: 1, Standard: 2, Expert: 3 } as any)[state.interaction_mode] ?? 2);
  if (![1, 2, 3].includes(count)) throw new BeaveError("--count must be 1, 2, or 3");
  const catalog = questionnaire().find((item: any) => item.id === active.id);
  return [`Module ${active.id} — ${active.title} [${active.status}]`, ...catalog!.questions.slice(0, count).map((question: string, index: number) => `${index + 1}. ${question}`), "Stop after the user's answers; confirm them before recording the module outcome.", ""].join("\n");
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

function resume(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const state = validateRoot(root);
  if (state.needs_reconciliation) {
    console.log(`${contextMarkdown(state)}\n## Resume blocked\n\nReconcile the open human override before continuing normal work.`);
    return;
  }
  console.log(`${contextMarkdown(state)}\n## Resume questions\n\n${nextQuestions(state).trimEnd()}\n\nRe-verify canonical sources before changing files.`);
}

function record(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const { location, state } = loadState(root);
  if (stateErrors(root, state).length) throw new BeaveError("State is invalid; run validate before record");
  if (state.needs_reconciliation) throw new BeaveError("Cannot record a questionnaire outcome while a human override is open");
  assertKnownOwner(state, required(flags, "owner"));
  const moduleId = Number(required(flags, "module"));
  const outcome = required(flags, "status").toUpperCase().replaceAll("_", " ");
  if (!MODULE_STATUSES.has(outcome)) throw new BeaveError(`Unsupported module status: ${outcome}`);
  const sourcePath = path.resolve(required(flags, "answer-file"));
  const bytes = fs.readFileSync(sourcePath);
  const module = state.modules.find((item) => item.id === moduleId);
  if (!module) throw new BeaveError(`Unknown module: ${moduleId}`);
  const timestamp = now();
  Object.assign(module, { status: outcome, owner: flags.owner, evidence: path.relative(root, sourcePath) || path.basename(sourcePath), evidence_sha256: sha256(bytes), summary: flags.summary && typeof flags.summary === "string" ? flags.summary.trim().slice(0, 240) : null, updated_at: timestamp });
  const active = activeModule(state);
  if (active) state.exact_next_action = `Discuss module ${active.id} — ${active.title}.`;
  else Object.assign(state, { lifecycle_state: "RESEARCH", current_gate: "G2", exact_next_action: "Review coverage, then approve a bounded research plan or mark research not applicable." });
  state.updated_at = timestamp;
  const revision = state.revision + 1;
  const eventId = crypto.randomUUID();
  state.revision = revision;
  state.last_event_id = eventId;
  appendEvent(root, { event_id: eventId, type: "MODULE_RECORDED", state_revision: revision, at: timestamp, module: moduleId, status: outcome, owner: flags.owner, evidence: module.evidence, evidence_sha256: module.evidence_sha256 });
  writeJson(location, state);
  console.log(`Recorded module ${moduleId} as ${outcome}`);
}

function override(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const { location, state } = loadState(root);
  assertKnownOwner(state, required(flags, "owner"));
  const sourcePath = path.resolve(required(flags, "instruction-file"));
  const bytes = fs.readFileSync(sourcePath);
  const timestamp = now();
  const item = { id: `OVR-${crypto.randomBytes(6).toString("hex")}`, status: "OPEN", owner: required(flags, "owner"), reason: typeof flags.reason === 'string' ? flags.reason : "Human direction changed by prompt", source: path.relative(root, sourcePath) || path.basename(sourcePath), source_sha256: sha256(bytes), summary: bytes.toString("utf8").replace(/\s+/g, " ").slice(0, 240), created_at: timestamp };
  state.human_overrides.push(item);
  state.needs_reconciliation = true;
  state.exact_next_action = `Reconcile ${item.id}: identify impacted decisions, artifacts, tasks, agents, tests, and gates.`;
  state.updated_at = timestamp;
  const revision = state.revision + 1;
  const eventId = crypto.randomUUID();
  state.revision = revision;
  state.last_event_id = eventId;
  appendEvent(root, { event_id: eventId, type: "HUMAN_OVERRIDE_RECORDED", state_revision: revision, at: timestamp, ...item });
  writeJson(location, state);
  console.log(`Recorded human override ${item.id}; downstream work requires reconciliation.`);
}

function reconcile(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const { location, state } = loadState(root);
  assertKnownOwner(state, required(flags, "owner"));
  const item = state.human_overrides.find((entry) => entry.id === required(flags, "override-id"));
  if (!item || item.status !== "OPEN") throw new BeaveError(`Open override not found: ${flags["override-id"]}`);
  const evidencePath = path.resolve(required(flags, "evidence-file"));
  const bytes = fs.readFileSync(evidencePath);
  const timestamp = now();
  Object.assign(item, { status: "RECONCILED", reconciled_by: required(flags, "owner"), reconciled_at: timestamp, reconciliation_evidence: path.relative(root, evidencePath) || path.basename(evidencePath), reconciliation_sha256: sha256(bytes) });
  const open = state.human_overrides.filter((entry) => entry.status === "OPEN");
  state.needs_reconciliation = open.length > 0;
  state.exact_next_action = open.length ? `Reconcile ${open[0].id} before continuing.` : required(flags, "next-action");
  state.updated_at = timestamp;
  const revision = state.revision + 1;
  const eventId = crypto.randomUUID();
  state.revision = revision;
  state.last_event_id = eventId;
  appendEvent(root, { event_id: eventId, type: "HUMAN_OVERRIDE_RECONCILED", state_revision: revision, at: timestamp, override_id: item.id, owner: flags.owner, evidence: item.reconciliation_evidence, evidence_sha256: item.reconciliation_sha256 });
  writeJson(location, state);
  console.log(`Reconciled human override ${item.id}`);
}

function contextPack(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const content = contextMarkdown(validateRoot(root));
  if (!flags.output) return console.log(content.trimEnd());
  const relative = String(flags.output);
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw new BeaveError("Context output must stay under .beave/context");
  const output = boundedOutput(stateRoot(root), path.join("context", relative));
  atomicWrite(output, content);
  console.log(`Wrote context pack to ${output}`);
}

function migrate(flags: Flags): void {
  const root = resolveProject(required(flags, "project-root"));
  const location = path.join(stateRoot(root), "state.json");
  const rawState = readJson(location);
  
  if (rawState.schema_version === SCHEMA_VERSION) {
    return console.log(`State already uses schema version ${SCHEMA_VERSION}.`);
  }
  
  if (rawState.schema_version !== 1 && rawState.schema_version !== 2) {
    throw new BeaveError(`No migration path from schema_version=${rawState.schema_version}`);
  }

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
  }

  Object.assign(rawState, { schema_version: SCHEMA_VERSION, beave_version: VERSION, intake_strategy: legacy === "Brief-led" ? "Brief-led" : "Adaptive", human_overrides: rawState.human_overrides || [], needs_reconciliation: Boolean(rawState.needs_reconciliation), revision, last_event_id: eventId, updated_at: now() });
  appendEvent(root, { event_id: eventId, type: "STATE_MIGRATED", state_revision: revision, at: rawState.updated_at, from_schema: rawState.schema_version, to_schema: SCHEMA_VERSION, legacy_interaction_mode: legacy });
  writeJson(location, rawState);
  console.log(`Migrated Beave state to schema ${SCHEMA_VERSION}.`);
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
  console.log(`Beave ${VERSION}\n\nUsage: beave <command> [options]\n\nCommands:\n  capabilities\n  init --project-root . --project-name NAME --project-mode Resume --interaction-mode Standard --owners-file owners.json\n  status --project-root .\n  next --project-root . [--count 1|2|3]\n  resume --project-root .\n  record --project-root . --module N --status CONFIRMED --answer-file FILE --owner NAME\n  override --project-root . --instruction-file FILE --owner NAME [--reason TEXT]\n  reconcile --project-root . --override-id ID --evidence-file FILE --owner NAME --next-action TEXT\n  context-pack --project-root . [--output session.md]\n  validate --project-root .\n  migrate --project-root .\n  export --target portable|codex|claude|gemini|agy --output-dir DIR\n  install --target codex|claude|gemini|agy|all [--scope project|workspace|user] [--project-root DIR] [--dry-run]\n  version`);
}

export async function main(argv: string[]): Promise<number> {
  try {
    const { command, flags } = parse(argv);
    if (!command || command === "help" || command === "--help" || command === "-h") help();
    else if (command === "version" || command === "--version" || command === "-v") console.log(VERSION);
    else if (command === "capabilities") capabilities();
    else if (command === "init") init(flags);
    else if (command === "status") status(flags);
    else if (command === "next") next(flags);
    else if (command === "resume") resume(flags);
    else if (command === "record") record(flags);
    else if (command === "override") override(flags);
    else if (command === "reconcile") reconcile(flags);
    else if (command === "context-pack") contextPack(flags);
    else if (command === "validate") {
      validateRoot(resolveProject(required(flags, "project-root")));
      console.log("Beave state is valid.");
    } else if (command === "migrate") migrate(flags);
    else if (command === "export") exportTarget(flags);
    else if (command === "install") install(flags);
    else throw new BeaveError(`Unknown command: ${command}`);
    return 0;
  } catch (error: any) {
    console.error(`BEAVE ERROR: ${error.message}`);
    return 2;
  }
}
