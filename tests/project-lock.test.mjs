import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Two processes on one project, made to overlap on purpose.
 *
 * The engine used to have no project lock at all. `appendEvent` reads the event
 * log, appends a line and writes it back; `commitState` reads the state, computes
 * a patch against it and writes the result. Two processes reaching either at the
 * same revision lose an event or build a state on a revision that has already
 * moved. An independent review ran forty parallel mutations without producing a
 * collision and drew the right conclusion from it: an overlap that was never
 * forced is not evidence of safety.
 *
 * So nothing here is probabilistic. `PLANGONAUT_TEST_SYNC` names a path: once a
 * process is inside the critical section it writes `<path>.ready` and waits for
 * `<path>.go`. The test starts the first process, waits for `.ready` — at which
 * point the first is provably holding the lock — starts the second, observes
 * what it does, and only then releases the first. If the lock were absent the
 * second would sail straight through, and several of these tests would pass for
 * the wrong reason; the first one below is the control that makes that visible.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HERE, "..", "lib", "bin", "plangonaut.js");

let counter = 0;

function plangonaut(root, args, env = {}) {
  counter += 1;
  const full = [...args];
  if (!full.includes("--operation-id")) full.push("--operation-id", `L${counter}-${Date.now()}`);
  const result = spawnSync(process.execPath, [CLI, ...full], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}`.trim() };
}

function ok(root, args, env) {
  const result = plangonaut(root, args, env);
  assert.strictEqual(result.status, 0, `expected success from ${args[0]}:\n${result.out}`);
  return result.out;
}

function project(t, name = "Locked") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plangonaut-lock-"));
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

const lockPath = (root) => path.join(root, ".plangonaut", "lock.json");
const statePath = (root) => path.join(root, ".plangonaut", "state.json");
const eventsPath = (root) => path.join(root, ".plangonaut", "events.jsonl");
const readState = (root) => JSON.parse(fs.readFileSync(statePath(root), "utf8"));
const readEvents = (root) =>
  fs.readFileSync(eventsPath(root), "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

/** Wait, bounded, for a file to appear. Returns false if it never does. */
function waitForFile(file, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return true;
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},20)"], { timeout: 200 });
  }
  return false;
}

/**
 * Start a command and return once it is provably inside the critical section.
 *
 * `release()` lets it finish; `wait()` returns its exit code and output.
 */
function startHolding(t, root, args, marker, env = {}) {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: root,
    env: { ...process.env, PLANGONAUT_TEST_SYNC: marker, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });

  assert.ok(waitForFile(`${marker}.ready`), "the first process never reached the critical section");
  return {
    child,
    release: () => fs.writeFileSync(`${marker}.go`, "go\n"),
    wait: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve({ status: child.exitCode, out: output.trim() });
        child.on("close", (status) => resolve({ status, out: output.trim() }));
      }),
  };
}

function marker(root, name) {
  return path.join(root, `${name}-sync`);
}

// ---------------------------------------------------------------------------
// 1-3. One at a time, and the second one is told why
// ---------------------------------------------------------------------------

test("only one process is inside the critical section, and the lock says who", async (t) => {
  const root = project(t);
  const sync = marker(root, "one");
  const first = startHolding(t, root, [
    "decision", "--project-root", root, "--id", "DEC-0001", "--title", "First", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-FIRST",
  ], sync);

  // Provably inside: the lock file exists and names the process holding it.
  assert.ok(fs.existsSync(lockPath(root)), "no lock was taken");
  const held = JSON.parse(fs.readFileSync(lockPath(root), "utf8"));
  assert.strictEqual(held.pid, first.child.pid);
  assert.strictEqual(held.host, os.hostname());
  assert.strictEqual(held.command, "decision");
  assert.strictEqual(held.operation_id, "OP-FIRST");
  assert.ok(held.lock_id && held.at, "the lock carries no identity or instant");

  // The second process does not get in. It waits, then says exactly what it is
  // waiting behind — the wait is bounded, so this test cannot hang.
  const second = plangonaut(root, [
    "decision", "--project-root", root, "--id", "DEC-0002", "--title", "Second", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-SECOND",
  ]);
  assert.notStrictEqual(second.status, 0, "the second process entered while the first held the lock");
  assert.match(second.out, /in use by another Plangonaut process/);
  assert.match(second.out, new RegExp(`process ${first.child.pid}`));
  assert.match(second.out, /Nothing was changed/);

  first.release();
  const finished = await first.wait();
  assert.strictEqual(finished.status, 0, finished.out);

  // Nothing of the refused one was written.
  assert.strictEqual(readState(root).decisions.length, 1);
  assert.strictEqual(readState(root).decisions[0].id, "DEC-0001");
});

test("the second process succeeds once the first has finished", async (t) => {
  const root = project(t);
  const sync = marker(root, "retry");
  const first = startHolding(t, root, [
    "decision", "--project-root", root, "--id", "DEC-0001", "--title", "First", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-A",
  ], sync);

  const refusedWhileHeld = plangonaut(root, ["decision", "--project-root", root, "--id", "DEC-0002", "--title", "Second", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-B"]);
  assert.notStrictEqual(refusedWhileHeld.status, 0);

  first.release();
  assert.strictEqual((await first.wait()).status, 0);
  assert.ok(!fs.existsSync(lockPath(root)), "the lock was not released on a normal exit");

  ok(root, ["decision", "--project-root", root, "--id", "DEC-0002", "--title", "Second", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-B"]);
  const state = readState(root);
  assert.deepStrictEqual(state.decisions.map((item) => item.id), ["DEC-0001", "DEC-0002"]);
  assert.strictEqual(state.revision, 3);
});

test("two processes cannot apply the same revision, and no event is lost", async (t) => {
  const root = project(t);
  const sync = marker(root, "revision");
  const before = readState(root).revision;

  const first = startHolding(t, root, [
    "risk", "--project-root", root, "--id", "RSK-0001", "--title", "Oven fails", "--severity", "HIGH", "--status", "IDENTIFIED", "--owner", "Ada", "--operation-id", "OP-R1",
  ], sync);

  // The second reads the same revision the first is about to advance past.
  const blocked = plangonaut(root, ["risk", "--project-root", root, "--id", "RSK-0002", "--title", "Flour shortage", "--severity", "MEDIUM", "--status", "IDENTIFIED", "--owner", "Ada", "--operation-id", "OP-R2"]);
  assert.notStrictEqual(blocked.status, 0);

  first.release();
  assert.strictEqual((await first.wait()).status, 0);
  ok(root, ["risk", "--project-root", root, "--id", "RSK-0002", "--title", "Flour shortage", "--severity", "MEDIUM", "--status", "IDENTIFIED", "--owner", "Ada", "--operation-id", "OP-R2"]);

  const events = readEvents(root);
  const revisions = events.map((event) => Number(event.state_revision));
  assert.deepStrictEqual(revisions, [...new Set(revisions)], "a revision was applied twice");
  for (let index = 1; index < revisions.length; index += 1) {
    assert.strictEqual(revisions[index], revisions[index - 1] + 1, "a revision was skipped");
  }
  assert.strictEqual(revisions[revisions.length - 1], before + 2, "an event was lost");
  assert.strictEqual(readState(root).risks.length, 2);
  assert.strictEqual(plangonaut(root, ["replay", "--project-root", root]).status, 0);
  assert.strictEqual(plangonaut(root, ["validate", "--project-root", root]).status, 0);
});

// ---------------------------------------------------------------------------
// 4-6. A read that can recover is inside the same boundary
// ---------------------------------------------------------------------------

test("a read that can trigger recovery waits behind the lock, and one that cannot does not", async (t) => {
  const root = project(t);
  const sync = marker(root, "reads");
  const first = startHolding(t, root, [
    "decision", "--project-root", root, "--id", "DEC-0001", "--title", "First", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-READ",
  ], sync);

  // `status` loads the state, and loading runs recovery, so it is a writer's
  // neighbour whatever its name suggests.
  const status = plangonaut(root, ["status", "--project-root", root]);
  assert.notStrictEqual(status.status, 0, "a command that can recover entered while the project was locked");
  assert.match(status.out, /in use by another Plangonaut process/);

  // `replay --verify` deliberately never recovers, so it is free to read. It
  // reports what it saw rather than pretending the project is idle.
  const verified = plangonaut(root, ["replay", "--project-root", root, "--verify"]);
  assert.strictEqual(verified.status, 0, verified.out);

  first.release();
  assert.strictEqual((await first.wait()).status, 0);
});

// ---------------------------------------------------------------------------
// 7-9. What happens to a lock nobody released
// ---------------------------------------------------------------------------

test("a killed process leaves a lock that the next command can take over, and says it did", (t) => {
  const root = project(t);
  // A lock left exactly as a kill leaves one: this host, a PID that is gone.
  const dead = {
    lock_id: "11111111-2222-3333-4444-555555555555",
    pid: 999_999,
    host: os.hostname(),
    at: "2026-09-12T00:00:00.000Z",
    command: "decision",
    operation_id: "OP-DEAD",
    observed_revision: 1,
  };
  fs.writeFileSync(lockPath(root), `${JSON.stringify(dead, null, 2)}\n`);

  ok(root, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "After the kill", "--status", "APPROVED", "--owner", "Ada"]);
  assert.strictEqual(readState(root).decisions.length, 1);
  assert.ok(!fs.existsSync(lockPath(root)), "the takeover did not release its own lock");
  assert.strictEqual(plangonaut(root, ["replay", "--project-root", root]).status, 0);
  assert.strictEqual(plangonaut(root, ["validate", "--project-root", root]).status, 0);
});

test("a lock held by a live process is never taken, with or without --force", async (t) => {
  const root = project(t);
  const sync = marker(root, "live");
  const first = startHolding(t, root, [
    "decision", "--project-root", root, "--id", "DEC-0001", "--title", "Holding", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-LIVE",
  ], sync);

  const inspected = ok(root, ["unlock", "--project-root", root]);
  assert.match(inspected, /still running on this machine/);
  assert.match(inspected, /Nothing was changed/);

  const forced = plangonaut(root, ["unlock", "--project-root", root, "--force"]);
  assert.notStrictEqual(forced.status, 0, "--force took a lock from a running process");
  assert.match(forced.out, /will not take a lock from a live process/);
  assert.ok(fs.existsSync(lockPath(root)), "the lock was removed anyway");

  first.release();
  assert.strictEqual((await first.wait()).status, 0);
});

test("a lock from another host, or one that cannot be read, takes an explicit release", (t) => {
  const root = project(t);
  const remote = {
    lock_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    pid: 4242,
    host: `${os.hostname()}-somewhere-else`,
    at: "2026-09-12T00:00:00.000Z",
    command: "doc-save",
    operation_id: "OP-REMOTE",
    observed_revision: 1,
  };
  fs.writeFileSync(lockPath(root), `${JSON.stringify(remote, null, 2)}\n`);

  const refusedRemote = plangonaut(root, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "x", "--status", "APPROVED", "--owner", "Ada"]);
  assert.notStrictEqual(refusedRemote.status, 0);
  assert.match(refusedRemote.out, /locked by another machine/);
  assert.match(refusedRemote.out, /plangonaut unlock/);
  assert.ok(fs.existsSync(lockPath(root)), "a remote lock was taken automatically");

  ok(root, ["unlock", "--project-root", root, "--force"]);
  ok(root, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "x", "--status", "APPROVED", "--owner", "Ada"]);

  /*
   * A lock nobody can read is not released by `--force` either.
   *
   * The second independent review broke exactly that: an unreadable record made
   * the holder look absent, the live-process guard did not fire, and `--force`
   * took a lock a running process was holding — while the acquisition message
   * was telling the user to run precisely that command. There is no safe
   * automatic answer, so the decision goes to a person.
   */
  fs.writeFileSync(lockPath(root), "this is not json\n");
  const refusedUnreadable = plangonaut(root, ["decision", "--project-root", root, "--id", "DEC-0002", "--title", "y", "--status", "APPROVED", "--owner", "Ada"]);
  assert.notStrictEqual(refusedUnreadable.status, 0);
  assert.match(refusedUnreadable.out, /lock cannot be read/);
  assert.match(refusedUnreadable.out, /neither will/);
  assert.match(refusedUnreadable.out, /delete that file yourself/);

  const inspected = ok(root, ["unlock", "--project-root", root]);
  assert.match(inspected, /cannot tell what holds it/);
  assert.match(inspected, /--force will not change it either/);

  const forced = plangonaut(root, ["unlock", "--project-root", root, "--force"]);
  assert.notStrictEqual(forced.status, 0, "--force removed a lock nobody could read");
  assert.match(forced.out, /cannot tell whether a process is holding it/);
  assert.ok(fs.existsSync(lockPath(root)), "the unreadable lock was removed anyway");

  // The way out the message names is the one that works.
  fs.rmSync(lockPath(root));
  ok(root, ["decision", "--project-root", root, "--id", "DEC-0002", "--title", "y", "--status", "APPROVED", "--owner", "Ada"]);
  assert.strictEqual(plangonaut(root, ["replay", "--project-root", root]).status, 0);
});

test("a lock whose pid is not a number is never treated as an abandoned one", (t) => {
  const root = project(t);
  // Same live process, recorded as a string. `processIsAlive` used to require an
  // integer and answer "dead" for anything else, so this lock was taken in
  // silence — from a process that was running.
  const sync = marker(root, "typed");
  const first = startHolding(t, root, [
    "decision", "--project-root", root, "--id", "DEC-0001", "--title", "Holding", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-TYPED",
  ], sync);
  const held = JSON.parse(fs.readFileSync(lockPath(root), "utf8"));
  fs.writeFileSync(lockPath(root), `${JSON.stringify({ ...held, pid: String(held.pid) }, null, 2)}\n`);

  // A numeric string is a pid: it is read as one, the process is found alive,
  // and the lock is not taken. It used to fail `Number.isInteger` and be called
  // dead.
  const blocked = plangonaut(root, ["decision", "--project-root", root, "--id", "DEC-0002", "--title", "y", "--status", "APPROVED", "--owner", "Ada"]);
  assert.notStrictEqual(blocked.status, 0, "the lock was taken from a live process");
  assert.match(blocked.out, /in use by another Plangonaut process/);
  assert.ok(fs.existsSync(lockPath(root)), "the lock was removed");

  first.release();
  return first.wait();
});

test("a lock whose pid cannot be read at all is refused rather than assumed dead", (t) => {
  const root = project(t);
  const nonsense = {
    lock_id: "22222222-3333-4444-5555-666666666666",
    pid: "not a process id",
    host: os.hostname(),
    at: "2026-09-12T00:00:00.000Z",
    command: "doc-save",
    operation_id: "OP-NONSENSE",
    observed_revision: 1,
  };
  fs.writeFileSync(lockPath(root), `${JSON.stringify(nonsense, null, 2)}
`);

  const refusedRun = plangonaut(root, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "x", "--status", "APPROVED", "--owner", "Ada"]);
  assert.notStrictEqual(refusedRun.status, 0, "a lock with an unreadable holder was taken");
  assert.match(refusedRun.out, /does not say which process holds it/);
  assert.match(refusedRun.out, /delete that file yourself/);
  assert.ok(fs.existsSync(lockPath(root)));

  // And `--force` will not do it either, for the same reason.
  const forced = plangonaut(root, ["unlock", "--project-root", root, "--force"]);
  assert.notStrictEqual(forced.status, 0);
  assert.ok(fs.existsSync(lockPath(root)));

  fs.rmSync(lockPath(root));
  ok(root, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "x", "--status", "APPROVED", "--owner", "Ada"]);
});

test("the lock does not remove anything it did not write", (t) => {
  const root = project(t);
  const bystander = path.join(root, ".plangonaut", "something-a-user-left.txt");
  fs.writeFileSync(bystander, "not Plangonaut's\n");
  const dead = { lock_id: "x", pid: 999_999, host: os.hostname(), at: "2026-09-12T00:00:00.000Z", command: "decision", operation_id: null, observed_revision: null };
  fs.writeFileSync(lockPath(root), `${JSON.stringify(dead, null, 2)}\n`);

  ok(root, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "x", "--status", "APPROVED", "--owner", "Ada"]);
  assert.ok(fs.existsSync(bystander), "a file the engine did not write was removed");
  assert.strictEqual(fs.readFileSync(bystander, "utf8"), "not Plangonaut's\n");
});

test("a kill really does leave the lock behind, which is what makes the takeover rules matter", async (t) => {
  const root = project(t);
  const sync = marker(root, "killed");
  const first = startHolding(t, root, [
    "decision", "--project-root", root, "--id", "DEC-0001", "--title", "Interrupted", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-KILL",
  ], sync);

  const held = JSON.parse(fs.readFileSync(lockPath(root), "utf8"));
  first.child.kill("SIGKILL");
  await first.wait();

  // The file is still there: no `finally` runs for a killed process, and that is
  // exactly the state the stale-lock rules are written for.
  assert.ok(fs.existsSync(lockPath(root)), "the lock vanished, so this test proves nothing");
  assert.strictEqual(JSON.parse(fs.readFileSync(lockPath(root), "utf8")).lock_id, held.lock_id);

  // The next command takes it over, because that PID is certainly gone.
  ok(root, ["decision", "--project-root", root, "--id", "DEC-0002", "--title", "After", "--status", "APPROVED", "--owner", "Ada"]);
  assert.strictEqual(plangonaut(root, ["replay", "--project-root", root]).status, 0);
  assert.strictEqual(plangonaut(root, ["validate", "--project-root", root]).status, 0);
  assert.ok(!fs.existsSync(lockPath(root)));
});

// ---------------------------------------------------------------------------
// 12-13. What the lock prevents, shown rather than asserted
// ---------------------------------------------------------------------------

/*
 * The second independent review's P2-6.
 *
 * Every test above stops a process just after it takes the lock, which proves
 * mutual exclusion: a second process does not get in. It cannot prove that
 * getting in would cost anything, because at that moment the first process has
 * not yet read `state.json` — the read-modify-write window the lock exists to
 * protect had not opened. The reviewer said so plainly: "the seam demonstrates
 * mutual exclusion, not the absence of a lost update", and asked for a second
 * synchronisation point after the revision is read.
 *
 * There is one now, `PLANGONAUT_TEST_SYNC_AT=read`, and with `PLANGONAUT_TEST_UNSAFE_NO_LOCK`
 * the lock can be taken away so the damage can be produced on purpose. These two
 * tests are a pair: the first is the counter-example, the second is the same
 * choreography with the lock back.
 */

test("without the lock, two writers in one window destroy each other's work", async (t) => {
  const root = project(t);
  const sync = marker(root, "lost-update");
  const before = readState(root).revision;

  // A reads the revision it will build on, and stops inside the window.
  const first = startHolding(t, root, [
    "decision", "--project-root", root, "--id", "DEC-0001", "--title", "A", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-LU-A",
  ], sync, { PLANGONAUT_TEST_SYNC_AT: "read", PLANGONAUT_TEST_UNSAFE_NO_LOCK: "1" });
  assert.ok(!fs.existsSync(lockPath(root)), "the seam did not actually remove the lock");

  // B runs the whole operation while A is in there, and succeeds.
  const second = plangonaut(root, [
    "decision", "--project-root", root, "--id", "DEC-0002", "--title", "B", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-LU-B",
  ], { PLANGONAUT_TEST_UNSAFE_NO_LOCK: "1" });
  assert.strictEqual(second.status, 0, second.out);
  assert.match(second.out, /PLANGONAUT_TEST_UNSAFE_NO_LOCK is set/);

  first.release();
  const finished = await first.wait();
  assert.strictEqual(finished.status, 0, "both processes reported success, which is the point");

  /*
   * Both said they created a decision. One of them is gone: A recomputed its
   * patch against what it found on disk, so the chain stayed continuous while
   * B's decision was overwritten inside it. This is the damage, recorded as
   * what actually happens rather than as a warning about what might.
   */
  const state = readState(root);
  assert.deepStrictEqual(state.decisions.map((item) => item.id), ["DEC-0001"], "the overlap did not produce the lost update it exists to demonstrate");
  assert.strictEqual(state.revision, before + 1, "the revision advanced twice for two writes, which would mean nothing was lost");

  const revisions = readEvents(root).map((event) => Number(event.state_revision));
  assert.notDeepStrictEqual(revisions, [...new Set(revisions)], "no revision was reused, so no update was lost");

  // And both commands that judge a project say so.
  const validated = plangonaut(root, ["validate", "--project-root", root]);
  assert.strictEqual(validated.status, 2, validated.out);
  const replayed = plangonaut(root, ["replay", "--project-root", root, "--verify"]);
  assert.strictEqual(replayed.status, 2, `replay accepted a history holding a lost update:
${replayed.out}`);
  assert.match(replayed.out, /the revision does not advance/);
});

test("with the lock, the same choreography cannot start", async (t) => {
  const root = project(t);
  const sync = marker(root, "no-lost-update");
  const before = readState(root).revision;

  // Identical to the test above in every respect but one: the lock is there.
  const first = startHolding(t, root, [
    "decision", "--project-root", root, "--id", "DEC-0001", "--title", "A", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-OK-A",
  ], sync, { PLANGONAUT_TEST_SYNC_AT: "read" });
  assert.ok(fs.existsSync(lockPath(root)), "no lock was taken");

  const blocked = plangonaut(root, [
    "decision", "--project-root", root, "--id", "DEC-0002", "--title", "B", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-OK-B",
  ]);
  assert.notStrictEqual(blocked.status, 0, "the second writer entered the window the first was inside");
  assert.match(blocked.out, /in use by another Plangonaut process/);

  first.release();
  assert.strictEqual((await first.wait()).status, 0);
  ok(root, ["decision", "--project-root", root, "--id", "DEC-0002", "--title", "B", "--status", "APPROVED", "--owner", "Ada", "--operation-id", "OP-OK-B"]);

  const state = readState(root);
  assert.deepStrictEqual(state.decisions.map((item) => item.id), ["DEC-0001", "DEC-0002"], "a decision was lost with the lock in place");
  assert.strictEqual(state.revision, before + 2);
  const revisions = readEvents(root).map((event) => Number(event.state_revision));
  assert.deepStrictEqual(revisions, [...new Set(revisions)], "a revision was applied twice");
  assert.strictEqual(plangonaut(root, ["validate", "--project-root", root]).status, 0);
  assert.strictEqual(plangonaut(root, ["replay", "--project-root", root, "--verify"]).status, 0);
});

// ---------------------------------------------------------------------------
// 14-15. A lock being born is not a broken lock
// ---------------------------------------------------------------------------

/*
 * Found by this suite failing on a project it was not writing to.
 *
 * `writeLockRecord` creates the file with `O_CREAT | O_EXCL` and fills it on the
 * next line -- that is what makes the acquisition atomic -- so for a few
 * microseconds the file exists and is empty. A second process reading in that
 * window concluded the lock could not be read, which is the most expensive
 * conclusion this engine draws: a hard refusal that sends a person to delete a
 * file by hand. Two ordinary commands overlapping were enough to produce it.
 */

test("a lock caught between its creation and its content is read, not condemned", async (t) => {
  const root = project(t);
  const file = lockPath(root);

  // The window, held open by hand: the file exists and is empty, exactly as it
  // is for an instant during a real acquisition. The reader has to be started
  // asynchronously -- `spawnSync` would block this process's timers, and the
  // file would be filled only after the child had already given its answer.
  fs.writeFileSync(file, "");
  const child = spawn(process.execPath, [CLI, "unlock", "--project-root", root], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  child.stderr.on("data", (chunk) => { out += chunk; });
  const filler = setTimeout(() => {
    fs.writeFileSync(file, JSON.stringify({ lock_id: "L", pid: 999_999_998, host: os.hostname(), at: new Date().toISOString(), command: "decision", operation_id: "OP-X", observed_revision: 1 }));
  }, 40);
  t.after(() => clearTimeout(filler));
  const status = await new Promise((resolve) => child.on("close", resolve));

  const reported = { status, out: out.trim() };
  assert.strictEqual(reported.status, 0, reported.out);
  assert.doesNotMatch(
    reported.out,
    /cannot be read|unreadable/,
    "a lock that was merely being written was reported as damaged",
  );
  assert.match(reported.out, /process 999999998/);
});

test("a lock that is genuinely empty is still refused, and says the same thing", (t) => {
  const root = project(t);
  fs.writeFileSync(lockPath(root), "");

  // Patience is bounded: nothing ever fills this one, and the answer is the
  // answer it always was -- Plangonaut will not reason about a file it cannot read.
  const started = Date.now();
  const refused = plangonaut(root, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Blocked", "--status", "APPROVED", "--owner", "Ada"]);
  assert.notStrictEqual(refused.status, 0);
  assert.match(refused.out, /locked and the lock cannot be read/);
  assert.ok(Date.now() - started < 20_000, "the patient read did not give up");

  const reported = plangonaut(root, ["unlock", "--project-root", root]);
  assert.match(reported.out, /unreadable/);
  const forced = plangonaut(root, ["unlock", "--project-root", root, "--force"]);
  assert.notStrictEqual(forced.status, 0, "--force removed a lock Plangonaut cannot read");
  assert.ok(fs.existsSync(lockPath(root)), "the unreadable lock was removed anyway");
});

// ---------------------------------------------------------------------------
// 16. A lock that does not name a machine
// ---------------------------------------------------------------------------

test("a lock with no host is not a lock from another machine", (t) => {
  const root = project(t);
  /*
   * `--force` may release a lock from another host: this engine cannot ask a
   * machine it cannot see whether a process is alive, and someone has to be able
   * to break a lock left on a shared folder. `mine` was `record.host ===
   * os.hostname()`, so a record with no host at all took that branch -- and a
   * third independent review released, with `--force`, a lock naming a process
   * that was running on this machine at that moment.
   */
  fs.writeFileSync(lockPath(root), JSON.stringify({ lock_id: "x", pid: process.pid, at: new Date().toISOString(), command: "decision" }));

  const reported = plangonaut(root, ["unlock", "--project-root", root]);
  assert.match(reported.out, /does not say which machine holds it/);
  const forced = plangonaut(root, ["unlock", "--project-root", root, "--force"]);
  assert.notStrictEqual(forced.status, 0, "--force released a lock that names no machine");
  assert.ok(fs.existsSync(lockPath(root)), "the lock was removed anyway");

  // And a command arriving at that lock does not take it over either.
  const refused = plangonaut(root, ["decision", "--project-root", root, "--id", "DEC-0001", "--title", "Blocked", "--status", "APPROVED", "--owner", "Ada"]);
  assert.notStrictEqual(refused.status, 0);
  assert.ok(fs.existsSync(lockPath(root)));
});
