// Grades otito's own risk flags against the repository's own history.
//
// A risk level that has never been compared to an outcome is a heuristic
// wearing a number. This module supplies the comparison: walk history, recover
// which commits each later fix actually repaired, and report per-flag hit rate
// and lift beside the weight that flag carries today.
//
// The join is line-overlap (SZZ): for each fix commit, blame the exact
// pre-image lines it modifies at its parent, and treat the commits owning those
// lines as the ones it repairs. Joining on "same file" instead measures
// co-change, not repair — on a 1,178-commit corpus the file-level join marks
// 91% of commits repaired at a 90-day window against 31% for this one.
//
// Everything here is a pure function of repository state: local, offline, and
// replayable, recorded in a receipt over a canonical timestamp-free payload.
//
// This grades the signal. It is not itself a gate, and it does not tune
// anything: a measured weight is still a human-reviewed code change.
import crypto from "node:crypto";
import path from "node:path";
import { inspectRepo } from "./repo.js";
import { classifyPath, isDocPath, RISK_FLAGS, RISK_SCORE_WEIGHTS } from "./risk-paths.js";
import { classifyFile } from "./code-map/classify.js";
import { runCommand } from "./tools.js";

// Outcome window, in days, joined against by default. Reported alongside a
// sensitivity sweep, because a proxy whose rate tracks the window is measuring
// elapsed time rather than repair.
export const DEFAULT_WINDOW_DAYS = 30;

// A rate computed from a handful of commits is noise with a decimal point. The
// thesis asks for a rule that refuses to publish beneath a floor rather than
// leaving the reader to notice `n` — so rows below this report `null` rates.
export const DEFAULT_MIN_SAMPLE = 30;

const WINDOW_SWEEP_DAYS = [7, 14, 30, 60, 90];
const DAY_SECONDS = 86400;

// Blame on a lockfile or a generated bundle is slow and its "lines" carry no
// authorship meaning. Cap how much of any one file is blamed rather than
// letting a single 20,000-line diff dominate the run.
const MAX_RANGES_PER_FILE = 60;

// `@@ -a,b +c,d @@` — the `-a,b` side is the pre-image range in the parent.
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/;
const BLAME_LINE = /^([0-9a-f]{40}) \d+ \d+/;

// A commit is treated as a repair when its subject announces one. This is a
// convention, not a fact: a fix that is not labelled one is invisible here, and
// that limitation is reported in the payload rather than hidden. The spellings
// are the ones real histories use: on the two bashbop repositories 119
// commits were `hot-fix(...)`, `bug(...)`, `patch` or `fixes`, and under the
// narrower rule they were graded as requests and invisible as repairs.
// `hot-fit` is a typo those histories repeat. A word boundary already covers
// `fix:`, `fix(scope)` and `fix!`.
export const FIX_SUBJECT = /^(fix(es|ed|ing)?|hot-?fix|hot-fit|bug(s|fix)?|patch|revert)\b/i;
export const FIX_COMMIT_RULE = "subject begins fix/fixes/hot-fix/hotfix/bugfix/bug/patch/revert";

/**
 * @typedef {object} CalibrateOptions
 * @property {number|string} [window] outcome window in days
 * @property {number|string} [minSample] refuse to publish a rate below this n
 * @property {string} [since] only consider commits after this date
 * @property {number|string} [max] cap the number of fix commits joined
 */

/**
 * @param {string} [repoPath]
 * @param {CalibrateOptions} [options]
 * @returns {Record<string, any>}
 */
export function generateCalibration(repoPath = ".", options = {}) {
  const repo = inspectRepo(repoPath);
  if (!repo.git.available) {
    throw new Error(`calibration requires a git repository: ${repo.root}`);
  }
  const root = repo.git.root ?? repo.root;
  const windowDays = positiveInt(options.window, DEFAULT_WINDOW_DAYS);
  const minSample = positiveInt(options.minSample, DEFAULT_MIN_SAMPLE);
  const maxFixes = options.max === undefined ? Infinity : positiveInt(options.max, Infinity);

  const commits = readHistory(root, options.since);
  if (!commits.length) {
    throw new Error("calibration found no non-merge commits to measure");
  }

  // The candidate set deliberately excludes commits that announce themselves as
  // fixes: a fix repairing an earlier fix would otherwise be scored as its own
  // outcome. Docs-only commits are excluded because no risk flag can fire.
  const scoreable = commits.filter((commit) => !FIX_SUBJECT.test(commit.subject) && commit.files.some((file) => !isDocPath(file.path)));
  const fixes = commits.filter((commit) => FIX_SUBJECT.test(commit.subject) && commit.parents.length === 1).slice(0, maxFixes);
  const { repairedAfter, joinedFixes } = joinRepairs(root, scoreable, fixes);

  const graded = scoreable.map((commit) => ({
    sha: commit.sha,
    flags: flagsForCommit(commit),
    repairedAfter: repairedAfter.get(commit.sha) ?? null,
  }));

  const within = (/** @type {typeof graded[number]} */ commit, /** @type {number} */ days) =>
    commit.repairedAfter !== null && commit.repairedAfter <= days * DAY_SECONDS;
  const repairedCount = graded.filter((commit) => within(commit, windowDays)).length;
  const baseRate = graded.length ? repairedCount / graded.length : 0;

  const flags = gradeFlags(graded, windowDays, baseRate, minSample, within);
  const levels = gradeLevels(graded, windowDays, baseRate, minSample, within);
  const windowSensitivity = WINDOW_SWEEP_DAYS.map((days) => ({
    days,
    rate: round(graded.filter((commit) => within(commit, days)).length / (graded.length || 1)),
  }));

  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    repo: { root, name: path.basename(root), head: repo.git.commit ?? null },
    method: {
      join: "line-overlap",
      joinDescription: "blame the pre-image lines each fix modifies at its parent; the commits owning those lines are the ones it repairs",
      outcome: "repaired",
      fixCommitRule: FIX_COMMIT_RULE,
      windowDays,
      minSample,
      maxRangesPerFile: MAX_RANGES_PER_FILE,
    },
    range: {
      since: options.since ?? null,
      commits: commits.length,
      scoreable: graded.length,
      fixCommits: fixes.length,
      fixCommitsJoined: joinedFixes,
    },
    base: { rate: round(baseRate), repaired: repairedCount, n: graded.length },
    windowSensitivity,
    flags,
    levels,
    // Named so a reader weighs the number rather than adopting it. These are
    // proxies with known failure modes, not ground truth.
    caveats: [
      "`repaired` is a proxy. Blame attributes a line to its last toucher, which is not always the commit that introduced the defect.",
      "Fix commits are identified by subject convention, so an unlabelled fix is invisible to this join.",
      `Rates over fewer than ${minSample} commits are withheld rather than published.`,
      "One repository is not a representative sample of repositories.",
    ],
  };
  return { ...data, receipt: makeCalibrationReceipt(data) };
}

/**
 * The outcome join, shared with the route regret backtest so both grade
 * against the same notion of "repaired".
 * @param {string} root
 * @param {{ sha: string, time: number }[]} scoreable
 * @param {{ sha: string, parents: string[], time: number }[]} fixes
 * @returns {{ repairedAfter: Map<string, number>, joinedFixes: number }} sha -> seconds until the earliest later fix that touched its lines
 */
export function joinRepairs(root, scoreable, fixes) {
  const scoreableTime = new Map(scoreable.map((commit) => [commit.sha, commit.time]));
  /** @type {Map<string, number>} */
  const repairedAfter = new Map();
  let joinedFixes = 0;
  for (const fix of fixes) {
    const blamed = blameRepairedCommits(root, fix);
    if (blamed.size) joinedFixes += 1;
    for (const sha of blamed) {
      const introducedAt = scoreableTime.get(sha);
      if (introducedAt === undefined) continue;
      // Blaming at the fix's *parent* means the blamed commit is always an
      // ancestor, so ordering is guaranteed by topology rather than by the
      // clock. A negative gap can only be clock skew; a zero gap is a real
      // same-second repair and counts.
      const elapsed = fix.time - introducedAt;
      if (elapsed < 0) continue;
      const best = repairedAfter.get(sha);
      if (best === undefined || elapsed < best) repairedAfter.set(sha, elapsed);
    }
  }
  return { repairedAfter, joinedFixes };
}

/**
 * Per-flag hit rate and lift, with the weight the flag carries today so the two
 * can be read against each other.
 * @param {{ flags: Set<string>, repairedAfter: number|null }[]} graded
 * @param {number} windowDays
 * @param {number} baseRate
 * @param {number} minSample
 * @param {(commit: any, days: number) => boolean} within
 * @returns {Record<string, any>[]}
 */
function gradeFlags(graded, windowDays, baseRate, minSample, within) {
  const names = new Set(graded.flatMap((commit) => [...commit.flags]));
  for (const flag of Object.keys(RISK_SCORE_WEIGHTS)) names.add(flag);
  const rows = [];
  for (const flag of names) {
    const matching = graded.filter((commit) => commit.flags.has(flag));
    rows.push(summarize(flag, matching, baseRate, minSample, windowDays, within, RISK_SCORE_WEIGHTS[flag] ?? null));
  }
  const unflagged = graded.filter((commit) => commit.flags.size === 0);
  rows.push(summarize("(no flag)", unflagged, baseRate, minSample, windowDays, within, null));
  rows.sort((a, b) => (b.lift ?? -1) - (a.lift ?? -1) || b.n - a.n);
  return rows;
}

/**
 * The ordering check that actually matters: are `high` changes empirically
 * worse than `medium`, and `medium` worse than `low`? A gate whose bands are
 * not monotonic is mis-sorting changes regardless of any per-flag number.
 * @param {{ flags: Set<string>, repairedAfter: number|null }[]} graded
 * @param {number} windowDays
 * @param {number} baseRate
 * @param {number} minSample
 * @param {(commit: any, days: number) => boolean} within
 * @returns {Record<string, any>}
 */
function gradeLevels(graded, windowDays, baseRate, minSample, within) {
  const bands = ["low", "medium", "high"];
  const rows = bands.map((level) => {
    const matching = graded.filter((commit) => bandFor(commit.flags) === level);
    return summarize(level, matching, baseRate, minSample, windowDays, within, null);
  });
  const rates = rows.map((row) => row.rate);
  const measured = rates.every((rate) => rate !== null);
  return {
    bands: rows,
    // Only claimed when every band cleared the minimum-sample rule; otherwise
    // the ordering is unknown rather than true or false.
    monotonic: measured ? rates[0] < rates[1] && rates[1] < rates[2] : null,
  };
}

/**
 * @param {string} name
 * @param {{ repairedAfter: number|null }[]} matching
 * @param {number} baseRate
 * @param {number} minSample
 * @param {number} windowDays
 * @param {(commit: any, days: number) => boolean} within
 * @param {number|null} weight
 * @returns {Record<string, any>}
 */
function summarize(name, matching, baseRate, minSample, windowDays, within, weight) {
  const n = matching.length;
  // The minimum-sample rule: below the floor the counts are still reported, but
  // the rate and lift are withheld so nothing downstream can quote them.
  const publishable = n >= minSample;
  const repaired = matching.filter((commit) => within(commit, windowDays)).length;
  const rate = publishable && n ? repaired / n : null;
  return {
    name,
    weight,
    n,
    repaired,
    rate: rate === null ? null : round(rate),
    lift: rate === null || !baseRate ? null : round(rate / baseRate),
    publishable,
  };
}

/** @param {Set<string>} flags @returns {string} */
function bandFor(flags) {
  let score = 0;
  for (const [flag, weight] of Object.entries(RISK_SCORE_WEIGHTS)) {
    if (flags.has(flag)) score += weight;
  }
  return score >= 9 ? "high" : score >= 4 ? "medium" : "low";
}

/**
 * Risk flags implied by a commit's changed paths. Path classification is a pure
 * function of the path, so this is the same answer the gate would have given at
 * the time.
 * @param {{ files: { path: string, additions: number, deletions: number }[] }} commit
 * @returns {Set<string>}
 */
function flagsForCommit(commit) {
  /** @type {Set<string>} */
  const flags = new Set();
  for (const file of commit.files) {
    const kind = classifyFile(file.path);
    for (const flag of classifyPath(file.path, { kind, additions: file.additions, deletions: file.deletions })) {
      flags.add(flag);
    }
  }
  return flags;
}

/**
 * The line-overlap join for a single fix commit: which earlier commits own the
 * lines this fix rewrote?
 * @param {string} root
 * @param {{ sha: string, parents: string[] }} fix
 * @returns {Set<string>}
 */
function blameRepairedCommits(root, fix) {
  /** @type {Set<string>} */
  const blamed = new Set();
  const parent = fix.parents[0];
  if (!parent) return blamed;
  // `--diff-filter=M` keeps modifications only: an added file has no pre-image
  // lines to blame, and a deleted one repairs nothing line-wise.
  const diff = tryGit(root, ["diff", "--unified=0", "--no-renames", "--no-color", "--diff-filter=M", parent, fix.sha]);
  if (!diff) return blamed;

  /** @type {Map<string, [number, number][]>} */
  const rangesByFile = new Map();
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      if (!rangesByFile.has(file)) rangesByFile.set(file, []);
      continue;
    }
    if (!file) continue;
    const match = HUNK_HEADER.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    // A pure insertion reports a zero-length pre-image range: it rewrote no
    // existing line, so it repairs nothing under this join.
    if (count === 0) continue;
    rangesByFile.get(file)?.push([start, start + count - 1]);
  }

  for (const [target, ranges] of rangesByFile) {
    if (!ranges.length || ranges.length > MAX_RANGES_PER_FILE) continue;
    const args = ["blame", "--porcelain", "-w", "--no-progress"];
    for (const [from, to] of ranges) args.push("-L", `${from},${to}`);
    args.push(parent, "--", target);
    const output = tryGit(root, args);
    if (!output) continue;
    for (const line of output.split("\n")) {
      const match = BLAME_LINE.exec(line);
      if (match) blamed.add(match[1]);
    }
  }
  return blamed;
}

/**
 * Non-merge commits, newest first, with per-file line counts.
 * @param {string} root
 * @param {string} [since]
 * @returns {{ sha: string, parents: string[], time: number, subject: string, files: { path: string, additions: number, deletions: number }[] }[]}
 */
export function readHistory(root, since) {
  // Record separator: built from a character code so no literal control
  // byte lands in the source, and spawn never sees a null in an argument.
  const separator = `${String.fromCharCode(30)}otito${String.fromCharCode(30)}`;
  const args = ["log", "--no-merges", "--numstat", "--no-renames", `--format=${separator}%H%x09%P%x09%ct%x09%s`];
  if (since) args.push(`--since=${since}`);
  const raw = tryGit(root, args);
  if (!raw) return [];
  const commits = [];
  for (const chunk of raw.split(separator).slice(1)) {
    const lines = chunk.split("\n");
    const [sha, parents, time, ...subjectParts] = lines[0].split("\t");
    if (!sha) continue;
    const files = [];
    for (const line of lines.slice(1)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [additions, deletions, filePath] = trimmed.split("\t");
      // A binary file reports "-" for both counts and has no lines to blame.
      if (!filePath || additions === "-") continue;
      files.push({ path: filePath, additions: Number(additions) || 0, deletions: Number(deletions) || 0 });
    }
    commits.push({
      sha,
      parents: String(parents ?? "")
        .split(" ")
        .filter(Boolean),
      time: Number(time) || 0,
      subject: subjectParts.join("\t"),
      files,
    });
  }
  return commits;
}

/**
 * Git calls here are measurements, not actions: a missing ref or an unreadable
 * blob means "no evidence", never a failed run.
 * @param {string} root
 * @param {string[]} args
 * @returns {string}
 */
function tryGit(root, args) {
  const result = runCommand("git", args, { cwd: root, maxBuffer: 1024 * 1024 * 64 });
  return result.ok ? result.stdout : "";
}

/**
 * Deterministic receipt over a canonical, timestamp-free payload, so a number
 * quoted in a README can be traced back to the run that produced it.
 * @param {Record<string, any>} data
 * @returns {{ id: string, algorithm: string, commit: string|null, inputsHash: string }}
 */
export function makeCalibrationReceipt(data) {
  const canonical = {
    engine: "otito-calibrate",
    join: data.method.join,
    outcome: data.method.outcome,
    fixCommitRule: data.method.fixCommitRule,
    windowDays: data.method.windowDays,
    minSample: data.method.minSample,
    commit: data.repo.head ?? null,
    since: data.range.since,
    range: data.range,
    base: data.base,
    windowSensitivity: data.windowSensitivity,
    flags: data.flags.map((/** @type {any} */ row) => [row.name, row.n, row.repaired, row.rate, row.lift]),
    levels: data.levels.bands.map((/** @type {any} */ row) => [row.name, row.n, row.repaired, row.rate]),
    monotonic: data.levels.monotonic,
  };
  const inputsHash = crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return { id: `cal_${inputsHash.slice(0, 12)}`, algorithm: "sha256", commit: canonical.commit, inputsHash };
}

/** @param {unknown} value @param {number} fallback @returns {number} */
function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** @param {number} value @returns {number} */
function round(value) {
  return Math.round(value * 1000) / 1000;
}

/**
 * @param {Record<string, any>} data
 * @returns {string}
 */
export function formatCalibrationMarkdown(data) {
  const pct = (/** @type {number|null} */ value) => (value === null ? "—" : `${(value * 100).toFixed(1)}%`);
  const lift = (/** @type {number|null} */ value) => (value === null ? "—" : `${value.toFixed(2)}x`);
  const lines = [
    `# Calibration — ${data.repo.name}`,
    "",
    `Join: ${data.method.join} · outcome: \`${data.method.outcome}\` · window: ${data.method.windowDays}d · minimum sample: ${data.method.minSample}`,
    `Corpus: ${data.range.scoreable} scoreable commits, ${data.range.fixCommits} fix commits (${data.range.fixCommitsJoined} joined to a parent)`,
    `Base rate: ${pct(data.base.rate)} (${data.base.repaired}/${data.base.n})`,
    "",
    "## Per-flag",
    "",
    "| Flag | weight | n | repaired | lift |",
    "| --- | ---: | ---: | ---: | ---: |",
  ];
  for (const row of data.flags) {
    const weight = row.weight === null ? "—" : `+${row.weight}`;
    const suffix = row.publishable ? "" : ` _(n < ${data.method.minSample}, withheld)_`;
    lines.push(`| ${row.name} | ${weight} | ${row.n} | ${pct(row.rate)}${suffix} | ${lift(row.lift)} |`);
  }
  lines.push("", "## Level ordering", "");
  lines.push("| Level | n | repaired | lift |", "| --- | ---: | ---: | ---: |");
  for (const row of data.levels.bands) {
    lines.push(`| ${row.name} | ${row.n} | ${pct(row.rate)} | ${lift(row.lift)} |`);
  }
  const verdict =
    data.levels.monotonic === null ? "unknown (a band fell below the minimum sample)" : data.levels.monotonic ? "yes" : "**no — bands are mis-sorted**";
  lines.push("", `Monotonic (low < medium < high): ${verdict}`);
  lines.push("", "## Window sensitivity", "");
  lines.push(`| ${data.windowSensitivity.map((/** @type {any} */ row) => `${row.days}d`).join(" | ")} |`);
  lines.push(`| ${data.windowSensitivity.map(() => "---:").join(" | ")} |`);
  lines.push(`| ${data.windowSensitivity.map((/** @type {any} */ row) => pct(row.rate)).join(" | ")} |`);
  lines.push("", "A rate that tracks the window is measuring elapsed time rather than repair.");
  lines.push("", "## Caveats", "");
  for (const caveat of data.caveats) lines.push(`- ${caveat}`);
  lines.push("", `Receipt: \`${data.receipt.id}\` (${data.receipt.algorithm}, inputs ${data.receipt.inputsHash.slice(0, 12)}…)`);
  return lines.join("\n");
}

export const RISK_FLAG_NAMES = Object.values(RISK_FLAGS);
