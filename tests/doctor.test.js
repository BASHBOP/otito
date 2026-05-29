import test from "node:test";
import assert from "node:assert/strict";
import { formatDoctorReport, getDoctorReport } from "../src/lib/doctor.js";

const sampleReport = {
  ok: true,
  tools: [
    { name: "node", command: "node", available: true, version: "v22.12.0", installHint: "Install Node.js 18+." },
    { name: "rg", command: "rg", available: false, version: undefined, installHint: "Install ripgrep for faster source searching." },
  ],
};

test("getDoctorReport returns a normalized shape", () => {
  const report = getDoctorReport();
  assert.equal(report.ok, true);
  assert.ok(Array.isArray(report.tools));
  for (const tool of report.tools) {
    assert.ok(typeof tool.name === "string");
    assert.ok(typeof tool.command === "string");
    assert.ok(typeof tool.available === "boolean");
    assert.ok(typeof tool.installHint === "string");
  }
});

test("formatDoctorReport renders fancy header and status lines", () => {
  const output = formatDoctorReport(sampleReport, { emoji: true });
  assert.match(output, /repoctx doctor/);
  assert.match(output, /✅/);
  assert.match(output, /node/);
  assert.match(output, /v22\.12\.0/);
  assert.match(output, /⚠️/);
  assert.match(output, /Install ripgrep/);
});

test("formatDoctorReport drops emojis in plain mode", () => {
  const output = formatDoctorReport(sampleReport, { emoji: false });
  assert.match(output, /\[OK\]/);
  assert.match(output, /\[WARN\]/);
  assert.ok(!output.includes("✅"));
  assert.ok(!output.includes("📋"));
});
