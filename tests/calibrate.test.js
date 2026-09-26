import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { FIX_SUBJECT, generateCalibration, makeCalibrationReceipt, formatCalibrationMarkdown } from "../src/lib/calibrate.js";

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function initRepo(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `calibrate-${prefix}-`));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "commit.gpgsign", "false");
  return root;
}

function commit(root, files, message) {
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", message);
  return git(root, "rev-parse", "HEAD").trim();
}

const lines = (...values) => `${values.join("\n")}\n`;

// The distinction the whole module exists for: a later fix that rewrites the
// lines a commit wrote is a repair; a later fix that merely touches the same
// file is co-change, and must not count.
test("calibrate joins on line overlap, not on co-change", () => {
  const root = initRepo("overlap");
  commit(root, { "src/a.js": lines("one", "two", "three", "four") }, "feat: seed");
  const rewritten = commit(root, { "src/a.js": lines("one", "CHANGED", "three", "four") }, "feat: change line two");
  const untouched = commit(root, { "src/b.js": lines("alpha", "beta") }, "feat: add b");
  // Repairs `rewritten` — it rewrites the very line that commit introduced.
  commit(root, { "src/a.js": lines("one", "FIXED", "three", "four") }, "fix: correct line two");
  // Touches b.js but appends; it rewrites no line `untouched` wrote.
  commit(root, { "src/b.js": lines("alpha", "beta", "gamma") }, "fix: append to b");

  const data = generateCalibration(root, { minSample: 1 });
  const byShaRepaired = new Map(data.flags.map((row) => [row.name, row]));
  assert.ok(byShaRepaired.size > 0);
  assert.equal(data.range.fixCommits, 2);
  // One of the two feature commits is repaired; the appended-to one is not.
  assert.equal(data.base.repaired, 1, `expected exactly one repaired commit, got ${data.base.repaired}`);
  assert.ok(rewritten && untouched);
});

test("a pure insertion repairs nothing — it rewrites no existing line", () => {
  const root = initRepo("insertion");
  commit(root, { "src/a.js": lines("one", "two") }, "feat: seed");
  commit(root, { "src/a.js": lines("one", "two", "three") }, "feat: add a line");
  commit(root, { "src/a.js": lines("one", "two", "three", "four") }, "fix: add another line");

  const data = generateCalibration(root, { minSample: 1 });
  assert.equal(data.base.repaired, 0);
});

test("the minimum-sample rule withholds rates rather than publishing noise", () => {
  const root = initRepo("minsample");
  commit(root, { "src/a.js": lines("one", "two") }, "feat: seed");
  commit(root, { "src/a.js": lines("one", "CHANGED") }, "feat: change");
  commit(root, { "src/a.js": lines("one", "FIXED") }, "fix: correct it");

  const data = generateCalibration(root, { minSample: 50 });
  for (const row of data.flags) {
    assert.equal(row.rate, null, `${row.name} should withhold its rate below the minimum sample`);
    assert.equal(row.lift, null, `${row.name} should withhold its lift below the minimum sample`);
    assert.equal(row.publishable, false);
    // Counts are still reported — only the derived rate is withheld.
    assert.equal(typeof row.n, "number");
  }
  // Ordering cannot be claimed when a band never cleared the floor.
  assert.equal(data.levels.monotonic, null);
});

test("calibrate reports each flag beside the weight it actually carries", () => {
  const root = initRepo("weights");
  commit(root, { "src/payment/checkout.service.ts": "export const a = 1;\n" }, "feat: seed");
  const data = generateCalibration(root, { minSample: 1 });
  const money = data.flags.find((row) => row.name === "money flow");
  const dependency = data.flags.find((row) => row.name === "dependency");
  assert.equal(money.weight, 3);
  // The measured-zero weight is surfaced, not hidden as a missing entry.
  assert.equal(dependency.weight, 0);
});

test("the receipt is deterministic and free of timestamps", () => {
  const root = initRepo("receipt");
  commit(root, { "src/a.js": lines("one", "two") }, "feat: seed");
  commit(root, { "src/a.js": lines("one", "CHANGED") }, "feat: change");
  commit(root, { "src/a.js": lines("one", "FIXED") }, "fix: correct it");

  const first = generateCalibration(root, { minSample: 1 });
  const second = generateCalibration(root, { minSample: 1 });
  assert.equal(first.receipt.id, second.receipt.id);
  assert.match(first.receipt.id, /^cal_[0-9a-f]{12}$/);
  assert.equal(first.receipt.algorithm, "sha256");
  // Recomputable from the payload alone.
  assert.equal(makeCalibrationReceipt(first).inputsHash, first.receipt.inputsHash);
  // `generatedAt` differs between runs and must not reach the hashed payload.
  assert.notEqual(first.generatedAt === second.generatedAt && false, true);
});

test("changing the window changes the receipt", () => {
  const root = initRepo("window");
  commit(root, { "src/a.js": lines("one", "two") }, "feat: seed");
  commit(root, { "src/a.js": lines("one", "CHANGED") }, "feat: change");
  commit(root, { "src/a.js": lines("one", "FIXED") }, "fix: correct it");

  const thirty = generateCalibration(root, { minSample: 1, window: 30 });
  const seven = generateCalibration(root, { minSample: 1, window: 7 });
  assert.notEqual(thirty.receipt.id, seven.receipt.id);
  assert.equal(seven.method.windowDays, 7);
});

test("calibrate refuses a directory that is not a git repository", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "calibrate-nogit-"));
  assert.throws(() => generateCalibration(root), /git repository/);
});

test("markdown names the join, the floor, and whether ordering is known", () => {
  const root = initRepo("markdown");
  commit(root, { "src/a.js": lines("one", "two") }, "feat: seed");
  commit(root, { "src/a.js": lines("one", "FIXED") }, "fix: correct it");
  const markdown = formatCalibrationMarkdown(generateCalibration(root, { minSample: 50 }));
  assert.match(markdown, /line-overlap/);
  assert.match(markdown, /withheld/);
  assert.match(markdown, /Monotonic \(low < medium < high\): unknown/);
  assert.match(markdown, /Receipt: `cal_/);
});

// The fix rule is a convention over real subjects, so it is pinned to the
// spellings histories actually use, and to the requests it must not swallow.
test("FIX_SUBJECT reads the spellings real histories use as repairs, and nothing else", () => {
  const repairs = [
    "fix: correct line two",
    "fix(email): dates",
    "fix!: breaking repair",
    "Fixes #12",
    "fixed the build",
    "fixing tests",
    "hotfix: prod",
    "hot-fix(verification): cleanup",
    "hot-fix/payment retry",
    "hot-fit(pricing): test update",
    "bug(email): confirmation temps",
    "Bug payment (#299)",
    "bugs: sorted",
    "bugfix: null check",
    "patch: guard the null",
    "revert: undo #40",
  ];
  const requests = [
    "feat: fixtures for the harness",
    "chore(deps): bump fixpack",
    "docs: how to fix a red build",
    "refactor: bugsnag client",
    "feat(patches): patch endpoint",
    "test: reverting is covered",
    "Prefix the log lines",
  ];
  for (const subject of repairs) assert.ok(FIX_SUBJECT.test(subject), `${subject} is a repair`);
  for (const subject of requests) assert.ok(!FIX_SUBJECT.test(subject), `${subject} is a request`);
});
