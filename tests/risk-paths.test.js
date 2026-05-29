import test from "node:test";
import assert from "node:assert/strict";
import { RISK_FLAGS, classifyPath, conceptsFromQuery, glyphFor, isSecretPath, matchRiskPaths, matchSecretPaths } from "../src/lib/risk-paths.js";

test("classifyPath flags auth/security paths by substring", () => {
  const flags = classifyPath("src/authentication/session.ts");
  assert.ok(flags.includes(RISK_FLAGS.authSecurity), `expected auth flag, got ${flags.join(", ")}`);
});

test("classifyPath flags money flow from stripe path", () => {
  const flags = classifyPath("src/payment/processors/stripe.processor.ts");
  assert.ok(flags.includes(RISK_FLAGS.moneyFlow));
});

test("classifyPath flags data model from prisma schema path", () => {
  const flags = classifyPath("prisma/schema.prisma");
  assert.ok(flags.includes(RISK_FLAGS.dataModel));
});

test("classifyPath promotes controller kind to request surface", () => {
  const flags = classifyPath("src/booking/booking.controller.ts", { kind: "controller" });
  assert.ok(flags.includes(RISK_FLAGS.requestSurface));
});

test("classifyPath adds large file diff flag at threshold", () => {
  const flags = classifyPath("src/booking/booking.controller.ts", { additions: 200, deletions: 100 });
  assert.ok(flags.includes(RISK_FLAGS.largeFileDiff));
});

test("classifyPath stays empty for unmatched plain source", () => {
  const flags = classifyPath("src/utils/format-date.ts");
  assert.deepEqual(flags, []);
});

test("isSecretPath matches .env and credential paths", () => {
  assert.equal(isSecretPath(".env.local"), true);
  assert.equal(isSecretPath("credentials/google.json"), true);
  assert.equal(isSecretPath("certs/private-key.pem"), true);
  assert.equal(isSecretPath("src/index.ts"), false);
});

test("matchSecretPaths and matchRiskPaths filter cleanly", () => {
  const paths = [".env", "src/payment/stripe.ts", "src/util/date.ts", "prisma/schema.prisma"];
  assert.deepEqual(matchSecretPaths(paths), [".env"]);
  const risky = matchRiskPaths(paths);
  assert.ok(risky.includes("src/payment/stripe.ts"));
  assert.ok(risky.includes("prisma/schema.prisma"));
  assert.ok(!risky.includes("src/util/date.ts"));
});

test("conceptsFromQuery infers auth from Apple sign-in", () => {
  const flags = conceptsFromQuery("fix Apple sign-in token validation");
  assert.ok(flags.includes(RISK_FLAGS.authSecurity), `expected auth, got ${flags.join(", ")}`);
});

test("conceptsFromQuery infers money flow from refund request", () => {
  const flags = conceptsFromQuery("add Stripe refunds to bookings");
  assert.ok(flags.includes(RISK_FLAGS.moneyFlow));
});

test("conceptsFromQuery returns empty when no concept matches", () => {
  const flags = conceptsFromQuery("rename the foo variable to bar");
  assert.deepEqual(flags, []);
});

test("glyphFor returns the right emoji and empty for unknown", () => {
  assert.equal(glyphFor(RISK_FLAGS.authSecurity), "🔐");
  assert.equal(glyphFor(RISK_FLAGS.moneyFlow), "💳");
  assert.equal(glyphFor("not-a-flag"), "");
});
