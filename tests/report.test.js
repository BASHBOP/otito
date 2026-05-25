import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatReportTerminal, generateReport } from "../src/lib/report.js";

test("generateReport returns markdown and structured data", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-report-"));
  fs.writeFileSync(path.join(root, "README.md"), "# demo\n");

  const result = generateReport(root);
  assert.equal(result.data.ok, true);
  assert.match(result.markdown, /# Dev Context Report/);
  assert.match(result.markdown, /## Repo Overview/);
  assert.match(result.terminal, /Dev Context Field Report/);
  assert.equal(result.data.repo.root, root);
});

test("formatReportTerminal returns a terminal-oriented report", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-report-"));
  fs.writeFileSync(path.join(root, "README.md"), "# demo\n");

  const result = generateReport(root);
  const terminal = formatReportTerminal(result.data, { columns: 60 });

  assert.match(terminal, /Dev Context Field Report/);
  assert.match(terminal, /At a Glance/);
  assert.match(terminal, /Ready Tools/);
  assert.match(terminal, /Next Moves/);
  assert.match(terminal, /Token Use/);
  assert.match(terminal, /Full JSON\s+\d+ estimated tokens/);
  assert.match(terminal, /Markdown\s+\d+ estimated tokens/);
  assert.doesNotMatch(terminal, /\| Tool \| Role \| Pilot Use \| Notes \|/);
});
