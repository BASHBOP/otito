import test from "node:test";
import assert from "node:assert/strict";
import {
  askSystemOne,
  CAPABILITIES,
  CHOICE_FLOOR,
  DEMOTE_BELOW,
  INTENTS,
  interpretRead,
  JEV_API_URL,
  JEV_PER_MTOK,
  MAX_RELEVANCE_FILES,
  pickAnswers,
  priceJevCall,
  readQuestions,
} from "../src/lib/jev.js";
import { tools } from "../src/lib/mcp.js";

test("priceJevCall separates a free call from an unmeasured one", () => {
  // Zero is a measurement: the call billed nothing and costs nothing.
  assert.equal(priceJevCall(0), 0);
  assert.equal(priceJevCall(1_000_000), JEV_PER_MTOK);

  // These are absences, not amounts, and must not read as free.
  for (const missing of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, "700"]) {
    assert.equal(priceJevCall(/** @type {any} */ (missing)), null, `${String(missing)} should not price`);
  }
});

test("the capability choice names exactly the MCP tool catalog, plus none", () => {
  const options = Object.keys(CAPABILITIES)
    .filter((key) => key !== "none")
    .sort();
  assert.deepEqual(options, tools.map((tool) => tool.name).sort(), "a tool added to mcp.js must be added to CAPABILITIES, and the reverse");
  assert.ok(CAPABILITIES.none, "a Choice that may not be exhaustive needs a way out");
});

test("readQuestions builds the documented Choice and Noul shapes", () => {
  const files = [{ path: "src/a.js" }, { path: "docs/b.md" }];
  const questions = /** @type {Record<string, any>} */ (readQuestions({ files }));
  assert.deepEqual(Object.keys(questions), ["read_intent", "read_capability", "read_file_0", "read_file_1"]);

  // Choice criteria are an object keyed by option; Noul criteria are true/false.
  assert.equal(questions.read_intent.type, "choice");
  assert.deepEqual(questions.read_intent.criteria, INTENTS);
  assert.equal(questions.read_capability.type, "choice");
  assert.deepEqual(questions.read_capability.criteria, CAPABILITIES);
  assert.equal(questions.read_file_1.type, "noul");
  assert.match(questions.read_file_1.instructions, /docs\/b\.md/);
  assert.deepEqual(Object.keys(questions.read_file_1.criteria), ["true", "false"]);

  assert.deepEqual(Object.keys(readQuestions({ files, intent: false, capability: false })), ["read_file_0", "read_file_1"]);
  assert.deepEqual(Object.keys(readQuestions()), ["read_intent", "read_capability"]);

  const many = Array.from({ length: MAX_RELEVANCE_FILES + 5 }, (_, index) => ({ path: `f${index}.js` }));
  const capped = Object.keys(readQuestions({ files: many, intent: false, capability: false }));
  assert.equal(capped.length, MAX_RELEVANCE_FILES, "one Noul per file, up to the cap");
});

test("interpretRead gates each Choice on confidence and reads a malformed answer as null", () => {
  const files = [{ path: "a.js" }, { path: "b.js" }, { path: "c.js" }];
  const read = interpretRead(
    {
      read_intent: { type: "choice", choice: "fix", confidence: CHOICE_FLOOR, probabilities: { fix: 0.667, add: 0.333 } },
      read_capability: { type: "choice", choice: "context_pack", confidence: 0.3, probabilities: { context_pack: 0.53 } },
      read_file_0: { type: "noul", noul: 0.934 },
      read_file_1: { type: "noul", noul: "high" },
    },
    files,
  );
  assert.deepEqual(read.intent, { choice: "fix", confidence: 0.5, accepted: true, probabilities: { fix: 0.67, add: 0.33 } });
  assert.equal(read.capability?.accepted, false, "under the floor is reported, not accepted");
  assert.deepEqual(read.relevance, [
    { path: "a.js", relevance: 0.93 },
    { path: "b.js", relevance: null },
    { path: "c.js", relevance: null },
  ]);

  // An option the question never offered is not an answer.
  assert.equal(interpretRead({ read_intent: { choice: "deploy", confidence: 0.99 } }).intent, null);
  // Inherited Object.prototype keys are not options either: a `constructor` or
  // `toString` choice must not slip through `in` as an accepted answer.
  assert.equal(interpretRead({ read_intent: { choice: "constructor", confidence: 0.99 } }).intent, null);
  assert.equal(interpretRead({ read_capability: { choice: "toString", confidence: 0.99 } }).capability, null);
  assert.equal(interpretRead({ read_intent: { choice: "fix" } }).intent?.accepted, false, "no confidence, no acceptance");
  assert.deepEqual(interpretRead(/** @type {any} */ (undefined)), { intent: null, capability: null, relevance: [] });
  assert.ok(DEMOTE_BELOW < CHOICE_FLOOR, "demoting a file takes a stronger no than relabelling an intent takes a yes");
});

test("pickAnswers keeps only the answers a question set asked for", () => {
  const answers = { specificity: 1, read_intent: 2, novelty: 3 };
  assert.deepEqual(pickAnswers(answers, { specificity: {}, novelty: {}, blast_radius: {} }), { specificity: 1, novelty: 3 });
  assert.deepEqual(pickAnswers(/** @type {any} */ (undefined), { specificity: {} }), {});
});

test("askSystemOne posts one call with a bearer key and a timeout, and reports usage", async () => {
  let sent;
  const reply = await askSystemOne(
    { request: "q" },
    { read_intent: { type: "choice" } },
    {
      apiKey: "test-key",
      fetchImpl: async (url, init) => {
        sent = { url: String(url), init };
        return /** @type {any} */ ({ ok: true, json: async () => ({ model: "jev-x", usage: { input_tokens: 100 }, answers: { read_intent: {} } }) });
      },
    },
  );
  assert.equal(sent.url, JEV_API_URL);
  assert.equal(sent.init.headers.authorization, "Bearer test-key");
  assert.ok(sent.init.signal, "a hung vendor call must not hang the tool that made it");
  const body = JSON.parse(sent.init.body);
  assert.deepEqual(body, { state: { request: "q" }, model: "jev-latest", questions: { read_intent: { type: "choice" } } });
  assert.equal(reply.source, "jev");
  assert.equal(reply.model, "jev-x");
  assert.equal(reply.billableTokens, 100);
  assert.deepEqual(reply.answers, { read_intent: {} });
});

test("askSystemOne refuses without a key and surfaces an API error", async (t) => {
  const saved = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  t.after(() => {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved;
  });
  await assert.rejects(() => askSystemOne({}, {}, { fetchImpl: async () => assert.fail("no call without a key") }), /TYPESAFE_API_KEY is not set/);
  await assert.rejects(
    () => askSystemOne({}, {}, { apiKey: "k", fetchImpl: async () => /** @type {any} */ ({ ok: false, status: 422, text: async () => "bad criteria" }) }),
    /TypeSafe API 422: bad criteria/,
  );
});
