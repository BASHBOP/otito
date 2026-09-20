import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  askJev,
  BAND_CHEAP,
  BAND_MID,
  CONFIDENCE_FLOOR,
  loadHosts,
  offlineAnswers,
  QUESTIONS,
  routeFooter,
  scoreDecision,
  signalsFrom,
} from "../src/lib/model-route.js";
import { generateAxScore } from "../src/lib/ax.js";
import { formatRouteMarkdown, formatRouteTerminal } from "../src/lib/render/route.js";
import { createRenderer } from "../src/lib/render/fancy.js";

/** Minimal answer set; override one field per test. */
function answers(overrides = {}) {
  return {
    specificity: { type: "score", score: 0, confidence: 0.9, probabilities: {} },
    blast_radius: { type: "score", score: 0, confidence: 0.9, probabilities: {} },
    novelty: { type: "noul", noul: 0 },
    ...overrides,
  };
}

function signals(overrides = {}) {
  return {
    repoName: "fixture",
    ax: 80,
    containment: 10,
    owners: 1,
    candidates: 1,
    moduleSpread: 1,
    riskPaths: [],
    riskEvidence: {},
    topFile: "src/a.js",
    evidence: [],
    ...overrides,
  };
}

test("each term takes a share of AX, so the score stays on the scale its bands were drawn for", () => {
  // A perfect request costs nothing and the score IS the AX score.
  const clean = scoreDecision({ answers: answers(), signals: signals({ ax: 80 }) });
  assert.equal(clean.route, 80);
  assert.equal(clean.baseTier, "cheap");

  // The worst request spends 60% of AX and no more, because the shares are
  // fractions of the base rather than a flat number of points.
  const worst = scoreDecision({
    answers: answers({
      specificity: { score: 2, confidence: 0.9, probabilities: {} },
      blast_radius: { score: 2, confidence: 0.9, probabilities: {} },
      novelty: { noul: 1 },
    }),
    signals: signals({ ax: 80 }),
  });
  assert.equal(worst.route, Math.round(80 * 0.4));

  // Flat points would make the penalty identical at every AX. Shares scale.
  const low = scoreDecision({
    answers: answers({ specificity: { score: 2, confidence: 0.9, probabilities: {} } }),
    signals: signals({ ax: 40 }),
  });
  const high = scoreDecision({
    answers: answers({ specificity: { score: 2, confidence: 0.9, probabilities: {} } }),
    signals: signals({ ax: 80 }),
  });
  assert.equal(low.route, Math.round(40 * 0.75));
  assert.equal(high.route, Math.round(80 * 0.75));
  assert.notEqual(high.route - low.route, 0);
});

test("bands split the route score at the documented thresholds", () => {
  const at = (route) => {
    // Pick an AX that lands exactly on `route` with no deductions.
    const scoring = scoreDecision({ answers: answers(), signals: signals({ ax: route }) });
    return scoring.baseTier;
  };
  assert.equal(at(BAND_CHEAP), "cheap");
  assert.equal(at(BAND_CHEAP - 1), "mid");
  assert.equal(at(BAND_MID), "mid");
  assert.equal(at(BAND_MID - 1), "premium");
});

test("containment above the threshold returns a share of AX", () => {
  const without = scoreDecision({ answers: answers(), signals: signals({ ax: 50, containment: 39 }) });
  const with_ = scoreDecision({ answers: answers(), signals: signals({ ax: 50, containment: 40 }) });
  assert.equal(with_.route - without.route, 5);
  assert.ok(with_.steps.some((step) => step.label === "containment"));
  assert.ok(!without.steps.some((step) => step.label === "containment"));
});

test("a route score is clamped into 0..100 and says so", () => {
  const scoring = scoreDecision({
    answers: answers({
      specificity: { score: 2, confidence: 0.9, probabilities: {} },
      blast_radius: { score: 2, confidence: 0.9, probabilities: {} },
      novelty: { noul: 1 },
    }),
    signals: signals({ ax: 0 }),
  });
  assert.equal(scoring.route, 0);
});

test("bumps only ever escalate, and report a ceiling instead of wrapping", () => {
  // A mid-band score with a top-severity risk flag moves up one tier.
  const bumped = scoreDecision({
    answers: answers(),
    signals: signals({ ax: 50, riskPaths: ["auth/security"] }),
  });
  assert.equal(bumped.baseTier, "mid");
  assert.equal(bumped.tier, "premium");

  // Already premium: the bump fires but cannot move further, and never wraps
  // back round to cheap.
  const ceiling = scoreDecision({
    answers: answers(),
    signals: signals({ ax: 20, riskPaths: ["auth/security"] }),
  });
  assert.equal(ceiling.baseTier, "premium");
  assert.equal(ceiling.tier, "premium");
  assert.equal(ceiling.bumps.find((b) => b.name === "risk path").ceiling, true);
});

test("only top-severity risk flags bump, as otito already weights them", () => {
  // `dependency` is weighted zero by the gate, so it must not escalate here.
  const dependency = scoreDecision({ answers: answers(), signals: signals({ ax: 50, riskPaths: ["dependency"] }) });
  assert.equal(dependency.tier, "mid");
  assert.equal(dependency.bumps.find((b) => b.name === "risk path").fired, false);

  for (const flag of ["auth/security", "money flow", "data model"]) {
    const scoring = scoreDecision({ answers: answers(), signals: signals({ ax: 50, riskPaths: [flag] }) });
    assert.equal(scoring.tier, "premium", `${flag} should bump`);
  }
});

test("confidence reads the weaker of the two Score answers, because Noul carries none", () => {
  const scoring = scoreDecision({
    answers: answers({
      specificity: { score: 0, confidence: 0.2, probabilities: {} },
      blast_radius: { score: 0, confidence: 0.99, probabilities: {} },
    }),
    signals: signals({ ax: 80 }),
  });
  assert.equal(scoring.confidence, 0.2);
  assert.ok(scoring.confidence < CONFIDENCE_FLOOR);
  // Low confidence escalates cheap to mid rather than leaving it cheap.
  assert.equal(scoring.baseTier, "cheap");
  assert.equal(scoring.tier, "mid");
});

test("signals classify the top ranked predictions, not only the owner buckets", () => {
  // Regression: an auth file ranked FIRST but sitting in the advisory bucket
  // left risk_paths empty, so the auth/security bump never fired.
  const impact = {
    repo: { name: "fixture" },
    classifications: { requiredOwners: ["src/ui/panel.tsx"], supportingFiles: [], advisoryFiles: [] },
    topFiles: [{ path: "redux/slices/auth-slice.ts", kind: "state", reasons: ["path matches: auth"] }],
  };
  const ax = { ax: 60, subScores: { containment: 20 } };
  const derived = signalsFrom(impact, ax);
  assert.ok(derived.riskPaths.includes("auth/security"));
  assert.ok(derived.riskEvidence["auth/security"].includes("redux/slices/auth-slice.ts"));
});

test("reach is measured by module spread, never by containment, which AX already counts", () => {
  const base = {
    repo: { name: "fixture" },
    topFiles: [],
    classifications: { requiredOwners: ["a/one.ts", "b/two.ts", "c/three.ts"], supportingFiles: [] },
  };
  const tight = signalsFrom(base, { ax: 60, subScores: { containment: 90 } });
  const loose = signalsFrom(base, { ax: 60, subScores: { containment: 5 } });
  // Containment differs wildly; the spread that feeds the offline reach
  // estimate does not move with it.
  assert.equal(tight.moduleSpread, loose.moduleSpread);
  assert.equal(tight.moduleSpread, 3);
});

test("offline answers are deterministic, bounded, and labelled as uncalibrated", () => {
  const derived = signals({ owners: 2, moduleSpread: 3 });
  const first = offlineAnswers("figure out why the fee is wrong", derived);
  const second = offlineAnswers("figure out why the fee is wrong", derived);
  assert.deepEqual(first, second);
  assert.equal(first.source, "offline");
  assert.equal(first.tokens, null);

  for (const answer of [first.answers.specificity, first.answers.blast_radius]) {
    assert.ok(answer.score >= 0 && answer.score <= 2);
    const total = Object.values(answer.probabilities).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 0.02, `probabilities should sum to 1, got ${total}`);
  }
  assert.ok(first.answers.novelty.noul >= 0 && first.answers.novelty.noul <= 1);

  // A symptom-only request must read as less specific than a named target.
  const vague = offlineAnswers("something is broken, figure out why", derived).answers.specificity.score;
  const precise = offlineAnswers("fix the typo in the confirmation copy", derived).answers.specificity.score;
  assert.ok(vague > precise, `${vague} should exceed ${precise}`);
});

test("Score questions send criteria as an ordered list, which the API requires", () => {
  for (const name of ["specificity", "blast_radius"]) {
    assert.equal(QUESTIONS[name].type, "score");
    assert.ok(Array.isArray(QUESTIONS[name].criteria), `${name} criteria must be a list`);
    assert.equal(QUESTIONS[name].criteria.length, 3);
  }
  assert.equal(QUESTIONS.novelty.type, "noul");
});

test("askJev normalises a level-indexed distribution onto level names", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      model: "jev-1.13.0",
      usage: { input_tokens: 700 },
      answers: {
        specificity: { type: "score", score: 1.2, confidence: 0.8, probabilities: [0.1, 0.7, 0.2] },
        blast_radius: { type: "score", score: 0.5, confidence: 0.6, probabilities: { 0: 0.6, 1: 0.3, 2: 0.1 } },
        novelty: { type: "noul", noul: 0.3 },
      },
    }),
  });
  const result = await askJev("a request", signals(), { apiKey: "test-key", fetchImpl });
  assert.equal(result.source, "jev");
  assert.equal(result.tokens, 700);
  assert.deepEqual(Object.keys(result.answers.specificity.probabilities), ["names the target", "names an area", "names a symptom"]);
  assert.deepEqual(Object.keys(result.answers.blast_radius.probabilities), ["one file", "one module", "cross-cutting"]);
  assert.equal(result.answers.blast_radius.probabilities["one file"], 0.6);
});

test("askJev sends the request and repository evidence as state", async () => {
  let sent;
  const fetchImpl = async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ answers: {} }) };
  };
  await askJev("migrate the session cookie", signals({ riskPaths: ["auth/security"], evidence: [{ path: "a.ts" }] }), {
    apiKey: "k",
    fetchImpl,
  });
  assert.equal(sent.state.request, "migrate the session cookie");
  assert.deepEqual(sent.state.risk_flags, ["auth/security"]);
  assert.deepEqual(sent.state.likely_files, [{ path: "a.ts" }]);
  assert.equal(sent.model, "jev-latest");
});

test("askJev surfaces an API failure rather than inventing an answer", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => "unauthorized" });
  await assert.rejects(() => askJev("q", signals(), { apiKey: "k", fetchImpl }), /401/);
  await assert.rejects(() => askJev("q", signals(), { apiKey: undefined, fetchImpl }), /TYPESAFE_API_KEY/);
});

test("host maps merge built-ins with repo config, and repo wins", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "otito-route-hosts-"));
  fs.mkdirSync(path.join(fixture, ".otito"), { recursive: true });
  fs.writeFileSync(path.join(fixture, ".otito", "model-route.json"), JSON.stringify({ hosts: { cursor: { cheap: "c", mid: "m", premium: "p" } } }));
  const hosts = loadHosts(fixture);
  assert.equal(hosts.cursor.premium, "p");
  assert.equal(hosts["claude-code"].premium, "claude-opus-5");

  // A missing or unreadable config is not an error.
  const empty = loadHosts(fs.mkdtempSync(path.join(os.tmpdir(), "otito-route-empty-")));
  assert.ok(empty["claude-code"]);
});

test("the advisory footer is offline, one line, and names itself uncalibrated", () => {
  const impact = {
    repo: { name: "fixture" },
    topFiles: [],
    classifications: { requiredOwners: ["src/a.ts"], supportingFiles: [] },
  };
  const footer = routeFooter("fix the typo in the label", impact, { ax: 80, subScores: { containment: 50 } });
  assert.ok(["cheap", "mid", "premium"].includes(footer.tier));
  assert.match(footer.line, /^model route: /);
  assert.match(footer.line, /offline estimate, advisory$/);
  assert.equal(footer.line.includes("\n"), false);
});

test("terminal output carries no escape codes when colour is off", () => {
  const data = {
    request: "a request",
    repo: { name: "fixture" },
    scoring: scoreDecision({ answers: answers(), signals: signals() }),
    model: { source: "offline", model: "offline-heuristic", answers: answers(), tokens: null, latencyMs: 0 },
    signals: signals(),
    costUsd: null,
  };
  const plain = formatRouteTerminal(data, createRenderer({ color: false, emoji: false }));
  assert.equal(plain.includes(String.fromCharCode(27)), false);
  assert.match(plain, /MODEL ROUTE/);
  assert.match(plain, /advisory/);

  const coloured = formatRouteTerminal(data, createRenderer({ color: true, emoji: false }));
  assert.ok(coloured.includes(String.fromCharCode(27)));
});

test("markdown output records the tier, the source, and that it is advisory", () => {
  const data = {
    request: "a request",
    repo: { name: "fixture" },
    scoring: scoreDecision({ answers: answers(), signals: signals() }),
    model: { source: "offline", model: "offline-heuristic", answers: answers() },
    signals: signals(),
  };
  const markdown = formatRouteMarkdown(data);
  assert.match(markdown, /# Model route: cheap/);
  assert.match(markdown, /offline estimate, not calibrated/);
  assert.match(markdown, /\*\*Advisory\*\*/);
});

test("AX accepts an injected impact pass, so a composite command pays for it once", () => {
  // `otito route` needs the impact pass for its own signals and AX needs it for
  // changeability. Without injection the expensive half runs twice, which was
  // the whole of the prototype's local cost.
  const impact = {
    repo: { name: "fixture", root: "/tmp/fixture" },
    topFiles: [],
    classifications: { requiredOwners: [], supportingFiles: [] },
    tokenEstimate: { total: 200 },
    risks: [],
    concepts: [],
    validation: {},
  };
  const cheapToChange = generateAxScore("a request", { path: ".", impact });

  const expensive = { ...impact, tokenEstimate: { total: 400000 } };
  const costlyToChange = generateAxScore("a request", { path: ".", impact: expensive });

  // The injected pass is what AX scored: a huge token estimate must lower
  // changeability. If the option were ignored both calls would be identical.
  assert.ok(
    cheapToChange.subScores.changeability > costlyToChange.subScores.changeability,
    `${cheapToChange.subScores.changeability} should beat ${costlyToChange.subScores.changeability}`,
  );
});
