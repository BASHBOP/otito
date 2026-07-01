import test from "node:test";
import assert from "node:assert/strict";
import { createFakeRunner, defaultGhRunner } from "../src/lib/gh.js";

test("createFakeRunner returns the longest matching canned prefix", () => {
  const runner = createFakeRunner({
    "pr view": '{"number":1}',
    "pr view 42": '{"number":42}',
  });
  assert.equal(runner.run("/tmp", ["pr", "view", "42", "--json"]), '{"number":42}');
  assert.equal(runner.run("/tmp", ["pr", "view", "--json"]), '{"number":1}');
});

test("createFakeRunner throws canned errors", () => {
  const runner = createFakeRunner({
    "pr view": new Error("gh unavailable"),
  });
  assert.throws(() => runner.run("/tmp", ["pr", "view"]), /gh unavailable/);
});

test("createFakeRunner throws when no canned response matches", () => {
  const runner = createFakeRunner({});
  assert.throws(() => runner.run("/tmp", ["repo", "view"]), /no canned response/);
});

test("defaultGhRunner surfaces gh stderr on failure", () => {
  const runner = defaultGhRunner();
  assert.throws(
    () => runner.run("/definitely/not/a/git/repo", ["pr", "view", "999999999"]),
    (error) => {
      assert.match(String(error.message), /gh pr view/);
      return true;
    },
  );
});
