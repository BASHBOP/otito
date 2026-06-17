// repoctx review = the composite engine that runs Phases 2-4 together:
// impact (blast radius) → pr-review (rich diff context) → pass (verdict).
// Returns one structured report an agent or reviewer can consume in a
// single call, with a derived confidence score the agent can use to
// decide whether to escalate to a human.

import { generateImpact } from "./impact.js";
import { generatePrReview } from "./pr-review.js";
import { evaluateLocal } from "./pass-local.js";
import { evaluatePR } from "./pass-pr.js";
import { estimateTokens } from "./tokens.js";

const reviewEngineVersion = 1;

/** @typedef {import('./pass-pr.js').Runner} Runner */

/**
 * @typedef {Object} ReviewOptions
 * @property {string} [request]
 * @property {string} [prSelector]
 * @property {boolean} [pr]
 * @property {number} [impactTop]
 * @property {string} [base]
 * @property {string} [head]
 * @property {string} [policy]
 * @property {string} [governance]
 * @property {Runner} [runner]
 */

/**
 * @param {string} repoPath
 * @param {ReviewOptions} [options]
 */
export async function generateReview(repoPath, options = {}) {
  const request = String(options.request ?? "").trim() || "review this change";
  const wantsPr = Boolean(options.prSelector || options.pr);

  /** @type {any} */
  const impact = generateImpact(request, { path: repoPath, top: options.impactTop ?? 8, diffBase: options.base }).data;
  const prReview = generatePrReview(repoPath, { base: options.base, head: options.head, number: options.prSelector, github: wantsPr });
  /** @type {any} */
  const prData = prReview.data;

  /** @type {any} */
  let passReport;
  if (wantsPr) {
    passReport = await evaluatePR(repoPath, options.prSelector ?? "", {
      policy: options.policy,
      governance: options.governance,
      request,
      runner: options.runner,
    });
  } else {
    passReport = evaluateLocal(repoPath, {
      base: options.base,
      policy: options.policy,
      governance: options.governance,
      request,
    });
  }

  const confidence = computeConfidence({ impact, passReport, prReview: prData });

  /** @type {Record<string, unknown> & { tokenEstimate?: { fullJson: number } }} */
  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    reviewEngineVersion,
    request,
    verdict: passReport.verdict,
    confidence,
    repo: { root: passReport.repo.root, name: passReport.repo.name },
    impactSummary: {
      concepts: impact.concepts,
      topFiles: impact.topFiles.slice(0, 5).map((/** @type {any} */ file) => ({ path: file.path, score: file.score, riskFlags: file.riskFlags })),
      risks: impact.risks,
    },
    prReviewSummary: {
      changedFiles: prData.changedFiles.length,
      additions: prData.diff?.additions ?? 0,
      deletions: prData.diff?.deletions ?? 0,
      riskLevel: prData.risk?.level,
      riskFlags: prData.risk?.flags ?? [],
      reviewTargetsCount: prData.reviewTargets?.routes?.length ?? 0,
    },
    pass: {
      verdict: passReport.verdict,
      policy: passReport.policy,
      governance: passReport.governance,
      checks: passReport.checks.map((/** @type {any} */ check) => ({ name: check.name, status: check.status, summary: check.summary })),
    },
  };
  data.tokenEstimate = { fullJson: estimateTokens(data) };
  return { data, fullReports: { impact, prReview: prData, pass: passReport } };
}

// Confidence score blends three signals: pass verdict, impact concept
// coverage, and PR review risk level. The score is a 0-100 integer so the
// terminal renderer can paint it as a bar.
/**
 * @param {{ impact: any, passReport: any, prReview: any }} params
 * @returns {number}
 */
function computeConfidence({ impact, passReport, prReview }) {
  let score = 70;
  if (passReport.verdict === "PASS") score += 15;
  if (passReport.verdict === "FAIL") score -= 35;
  if (impact.concepts.length > 0) score += 5;
  if (impact.topFiles.length === 0) score -= 10;
  const riskLevel = prReview.risk?.level;
  if (riskLevel === "high") score -= 15;
  else if (riskLevel === "medium") score -= 5;
  return Math.max(0, Math.min(100, score));
}

/**
 * @typedef {Object} ReviewData
 * @property {string} request
 * @property {string} verdict
 * @property {number} confidence
 * @property {{ root: string, name: string }} repo
 * @property {{ concepts: string[], topFiles: { path: string, score: number, riskFlags: string[] }[], risks: string[] }} impactSummary
 * @property {{ changedFiles: number, additions: number, deletions: number, riskLevel?: string, riskFlags: string[], reviewTargetsCount: number }} prReviewSummary
 * @property {{ verdict: string, policy: string, governance: string, checks: { name: string, status: string, summary: string }[] }} pass
 */

/**
 * @param {ReviewData} data
 * @param {(options: object) => any} rendererFactory
 * @returns {string}
 */
export function formatReviewTerminal(data, rendererFactory) {
  const renderer = rendererFactory({});
  /** @type {string[]} */
  const lines = [];
  const sub = [
    { text: `"${data.request}"`, glyph: "💬" },
    { text: `${data.repo.root}`, glyph: "📂" },
    { text: `verdict ${data.verdict} · confidence ${data.confidence}%`, glyph: "🚦" },
  ];
  lines.push(renderer.header({ text: "repoctx review · composite verdict", glyph: "🔬" }, sub));
  lines.push("");

  lines.push(
    `  ${renderer.emoji ? "🎯" : ">"}  Impact   ${bar(data.impactSummary.topFiles.length, 8, renderer.emoji)}   ${data.impactSummary.topFiles.length} owner file(s) · ${data.impactSummary.concepts.length} concept(s)`,
  );
  lines.push(
    `  ${renderer.emoji ? "📋" : ">"}  Context  ${bar(data.prReviewSummary.changedFiles, 20, renderer.emoji)}   ${data.prReviewSummary.changedFiles} changed file(s) · risk ${data.prReviewSummary.riskLevel ?? "?"}`,
  );
  lines.push(
    `  ${renderer.emoji ? "🚦" : ">"}  Pass     ${statusGlyph(renderer.emoji, data.verdict)}  ${data.verdict}        policy ${data.pass.policy} · governance ${data.pass.governance}`,
  );
  lines.push(`  ${renderer.emoji ? "🎓" : ">"}  Confidence  ${bar(data.confidence, 100, renderer.emoji)}   ${data.confidence}%`);
  lines.push("");

  if (data.impactSummary.topFiles.length) {
    lines.push(`  ${renderer.emoji ? "🥇" : ">"}  Owner files`);
    for (const file of data.impactSummary.topFiles) {
      lines.push(`     ${renderer.emoji ? "└─" : "|-"} ${file.path} (score ${file.score})`);
    }
    lines.push("");
  }
  const failing = data.pass.checks.filter((c) => c.status === "FAIL");
  const warning = data.pass.checks.filter((c) => c.status === "WARN");
  if (failing.length) {
    lines.push(`  ${renderer.emoji ? "❌" : "[FAIL]"}  Blocking checks`);
    for (const check of failing) lines.push(`     ${renderer.emoji ? "└─" : "|-"} ${check.name}: ${check.summary}`);
    lines.push("");
  }
  if (warning.length) {
    lines.push(`  ${renderer.emoji ? "⚠️ " : "[WARN]"} Warnings`);
    for (const check of warning) lines.push(`     ${renderer.emoji ? "└─" : "|-"} ${check.name}: ${check.summary}`);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * @param {number} value
 * @param {number} max
 * @param {boolean} emoji
 * @returns {string}
 */
function bar(value, max, emoji) {
  const cells = 10;
  const filled = Math.max(0, Math.min(cells, Math.round((value / max) * cells)));
  if (emoji) return `${"▰".repeat(filled)}${"▱".repeat(cells - filled)}`;
  return `[${"#".repeat(filled)}${".".repeat(cells - filled)}]`;
}

/**
 * @param {boolean} emoji
 * @param {string} verdict
 * @returns {string}
 */
function statusGlyph(emoji, verdict) {
  if (!emoji) return `[${verdict}]`;
  if (verdict === "PASS") return "✅";
  if (verdict === "WARN") return "⚠️ ";
  return "❌";
}

/**
 * Mermaid flowchart: request → impact summary → gate checks → verdict.
 * @param {ReviewData} data
 * @returns {string}
 */
export function formatReviewMermaid(data) {
  const lines = ["flowchart TD"];
  const req = (data.request ?? "review").slice(0, 50).replace(/"/g, "'");
  lines.push(`    Q["💬 ${req}"]`);

  const concepts = ((data.impactSummary?.concepts ?? []).slice(0, 4).join(", ") || "—").replace(/"/g, "'");
  const fileCount = data.impactSummary?.topFiles?.length ?? 0;
  const riskLevel = String(data.prReviewSummary?.riskLevel ?? "?").replace(/"/g, "'");
  // Mermaid renders <br/> as a line break; a literal \n is shown as text.
  lines.push(`    I["Impact: ${fileCount} file(s)<br/>concepts: ${concepts}<br/>risk: ${riskLevel}"]`);
  lines.push(`    Q --> I`);

  const checks = data.pass?.checks ?? [];
  for (const [ci, check] of checks.entries()) {
    const glyph = check.status === "PASS" ? "✅" : check.status === "WARN" ? "⚠️" : "❌";
    const label = `${glyph} ${String(check.name).slice(0, 40)}`.replace(/"/g, "'");
    lines.push(`    G${ci}["${label}"]`);
    lines.push(`    I --> G${ci}`);
  }

  const vGlyph = data.verdict === "PASS" ? "✅" : data.verdict === "WARN" ? "⚠️" : "❌";
  lines.push(`    V["🚦 ${vGlyph} VERDICT: ${data.verdict ?? "?"}"]`);
  for (let ci = 0; ci < checks.length; ci++) lines.push(`    G${ci} --> V`);
  if (checks.length === 0) lines.push(`    I --> V`);

  return lines.join("\n");
}
