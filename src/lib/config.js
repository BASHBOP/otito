import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** Keys accepted in a config file or via env. */
const VALID_KEYS = new Set(["emoji", "color", "theme", "width", "policy", "governance", "telemetry"]);

/**
 * Built-in defaults. Only keys with stable defaults are listed; undefined keys
 * mean "auto-detect at render time" (e.g. emoji and color).
 */
const DEFAULTS = {
  theme: "default",
  policy: "standard",
  governance: "team",
  // Usage telemetry is strictly opt-in: off until the user turns it on.
  telemetry: false,
};

/**
 * @typedef {object} ResolvedConfig
 * @property {boolean | undefined} emoji
 * @property {boolean | undefined} color
 * @property {string | undefined} theme
 * @property {number | undefined} width
 * @property {string | undefined} policy
 * @property {string | undefined} governance
 * @property {boolean | undefined} telemetry
 */

/**
 * @typedef {object} SourcedEntry
 * @property {string} key
 * @property {unknown} value
 * @property {"default" | "user" | "local" | "env"} source
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
function getUserConfigPath(env = process.env) {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg ? xdg : path.join(os.homedir(), ".config");
  return path.join(base, "otito", "config.json");
}

/**
 * Walk up from cwd looking for .otitorc.json, stopping at the home dir.
 * @param {string} cwd
 * @returns {string | null}
 */
function findLocalConfigPath(cwd) {
  const home = os.homedir();
  let dir = cwd;
  for (;;) {
    const candidate = path.join(dir, ".otitorc.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir || dir === home) return null;
    dir = parent;
  }
}

/**
 * @param {string} filePath
 * @returns {Record<string, unknown> | null}
 */
function readJsonFile(filePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} value
 * @returns {boolean | undefined}
 */
function coerceBool(value) {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

/**
 * Apply OTITO_* and NO_COLOR env vars into the config object in-place.
 * @param {Partial<ResolvedConfig>} cfg
 * @param {NodeJS.ProcessEnv} env
 */
function applyEnv(cfg, env) {
  if (env.OTITO_EMOJI !== undefined) {
    const v = coerceBool(env.OTITO_EMOJI);
    if (v !== undefined) cfg.emoji = v;
  }
  if (env.OTITO_COLOR !== undefined) {
    const v = coerceBool(env.OTITO_COLOR);
    if (v !== undefined) cfg.color = v;
  }
  // NO_COLOR spec: any value (including empty string) disables color.
  if (env.NO_COLOR !== undefined) cfg.color = false;
  if (env.OTITO_THEME !== undefined) cfg.theme = env.OTITO_THEME;
  if (env.OTITO_TELEMETRY !== undefined) {
    const v = coerceBool(env.OTITO_TELEMETRY);
    if (v !== undefined) cfg.telemetry = v;
  }
  if (env.OTITO_WIDTH !== undefined) {
    const n = Number(env.OTITO_WIDTH);
    if (!isNaN(n) && n > 0) cfg.width = n;
  }
}

/**
 * Merge entries from a raw JSON object into cfg, skipping null/undefined values.
 * @param {Partial<ResolvedConfig>} cfg
 * @param {Record<string, unknown>} raw
 */
function mergeRaw(cfg, raw) {
  for (const key of VALID_KEYS) {
    if (Object.hasOwn(raw, key) && raw[key] != null) {
      // @ts-ignore — dynamic key assignment
      cfg[key] = raw[key];
    }
  }
}

/**
 * Load merged config. Precedence (low → high): defaults → user → local → env.
 * CLI flags are applied by callers on top of this result.
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {ResolvedConfig}
 */
export function loadConfig({ cwd = process.cwd(), env = process.env } = {}) {
  /** @type {Partial<ResolvedConfig>} */
  const cfg = { ...DEFAULTS };
  const userRaw = readJsonFile(getUserConfigPath(env));
  if (userRaw) mergeRaw(cfg, userRaw);
  const localPath = findLocalConfigPath(cwd);
  if (localPath) {
    const localRaw = readJsonFile(localPath);
    if (localRaw) mergeRaw(cfg, localRaw);
  }
  applyEnv(cfg, env);
  return /** @type {ResolvedConfig} */ (cfg);
}

/**
 * @param {"user" | "local"} scope
 * @param {string} [cwd]
 * @returns {string}
 */
export function getConfigPath(scope, cwd = process.cwd()) {
  return scope === "local" ? path.join(cwd, ".otitorc.json") : getUserConfigPath();
}

/**
 * Merge partial config into the target file (user or local .otitorc.json).
 * @param {Partial<ResolvedConfig>} config
 * @param {"user" | "local"} [scope]
 * @param {string} [cwd]
 */
export function writeConfig(config, scope = "user", cwd = process.cwd()) {
  const target = getConfigPath(scope, cwd);
  const existing = readJsonFile(target) ?? {};
  for (const [key, value] of Object.entries(config)) {
    if (VALID_KEYS.has(key)) existing[key] = value;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(existing, null, 2)}\n`);
}

/**
 * Returns each known config key annotated with its source.
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {SourcedEntry[]}
 */
export function listConfigSources({ cwd = process.cwd(), env = process.env } = {}) {
  const userRaw = readJsonFile(getUserConfigPath(env)) ?? {};
  const localPath = findLocalConfigPath(cwd);
  const localRaw = localPath ? (readJsonFile(localPath) ?? {}) : {};
  /** @type {Partial<ResolvedConfig>} */
  const envCfg = {};
  applyEnv(envCfg, env);

  return Array.from(VALID_KEYS).map((key) => {
    if (Object.hasOwn(envCfg, key)) return { key, value: /** @type {Record<string,unknown>} */ (envCfg)[key], source: /** @type {"env"} */ ("env") };
    if (Object.hasOwn(localRaw, key) && localRaw[key] != null) return { key, value: localRaw[key], source: /** @type {"local"} */ ("local") };
    if (Object.hasOwn(userRaw, key) && userRaw[key] != null) return { key, value: userRaw[key], source: /** @type {"user"} */ ("user") };
    if (Object.hasOwn(DEFAULTS, key))
      return { key, value: /** @type {Record<string,unknown>} */ (DEFAULTS)[key], source: /** @type {"default"} */ ("default") };
    return { key, value: undefined, source: /** @type {"default"} */ ("default") };
  });
}

/** All valid config key names. @type {string[]} */
export const CONFIG_KEYS = Array.from(VALID_KEYS);
