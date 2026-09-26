import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_KEYS, gatePolicy, getConfigPath, listConfigSources, loadConfig, writeConfig } from "../src/lib/config.js";

// Every loadConfig call pins XDG_CONFIG_HOME to its temp dir. An empty env
// still falls back to ~/.config/otito/config.json, so a developer who has run
// `otito config set telemetry true` would otherwise fail the defaults tests.
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "otito-config-test-"));
}

test("CONFIG_KEYS lists all expected keys", () => {
  assert.ok(CONFIG_KEYS.includes("emoji"));
  assert.ok(CONFIG_KEYS.includes("color"));
  assert.ok(CONFIG_KEYS.includes("theme"));
  assert.ok(CONFIG_KEYS.includes("width"));
  assert.ok(CONFIG_KEYS.includes("policy"));
  assert.ok(CONFIG_KEYS.includes("governance"));
  assert.ok(CONFIG_KEYS.includes("telemetry"));
  assert.ok(CONFIG_KEYS.includes("telemetryShare"));
});

test("anonymous telemetry sharing is a separate opt-in", () => {
  const tmp = makeTmpDir();
  assert.equal(loadConfig({ cwd: tmp, env: { XDG_CONFIG_HOME: tmp } }).telemetryShare, false);
  fs.writeFileSync(path.join(tmp, ".otitorc.json"), JSON.stringify({ telemetry: true, telemetryShare: false }));
  assert.equal(loadConfig({ cwd: tmp, env: { XDG_CONFIG_HOME: tmp } }).telemetry, true);
  assert.equal(loadConfig({ cwd: tmp, env: { XDG_CONFIG_HOME: tmp } }).telemetryShare, false, "local consent does not imply sharing");
  assert.equal(loadConfig({ cwd: tmp, env: { XDG_CONFIG_HOME: tmp, OTITO_TELEMETRY_SHARE: "1" } }).telemetryShare, true);
  fs.rmSync(tmp, { recursive: true });
});

test("telemetry defaults to off and OTITO_TELEMETRY overrides it", () => {
  const tmp = makeTmpDir();
  assert.equal(loadConfig({ cwd: tmp, env: { XDG_CONFIG_HOME: tmp } }).telemetry, false, "opt-in: off by default");
  fs.writeFileSync(path.join(tmp, ".otitorc.json"), JSON.stringify({ telemetry: true }));
  assert.equal(loadConfig({ cwd: tmp, env: { XDG_CONFIG_HOME: tmp } }).telemetry, true, "config can enable it");
  assert.equal(loadConfig({ cwd: tmp, env: { XDG_CONFIG_HOME: tmp, OTITO_TELEMETRY: "0" } }).telemetry, false, "env overrides config");
  fs.rmSync(tmp, { recursive: true });
});

test("loadConfig returns built-in defaults when no files or env present", () => {
  const tmp = makeTmpDir();
  const cfg = loadConfig({ cwd: tmp, env: { XDG_CONFIG_HOME: tmp } });
  assert.equal(cfg.theme, "default");
  assert.equal(cfg.policy, "standard");
  assert.equal(cfg.governance, "team");
  assert.equal(cfg.emoji, undefined);
  assert.equal(cfg.color, undefined);
  fs.rmSync(tmp, { recursive: true });
});

test("loadConfig reads .otitorc.json from cwd", () => {
  const tmp = makeTmpDir();
  fs.writeFileSync(path.join(tmp, ".otitorc.json"), JSON.stringify({ color: true, theme: "color" }));
  const cfg = loadConfig({ cwd: tmp, env: { XDG_CONFIG_HOME: tmp } });
  assert.equal(cfg.color, true);
  assert.equal(cfg.theme, "color");
  fs.rmSync(tmp, { recursive: true });
});

test("loadConfig reads the gate defaults, policy and governance, from .otitorc.json", () => {
  const tmp = makeTmpDir();
  fs.writeFileSync(path.join(tmp, ".otitorc.json"), JSON.stringify({ policy: "high-risk", governance: "solo" }));
  const cfg = loadConfig({ cwd: tmp, env: { XDG_CONFIG_HOME: tmp } });
  assert.equal(cfg.policy, "high-risk");
  assert.equal(cfg.governance, "solo");
  fs.rmSync(tmp, { recursive: true });
});

test("loadConfig env vars override local config", () => {
  const tmp = makeTmpDir();
  fs.writeFileSync(path.join(tmp, ".otitorc.json"), JSON.stringify({ color: true }));
  const cfg = loadConfig({ cwd: tmp, env: { XDG_CONFIG_HOME: tmp, OTITO_COLOR: "false" } });
  assert.equal(cfg.color, false);
  fs.rmSync(tmp, { recursive: true });
});

test("NO_COLOR env var disables color regardless of config", () => {
  const tmp = makeTmpDir();
  fs.writeFileSync(path.join(tmp, ".otitorc.json"), JSON.stringify({ color: true }));
  const cfg = loadConfig({ cwd: tmp, env: { XDG_CONFIG_HOME: tmp, NO_COLOR: "" } });
  assert.equal(cfg.color, false);
  fs.rmSync(tmp, { recursive: true });
});

test("OTITO_EMOJI=1 sets emoji to true", () => {
  const tmp = makeTmpDir();
  const cfg = loadConfig({ cwd: tmp, env: { XDG_CONFIG_HOME: tmp, OTITO_EMOJI: "1" } });
  assert.equal(cfg.emoji, true);
  fs.rmSync(tmp, { recursive: true });
});

test("OTITO_WIDTH sets numeric width", () => {
  const tmp = makeTmpDir();
  const cfg = loadConfig({ cwd: tmp, env: { XDG_CONFIG_HOME: tmp, OTITO_WIDTH: "100" } });
  assert.equal(cfg.width, 100);
  fs.rmSync(tmp, { recursive: true });
});

test("writeConfig creates file and writeConfig merges into existing", () => {
  const tmp = makeTmpDir();
  writeConfig({ color: true }, "local", tmp);
  const p = path.join(tmp, ".otitorc.json");
  assert.ok(fs.existsSync(p));
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(raw.color, true);

  // Second write merges rather than overwrites.
  writeConfig({ theme: "minimal" }, "local", tmp);
  const merged = JSON.parse(fs.readFileSync(p, "utf8"));
  assert.equal(merged.color, true);
  assert.equal(merged.theme, "minimal");
  fs.rmSync(tmp, { recursive: true });
});

test("getConfigPath returns local path inside cwd", () => {
  const tmp = makeTmpDir();
  const p = getConfigPath("local", tmp);
  assert.equal(p, path.join(tmp, ".otitorc.json"));
  fs.rmSync(tmp, { recursive: true });
});

test("listConfigSources annotates env override", () => {
  const tmp = makeTmpDir();
  const sources = listConfigSources({ cwd: tmp, env: { XDG_CONFIG_HOME: tmp, OTITO_COLOR: "false" } });
  const colorEntry = sources.find((s) => s.key === "color");
  assert.ok(colorEntry);
  assert.equal(colorEntry.source, "env");
  assert.equal(colorEntry.value, false);
  fs.rmSync(tmp, { recursive: true });
});

test("listConfigSources annotates local vs default", () => {
  const tmp = makeTmpDir();
  fs.writeFileSync(path.join(tmp, ".otitorc.json"), JSON.stringify({ theme: "minimal" }));
  const sources = listConfigSources({ cwd: tmp, env: { XDG_CONFIG_HOME: tmp } });
  const themeEntry = sources.find((s) => s.key === "theme");
  assert.ok(themeEntry);
  assert.equal(themeEntry.source, "local");
  assert.equal(themeEntry.value, "minimal");
  const policyEntry = sources.find((s) => s.key === "policy");
  assert.ok(policyEntry);
  assert.equal(policyEntry.source, "default");
  fs.rmSync(tmp, { recursive: true });
});

test("loadConfig walks up to find .otitorc.json in parent", () => {
  const tmp = makeTmpDir();
  fs.writeFileSync(path.join(tmp, ".otitorc.json"), JSON.stringify({ emoji: false }));
  const nested = path.join(tmp, "packages", "web");
  fs.mkdirSync(nested, { recursive: true });
  const cfg = loadConfig({ cwd: nested, env: { XDG_CONFIG_HOME: tmp } });
  assert.equal(cfg.emoji, false);
  fs.rmSync(tmp, { recursive: true });
});

test("loadConfig walks up from a relative cwd, such as an MCP tool's path: '.'", () => {
  const tmp = makeTmpDir();
  fs.writeFileSync(path.join(tmp, ".otitorc.json"), JSON.stringify({ governance: "solo" }));
  const nested = path.join(tmp, "packages", "web");
  fs.mkdirSync(nested, { recursive: true });
  const saved = process.cwd();
  process.chdir(nested);
  try {
    // path.dirname(".") is ".", so an unresolved walk ended where it began and
    // a gate on path "." fell back to team governance.
    assert.equal(loadConfig({ cwd: ".", env: { XDG_CONFIG_HOME: tmp } }).governance, "solo");
    assert.equal(loadConfig({ cwd: "..", env: { XDG_CONFIG_HOME: tmp } }).governance, "solo");
  } finally {
    process.chdir(saved);
  }
  fs.rmSync(tmp, { recursive: true });
});

test("loadConfig from a relative sibling path reads that path's config, not the cwd's", () => {
  const tmp = makeTmpDir();
  const here = path.join(tmp, "here");
  const there = path.join(tmp, "there");
  fs.mkdirSync(here);
  fs.mkdirSync(there);
  fs.writeFileSync(path.join(here, ".otitorc.json"), JSON.stringify({ governance: "solo" }));
  const saved = process.cwd();
  process.chdir(here);
  try {
    // Unresolved, the walk from "../there" went to "..", then to ".", and read
    // this directory's config: `otito pass ../there` gated there as solo.
    assert.equal(loadConfig({ cwd: "../there", env: { XDG_CONFIG_HOME: tmp } }).governance, "team");
  } finally {
    process.chdir(saved);
  }
  fs.rmSync(tmp, { recursive: true });
});

test("gatePolicy fills an omitted or blank policy and governance from the gated repository's config", () => {
  const tmp = makeTmpDir();
  const repo = path.join(tmp, "repo");
  const bare = path.join(tmp, "bare");
  fs.mkdirSync(repo);
  fs.mkdirSync(bare);
  fs.writeFileSync(path.join(repo, ".otitorc.json"), JSON.stringify({ policy: "high-risk", governance: "solo" }));
  const env = { XDG_CONFIG_HOME: tmp };

  assert.deepEqual(gatePolicy(repo, {}, env), { policy: "high-risk", governance: "solo" });
  assert.deepEqual(gatePolicy(repo, { policy: "standard", governance: "team" }, env), { policy: "standard", governance: "team" }, "an explicit value wins");
  assert.deepEqual(gatePolicy(repo, { policy: " ", governance: "" }, env), { policy: "high-risk", governance: "solo" }, "a blank value counts as omitted");
  assert.deepEqual(gatePolicy(bare, {}, env), { policy: "standard", governance: "team" }, "no config anywhere leaves the defaults");

  // The user config fills what the gated repository leaves out.
  fs.mkdirSync(path.join(tmp, "otito"));
  fs.writeFileSync(path.join(tmp, "otito", "config.json"), JSON.stringify({ governance: "solo" }));
  assert.deepEqual(gatePolicy(bare, {}, env), { policy: "standard", governance: "solo" });
  fs.rmSync(tmp, { recursive: true });
});

test("loadConfig honors XDG_CONFIG_HOME from the injected env (user tier)", () => {
  const tmp = makeTmpDir();
  const xdg = path.join(tmp, "xdg");
  fs.mkdirSync(path.join(xdg, "otito"), { recursive: true });
  fs.writeFileSync(path.join(xdg, "otito", "config.json"), JSON.stringify({ theme: "from-user-xdg" }));
  const cwd = path.join(tmp, "work");
  fs.mkdirSync(cwd, { recursive: true });

  const cfg = loadConfig({ cwd, env: { XDG_CONFIG_HOME: xdg } });
  assert.equal(cfg.theme, "from-user-xdg");

  const sources = listConfigSources({ cwd, env: { XDG_CONFIG_HOME: xdg } });
  const themeSource = sources.find((entry) => entry.key === "theme");
  assert.equal(themeSource?.value, "from-user-xdg");
  assert.equal(themeSource?.source, "user");
  fs.rmSync(tmp, { recursive: true });
});
