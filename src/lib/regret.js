// Grades the router's tier against the repository's own history.
//
// `otito route` recommends cheap, mid or premium from two halves: otito's
// deterministic read of the repository (AX, containment, risk paths) and a
// model's read of the request. Neither half has been compared to an outcome.
// This module supplies the comparison the calibration thesis asks for: replay
// history, recompute the tier from the state as it was, and join to the same
// `repaired` outcome `otito calibrate` uses for risk flags.
//
// The metric is regret, not accuracy: a change routed cheap that was repaired
// within the window is a recommendation the outcome contradicted. It is never
// "spend avoided": otito cannot know whether a host switched models, so
// nothing here can claim a saving.
//
// Three variants are graded side by side so the model half can be read
// against the deterministic half rather than in isolation:
//   deterministic  the tier from AX, containment and bumps alone. Every model
//                  term is zero, so this is the cheapest tier the router can
//                  give a request; a model read can only move it toward premium.
//   offline        the shipped no-key heuristic
//   jev            the System One read, when a key is present
//
// With no key this is a pure function of repository state, recorded in a
// receipt. With a key, the model's answers are not replayable and the receipt
// says so. Nothing here reaches the gate.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { generateAxScore } from "./ax.js";
import { generateCodeMap } from "./code-map.js";
import { DEFAULT_MIN_SAMPLE, DEFAULT_WINDOW_DAYS, FIX_SUBJECT, joinRepairs, readHistory } from "./calibrate.js";
import { generateImpact } from "./impact.js";
import { priceJevCall } from "./jev.js";
import { askJev, modelRouteEngineVersion, offlineAnswers, scoreDecision, signalsFrom, TIERS } from "./model-route.js";
import { inspectRepo } from "./repo.js";
import { runCommand } from "./tools.js";

export const regretEngineVersion = "0.2.0";

const DAY_SECONDS = 86400;
const Z95 = 1.96;

/**
 * The deterministic half on its own: every model term at zero, so the route
 * is AX plus containment plus the bumps.
 */
const NEUTRAL_ANSWERS = {
  specificity: { score: 0, confidence: null },
  blast_radius: { score: 0, confidence: null },
  novelty: { noul: 0 },
};

export const VARIANTS = /** @type {const} */ (["deterministic", "offline", "jev"]);

/**
 * @typedef {object} RegretOptions
 * @property {number|string} [window] outcome window in days
 * @property {number|string} [minSample] refuse to publish a rate below this n
 * @property {string} [since] only consider commits after this date
 * @property {number|string} [max] cap the number of commits replayed, newest gradable first
 * @property {number|string} [top] ranked files per impact pass
 * @property {boolean} [offline] never call a model, even with a key
 * @property {string} [apiKey]
 * @property {typeof fetch} [fetchImpl]
 * @property {(progress: { done: number, total: number, sha: string, worktree: string }) => void} [onProgress]
 */

/**
 * @param {string} [repoPath]
 * @param {RegretOptions} [options]
 * @returns {Promise<Record<string, any>>}
 */
export async function generateRegret(repoPath = ".", options = {}) {
  const repo = inspectRepo(repoPath);
  if (!repo.git.available) {
    throw new Error(`regret requires a git repository: ${repo.root}`);
  }
  const root = repo.git.root ?? repo.root;
  const windowDays = positiveInt(options.window, DEFAULT_WINDOW_DAYS);
  const minSample = positiveInt(options.minSample, DEFAULT_MIN_SAMPLE);
  const max = options.max === undefined ? Infinity : positiveInt(options.max, Infinity);
  const top = positiveInt(options.top, 8);

  const commits = readHistory(root, options.since);
  if (!commits.length) {
    throw new Error("regret found no non-merge commits to replay");
  }

  // The observation horizon is the newest commit in history, not the clock,
  // so the run stays a function of repository state. A commit younger than
  // the window has not had its chance to be repaired yet; grading it as
  // unrepaired would flatter every tier it landed in, so it is censored.
  const horizon = Math.max(...commits.map((commit) => commit.time));
  const gradable = (/** @type {{ time: number }} */ commit) => horizon - commit.time >= windowDays * DAY_SECONDS;

  // Fix commits are the outcome, so they cannot also be inputs. Everything
  // else with a parent and a subject is a request the router would have seen,
  // docs-only changes included: a typo fix is a request too.
  const candidates = commits.filter((commit) => !FIX_SUBJECT.test(commit.subject) && commit.parents.length === 1 && commit.subject.trim());
  const censored = candidates.filter((commit) => !gradable(commit)).length;
  const scoreable = candidates.filter(gradable).slice(0, max === Infinity ? undefined : max);
  const fixes = commits.filter((commit) => FIX_SUBJECT.test(commit.subject) && commit.parents.length === 1);
  if (!scoreable.length) {
    throw new Error(`regret found no commit old enough to grade: every candidate is younger than the ${windowDays}-day window`);
  }
  const { repairedAfter, joinedFixes } = joinRepairs(root, scoreable, fixes);

  const wantsModel = !options.offline && Boolean(options.apiKey ?? process.env.TYPESAFE_API_KEY);
  const model = {
    source: wantsModel ? "jev" : "offline estimate",
    name: /** @type {string|null} */ (null),
    calls: 0,
    failures: 0,
    billableTokens: 0,
    costUsd: 0,
  };

  /** @type {Record<string, any>[]} */
  const graded = [];
  const worktree = addWorktree(root, scoreable[0].parents[0]);
  // A Ctrl-C or a kill mid-replay must not leave a worktree registered in the
  // user's repository. The handlers are removed once the run has cleaned up.
  const onInterrupt = (/** @type {NodeJS.Signals} */ signal) => {
    removeWorktree(root, worktree);
    process.exit(signal === "SIGTERM" ? 143 : 130);
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);
  try {
    let done = 0;
    for (const commit of scoreable) {
      checkout(root, worktree, commit.parents[0]);
      const request = commit.subject;
      // A fresh map per checkout, handed in directly: the per-user index
      // cache is keyed by root, and a temporary root would leave an orphan
      // entry behind on every run.
      const codeMap = generateCodeMap(worktree);
      const impact = generateImpact(request, { path: worktree, top, codeMap }).data;
      const ax = generateAxScore(request, { path: worktree, top, impact });
      const signals = signalsFrom(impact, ax);

      const deterministic = scoreDecision({ answers: NEUTRAL_ANSWERS, signals });
      const offline = offlineAnswers(request, signals);
      const offlineScore = scoreDecision({ answers: offline.answers, signals });

      /** @type {Record<string, any>} */
      const row = {
        sha: commit.sha,
        subject: commit.subject,
        time: commit.time,
        docsOnly: !commit.files.some((file) => !isDocLike(file.path)),
        ax: signals.ax,
        candidates: signals.candidates ?? 0,
        repairedAfter: repairedAfter.get(commit.sha) ?? null,
        tiers: { deterministic: deterministic.tier, offline: offlineScore.tier },
        routes: { deterministic: deterministic.route, offline: offlineScore.route },
        answers: { offline: fractionsOf(offline.answers) },
      };

      if (wantsModel) {
        try {
          const jev = await askJev(request, signals, { apiKey: options.apiKey, fetchImpl: options.fetchImpl });
          const scored = scoreDecision({ answers: jev.answers, signals });
          model.calls += 1;
          model.name = model.name ?? jev.model;
          model.billableTokens += jev.billableTokens ?? 0;
          row.tiers.jev = scored.tier;
          row.routes.jev = scored.route;
          row.answers.jev = fractionsOf(jev.answers);
        } catch (error) {
          model.failures += 1;
          row.jevError = String(/** @type {any} */ (error)?.message ?? error).slice(0, 120);
        }
      }

      graded.push(row);
      done += 1;
      options.onProgress?.({ done, total: scoreable.length, sha: commit.sha, worktree });
    }
  } finally {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onInterrupt);
    removeWorktree(root, worktree);
  }
  // Priced once from the total, with the same function every surface uses.
  model.costUsd = priceJevCall(model.billableTokens) ?? 0;

  const within = (/** @type {any} */ row, /** @type {number} */ days) => row.repairedAfter !== null && row.repairedAfter <= days * DAY_SECONDS;
  const base = summarizeRows("base", graded, windowDays, minSample, within, null);

  /** @type {Record<string, any>} */
  const variants = {};
  for (const variant of VARIANTS) {
    const rows = graded.filter((row) => row.tiers[variant] !== undefined);
    if (!rows.length) continue;
    variants[variant] = gradeVariant(variant, rows, windowDays, minSample, within);
  }

  /** @type {Record<string, any>} */
  const questions = {};
  for (const variant of ["offline", "jev"]) {
    const rows = graded.filter((row) => row.answers[variant]);
    if (!rows.length) continue;
    questions[variant] = ["specificity", "blast_radius", "novelty"].map((name) =>
      spread(
        name,
        rows.map((row) => row.answers[variant][name]),
      ),
    );
  }

  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    regretEngineVersion,
    modelRouteEngineVersion,
    repo: { root, name: path.basename(root), head: repo.git.commit ?? null },
    method: {
      join: "line-overlap",
      outcome: "repaired",
      fixCommitRule: "subject begins fix/hotfix/bugfix/revert",
      requestProxy: "commit subject",
      stateAt: "first parent, checked out into a temporary worktree",
      horizon: "the newest commit in history; a commit younger than the window is censored, not graded",
      regret: "a commit routed cheap that was repaired within the window",
      interval: "Wilson 95%",
      windowDays,
      minSample,
      top,
    },
    range: {
      since: options.since ?? null,
      max: max === Infinity ? null : max,
      commits: commits.length,
      candidates: candidates.length,
      censored,
      replayed: graded.length,
      docsOnly: graded.filter((row) => row.docsOnly).length,
      fixCommits: fixes.length,
      fixCommitsJoined: joinedFixes,
    },
    base: { rate: base.rate, ci95: base.ci95, repaired: base.repaired, n: base.n, publishable: base.publishable },
    model: {
      ...model,
      name: model.name ?? (wantsModel ? null : "offline estimate"),
      replayable: !wantsModel,
    },
    variants,
    questions,
    commits: graded,
    caveats: [
      "The request is the commit subject, written after the change, not the prompt that started the work. Whether it reads as more or less specific than the real request is unmeasured.",
      "The state is the first parent's tree. Work in progress, untracked files and the developer's local index are not replayed.",
      "`repaired` is a proxy inherited from calibrate: blame attributes a line to its last toucher, and an unlabelled fix is invisible.",
      "Fix commits are outcomes here, so requests that were themselves fixes are not graded. The router serves them in production.",
      "The tier that was actually used, if any, is unknown; this grades what the router would have said, not what happened.",
      `Rates over fewer than ${minSample} commits are withheld rather than published, the base rate included. A published rate carries a 95% interval; two rates whose intervals overlap are not shown to differ.`,
      ...(wantsModel ? ["The model's answers are not replayable; the receipt covers this run's inputs and outputs, not a recomputation."] : []),
    ],
  };
  return { ...data, receipt: makeRegretReceipt(data) };
}

/**
 * Per-tier repair rate and lift for one variant against that variant's own
 * rows, the ordering check, and the regret count.
 * @param {string} variant
 * @param {Record<string, any>[]} rows
 * @param {number} windowDays
 * @param {number} minSample
 * @param {(row: any, days: number) => boolean} within
 */
function gradeVariant(variant, rows, windowDays, minSample, within) {
  // The model variant grades only the commits it answered, so its base rate
  // is over those rows, not the whole corpus.
  const base = summarizeRows("base", rows, windowDays, minSample, within, null);
  const tiers = TIERS.map((tier) =>
    summarizeRows(
      tier,
      rows.filter((row) => row.tiers[variant] === tier),
      windowDays,
      minSample,
      within,
      base.rate,
    ),
  );
  const rates = tiers.map((row) => row.rate);
  const measured = rates.every((rate) => rate !== null);
  const cheap = summarizeRows(
    "cheap",
    rows.filter((row) => row.tiers[variant] === "cheap"),
    windowDays,
    minSample,
    within,
    null,
  );
  return {
    n: rows.length,
    base: { rate: base.rate, ci95: base.ci95, repaired: base.repaired, n: base.n, publishable: base.publishable },
    tiers,
    // Cheap should be repaired least and premium most if the tier orders
    // changes by how much care they needed. Claimed only when every band
    // cleared the minimum sample.
    monotonic: measured ? rates[0] < rates[1] && rates[1] < rates[2] : null,
    contradicted: { n: cheap.repaired, ofCheap: cheap.n, rate: cheap.rate, ci95: cheap.ci95, publishable: cheap.publishable },
  };
}

/**
 * Counts always; rate, interval and lift only above the minimum sample.
 * @param {string} name
 * @param {Record<string, any>[]} matching
 * @param {number} windowDays
 * @param {number} minSample
 * @param {(row: any, days: number) => boolean} within
 * @param {number|null} baseRate
 */
function summarizeRows(name, matching, windowDays, minSample, within, baseRate) {
  const n = matching.length;
  const repaired = matching.filter((row) => within(row, windowDays)).length;
  const publishable = n >= minSample;
  const rate = publishable && n ? repaired / n : null;
  return {
    name,
    n,
    repaired,
    rate: rate === null ? null : round(rate),
    ci95: rate === null ? null : wilson(repaired, n),
    lift: rate === null || !baseRate ? null : round(rate / baseRate),
    publishable,
  };
}

/**
 * Wilson score interval: honest at small n and at rates near zero, which is
 * where these tables live.
 * @param {number} successes
 * @param {number} n
 * @returns {[number, number]}
 */
export function wilson(successes, n) {
  if (!n) return [0, 0];
  const p = successes / n;
  const z2 = Z95 * Z95;
  const denominator = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denominator;
  const half = (Z95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  return [round(Math.max(0, centre - half)), round(Math.min(1, centre + half))];
}

/**
 * The model's answers as the fractions the arithmetic uses, so a question that
 * cannot separate its inputs shows as a flat distribution here.
 * @param {any} answers
 */
function fractionsOf(answers) {
  const num = (/** @type {unknown} */ value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const specificity = num(answers?.specificity?.score);
  const blast = num(answers?.blast_radius?.score);
  const novelty = num(answers?.novelty?.noul);
  return {
    specificity: specificity === null ? null : round(specificity / 2),
    blast_radius: blast === null ? null : round(blast / 2),
    novelty: novelty === null ? null : round(novelty),
  };
}

/**
 * @param {string} name
 * @param {(number|null)[]} values
 */
function spread(name, values) {
  const nums = values.filter((value) => typeof value === "number");
  if (!nums.length) return { name, n: 0, mean: null, min: null, max: null, stdev: null };
  const mean = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  const variance = nums.reduce((sum, value) => sum + (value - mean) ** 2, 0) / nums.length;
  return { name, n: nums.length, mean: round(mean), min: round(Math.min(...nums)), max: round(Math.max(...nums)), stdev: round(Math.sqrt(variance)) };
}

/** @param {string} filePath */
function isDocLike(filePath) {
  return /\.(md|mdx|markdown|txt|rst|adoc)$/i.test(filePath) || /^docs?\//i.test(filePath);
}

/**
 * Git for the replay runs with the caller's GIT_* redirections stripped, so a
 * run started from inside a hook (GIT_DIR, GIT_INDEX_FILE set) cannot land
 * its checkouts on the user's own index, and with hooks and LFS smudge
 * disabled, so checking out a historical tree runs nothing and fetches nothing.
 * @returns {NodeJS.ProcessEnv}
 */
function gitEnv() {
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|COMMON_DIR|NAMESPACE|PREFIX|CEILING_DIRECTORIES)$/.test(key)) continue;
    env[key] = value;
  }
  env.GIT_LFS_SKIP_SMUDGE = "1";
  return env;
}

const GIT_QUIET = [
  "-c",
  `core.hooksPath=${os.devNull}`,
  "-c",
  "filter.lfs.smudge=",
  "-c",
  "filter.lfs.process=",
  "-c",
  "filter.lfs.required=false",
  "-c",
  "core.fsmonitor=false",
];

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  return runCommand("git", [...GIT_QUIET, ...args], { cwd, env: gitEnv() });
}

/**
 * @param {string} root
 * @param {string} sha
 * @returns {string}
 */
function addWorktree(root, sha) {
  // mkdtemp owns the path from here on; git accepts an existing empty
  // directory, so nothing is removed and re-created in between.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "otito-regret-"));
  const result = git(root, ["worktree", "add", "--detach", "--quiet", dir, sha]);
  if (!result.ok) {
    throw new Error(`regret could not check out ${sha.slice(0, 7)} into a worktree: ${result.stderr || result.stdout}`);
  }
  return dir;
}

/**
 * @param {string} root
 * @param {string} worktree
 * @param {string} sha
 */
function checkout(root, worktree, sha) {
  const result = git(worktree, ["checkout", "--quiet", "--detach", sha]);
  if (!result.ok) {
    throw new Error(`regret could not check out ${sha.slice(0, 7)} in ${root}: ${result.stderr || result.stdout}`);
  }
}

/**
 * @param {string} root
 * @param {string} worktree
 */
function removeWorktree(root, worktree) {
  // Only this run's worktree is touched. No `git worktree prune`: it would
  // also drop the user's own entries whose directories happen to be absent,
  // for instance a worktree on an unmounted drive.
  git(root, ["worktree", "remove", "--force", worktree]);
  if (fs.existsSync(worktree)) fs.rmSync(worktree, { recursive: true, force: true });
}

/**
 * Deterministic receipt over a canonical, timestamp-free payload.
 * @param {Record<string, any>} data
 */
export function makeRegretReceipt(data) {
  const canonical = {
    engine: "otito-regret",
    regretEngineVersion: data.regretEngineVersion,
    modelRouteEngineVersion: data.modelRouteEngineVersion,
    method: data.method,
    commit: data.repo.head ?? null,
    range: data.range,
    base: data.base,
    model: { source: data.model.source, name: data.model.name, calls: data.model.calls, failures: data.model.failures },
    variants: Object.fromEntries(
      Object.entries(data.variants).map(([name, variant]) => [
        name,
        {
          tiers: variant.tiers.map((/** @type {any} */ row) => [row.name, row.n, row.repaired, row.rate]),
          monotonic: variant.monotonic,
          contradicted: [variant.contradicted.n, variant.contradicted.ofCheap],
        },
      ]),
    ),
    commits: data.commits.map((/** @type {any} */ row) => [row.sha, row.tiers.deterministic, row.tiers.offline, row.tiers.jev ?? null, row.repairedAfter]),
  };
  const inputsHash = crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
  return { id: `regret_${inputsHash.slice(0, 12)}`, algorithm: "sha256", commit: canonical.commit, inputsHash, replayable: data.model.replayable };
}

/**
 * @param {Record<string, any>} data
 * @returns {string}
 */
export function formatRegretMarkdown(data) {
  const pct = (/** @type {number|null} */ value) => (value === null ? "—" : `${(value * 100).toFixed(1)}%`);
  const ci = (/** @type {[number, number]|null} */ value) => (value ? ` (${pct(value[0])} to ${pct(value[1])})` : "");
  const lift = (/** @type {number|null} */ value) => (value === null ? "—" : `${value.toFixed(2)}x`);
  const withheld = ` _(n < ${data.method.minSample}, withheld)_`;
  const lines = [
    `# Route regret — ${data.repo.name}`,
    "",
    `Join: ${data.method.join} · outcome: \`${data.method.outcome}\` · window: ${data.method.windowDays}d · minimum sample: ${data.method.minSample}`,
    `Request: ${data.method.requestProxy} · state: ${data.method.stateAt}`,
    `Corpus: ${data.range.replayed} commits replayed (${data.range.docsOnly} docs-only) of ${data.range.candidates} candidates; ${data.range.censored} younger than the window, not graded; ${data.range.fixCommits} fix commits (${data.range.fixCommitsJoined} joined)`,
    `Base rate: ${data.base.publishable ? `${pct(data.base.rate)}${ci(data.base.ci95)}` : withheld.trim()} (${data.base.repaired}/${data.base.n})`,
    `Model: ${data.model.name ?? data.model.source}${data.model.calls ? `, ${data.model.calls} calls, ${data.model.failures} failed, $${data.model.costUsd.toFixed(4)}` : ""}`,
    "",
    "Regret is a commit routed cheap that was repaired within the window. It is never a saving: otito does not know which model was used. Two rates whose intervals overlap are not shown to differ.",
  ];
  for (const [name, variant] of Object.entries(data.variants)) {
    lines.push(
      "",
      `## ${name}`,
      "",
      `Base over these ${variant.n} commits: ${variant.base.publishable ? `${pct(variant.base.rate)}${ci(variant.base.ci95)}` : withheld.trim()}`,
      "",
      "| Tier | n | repaired | 95% interval | lift |",
      "| --- | ---: | ---: | --- | ---: |",
    );
    for (const row of variant.tiers) {
      lines.push(
        `| ${row.name} | ${row.n} | ${row.publishable ? pct(row.rate) : `${row.repaired}${withheld}`} | ${row.ci95 ? `${pct(row.ci95[0])} to ${pct(row.ci95[1])}` : "—"} | ${lift(row.lift)} |`,
      );
    }
    const order =
      variant.monotonic === null ? "unknown (a tier fell below the minimum sample)" : variant.monotonic ? "yes" : "**no — the tier does not order outcomes**";
    lines.push("", `Monotonic (cheap < mid < premium): ${order}`);
    const c = variant.contradicted;
    lines.push(`Contradicted: ${c.n} of ${c.ofCheap} routed cheap were repaired${c.publishable ? ` (${pct(c.rate)}${ci(c.ci95)})` : withheld}`);
  }
  for (const [name, rows] of Object.entries(data.questions)) {
    lines.push("", `## Question spread (${name})`, "", "| Question | n | mean | min | max | stdev |", "| --- | ---: | ---: | ---: | ---: | ---: |");
    for (const row of rows) {
      const f = (/** @type {number|null} */ value) => (value === null ? "—" : value.toFixed(2));
      lines.push(`| ${row.name} | ${row.n} | ${f(row.mean)} | ${f(row.min)} | ${f(row.max)} | ${f(row.stdev)} |`);
    }
    lines.push("", "A question whose answers barely move across the corpus is not separating its inputs.");
  }
  lines.push("", "## Caveats", "");
  for (const caveat of data.caveats) lines.push(`- ${caveat}`);
  lines.push(
    "",
    `Receipt: \`${data.receipt.id}\` (${data.receipt.algorithm}, inputs ${data.receipt.inputsHash.slice(0, 12)}…${data.receipt.replayable ? "" : ", not replayable"})`,
  );
  return lines.join("\n");
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
