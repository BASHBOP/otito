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

export async function generateReview(repoPath, options = {}) {
  const request = String(options.request ?? "").trim() || "review this change";
  const wantsPr = Boolean(options.prSelector || options.pr);

  const impact = generateImpact(request, { path: repoPath, top: options.impactTop ?? 8, diffBase: options.base }).data;
  const prReview = generatePrReview(repoPath, { base: options.base, head: options.head, number: options.prSelector, github: wantsPr });

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

  const confidence = computeConfidence({ impact, passReport, prReview: prReview.data });

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
      topFiles: impact.topFiles.slice(0, 5).map((file) => ({ path: file.path, score: file.score, riskFlags: file.riskFlags })),
      risks: impact.risks,
    },
    prReviewSummary: {
      changedFiles: prReview.data.changedFiles.length,
      additions: prReview.data.diff?.additions ?? 0,
      deletions: prReview.data.diff?.deletions ?? 0,
      riskLevel: prReview.data.risk?.level,
      riskFlags: prReview.data.risk?.flags ?? [],
      reviewTargetsCount: prReview.data.reviewTargets?.routes?.length ?? 0,
    },
    pass: {
      verdict: passReport.verdict,
      policy: passReport.policy,
      governance: passReport.governance,
      checks: passReport.checks.map((check) => ({ name: check.name, status: check.status, summary: check.summary })),
    },
  };
  data.tokenEstimate = { fullJson: estimateTokens(data) };
  return { data, fullReports: { impact, prReview: prReview.data, pass: passReport } };
}

// Confidence score blends three signals: pass verdict, impact concept
// coverage, and PR review risk level. The score is a 0-100 integer so the
// terminal renderer can paint it as a bar.
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

export function formatReviewTerminal(data, rendererFactory) {
  const renderer = rendererFactory({});
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

function bar(value, max, emoji) {
  const cells = 10;
  const filled = Math.max(0, Math.min(cells, Math.round((value / max) * cells)));
  if (emoji) return `${"▰".repeat(filled)}${"▱".repeat(cells - filled)}`;
  return `[${"#".repeat(filled)}${".".repeat(cells - filled)}]`;
}

function statusGlyph(emoji, verdict) {
  if (!emoji) return `[${verdict}]`;
  if (verdict === "PASS") return "✅";
  if (verdict === "WARN") return "⚠️ ";
  return "❌";
}
