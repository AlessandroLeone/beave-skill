import fs from "node:fs";
import path from "node:path";

/**
 * Turn a fixture into a project an older Beave really could have written.
 *
 * Several tests simulate "a project created before feature X" by editing
 * `.beave/state.json` directly after a real `beave init`. That used to work
 * because nothing compared the two files. It does not any more: an event now
 * records the digest of the state it produced, and the engine refuses to write
 * on top of a state that does not match its own history — which is the whole
 * point of the guard, and which those edits trip.
 *
 * So the fixture is aged honestly instead of the guard being weakened for it:
 * every event is rewritten in the shape an engine without the replay format
 * emitted, which is exactly what a project upgraded from an older version looks
 * like. Nothing is invented — fields are removed, never added — and a project
 * aged this way is also the compatibility case the suite needs: no digest to
 * check, no chain to verify, and every command still working.
 */
const REPLAY_FIELDS = [
  "format",
  "state_patch",
  "state_sha256",
  "previous_state_sha256",
  "previous_revision",
  "previous_event_sha256",
  "payload_sha256",
  "replay_origin",
];

export function ageProject(root) {
  const location = path.join(root, ".beave", "events.jsonl");
  if (!fs.existsSync(location)) return 0;
  let aged = 0;
  const lines = fs
    .readFileSync(location, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const event = JSON.parse(line);
      if (event.format === undefined) return line;
      for (const field of REPLAY_FIELDS) delete event[field];
      aged += 1;
      return JSON.stringify(event);
    });
  fs.writeFileSync(location, `${lines.join("\n")}\n`);
  return aged;
}
