import test from "node:test";
import assert from "node:assert/strict";
import { parseArgv } from "../src/lib/args.js";

test("parseArgv parses command, positionals, and flags", () => {
  const parsed = parseArgv(["deps", "zod", "--query", "parse", "--limit=5", "--json"]);
  assert.equal(parsed.command, "deps");
  assert.deepEqual(parsed.positionals, ["zod"]);
  assert.equal(parsed.flags.query, "parse");
  assert.equal(parsed.flags.limit, "5");
  assert.equal(parsed.flags.json, true);
});

test("parseArgv collects repeated exclude flags", () => {
  const parsed = parseArgv(["structure", ".", "--exclude", "a.ts", "-e", "b.ts"]);
  assert.deepEqual(parsed.flags.exclude, ["a.ts", "b.ts"]);
});

test("parseArgv collects repeated pattern flags", () => {
  const parsed = parseArgv(["structure", ".", "--pattern", "app/**/*.tsx", "-p", "src/**/*.ts"]);
  assert.deepEqual(parsed.flags.pattern, ["app/**/*.tsx", "src/**/*.ts"]);
});
