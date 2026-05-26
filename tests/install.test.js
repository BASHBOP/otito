import test from "node:test";
import assert from "node:assert/strict";
import { getInstallPlan, installDevContext } from "../src/lib/install.js";

test("getInstallPlan reports product name, binary, and commands", () => {
  const plan = getInstallPlan();

  assert.equal(plan.ok, true);
  assert.equal(plan.productName, "repoctx");
  assert.equal(plan.binaryName, "repoctx");
  assert.equal(plan.legacyBinaryName, "dev-context");
  assert.equal(plan.commands.fromGitHub, "npm install -g github:nugehs/dev-context");
  assert.equal(plan.commands.verify, "repoctx doctor");
});

test("installDevContext defaults to a non-mutating plan", () => {
  const result = installDevContext();

  assert.equal(result.ok, true);
  assert.equal(result.applied, undefined);
  assert.equal(result.commands.developmentLink, "npm link");
});
