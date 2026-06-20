import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { warnIfLegacyAlias } from "../src/cli.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const postinstall = path.join(here, "..", "scripts", "postinstall.mjs");

/**
 * Capture console.error while running `fn` with a given argv[1] basename.
 * @param {string} argv1
 * @param {() => void} fn
 * @returns {string[]}
 */
function captureWarn(argv1, fn) {
  const savedArgv1 = process.argv[1];
  const savedError = console.error;
  /** @type {string[]} */
  const calls = [];
  process.argv[1] = argv1;
  console.error = (/** @type {unknown} */ msg) => calls.push(String(msg));
  try {
    fn();
  } finally {
    console.error = savedError;
    process.argv[1] = savedArgv1;
  }
  return calls;
}

test("warnIfLegacyAlias warns when invoked as dev-context", () => {
  const calls = captureWarn("/usr/local/bin/dev-context", warnIfLegacyAlias);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /dev-context.*deprecated.*v3\.0\.0/);
});

test("warnIfLegacyAlias is silent when invoked as repoctx", () => {
  assert.deepEqual(captureWarn("/usr/local/bin/repoctx", warnIfLegacyAlias), []);
  assert.deepEqual(captureWarn("/some/path/cli.js", warnIfLegacyAlias), []);
});

/**
 * @param {Record<string, string>} extraEnv
 * @returns {{ status: number | null, stderr: string }}
 */
function runPostinstall(extraEnv) {
  // Start from a clean slate for the guard vars so the host CI env can't leak in.
  const env = { ...process.env, CI: "", REPOCTX_SKIP_POSTINSTALL: "", npm_config_global: "", ...extraEnv };
  const result = spawnSync(process.execPath, [postinstall], { env, encoding: "utf8" });
  return { status: result.status, stderr: result.stderr ?? "" };
}

test("postinstall runs doctor only on a global, non-CI install", () => {
  const result = runPostinstall({ npm_config_global: "true" });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /Environment check/);
});

test("postinstall is silent for non-global installs", () => {
  const result = runPostinstall({});
  assert.equal(result.status, 0);
  assert.equal(result.stderr.trim(), "");
});

test("postinstall is skipped in CI and when opted out", () => {
  const inCi = runPostinstall({ npm_config_global: "true", CI: "1" });
  assert.equal(inCi.status, 0);
  assert.equal(inCi.stderr.trim(), "");

  const optedOut = runPostinstall({ npm_config_global: "true", REPOCTX_SKIP_POSTINSTALL: "1" });
  assert.equal(optedOut.status, 0);
  assert.equal(optedOut.stderr.trim(), "");
});

test("postinstall always exits 0 (never fails an install)", () => {
  // Even with a bogus global flag value, the hook must not break the install.
  const result = runPostinstall({ npm_config_global: "true", PATH: "" });
  assert.equal(result.status, 0);
});
