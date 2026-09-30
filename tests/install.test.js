import test from "node:test";
import assert from "node:assert/strict";
import { formatInstallSummary, getInstallPlan, installSolumbe } from "../src/lib/install.js";

test("getInstallPlan reports product name, binary, and commands", () => {
  const plan = getInstallPlan();

  assert.equal(plan.ok, true);
  assert.equal(plan.productName, "Solumbe");
  assert.equal(plan.binaryName, "solumbe");
  assert.equal(plan.commands.fromNpm, "npm install -g @bashbop/solumbe");
  assert.equal(plan.commands.verify, "solumbe doctor");
});

test("installSolumbe defaults to a non-mutating plan", () => {
  const result = installSolumbe();

  assert.equal(result.ok, true);
  assert.equal(result.applied, undefined);
  assert.equal(result.commands.developmentLink, "npm link");
});

test("formatInstallSummary includes the Solumbe identity print", () => {
  const summary = formatInstallSummary(getInstallPlan());

  assert.match(summary, /Solumbe · installer/);
  assert.match(summary, /At a glance/);
  assert.match(summary, /Install commands/);
  assert.match(summary, /Next steps/);
});
