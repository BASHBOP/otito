import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_KEYS, getConfigPath, listConfigSources, loadConfig, writeConfig } from "../src/lib/config.js";

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "repoctx-config-test-"));
}

test("CONFIG_KEYS lists all expected keys", () => {
  assert.ok(CONFIG_KEYS.includes("emoji"));
  assert.ok(CONFIG_KEYS.includes("color"));
  assert.ok(CONFIG_KEYS.includes("theme"));
  assert.ok(CONFIG_KEYS.includes("width"));
  assert.ok(CONFIG_KEYS.includes("policy"));
  assert.ok(CONFIG_KEYS.includes("governance"));
  assert.ok(CONFIG_KEYS.includes("telemetry"));
});

test("telemetry defaults to off and REPOCTX_TELEMETRY overrides it", () => {
  const tmp = makeTmpDir();
  assert.equal(loadConfig({ cwd: tmp, env: {} }).telemetry, false, "opt-in: off by default");
  fs.writeFileSync(path.join(tmp, ".repoctxrc.json"), JSON.stringify({ telemetry: true }));
  assert.equal(loadConfig({ cwd: tmp, env: {} }).telemetry, true, "config can enable it");
  assert.equal(loadConfig({ cwd: tmp, env: { REPOCTX_TELEMETRY: "0" } }).telemetry, false, "env overrides config");
  fs.rmSync(tmp, { recursive: true });
});

test("loadConfig returns built-in defaults when no files or env present", () => {
  const tmp = makeTmpDir();
  const cfg = loadConfig({ cwd: tmp, env: {} });
  assert.equal(cfg.theme, "default");
  assert.equal(cfg.policy, "standard");
  assert.equal(cfg.governance, "team");
  assert.equal(cfg.emoji, undefined);
  assert.equal(cfg.color, undefined);
  fs.rmSync(tmp, { recursive: true });
});

test("loadConfig reads .repoctxrc.json from cwd", () => {
  const tmp = makeTmpDir();
  fs.writeFileSync(path.join(tmp, ".repoctxrc.json"), JSON.stringify({ color: true, theme: "color" }));
  const cfg = loadConfig({ cwd: tmp, env: {} });
  assert.equal(cfg.color, true);
  assert.equal(cfg.theme, "color");
  fs.rmSync(tmp, { recursive: true });
});

test("loadConfig env vars override local config", () => {
  const tmp = makeTmpDir();
  fs.writeFileSync(path.join(tmp, ".repoctxrc.json"), JSON.stringify({ color: true }));
  const cfg = loadConfig({ cwd: tmp, env: { REPOCTX_COLOR: "false" } });
  assert.equal(cfg.color, false);
  fs.rmSync(tmp, { recursive: true });
});

test("NO_COLOR env var disables color regardless of config", () => {
  const tmp = makeTmpDir();
  fs.writeFileSync(path.join(tmp, ".repoctxrc.json"), JSON.stringify({ color: true }));
  const cfg = loadConfig({ cwd: tmp, env: { NO_COLOR: "" } });
  assert.equal(cfg.color, false);
  fs.rmSync(tmp, { recursive: true });
});

test("REPOCTX_EMOJI=1 sets emoji to true", () => {
  const tmp = makeTmpDir();
  const cfg = loadConfig({ cwd: tmp, env: { REPOCTX_EMOJI: "1" } });
  assert.equal(cfg.emoji, true);
  fs.rmSync(tmp, { recursive: true });
});

test("REPOCTX_WIDTH sets numeric width", () => {
  const tmp = makeTmpDir();
  const cfg = loadConfig({ cwd: tmp, env: { REPOCTX_WIDTH: "100" } });
  assert.equal(cfg.width, 100);
  fs.rmSync(tmp, { recursive: true });
});

test("writeConfig creates file and writeConfig merges into existing", () => {
  const tmp = makeTmpDir();
  writeConfig({ color: true }, "local", tmp);
  const p = path.join(tmp, ".repoctxrc.json");
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
  assert.equal(p, path.join(tmp, ".repoctxrc.json"));
  fs.rmSync(tmp, { recursive: true });
});

test("listConfigSources annotates env override", () => {
  const tmp = makeTmpDir();
  const sources = listConfigSources({ cwd: tmp, env: { REPOCTX_COLOR: "false" } });
  const colorEntry = sources.find((s) => s.key === "color");
  assert.ok(colorEntry);
  assert.equal(colorEntry.source, "env");
  assert.equal(colorEntry.value, false);
  fs.rmSync(tmp, { recursive: true });
});

test("listConfigSources annotates local vs default", () => {
  const tmp = makeTmpDir();
  fs.writeFileSync(path.join(tmp, ".repoctxrc.json"), JSON.stringify({ theme: "minimal" }));
  const sources = listConfigSources({ cwd: tmp, env: {} });
  const themeEntry = sources.find((s) => s.key === "theme");
  assert.ok(themeEntry);
  assert.equal(themeEntry.source, "local");
  assert.equal(themeEntry.value, "minimal");
  const policyEntry = sources.find((s) => s.key === "policy");
  assert.ok(policyEntry);
  assert.equal(policyEntry.source, "default");
  fs.rmSync(tmp, { recursive: true });
});

test("loadConfig walks up to find .repoctxrc.json in parent", () => {
  const tmp = makeTmpDir();
  fs.writeFileSync(path.join(tmp, ".repoctxrc.json"), JSON.stringify({ emoji: false }));
  const nested = path.join(tmp, "packages", "web");
  fs.mkdirSync(nested, { recursive: true });
  const cfg = loadConfig({ cwd: nested, env: {} });
  assert.equal(cfg.emoji, false);
  fs.rmSync(tmp, { recursive: true });
});

test("loadConfig honors XDG_CONFIG_HOME from the injected env (user tier)", () => {
  const tmp = makeTmpDir();
  const xdg = path.join(tmp, "xdg");
  fs.mkdirSync(path.join(xdg, "repoctx"), { recursive: true });
  fs.writeFileSync(path.join(xdg, "repoctx", "config.json"), JSON.stringify({ theme: "from-user-xdg" }));
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
