import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { generateImpact, tokenize, weightedQueryTerms } from "../src/lib/impact.js";
import { generateConvergence } from "../src/lib/converge.js";

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

test("generateImpact recognises plural template requests and predictable locale, flag-snapshot, and focused-test fan-out", () => {
  const root = gitFixture("audience-preview", {
    "src/audience/AudienceEmailPreview.tsx": "export function AudienceEmailPreview() { return null; }\n",
    "src/audience/audience.controller.ts": "export class AudienceController { createCampaign() {} }\n",
    "src/audience/create-campaign.dto.ts": "export class CreateCampaignDto {}\n",
    "src/email/templates/responsive-base.hbs": "{{organisationAudiencePreview}}\n",
    "messages/en-GB.json": JSON.stringify({ "audience.preview.title": "Preview" }),
    "src/feature-flags/config/environments/production.json": JSON.stringify({ audienceStudio: false }),
    "src/feature-flags/config/.snapshot": "organisationAudienceStudio=false\n",
    "src/audience/audience-email-preview.test.ts": "import test from 'node:test'; test('preview', () => {});\n",
  });
  fs.writeFileSync(path.join(root, "src/audience/AudienceEmailPreview.tsx"), "export function AudienceEmailPreview() { return 'preview'; }\n");
  fs.writeFileSync(path.join(root, "src/email/templates/responsive-base.hbs"), "{{organisationAudiencePreview}}\n{{previewTitle}}\n");
  fs.writeFileSync(path.join(root, "messages/en-GB.json"), JSON.stringify({ "audience.preview.title": "Preview email" }));
  fs.writeFileSync(path.join(root, "src/feature-flags/config/environments/production.json"), JSON.stringify({ audienceStudio: true }));
  fs.writeFileSync(path.join(root, "src/feature-flags/config/.snapshot"), "organisationAudienceStudio=true\n");
  fs.writeFileSync(path.join(root, "src/audience/audience-email-preview.test.ts"), "import test from 'node:test'; test('preview email', () => {});\n");

  const result = generateImpact("add organisation audience email preview templates with feature flags", { path: root, diffBase: "HEAD", top: 10 });

  assert.ok(result.data.classifications.requiredOwners.includes("src/audience/AudienceEmailPreview.tsx"));
  assert.ok(result.data.classifications.supportingFiles.includes("src/email/templates/responsive-base.hbs"));
  assert.ok(result.data.classifications.advisoryFiles.includes("src/audience/audience.controller.ts"));
  assert.ok(result.data.classifications.advisoryFiles.includes("src/audience/create-campaign.dto.ts"));
  assert.ok(result.data.classifications.supportingFiles.includes("messages/en-GB.json"));
  assert.ok(result.data.classifications.supportingFiles.includes("src/feature-flags/config/environments/production.json"));
  assert.ok(result.data.classifications.supportingFiles.includes("src/feature-flags/config/.snapshot"));
  assert.ok(result.data.classifications.supportingFiles.includes("src/audience/audience-email-preview.test.ts"));
  assert.equal(result.data.topFiles.find((file) => file.path === "src/email/templates/responsive-base.hbs")?.role, "supporting");
  assert.deepEqual(result.data.validation.missedChangedFiles, []);
  assert.ok(result.data.validation.confirmedRelated.includes("messages/en-GB.json"));
  assert.ok(result.data.validation.confirmedRelated.includes("src/feature-flags/config/environments/production.json"));
  assert.ok(result.data.validation.confirmedRelated.includes("src/feature-flags/config/.snapshot"));

  spawnSync("git", ["add", "."], { cwd: root });
  const convergence = generateConvergence("add organisation audience email preview templates with feature flags", { path: root, base: "HEAD", staged: true });
  assert.ok(convergence.convergence >= 80, `expected supporting fan-out not to depress convergence, got ${convergence.convergence}`);
  assert.deepEqual(convergence.drivers.missedChangedFiles, []);
});

test("generateImpact keeps unrelated drift visible beside expected template fan-out", () => {
  const root = gitFixture("audience-preview-drift", {
    "src/audience/AudienceEmailPreview.tsx": "export function AudienceEmailPreview() { return null; }\n",
    "src/email/templates/campaign-message.hbs": "{{campaignMessage}}\n",
    "messages/en-GB.json": JSON.stringify({ "audience.preview.title": "Preview" }),
    "src/feature-flags/config/environments/production.json": JSON.stringify({ audienceStudio: false }),
    "src/payment/refund.service.ts": "export function refund() { return false; }\n",
  });
  fs.writeFileSync(path.join(root, "src/audience/AudienceEmailPreview.tsx"), "export function AudienceEmailPreview() { return 'preview'; }\n");
  fs.writeFileSync(path.join(root, "src/email/templates/campaign-message.hbs"), "{{campaignMessage}}\n{{previewTitle}}\n");
  fs.writeFileSync(path.join(root, "messages/en-GB.json"), JSON.stringify({ "audience.preview.title": "Preview email" }));
  fs.writeFileSync(path.join(root, "src/feature-flags/config/environments/production.json"), JSON.stringify({ audienceStudio: true }));
  fs.writeFileSync(path.join(root, "src/payment/refund.service.ts"), "export function refund() { return true; }\n");

  const result = generateImpact("update audience email preview templates with feature flags", { path: root, diffBase: "HEAD", top: 10 });
  assert.ok(result.data.validation.confirmedRelated.includes("src/email/templates/campaign-message.hbs"));
  assert.ok(result.data.validation.confirmedRelated.includes("messages/en-GB.json"));
  assert.ok(result.data.validation.confirmedRelated.includes("src/feature-flags/config/environments/production.json"));
  assert.deepEqual(result.data.validation.missedChangedFiles, ["src/payment/refund.service.ts"]);
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

// --- Finding #1 (via impact): a noisy substring concept no longer skews ranking ---

test("generateImpact does not demote files when a request word is only a substring of a concept synonym", () => {
  // "payload" must not infer a money-flow concept (it used to via the "pay"
  // substring). With no concept inferred, the parser file is not demoted and
  // ranks on its own merits.
  const root = writeFixture("payload", {
    "package.json": JSON.stringify({ name: "payload-fixture", scripts: { test: "node --test" } }),
    "src/parsing/payload-parser.service.ts": ["export class PayloadParserService {", "  parsePayload(input: string) { return input; }", "}", ""].join("\n"),
  });
  const result = generateImpact("fix payload parsing", { path: root });
  assert.ok(!result.data.concepts.includes("money flow"), `payload query should infer no money-flow concept, got ${result.data.concepts.join(", ")}`);
  const top = result.data.topFiles.map((f) => f.path);
  assert.equal(top[0], "src/parsing/payload-parser.service.ts", `parser should rank first, got ${top.join(", ")}`);
  const parser = result.data.topFiles[0];
  assert.ok(!parser.reasons.some((r) => r.includes("demoted")), `parser should not be concept-demoted, reasons: ${parser.reasons.join(" | ")}`);
});

// --- Finding #5: concept demotion is proportional and never erases a strong match ---

test("generateImpact keeps a strong owner ahead of an off-concept file under a single concept", () => {
  // Regression guard for the original behavior the safer demotion must preserve.
  const root = writeFixture("demote-single", {
    "package.json": JSON.stringify({ name: "demote-fixture", scripts: { test: "node --test" } }),
    "src/payment/processors/stripe.processor.ts": ["export class StripeProcessor {", "  refund(bookingId: string) { return bookingId; }", "}", ""].join("\n"),
    "src/shared/validation/refund-validation.service.ts": ["export class RefundValidationService {", "  validate() { return true; }", "}", ""].join("\n"),
  });
  const result = generateImpact("add Stripe refunds to bookings", { path: root });
  const top = result.data.topFiles.map((f) => f.path);
  const ownerIdx = top.indexOf("src/payment/processors/stripe.processor.ts");
  const valIdx = top.indexOf("src/shared/validation/refund-validation.service.ts");
  assert.ok(ownerIdx >= 0, `owner missing: ${top.join(", ")}`);
  assert.ok(ownerIdx < valIdx || valIdx === -1, `payment owner (#${ownerIdx}) should beat off-concept validation (#${valIdx})`);
});

test("generateImpact softens the off-concept demotion when multiple concepts disagree", () => {
  // A query that infers BOTH a money-flow and an auth concept. A file that
  // owns one concept but not the other should not be demoted as hard as the
  // single-concept case, so the off-concept (but path-relevant) file keeps a
  // meaningful score instead of being crushed by a flat 0.5.
  const root = writeFixture("demote-multi", {
    "package.json": JSON.stringify({ name: "multi-fixture", scripts: { test: "node --test" } }),
    "src/payment/refund.service.ts": ["export class RefundService { refund() { return true; } }", ""].join("\n"),
    "src/checkout/checkout-summary.component.ts": ["export class CheckoutSummaryComponent { render() { return 'summary'; } }", ""].join("\n"),
  });
  const result = generateImpact("add login tokens to the checkout payment flow", { path: root });
  // Multiple concepts should be inferred (auth + money flow).
  assert.ok(result.data.concepts.length >= 2, `expected multiple concepts, got ${result.data.concepts.join(", ")}`);
  const summary = result.data.topFiles.find((f) => f.path === "src/checkout/checkout-summary.component.ts");
  if (summary) {
    const demoteReason = summary.reasons.find((r) => r.includes("demoted"));
    if (demoteReason) {
      const match = demoteReason.match(/×([0-9.]+)/);
      assert.ok(match, `expected a demotion factor in reason: ${demoteReason}`);
      const factor = Number(match[1]);
      assert.ok(factor > 0.5, `multi-concept demotion factor should be softer than 0.5, got ${factor}`);
    }
  }
});

// --- Finding #9: diff validation runs git via the arg-array runner (no shell) ---

test("generateImpact validates against a real diff base using the arg-array git runner", () => {
  const root = gitFixture("validate", {
    "package.json": JSON.stringify({ name: "validate-fixture", scripts: { test: "node --test" } }),
    "src/payment/processors/stripe.processor.ts": ["export class StripeProcessor {", "  refund(bookingId) { return bookingId; }", "}", ""].join("\n"),
  });
  // Modify a tracked file so the diff against HEAD is non-empty.
  fs.writeFileSync(
    path.join(root, "src/payment/processors/stripe.processor.ts"),
    ["export class StripeProcessor {", "  refund(bookingId) { return bookingId; }", "  chargeback(id) { return id; }", "}", ""].join("\n"),
  );

  const result = generateImpact("add Stripe refunds", { path: root, diffBase: "HEAD" });
  assert.ok(result.data.validation, "expected a validation block");
  assert.equal(result.data.validation.ok, true, `validation should succeed, got ${JSON.stringify(result.data.validation)}`);
  assert.equal(result.data.validation.base, "HEAD");
  assert.ok(result.data.validation.changedFiles.includes("src/payment/processors/stripe.processor.ts"));
});

test("generateImpact fixes rename semantics independently of local Git config", () => {
  const root = gitFixture("rename-config", {
    "package.json": JSON.stringify({ name: "rename-fixture" }),
    "src/old-name.ts": "export const renamed = true;\n",
  });
  fs.renameSync(path.join(root, "src/old-name.ts"), path.join(root, "src/new-name.ts"));
  spawnSync("git", ["add", "-A"], { cwd: root });

  spawnSync("git", ["config", "diff.renames", "false"], { cwd: root });
  const disabled = generateImpact("rename the source file", { path: root, diffBase: "HEAD" });
  spawnSync("git", ["config", "diff.renames", "copies"], { cwd: root });
  spawnSync("git", ["config", "diff.renameLimit", "1"], { cwd: root });
  spawnSync("git", ["config", "diff.algorithm", "histogram"], { cwd: root });
  const copies = generateImpact("rename the source file", { path: root, diffBase: "HEAD" });

  assert.deepEqual(disabled.data.validation.changedFiles, ["src/new-name.ts"]);
  assert.deepEqual(copies.data.validation.changedFiles, disabled.data.validation.changedFiles);
});

test("generateImpact includes untracked files in diff validation before staging", () => {
  const root = gitFixture("validate-untracked", {
    "package.json": JSON.stringify({ name: "validate-untracked-fixture", scripts: { test: "node --test" } }),
    "src/payment/processors/stripe.processor.ts": "export class StripeProcessor { refund() {} }\n",
  });
  fs.mkdirSync(path.join(root, "src/payment/refunds"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/payment/refunds/refund-policy.ts"), "export const refundPolicy = 'safe';\n");

  const result = generateImpact("add a safe refund policy", { path: root, diffBase: "HEAD" });
  assert.equal(result.data.validation.ok, true);
  assert.ok(result.data.validation.changedFiles.includes("src/payment/refunds/refund-policy.ts"));
});

test("generateImpact surfaces exact diff evidence without concealing unexplained changes", () => {
  const root = gitFixture("diff-evidence", {
    "package.json": JSON.stringify({ name: "diff-evidence-fixture" }),
    "src/access/permission.service.ts": "export const canAccess = () => false;\n",
    "src/orders/order.service.ts": "export const findOrder = () => null;\n",
    "src/ui/copy.ts": "export const heading = 'Welcome';\n",
  });
  fs.writeFileSync(path.join(root, "src/access/permission.service.ts"), "export const canAccess = () => true;\n");
  fs.writeFileSync(path.join(root, "src/orders/order.service.ts"), "export const findOrder = (id) => id;\n");

  const result = generateImpact("adjust the welcome message", { path: root, diffBase: "HEAD", top: 1 });
  const exactFiles = ["src/access/permission.service.ts", "src/orders/order.service.ts"];

  assert.deepEqual(result.data.diffEvidence?.mappedFiles, exactFiles);
  for (const file of exactFiles) {
    const entry = result.data.topFiles.find((candidate) => candidate.path === file);
    assert.ok(entry, `changed file missing from surfaced impact: ${file}`);
    assert.ok(
      entry.reasons.some((reason) => reason.includes("exact Git diff evidence")),
      `missing evidence label for ${file}`,
    );
  }
  assert.deepEqual(result.data.validation.missedChangedFiles, exactFiles);
  assert.deepEqual(result.data.validation.heuristic.missedChangedFiles, exactFiles);
});

test("generateImpact reports a clean validation error for a bad diff base instead of throwing", () => {
  const root = gitFixture("validate-bad", {
    "package.json": JSON.stringify({ name: "validate-bad-fixture", scripts: { test: "node --test" } }),
    "src/payment/processors/stripe.processor.ts": ["export class StripeProcessor { refund() {} }", ""].join("\n"),
  });
  // A ref that does not exist; the arg-array runner returns a non-zero status
  // rather than letting a shell interpret it.
  const result = generateImpact("add Stripe refunds", { path: root, diffBase: "no-such-ref-xyz" });
  assert.ok(result.data.validation, "expected a validation block");
  assert.equal(result.data.validation.ok, false);
  assert.match(result.data.validation.error, /git diff failed/);
});

function gitFixture(prefix, files) {
  const root = writeFixture(prefix, files);
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  spawnSync("git", ["config", "user.email", "t@t"], { cwd: root });
  spawnSync("git", ["config", "user.name", "T"], { cwd: root });
  spawnSync("git", ["add", "."], { cwd: root });
  spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: root });
  return root;
}
