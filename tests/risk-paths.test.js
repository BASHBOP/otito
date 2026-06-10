import test from "node:test";
import assert from "node:assert/strict";
import {
  RISK_FLAGS,
  classifyPath,
  conceptsFromQuery,
  glyphFor,
  isDocPath,
  isGateRiskPath,
  isSecretPath,
  matchRiskPaths,
  matchSecretPaths,
  singularizeToken,
} from "../src/lib/risk-paths.js";

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

// --- Finding #1: conceptsFromQuery whole-token matching (no substring leaks) ---

test("conceptsFromQuery does not infer money flow from 'payload' (substring 'pay')", () => {
  const flags = conceptsFromQuery("fix payload parsing");
  assert.ok(!flags.includes(RISK_FLAGS.moneyFlow), `payload should not imply money flow, got ${flags.join(", ")}`);
});

test("conceptsFromQuery does not infer data model from 'feedback' (substring 'db')", () => {
  const flags = conceptsFromQuery("improve feedback widget");
  assert.ok(!flags.includes(RISK_FLAGS.dataModel), `feedback should not imply data model, got ${flags.join(", ")}`);
});

test("conceptsFromQuery does not infer configuration from 'pricing' (substring 'ci')", () => {
  const flags = conceptsFromQuery("fix pricing display");
  assert.ok(!flags.includes(RISK_FLAGS.configuration), `pricing should not imply configuration, got ${flags.join(", ")}`);
});

test("conceptsFromQuery does not infer auth from a bare 'apple' (emoji, not sign-in)", () => {
  const flags = conceptsFromQuery("add apple emoji to fruit picker");
  assert.ok(!flags.includes(RISK_FLAGS.authSecurity), `apple emoji should not imply auth, got ${flags.join(", ")}`);
});

test("conceptsFromQuery still infers auth from the 'apple sign-in' phrase", () => {
  assert.ok(conceptsFromQuery("add apple sign-in support").includes(RISK_FLAGS.authSecurity));
  assert.ok(conceptsFromQuery("let users sign in with google").includes(RISK_FLAGS.authSecurity));
});

test("conceptsFromQuery matches the bare whole-word 'pay' but not 'payload'", () => {
  assert.ok(conceptsFromQuery("split the pay between vendors").includes(RISK_FLAGS.moneyFlow));
  assert.ok(!conceptsFromQuery("decode the request payload").includes(RISK_FLAGS.moneyFlow));
});

// --- Finding #2: classifyPath singularizes path tokens ---

test("classifyPath flags auth/security for singular/plural security path tokens", () => {
  assert.ok(classifyPath("src/authentication/roles.guard.ts").includes(RISK_FLAGS.authSecurity), "roles.guard.ts should be auth");
  assert.ok(classifyPath("src/sessions/sessions.service.ts").includes(RISK_FLAGS.authSecurity), "sessions.service.ts should be auth");
  assert.ok(classifyPath("src/auth/permissions.guard.ts").includes(RISK_FLAGS.authSecurity), "permissions.guard.ts should be auth");
});

test("singularizeToken folds common plurals but leaves short/ss words alone", () => {
  assert.equal(singularizeToken("roles"), "role");
  assert.equal(singularizeToken("sessions"), "session");
  assert.equal(singularizeToken("policies"), "policy");
  assert.equal(singularizeToken("classes"), "class");
  assert.equal(singularizeToken("css"), "css");
  assert.equal(singularizeToken("api"), "api");
});

// --- Finding #6 support: ambiguous 'token' must not fold a generic plural ---

test("classifyPath does not flag a generic tokens.js as auth/security", () => {
  const flags = classifyPath("src/lib/tokens.js");
  assert.ok(!flags.includes(RISK_FLAGS.authSecurity), `tokens.js should not be auth, got ${flags.join(", ")}`);
});

test("classifyPath still flags a literal token.service.ts as auth/security", () => {
  assert.ok(classifyPath("src/auth/token.service.ts").includes(RISK_FLAGS.authSecurity));
});

// --- Finding #3: gate-facing matcher ignores tests and docs ---

test("isGateRiskPath ignores test files even when the name looks risky", () => {
  assert.equal(isGateRiskPath("tests/checkout.spec.ts"), false);
  assert.equal(isGateRiskPath("src/payment/__tests__/refund.test.ts"), false);
});

test("isGateRiskPath ignores documentation files even when the name looks risky", () => {
  assert.equal(isGateRiskPath("docs/git-checkout-guide.md"), false);
  assert.equal(isGateRiskPath("docs/auth-and-sessions.md"), false);
});

test("isGateRiskPath still flags real risk-sensitive implementation paths", () => {
  assert.equal(isGateRiskPath("src/payment/payment.service.ts"), true);
  assert.equal(isGateRiskPath("src/authentication/session.ts"), true);
});

test("matchRiskPaths gate mode filters tests/docs but default mode reports them", () => {
  const paths = ["tests/checkout.spec.ts", "docs/git-checkout-guide.md", "src/payment/stripe.ts"];
  assert.deepEqual(matchRiskPaths(paths, { gate: true }), ["src/payment/stripe.ts"]);
  const reported = matchRiskPaths(paths);
  assert.ok(reported.includes("src/payment/stripe.ts"));
  assert.ok(reported.includes("tests/checkout.spec.ts"), "default (non-gate) mode still reports the test path for ranking");
});

test("isDocPath recognizes markdown and docs directories", () => {
  assert.equal(isDocPath("README.md"), true);
  assert.equal(isDocPath("docs/anything.txt"), true);
  assert.equal(isDocPath("documentation/guide.rst"), true);
  assert.equal(isDocPath("src/index.ts"), false);
});

// --- Finding #4: tightened secret-path detection (basename/segment semantics) ---

test("isSecretPath does not flag a source file that merely contains '.env' as a substring", () => {
  assert.equal(isSecretPath("src/config/dev.environments.ts"), false);
});

test("isSecretPath does not flag documentation about secrets", () => {
  assert.equal(isSecretPath("docs/secrets-management.md"), false);
});

test("isSecretPath flags real secret/credential file-name patterns", () => {
  assert.equal(isSecretPath(".env"), true);
  assert.equal(isSecretPath(".env.production"), true);
  assert.equal(isSecretPath("config/.env.local"), true);
  assert.equal(isSecretPath("certs/server.pem"), true);
  assert.equal(isSecretPath("certs/server.key"), true);
  assert.equal(isSecretPath("secrets/aws.json"), true);
  assert.equal(isSecretPath("credentials/google.json"), true);
  assert.equal(isSecretPath(".ssh/id_rsa"), true);
});

test("matchSecretPaths returns only true secret files, excluding env-substring sources", () => {
  const paths = ["src/config/dev.environments.ts", "docs/secrets-management.md", ".env", "secrets/db.json"];
  assert.deepEqual(matchSecretPaths(paths), [".env", "secrets/db.json"]);
});
