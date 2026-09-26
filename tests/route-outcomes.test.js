import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { formatOutcomes, gradeDecisions, outcomesFor, promptHash, readSessions, readsAsPushback } from "../scripts/hooks/route-outcomes.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "hooks", "route-outcomes.mjs");
const T0 = Date.parse("2026-09-26T10:00:00Z");
const at = (/** @type {number} */ minutes) => new Date(T0 + minutes * 60000).toISOString();

/** A transcript line the way Claude Code writes one. */
function user(sessionId, minutes, text, extra = {}) {
  return {
    type: "user",
    sessionId,
    timestamp: at(minutes),
    uuid: `${sessionId}-${minutes}`,
    message: { role: "user", content: [{ type: "text", text }] },
    ...extra,
  };
}
function edit(sessionId, minutes, file) {
  return {
    type: "assistant",
    sessionId,
    timestamp: at(minutes),
    message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: file } }] },
  };
}
function decision(sessionId, minutes, prompt, tiers) {
  return { v: 1, ts: at(minutes), sessionId, promptHash: promptHash(prompt), tier: tiers.offline, tiers, routes: {}, signals: {}, answers: {} };
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "route-outcomes-"));
  const project = path.join(dir, "projects", "-Users-me-repo");
  fs.mkdirSync(project, { recursive: true });
  const s = "sess-a";
  const lines = [
    user(s, 0, "add a --quiet flag to the doctor command"),
    edit(s, 1, "src/cli.js"),
    user(s, 3, "no, the flag has to silence the footer too"), // pushback, and the same file again: corrected + reworked
    edit(s, 4, "src/cli.js"),
    user(s, 8, "now document it"), // moved on, edits a different file
    edit(s, 9, "README.md"),
    user(s, 8.5, "now document it"), // the duplicate copy the transcript writes; not a prompt
    user(s, 12, "[Request interrupted by user]"), // an interruption is a correction
    user(s, 13, "thanks"),
    user(s, 200, "unrelated, hours later"), // outside the window for the one before it
    // Tool results and meta records are not prompts.
    { ...user(s, 2, "tool output"), toolUseResult: { ok: true } },
    { ...user(s, 2.5, "context"), isMeta: true },
  ];
  fs.writeFileSync(path.join(project, `${s}.jsonl`), lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  const log = path.join(dir, "route-decisions.jsonl");
  const records = [
    decision(s, 0, "add a --quiet flag to the doctor command", { deterministic: "cheap", offline: "cheap" }),
    decision(s, 8, "now document it", { deterministic: "cheap", offline: "mid" }),
    decision(s, 12.5, "a prompt the transcript never recorded", { deterministic: "mid", offline: "mid" }), // a stray decision joins nothing and must not crash
    decision("sess-zzz", 0, "a session with no transcript", { deterministic: "mid", offline: "mid" }),
  ];
  fs.writeFileSync(log, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return { dir, transcripts: path.join(dir, "projects"), log, records };
}

test("pushback is read from how the next prompt opens", () => {
  for (const text of [
    "no that is wrong",
    "still failing",
    "undo that",
    "why did you delete it",
    "you missed the footer",
    "Actually keep it",
    "[Request interrupted by user]".replace("[", "wait "),
  ]) {
    assert.ok(readsAsPushback(text), text);
  }
  for (const text of ["now document it", "thanks", "open pr", "add tests for the flag"]) assert.ok(!readsAsPushback(text), text);
});

test("sessions are read with prompts, interruptions and edits in order, duplicates and tool results left out", () => {
  const { dir, transcripts } = fixture();
  const sessions = readSessions(transcripts);
  const events = sessions.get("sess-a");
  assert.ok(events);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["prompt", "edit", "prompt", "edit", "prompt", "edit", "interrupt", "prompt", "prompt"],
  );
  assert.deepEqual(outcomesFor(events, 0, 60 * 60000), { followUp: true, corrected: true, reworked: true });
  assert.deepEqual(
    outcomesFor(events, 4, 60 * 60000),
    { followUp: true, corrected: true, reworked: false },
    "the interruption corrects; README was not re-edited",
  );
  assert.deepEqual(outcomesFor(events, 7, 60 * 60000), { followUp: false, corrected: null, reworked: null }, "hours later is not a follow-up");
  assert.deepEqual(outcomesFor(events, 8, 60 * 60000), { followUp: false, corrected: null, reworked: null }, "the last prompt has nothing after it");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("decisions join to their prompt by session and hash, and grade per tier with the minimum-sample rule", () => {
  const { dir, transcripts, log, records } = fixture();
  const data = gradeDecisions(records, readSessions(transcripts), { minSample: 1 });
  assert.equal(data.records, 4);
  assert.equal(data.joined, 2);
  assert.equal(data.unjoined, 2);
  assert.equal(data.graded, 2);
  const offline = data.variants.offline;
  const cheap = offline.tiers.find((t) => t.name === "cheap");
  const mid = offline.tiers.find((t) => t.name === "mid");
  assert.deepEqual([cheap.corrected.n, cheap.corrected.hits, cheap.reworked.n, cheap.reworked.hits], [1, 1, 1, 1]);
  assert.deepEqual([mid.corrected.n, mid.corrected.hits, mid.reworked.n, mid.reworked.hits], [1, 1, 1, 0]);
  assert.equal(cheap.corrected.rate, 1);
  assert.deepEqual(cheap.corrected.ci95, [0.207, 1]);
  assert.equal(offline.monotonic, null, "premium has no rows");
  const deterministic = data.variants.deterministic.tiers.find((t) => t.name === "cheap");
  assert.equal(deterministic.corrected.n, 2, "both joined prompts were deterministic-cheap");

  const withheld = gradeDecisions(records, readSessions(transcripts), { minSample: 30 });
  assert.equal(withheld.variants.offline.tiers[0].corrected.rate, null);
  const text = formatOutcomes(withheld);
  assert.match(text, /1 · 1 _\(n < 30, withheld\)_/);
  assert.match(text, /2 joined to a transcript prompt \(2 not found\)/);

  const run = spawnSync(process.execPath, [SCRIPT, "--log", log, "--transcripts", transcripts, "--min-sample", "1", "--json"], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(run.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.joined, 2);
  const missing = spawnSync(process.execPath, [SCRIPT, "--log", path.join(dir, "nope.jsonl"), "--transcripts", transcripts], { encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no decision log/);
  fs.rmSync(dir, { recursive: true, force: true });
});
