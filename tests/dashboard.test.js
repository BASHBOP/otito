import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { aggregate, renderDashboardHtml, scanArtifacts, generateDashboard } from "../src/lib/dashboard.js";

function ev(over = {}) {
  return { v: 1, ts: 1000, surface: "cli", cmd: "ax", outcome: "ok", durationMs: 100, repo: "abc123", signals: null, ...over };
}

test("aggregate counts commands, surfaces, outcomes, and verdicts", () => {
  const d = aggregate([
    ev({ cmd: "ax", surface: "cli", durationMs: 100 }),
    ev({ cmd: "ax", surface: "mcp", durationMs: 300 }),
    ev({ cmd: "gate", surface: "cli", durationMs: 50, signals: { verdict: "PASS" } }),
    ev({ cmd: "gate", surface: "cli", durationMs: 60, signals: { verdict: "FAIL" }, outcome: "fail" }),
  ]);

  assert.equal(d.totals.events, 4);
  assert.equal(d.totals.cli, 3);
  assert.equal(d.totals.mcp, 1);
  assert.equal(d.outcomes.ok, 3);
  assert.equal(d.outcomes.fail, 1);
  assert.equal(d.verdicts.PASS, 1);
  assert.equal(d.verdicts.FAIL, 1);
  assert.equal(d.totals.passRate, 50, "1 PASS of 2 verdicts");
  const ax = d.commands.find((c) => c.cmd === "ax");
  assert.equal(ax.count, 2);
  assert.equal(ax.surface, "both");
  assert.equal(ax.medianDurationMs, 200, "median of 100 and 300");
});

test("aggregate builds a sorted convergence series and picks the latest eval", () => {
  const d = aggregate([
    ev({ cmd: "converge", ts: 30, signals: { convergence: 90 } }),
    ev({ cmd: "converge", ts: 10, signals: { convergence: 70 } }),
    ev({ cmd: "eval", ts: 5, signals: { savedPct: 40, savedTokens: 1000 } }),
    ev({ cmd: "eval", ts: 40, signals: { savedPct: 62, savedTokens: 2400 } }),
  ]);
  assert.deepEqual(
    d.convergenceSeries.map((p) => p.value),
    [70, 90],
    "series is sorted by timestamp",
  );
  assert.equal(d.latestEval.savedPct, 62, "latest eval by timestamp");
});

test("aggregate surfaces honesty blind spots, including the empty case", () => {
  const empty = aggregate([]);
  assert.ok(empty.blindSpots.some((s) => /No events recorded/.test(s)));
  const noVerdicts = aggregate([ev({ cmd: "map", signals: null })]);
  assert.ok(
    noVerdicts.blindSpots.some((s) => /naive/.test(s)),
    "always discloses the savedPct caveat",
  );
});

test("renderDashboardHtml is a standalone document with tooltips and the honesty panel", () => {
  const html = renderDashboardHtml(aggregate([ev({ cmd: "ax", signals: { ax: 77 } })]));
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /What this can't show/);
  assert.ok((html.match(/class="tiptext"/g) ?? []).length >= 6, "every tile and chart carries an interpretation tooltip");
  assert.match(html, /prefers-color-scheme:dark/, "works in dark mode");
  assert.equal(html.includes("<script src="), false, "no external scripts — fully offline");
});

test("renderDashboardHtml escapes embedded strings", () => {
  const html = renderDashboardHtml(aggregate([ev({ cmd: "<script>alert(1)</script>" })]));
  assert.equal(html.includes("<script>alert(1)</script>"), false, "command names are HTML-escaped");
  assert.match(html, /&lt;script&gt;/);
});

test("scanArtifacts classifies .dev-context JSON by its discriminating keys", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repoctx-dash-art-"));
  const dir = path.join(root, ".dev-context");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "converge.json"), JSON.stringify({ convergence: 80, band: "aligned" }));
  fs.writeFileSync(path.join(dir, "gate.json"), JSON.stringify({ verdict: "WARN", checks: [] }));
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify({ ignored: true }));
  fs.writeFileSync(path.join(dir, "broken.json"), "{ not json");

  const found = scanArtifacts(root);
  const kinds = Object.fromEntries(found.map((a) => [a.file, a.kind]));
  assert.equal(kinds["converge.json"], "converge");
  assert.equal(kinds["gate.json"], "gate");
  assert.equal(kinds["index.json"], undefined, "the cache index is excluded");
  assert.equal(kinds["broken.json"], undefined, "unparseable files are skipped, not thrown");
  fs.rmSync(root, { recursive: true });
});

test("generateDashboard returns both the aggregate data and a renderable HTML string", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repoctx-dash-gen-"));
  const { data, html } = generateDashboard(root, { env: { REPOCTX_TELEMETRY_PATH: path.join(root, "nope.jsonl") }, includeGit: false });
  assert.equal(data.totals.events, 0);
  assert.match(html, /repoctx · usage & performance/);
  fs.rmSync(root, { recursive: true });
});
