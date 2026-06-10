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

test("parseArgv parses PR review short flags", () => {
  const parsed = parseArgv(["pr", ".", "-n", "42", "-b", "origin/main", "--head", "HEAD"]);
  assert.equal(parsed.flags.number, "42");
  assert.equal(parsed.flags.base, "origin/main");
  assert.equal(parsed.flags.head, "HEAD");
});

test("parseArgv parses the gate command with a --pr selector", () => {
  const local = parseArgv(["gate", "../api", "--base", "origin/main", "--json"]);
  assert.equal(local.command, "gate");
  assert.deepEqual(local.positionals, ["../api"]);
  assert.equal(local.flags.pr, undefined, "no --pr means the local gate");
  assert.equal(local.flags.base, "origin/main");

  const pr = parseArgv(["gate", "--pr", "123", "--path", "../api", "--json"]);
  assert.equal(pr.command, "gate");
  assert.equal(pr.flags.pr, "123", "--pr carries the PR selector");
  assert.equal(pr.flags.path, "../api");
});
