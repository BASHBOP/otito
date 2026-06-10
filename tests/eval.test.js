import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runEval, runRetrievalEval } from "../src/lib/eval.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("runEval returns per-task and total token estimates for a tiny repo", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repoctx-eval-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "eval-fixture",
      scripts: { lint: "eslint .", test: "node --test" },
    }),
  );
  fs.writeFileSync(path.join(root, "README.md"), "# eval fixture\n\nA tiny repo for eval testing.\n");
  fs.writeFileSync(path.join(root, "src", "main.ts"), "export function main() { return 42; }\n");

  const { data, markdown } = runEval(root, { query: "audit this codebase" });

  assert.equal(data.ok, true);
  assert.equal(data.evalVersion, 1);
  assert.equal(data.repo.name, path.basename(root));
  assert.equal(data.query, "audit this codebase");
  assert.equal(data.tasks.length, 4);

  const taskNames = data.tasks.map((t) => t.name).sort();
  assert.deepEqual(taskNames, ["code_map", "context_pack", "harness", "repo_overview"]);

  for (const task of data.tasks) {
    assert.equal(task.ok, true, `task ${task.name} should run cleanly: ${task.error}`);
    assert.ok(task.repoctxBytes >= 0);
    assert.ok(task.naiveBytes >= 0);
    assert.ok(task.repoctxTokens >= 0);
    assert.ok(task.naiveTokens >= 0);
  }

  assert.ok(data.totals.repoctxBytes > 0);
  assert.equal(data.totals.repoctxTokens + data.totals.savedTokens, data.totals.naiveTokens, "repoctx + saved should equal naive");

  assert.match(markdown, /# repoctx Eval:/);
  assert.match(markdown, /\| Task \| repoctx tokens \|/);
  assert.match(markdown, /## Totals/);
});

test("runEval handles a missing repo gracefully", () => {
  assert.throws(() => runEval("/this/path/should/not/exist"), /repo not found/);
});

test("runRetrievalEval scores the committed corpus and passes its thresholds", () => {
  const { data, markdown } = runRetrievalEval();

  assert.equal(data.ok, true);
  assert.equal(data.evalKind, "accuracy");
  assert.ok(data.counts.retrieval >= 16, "expected at least 16 retrieval cases");
  assert.ok(data.counts.risk >= 16, "expected at least 16 risk cases");
  assert.ok(data.counts.retrieval + data.counts.risk >= 25, "corpus must have at least 25 labeled cases");

  // Real scoreboard, not a stub.
  const { retrieval, risk } = data.scoreboard;
  assert.ok(retrieval.pAtK > 0 && retrieval.pAtK <= 1, `p@k in (0,1]: ${retrieval.pAtK}`);
  assert.ok(retrieval.rAtK > 0 && retrieval.rAtK <= 1, `r@k in (0,1]: ${retrieval.rAtK}`);
  assert.ok(retrieval.mrr > 0 && retrieval.mrr <= 1, `mrr in (0,1]: ${retrieval.mrr}`);
  assert.ok(risk.accuracy >= 0 && risk.accuracy <= 1, `risk accuracy in [0,1]: ${risk.accuracy}`);

  // Every threshold check must pass and the overall gate must be green today.
  assert.ok(data.checks.length >= 4, "expected retrieval + risk threshold checks");
  for (const check of data.checks) {
    assert.equal(check.pass, true, `threshold check ${check.metric} failed: ${check.value} < ${check.threshold}`);
  }
  assert.equal(data.passed, true, "committed corpus must pass all thresholds");
  assert.equal(data.exitCode, 0);

  assert.match(markdown, /# repoctx Accuracy Eval/);
  assert.match(markdown, /## Scoreboard/);
  assert.match(markdown, /Overall: PASS/);
});

test("runRetrievalEval enforces the encoded risk false positives/negatives", () => {
  const { data } = runRetrievalEval();
  const byName = new Map(data.cases.risk.map((c) => [c.name, c]));

  // 'fix payload parsing' must NOT classify as money flow ('pay' substring).
  const payload = byName.get("query-payload-not-money");
  assert.ok(payload, "expected query-payload-not-money case");
  assert.equal(payload.pass, true);
  assert.ok(!payload.actualConcepts.includes("money flow"));

  // roles.guard.ts is auth/security, never money flow.
  const guard = byName.get("path-roles-guard-is-auth");
  assert.ok(guard.actualConcepts.includes("auth/security"));
  assert.ok(!guard.actualConcepts.includes("money flow"));
  assert.equal(guard.pass, true);

  // A checkout test must not trip the merge gate.
  const spec = byName.get("gate-checkout-spec-no-gate");
  assert.deepEqual(spec.actualConcepts, []);
  assert.equal(spec.pass, true);

  // dev.environments.ts is not a secret file.
  const devEnv = byName.get("secret-dev-environments-not-secret");
  assert.deepEqual(devEnv.actualConcepts, []);
  assert.equal(devEnv.pass, true);
});

test("retrieval metrics reward a concise, correct pack (precision over returned set, not k)", () => {
  const { data } = runRetrievalEval();
  // A single-file query that returns exactly the right one file should score
  // precision 1.0 — not 1/k — because precision is over what was returned.
  const oneFile = data.cases.retrieval.find((c) => c.name === "shop-stripe-webhook");
  assert.ok(oneFile, "expected shop-stripe-webhook case");
  assert.deepEqual(oneFile.ranked, ["src/payment/stripe.webhook.ts"]);
  assert.equal(oneFile.metrics.precisionAtK, 1);
  assert.equal(oneFile.metrics.recallAtK, 1);
  assert.equal(oneFile.metrics.mrr, 1);
});

test("runRetrievalEval handles the multi-repo route<->client pairing case", () => {
  const { data } = runRetrievalEval();
  const pairing = data.cases.retrieval.find((c) => c.name === "multi-repo-order-pairing");
  assert.ok(pairing, "expected multi-repo-order-pairing case");
  assert.deepEqual(pairing.fixtures, ["shop-api", "web-client"]);
  // Labels are namespaced <fixture>/<repo-path>; both sides must be present.
  assert.ok(pairing.ranked.includes("shop-api/src/orders/orders.controller.ts"));
  assert.ok(pairing.ranked.includes("web-client/src/api/orders.ts"));
  assert.equal(pairing.pass, true);
});

test("runRetrievalEval fails (exit 1) when a corpus regresses below threshold", () => {
  // Synthetic corpus: a retrieval case whose expected primary can never be
  // returned, with thresholds the engine cannot meet. Proves the runner is a
  // real gate, not a rubber stamp — a randomly-wrong pack must NOT pass.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repoctx-eval-corpus-"));
  const corpusPath = path.join(dir, "corpus.json");
  fs.writeFileSync(
    corpusPath,
    JSON.stringify({
      k: 5,
      thresholds: { retrieval: { precisionAtK: 0.99, recallAtK: 0.99, mrr: 0.99 }, risk: { accuracy: 0.99 } },
      fixtureRoots: { "sample-api": "codex/skills/dev-context/evals/files/sample-api" },
      retrieval: [
        {
          name: "impossible",
          query: "completely unrelated nonexistent symbol xyzzy",
          repoFixture: "sample-api",
          expectedPrimary: ["src/does/not/exist.ts"],
        },
      ],
      risk: [
        {
          name: "wrong-risk",
          mode: "query",
          query: "fix payload parsing",
          expectedConcepts: ["money flow"],
          notExpectedConcepts: [],
        },
      ],
    }),
  );

  const { data } = runRetrievalEval({ corpusPath, repoRoot });

  assert.equal(data.passed, false);
  assert.equal(data.exitCode, 1);
  const failing = [...data.cases.retrieval, ...data.cases.risk].filter((c) => !c.pass);
  assert.equal(failing.length, 2, "both the impossible retrieval and wrong-risk cases must fail");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("runRetrievalEval rejects a malformed corpus", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "repoctx-eval-bad-"));
  const corpusPath = path.join(dir, "corpus.json");
  fs.writeFileSync(corpusPath, JSON.stringify({ retrieval: "nope" }));
  assert.throws(() => runRetrievalEval({ corpusPath }), /retrieval\[\] and risk\[\]/);
  fs.rmSync(dir, { recursive: true, force: true });
});
