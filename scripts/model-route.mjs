#!/usr/bin/env node
// Model routing prototype: score a coding task before spending tokens on it.
//
// The otito half is deterministic and local (AX, containment, risk flags).
// The Jev half asks TypeSafe's System One model three narrow, typed questions
// about the prompt. Neither half decides alone: this file combines them with
// arithmetic you can read, the same discipline the calibration thesis applies
// to `inferRisk` (docs/17-calibration-thesis).
//
// Usage:
//   node scripts/model-route.mjs <repo> "<prompt>" [--json] [--offline] [--out file]
//
// Without TYPESAFE_API_KEY the run falls back to a deterministic offline
// estimator and says so in `jev.source`. Offline answers are NOT calibrated
// probabilities - they are placeholders that keep the pipeline runnable.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { generateAxScore } from "../src/lib/ax.js";
import { generateImpact } from "../src/lib/impact.js";
import { classifyPath, RISK_SCORE_WEIGHTS } from "../src/lib/risk-paths.js";

const API_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";
const JEV_PER_MTOK = 0.042;

// Tier bands and the confidence floor below which we escalate a tier.
const TIERS = ["cheap", "mid", "premium"];
const BAND_CHEAP = 75;
const BAND_MID = 45;
const CONFIDENCE_FLOOR = 0.55;

// A risk flag bumps the tier when otito already weights it as top severity.
// Reusing RISK_SCORE_WEIGHTS keeps one source of truth rather than a second
// hand-written list of "scary" paths.
const BUMP_WEIGHT = 3;

// Host model maps. The router decides a TIER; each host turns that tier into
// whatever it calls a model. Only claude-code ships filled in, because those
// are the ids this repo can verify. Add your own in `.otito/model-route.json`
// (repo) or `~/.otito/model-route.json` (user) - repo wins:
//
//   { "hosts": { "cursor": { "cheap": "...", "mid": "...", "premium": "..." } } }
//
const BUILTIN_HOSTS = {
  "claude-code": {
    cheap: "claude-haiku-4-5-20251001",
    mid: "claude-sonnet-5",
    premium: "claude-opus-5",
  },
};

function loadHosts(repo) {
  const hosts = { ...BUILTIN_HOSTS };
  const files = [path.join(os.homedir(), ".otito", "model-route.json"), path.join(path.resolve(repo), ".otito", "model-route.json")];
  for (const file of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const [host, map] of Object.entries(parsed.hosts ?? {})) {
        hosts[host] = { ...(hosts[host] ?? {}), ...map };
      }
    } catch {
      // absent or unreadable config is not an error - built-ins still apply
    }
  }
  return hosts;
}

const BLAST_LEVELS = ["one file", "one module", "cross-cutting"];

const SPECIFICITY_LEVELS = ["names the target", "names an area", "names a symptom"];

const QUESTIONS = {
  // `underspecified` used to be a Noul: "is this ambiguous enough that a wrong
  // reading produces the wrong change?" Jev answered 0.57-0.81 for every prompt
  // in the first dogfood run - correctly, because for any one-line request the
  // honest answer is yes. A question whose answer never moves carries no
  // information no matter how well calibrated it is. This Score asks something
  // observable instead, and the levels are things you can point at in the text.
  specificity: {
    type: "score",
    instructions: "How precisely does this request name the thing that has to change?",
    criteria: [
      "The request names the exact file, symbol, flag or user-visible string to change.",
      "The request names a feature or area, but not which code in it changes.",
      "The request names only a symptom or a desired outcome; what to change must be found first.",
    ],
  },
  blast_radius: {
    type: "score",
    instructions: "How far do the edits this request implies reach across the codebase?",
    // Score criteria are an ORDERED LIST: index 0 is level 0. BLAST_LEVELS
    // names them locally so the rest of the pipeline can key by name.
    criteria: [
      "The change is contained to a single file.",
      "The change touches several files inside one module or feature area.",
      "The change reaches across module boundaries or shared contracts.",
    ],
  },
  novelty: {
    type: "noul",
    instructions: "Does this request require designing something new, rather than applying a pattern the codebase already uses?",
  },
};

/* ------------------------------------------------------------------ otito */

/**
 * Deterministic, local signals. No network, no model.
 * @param {string} repo
 * @param {string} prompt
 */
export function otitoSignals(repo, prompt) {
  const impact = generateImpact(prompt, { path: repo, top: 8 }).data;
  const ax = generateAxScore(prompt, { path: repo, top: 8 });

  // Which files to classify is a real trade-off, settled by dogfooding:
  //   - classify everything, advisory files included, and an unrelated
  //     billing component makes a copy change look like a money-flow change;
  //   - classify owners + supporting only, and `redux/slices/auth-slice.ts`
  //     ranked FIRST for an auth prompt sat in the advisory bucket and the
  //     auth/security bump never fired.
  // So: the owner and supporting buckets, plus the top-ranked predictions
  // whatever bucket they landed in. Rank is evidence; the bucket is a label.
  const candidates = [...(impact.classifications?.requiredOwners ?? []), ...(impact.classifications?.supportingFiles ?? [])];
  const ranked = (impact.topFiles ?? []).slice(0, 3).map((f) => f.path);
  for (const file of ranked) {
    if (!candidates.includes(file)) candidates.push(file);
  }

  /** @type {Map<string, string[]>} */
  const flagged = new Map();
  for (const file of candidates) {
    for (const flag of classifyPath(file)) {
      if (!flagged.has(flag)) flagged.set(flag, []);
      flagged.get(flag).push(file);
    }
  }

  const owners = impact.classifications?.requiredOwners ?? [];
  // How many distinct top-level areas the candidates span. This measures the
  // request's reach, which containment does not: containment is already inside
  // AX at weight 0.30, so reading it again here would count it twice.
  const areas = new Set(candidates.map((f) => String(f).split("/")[0]));

  // The ranked evidence Jev needs to ground the request: what otito thinks the
  // change touches, and why it thinks so.
  const evidence = (impact.topFiles ?? []).slice(0, 6).map((f) => ({
    path: f.path,
    kind: f.kind,
    why: (f.reasons ?? []).slice(0, 3),
  }));

  return {
    repo_name: impact.repo?.name ?? path.basename(path.resolve(repo)),
    evidence,
    ax: ax.ax,
    containment: ax.subScores.containment,
    owners: owners.length,
    changed_files: candidates.length,
    module_spread: areas.size,
    risk_paths: [...flagged.keys()],
    risk_evidence: Object.fromEntries(flagged),
    top_file: impact.topFiles?.[0]?.path ?? null,
  };
}

/* -------------------------------------------------------------------- jev */

/**
 * Ask Jev the three routing questions in one call.
 * @param {string} prompt
 * @param {object} signals
 */
async function askJev(prompt, signals) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set");

  // State quality is the whole game. A first dogfood run sent the prompt plus
  // four numbers, and Jev returned `underspecified` 0.57-0.81 for EVERY prompt
  // - correctly, because nothing in that state said what "the publish
  // confirmation copy" refers to. otito already resolves a request to the files
  // that own it, so the state carries that evidence and Jev grades the request
  // against the codebase rather than in the abstract.
  const state = {
    request: prompt,
    repository: {
      name: signals.repo_name,
      agent_experience: signals.ax,
      containment: signals.containment,
    },
    likely_files: signals.evidence,
    risk_flags: signals.risk_paths,
  };

  const started = Date.now();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ state, model: JEV_MODEL, questions: QUESTIONS }),
  });
  const latency_ms = Date.now() - started;

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TypeSafe API ${res.status}: ${body.slice(0, 200)}`);
  }

  const payload = await res.json();
  const answers = payload.answers ?? {};

  // Normalise the Score distribution to our level NAMES, whichever way the API
  // keys it (list by level index, or object). One shape downstream, so the
  // scorer, the JSON and the canvas never branch on provider formatting.
  for (const [name, levels] of [
    ["blast_radius", BLAST_LEVELS],
    ["specificity", SPECIFICITY_LEVELS],
  ]) {
    const blast = answers[name];
    const BLAST_LEVELS_LOCAL = levels;
    if (blast && blast.probabilities) {
      const raw = blast.probabilities;
      const named = {};
      if (Array.isArray(raw)) {
        raw.forEach((v, i) => {
          named[BLAST_LEVELS_LOCAL[i] ?? `level ${i}`] = v;
        });
      } else {
        for (const [k, v] of Object.entries(raw)) {
          const asIndex = Number(k);
          named[Number.isInteger(asIndex) && BLAST_LEVELS_LOCAL[asIndex] ? BLAST_LEVELS_LOCAL[asIndex] : k] = v;
        }
      }
      blast.probabilities = named;
    }
  }

  return {
    source: "jev",
    model: payload.model ?? JEV_MODEL,
    tokens: payload.usage?.input_tokens ?? payload.usage?.total_tokens ?? payload.usage?.tokens ?? null,
    latency_ms,
    answers,
  };
}

/**
 * Deterministic stand-in so the pipeline runs without a key. These are
 * heuristics, not calibrated probabilities, and are labelled as such.
 * @param {string} prompt
 * @param {object} signals
 */
export function offlineAnswers(prompt, signals) {
  const text = prompt.toLowerCase();
  const has = (...words) => words.some((w) => text.includes(w));

  let underspecified = 0.12;
  if (has("figure out", "find out", "investigate", "why", "somewhere", "something", "broken", "not sure")) {
    underspecified += 0.45;
  }
  if (has("typo", "rename", "bump", "copy", "wording")) underspecified -= 0.08;
  if (signals.containment < 25) underspecified += 0.1;

  let novelty = 0.1;
  if (has("design", "new ", "introduce", "add support", "migrate", "rework", "rearchitect")) novelty += 0.4;
  if (has("typo", "bump", "rename", "copy", "wording", "flag")) novelty -= 0.06;

  // Blast radius reads the REQUEST, not the repo. Containment is already inside
  // AX, so deriving blast from it routed every prompt in a low-containment repo
  // to premium (dogfood, bashbop-event-web, 2026-09-19). Owners and the number
  // of distinct top-level areas describe reach without re-counting containment.
  let spread = (signals.owners > 1 ? (signals.owners - 1) * 0.5 : 0) + Math.max(0, signals.module_spread - 1) * 0.4;
  if (has("typo", "copy", "wording", "label", "rename", "comment")) spread = Math.min(spread, 0.2);
  if (has("across", "everywhere", "all ", "refactor", "rework", "migrate")) spread += 0.6;
  spread = Math.max(0, Math.min(2, spread));
  const dist = [0, 0, 0];
  dist[0] = Math.max(0.05, 1 - spread);
  dist[2] = Math.max(0.03, spread / 2);
  dist[1] = Math.max(0.05, 1 - dist[0] - dist[2]);
  const sum = dist.reduce((a, b) => a + b, 0);
  const probabilities = {};
  BLAST_LEVELS.forEach((k, i) => {
    probabilities[k] = Number((dist[i] / sum).toFixed(3));
  });
  const score = BLAST_LEVELS.reduce((acc, k, i) => acc + probabilities[k] * i, 0);

  // Confidence from the shape of the distribution: peaked means certain.
  const top = Math.max(...Object.values(probabilities));
  const confidence = Number(Math.min(0.95, Math.max(0.35, top * 1.05)).toFixed(2));

  return {
    source: "offline",
    model: "offline-heuristic",
    tokens: null,
    latency_ms: 0,
    answers: {
      specificity: {
        type: "score",
        score: Number((clamp01(underspecified) * 2).toFixed(2)),
        confidence,
        probabilities: Object.fromEntries(SPECIFICITY_LEVELS.map((k, i) => [k, i === 1 ? 0.5 : 0.25])),
      },
      blast_radius: {
        type: "score",
        score: Number(score.toFixed(2)),
        confidence,
        probabilities,
      },
      novelty: { type: "noul", noul: Number(clamp01(novelty).toFixed(2)) },
    },
  };
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/* --------------------------------------------------------------- scoring */

/**
 * The arithmetic. Every term is visible so a tier can be traced to its inputs.
 * @param {object} decision
 */
export function scoreDecision(decision) {
  const a = decision.jev.answers;
  const o = decision.otito;
  const steps = [];
  let running = o.ax;

  steps.push({ label: "AX", detail: "otito, deterministic", delta: null, to: running });

  const step = (label, detail, delta) => {
    const from = running;
    running = from + delta;
    steps.push({ label, detail, delta: Number(delta.toFixed(2)), from, to: running });
  };

  // Each term takes a SHARE of AX rather than a flat number of points. Flat
  // subtraction produced a quantity that was no longer on the AX scale, while
  // still being banded at AX's 45/75 - a category error that routed every
  // prompt in the dogfood corpus to premium. As a share, the route score keeps
  // its meaning ("AX, after what this request costs") and the bands still hold.
  const shares = [
    ["specificity", 0.25, a.specificity.score / 2],
    ["blast radius", 0.2, a.blast_radius.score / 2],
    ["novelty", 0.15, a.novelty.noul],
  ];
  for (const [label, weight, fraction] of shares) {
    step(label, `-${(weight * 100).toFixed(0)}% x ${fraction.toFixed(2)}`, -o.ax * weight * fraction);
  }
  // Containment above the threshold returns a tenth of what the request spent.
  if (o.containment >= 40) step("containment", "+10% of AX when >= 40", o.ax * 0.1);

  const raw = running;
  const route = Math.max(0, Math.min(100, raw));
  const baseTier = route >= BAND_CHEAP ? "cheap" : route >= BAND_MID ? "mid" : "premium";

  let index = TIERS.indexOf(baseTier);
  const severe = (o.risk_paths ?? []).filter((f) => (RISK_SCORE_WEIGHTS[f] ?? 0) >= BUMP_WEIGHT);
  // Two Score answers now carry confidence; the router trusts the weaker one.
  const confidence = Math.min(a.blast_radius.confidence ?? 1, a.specificity.confidence ?? 1);

  const bumps = [
    {
      name: "risk path",
      fired: severe.length > 0,
      note: severe.length ? `${severe.join(", ")} - one tier up` : "no top-severity risk flag",
    },
    {
      name: "low confidence",
      fired: confidence < CONFIDENCE_FLOOR,
      note:
        confidence < CONFIDENCE_FLOOR
          ? `score confidence ${confidence.toFixed(2)} < ${CONFIDENCE_FLOOR} - one tier up`
          : `score confidence ${confidence.toFixed(2)} >= ${CONFIDENCE_FLOOR}`,
    },
  ];

  for (const bump of bumps) {
    if (!bump.fired) continue;
    if (index === TIERS.length - 1) {
      bump.ceiling = true;
      continue;
    }
    index += 1;
  }

  return {
    steps,
    raw: Number(raw.toFixed(2)),
    route: Math.round(route),
    clamped: raw < 0 || raw > 100,
    baseTier,
    tier: TIERS[index],
    bumps,
    confidence,
  };
}

/* ------------------------------------------------------------------- main */

export async function route(repo, prompt, { offline = false } = {}) {
  const otito = otitoSignals(repo, prompt);
  let jev;
  if (offline || !process.env.TYPESAFE_API_KEY) {
    jev = offlineAnswers(prompt, otito);
  } else {
    try {
      jev = await askJev(prompt, otito);
    } catch (error) {
      jev = offlineAnswers(prompt, otito);
      jev.fallback_reason = String(error.message ?? error);
    }
  }

  const decision = {
    id: `r-${Date.now().toString(36)}`,
    prompt,
    at: new Date().toISOString(),
    repo: path.basename(path.resolve(repo)),
    jev,
    otito,
  };
  decision.scoring = scoreDecision(decision);
  decision.cost_usd = jev.tokens ? Number(((jev.tokens * JEV_PER_MTOK) / 1e6).toFixed(6)) : null;
  return decision;
}

const TIER_COLOR = { cheap: "32", mid: "33", premium: "31" };

/**
 * Colour-coded terminal report. Uses otito's own renderer for width, emoji and
 * colour policy, so `--no-color`, `NO_COLOR`, `--theme` and a piped stdout all
 * behave the way every other otito command behaves.
 */
export function formatRouteTerminal(d, renderer) {
  const s = d.scoring;
  const a = d.jev.answers;
  const o = d.otito;
  const on = renderer.color;
  const paint = (text, code) => (on && code ? `\u001b[${code}m${text}\u001b[0m` : text);
  const dim = (text) => paint(text, "2");
  const bold = (text) => paint(text, "1");
  const tier = (text) => paint(text, `1;${TIER_COLOR[s.tier] ?? "36"}`);

  const W = 26; // bar width, in cells, spanning 0..100
  const cell = renderer.emoji ? "\u2588" : "#";
  const empty = renderer.emoji ? "\u2591" : ".";
  const bar = (from, to, code) => {
    const lo = Math.max(0, Math.min(from, to));
    const hi = Math.max(0, Math.max(from, to));
    const start = Math.round((lo / 100) * W);
    const len = Math.max(1, Math.round(((hi - lo) / 100) * W));
    return dim(empty.repeat(start)) + paint(cell.repeat(Math.min(len, W - start)), code);
  };

  const out = [];
  out.push(renderer.header({ text: `MODEL ROUTE   ${d.repo}`, glyph: "\u{1F6A6}" }, [dim(`"${d.prompt}"`)]));
  out.push("");

  const model = d.host_model ? dim(`  \u2192  ${d.host_model}`) : "";
  out.push(`  ${bold("TIER")}  ${tier(s.tier.toUpperCase())}${model}`);
  const bumped = s.tier === s.baseTier ? dim("no bump") : paint(`bumped from ${s.baseTier}`, "33");
  out.push(`  ${dim("route")} ${bold(String(s.route).padStart(3))} ${dim("/ 100")}   ${bumped}`);
  out.push("");

  out.push(renderer.section("arithmetic", ""));
  for (const step of s.steps) {
    const label = step.label.padEnd(16);
    const code = step.delta == null ? "36" : step.delta < 0 ? "31" : "32";
    const value = step.delta == null ? String(step.to) : `${step.delta > 0 ? "+" : "\u2212"}${Math.abs(step.delta).toFixed(1)}`;
    out.push(`    ${dim(label)}${bar(step.delta == null ? 0 : step.from, step.to, code)}  ${value.padStart(6)}`);
  }
  const guide = " ".repeat(4 + 16 + Math.round(0.45 * W)) + dim("\u2191 45") + " ".repeat(Math.max(1, Math.round(0.3 * W) - 4)) + dim("\u2191 75");
  out.push(`    ${bold("route score".padEnd(16))}${bar(0, s.route, TIER_COLOR[s.tier])}  ${bold(String(s.route).padStart(6))}`);
  out.push(guide);
  if (s.clamped) out.push(dim(`    raw total ${s.raw} clamped into 0..100`));
  out.push("");

  const provenance = d.jev.source === "offline" ? paint("[offline estimate \u2014 not calibrated]", "33") : paint(`[${d.jev.model}]`, "36");
  out.push(renderer.section(`jev  ${provenance}`, ""));
  const mini = (p) => {
    const n = Math.round(p * 12);
    return paint(cell.repeat(Math.max(0, n)), "36") + dim(empty.repeat(12 - Math.max(0, n)));
  };
  const spec = Object.entries(a.specificity.probabilities ?? {}).sort((x, y) => y[1] - x[1])[0];
  out.push(
    `    ${dim("specificity".padEnd(16))}${mini(a.specificity.score / 2)}  ${a.specificity.score.toFixed(2)}  ${dim(spec ? `${spec[0]} ${(spec[1] * 100).toFixed(0)}%` : "")}`,
  );
  const top = Object.entries(a.blast_radius.probabilities).sort((x, y) => y[1] - x[1])[0];
  out.push(
    `    ${dim("blast_radius".padEnd(16))}${mini(a.blast_radius.score / 2)}  ${a.blast_radius.score.toFixed(2)}  ${dim(`${top[0]} ${(top[1] * 100).toFixed(0)}%`)}`,
  );
  out.push(`    ${dim("novelty".padEnd(16))}${mini(a.novelty.noul)}  ${a.novelty.noul.toFixed(2)}`);
  const confCode = s.confidence < CONFIDENCE_FLOOR ? "31" : s.confidence < 0.8 ? "33" : "32";
  out.push(`    ${dim("confidence".padEnd(16))}${mini(s.confidence)}  ${paint(s.confidence.toFixed(2), confCode)}`);
  out.push("");

  out.push(renderer.section("otito  (deterministic, local)", ""));
  const risk = o.risk_paths.length ? paint(o.risk_paths.join(", "), "31") : dim("none");
  out.push(
    `    ${dim("AX")} ${o.ax}   ${dim("containment")} ${o.containment}   ${dim("owners")} ${o.owners}   ${dim("areas")} ${o.module_spread}   ${dim("risk")} ${risk}`,
  );
  out.push("");

  out.push(renderer.section("bumps", ""));
  for (const b of s.bumps) {
    const mark = b.ceiling ? paint("\u25B3", "33") : b.fired ? paint("\u2714", "31") : dim("\u00b7");
    const name = b.fired ? bold(b.name.padEnd(16)) : dim(b.name.padEnd(16));
    out.push(`    ${mark} ${name}${dim(b.note)}${b.ceiling ? dim(" (already premium)") : ""}`);
  }

  if (d.cost_usd != null || d.jev.latency_ms) {
    out.push("");
    out.push(dim(`    route call: ${d.jev.tokens ?? "\u2014"} tokens, $${(d.cost_usd ?? 0).toFixed(6)}, ${d.jev.latency_ms} ms`));
  }
  return out.join("\n");
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const outIndex = args.indexOf("--out");
  const valueSlots = new Set(args.map((a, i) => (a === "--out" || a === "--host" || a === "--theme" ? i + 1 : -1)).filter((i) => i !== -1));
  const positional = args.filter((a, i) => !a.startsWith("--") && !valueSlots.has(i));
  const [repo, prompt] = positional;

  if (!repo || !prompt) {
    console.error('usage: node scripts/model-route.mjs <repo> "<prompt>" [--json|--tier-only|--host <id>] [--offline] [--out file]');
    process.exit(2);
  }

  const hostIndex = args.indexOf("--host");
  const host = hostIndex === -1 ? null : args[hostIndex + 1];

  const decision = await route(repo, prompt, { offline: flags.has("--offline") });

  // Any host, one contract: --tier-only prints the tier, --host prints that
  // host's model name for it. Everything else is the same decision object.
  let text;
  if (flags.has("--tier-only")) {
    text = decision.scoring.tier;
  } else if (host) {
    const map = loadHosts(repo)[host];
    if (!map) {
      console.error(
        `no model map for host "${host}". Known: ${Object.keys(loadHosts(repo)).join(", ")}. ` + "Add one in .otito/model-route.json, or use --tier-only.",
      );
      process.exit(3);
    }
    decision.host_model = map[decision.scoring.tier];
    text = decision.host_model;
  } else {
    if (flags.has("--json")) {
      text = JSON.stringify(decision, null, 2);
    } else {
      const { createRenderer } = await import("../src/lib/render/fancy.js");
      const themeIndex = args.indexOf("--theme");
      const renderer = createRenderer({
        theme: themeIndex === -1 ? undefined : args[themeIndex + 1],
        color: flags.has("--no-color") ? false : flags.has("--color") ? true : undefined,
        emoji: flags.has("--no-emoji") ? false : undefined,
      });
      text = formatRouteTerminal(decision, renderer);
    }
  }
  if (outIndex !== -1 && args[outIndex + 1]) {
    fs.writeFileSync(args[outIndex + 1], JSON.stringify(decision, null, 2));
  }
  console.log(text);
}
