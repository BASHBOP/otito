import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateImpact, tokenize, weightedQueryTerms } from "../src/lib/impact.js";

test("tokenize splits camelCase and kebab-case identifiers, drops stop-words", () => {
  const tokens = tokenize("addStripeRefunds to bookings");
  assert.deepEqual(tokens, ["stripe", "refunds", "bookings"]);
});

test("weightedQueryTerms boosts domain keywords and adds singular forms", () => {
  const weights = weightedQueryTerms("add Stripe refunds to bookings");
  assert.ok(weights.has("stripe"), "expected stripe present");
  assert.ok(weights.has("refunds"), "expected refunds present");
  assert.ok(weights.has("refund"), "expected singular refund derived");
  assert.ok(weights.get("stripe") >= 3, `stripe weight should be boosted, got ${weights.get("stripe")}`);
});

function writeFixture(prefix, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `impact-${prefix}-`));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

test("generateImpact ranks the owner controller above a generic validation service for an auth query", () => {
  const root = writeFixture("auth", {
    "package.json": JSON.stringify({ name: "auth-fixture", scripts: { test: "node --test" } }),
    "src/shared/validation/currency-validation.service.ts": [
      "export class CurrencyValidationService {",
      "  validation = true;",
      "  validate() { return this.validation; }",
      "}",
      "",
    ].join("\n"),
    "src/authentication/auth.controller.ts": [
      "export interface MobileAppleSessionBody { token: string }",
      "export interface AppleIdentityTokenPayload { sub: string }",
      "export class AuthController { sign() { return true; } }",
      "",
    ].join("\n"),
  });

  const result = generateImpact("fix Apple sign-in token validation", { path: root });
  const top = result.data.topFiles.map((f) => f.path);
  const authIdx = top.indexOf("src/authentication/auth.controller.ts");
  const currencyIdx = top.indexOf("src/shared/validation/currency-validation.service.ts");
  assert.ok(authIdx >= 0, `auth controller missing from top: ${top.join(", ")}`);
  assert.ok(authIdx < currencyIdx || currencyIdx === -1, `auth (#${authIdx}) should beat currency-validation (#${currencyIdx})`);
  assert.ok(result.data.concepts.includes("auth/security"), "expected auth concept to be inferred");
});

test("generateImpact promotes payment processor above an operational script for a refund query", () => {
  const root = writeFixture("refunds", {
    "package.json": JSON.stringify({ name: "refund-fixture", scripts: { test: "node --test" } }),
    "scripts/sync-database-with-stripe.ts": "export function syncStripe() { return 'stripe'; }\n",
    "src/payment/processors/stripe.processor.ts": ["export class StripeProcessor {", "  refund(bookingId: string) { return bookingId; }", "}", ""].join("\n"),
  });

  const result = generateImpact("add Stripe refunds to bookings", { path: root });
  const top = result.data.topFiles.map((f) => f.path);
  const ownerIdx = top.indexOf("src/payment/processors/stripe.processor.ts");
  const scriptIdx = top.indexOf("scripts/sync-database-with-stripe.ts");
  assert.ok(ownerIdx === 0, `expected processor at #1, got top: ${top.join(", ")}`);
  assert.ok(ownerIdx < scriptIdx, `processor should beat script (script idx ${scriptIdx})`);
});

test("generateImpact flags risk hotspots from concept + classifyPath", () => {
  const root = writeFixture("risks", {
    "package.json": JSON.stringify({ name: "risk-fixture" }),
    "src/payment/refund.ts": "export const refund = true;\n",
  });
  const result = generateImpact("issue Stripe refunds", { path: root });
  assert.ok(result.data.risks.some((r) => r.toLowerCase().includes("money") || r.toLowerCase().includes("refund")));
});

test("generateImpact suggests related tests by overlapping path tokens", () => {
  const root = writeFixture("tests", {
    "package.json": JSON.stringify({ name: "test-fixture", scripts: { test: "node --test" } }),
    "src/payment/processors/stripe.processor.ts": "export class StripeProcessor { refund() {} }\n",
    "src/payment/processors/stripe.processor.spec.ts": "import test from 'node:test';\ntest('refund stripe', () => {});\n",
    "src/booking/booking.controller.ts": "export class BookingController {}\n",
  });
  const result = generateImpact("add Stripe refunds to bookings", { path: root });
  assert.ok(
    result.data.testSuggestions.some((s) => s.includes("stripe.processor.spec.ts")),
    `expected stripe spec in suggestions, got ${result.data.testSuggestions.join(" | ")}`,
  );
});

test("generateImpact implementation plan loads the highest-ranked owner file first", () => {
  const root = writeFixture("plan", {
    "package.json": JSON.stringify({ name: "plan-fixture" }),
    "src/payment/processors/stripe.processor.ts": "export class StripeProcessor { refund() {} }\n",
  });
  const result = generateImpact("add Stripe refunds", { path: root });
  assert.ok(result.data.implementationPlan[0].includes("src/payment/processors/stripe.processor.ts"));
});

test("generateImpact returns markdown that mentions the query and top file", () => {
  const root = writeFixture("markdown", {
    "package.json": JSON.stringify({ name: "md-fixture" }),
    "src/payment/processors/stripe.processor.ts": "export class StripeProcessor { refund() {} }\n",
  });
  const result = generateImpact("add Stripe refunds to bookings", { path: root });
  assert.match(result.markdown, /# Change Impact: add Stripe refunds to bookings/);
  assert.match(result.markdown, /src\/payment\/processors\/stripe\.processor\.ts/);
});

test("generateImpact rejects empty queries", () => {
  assert.throws(() => generateImpact("   ", { path: "." }), /non-empty/);
});
