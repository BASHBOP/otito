import test from "node:test";
import assert from "node:assert/strict";
import { formatInstallSummary, getInstallPlan, installOtito } from "../src/lib/install.js";

test("getInstallPlan reports product name, binary, and commands", () => {
  const plan = getInstallPlan();

  assert.equal(plan.ok, true);
  assert.equal(plan.productName, "Òtítọ́");
  assert.equal(plan.binaryName, "otito");
  assert.equal(plan.commands.fromNpm, "npm install -g @bashbop/otito");
  assert.equal(plan.commands.verify, "otito doctor");
});

test("installOtito defaults to a non-mutating plan", () => {
  const result = installOtito();

  assert.equal(result.ok, true);
  assert.equal(result.applied, undefined);
  assert.equal(result.commands.developmentLink, "npm link");
});

test("formatInstallSummary includes the Òtítọ́ identity print", () => {
  const summary = formatInstallSummary(getInstallPlan());

  assert.match(summary, /^otito\n\+[-]+\+\n\| Hello builder, welcome to otito/);
  assert.match(summary, /files routes tests prompts/);
  assert.match(summary, /Òtítọ́ installer/);
});
