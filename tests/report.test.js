import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateReport } from "../src/lib/report.js";

test("generateReport returns markdown and structured data", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-report-"));
  fs.writeFileSync(path.join(root, "README.md"), "# demo\n");

  const result = generateReport(root);
  assert.equal(result.data.ok, true);
  assert.match(result.markdown, /# Dev Context Report/);
  assert.match(result.markdown, /## Repo Overview/);
  assert.equal(result.data.repo.root, root);
});
