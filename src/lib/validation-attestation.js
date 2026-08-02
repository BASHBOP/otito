/// <reference types="node" />

// Validation execution is intentionally separate from inferred validation
// commands. A gate may *describe* commands it discovers, but it may execute
// only a versioned plan read from the selected base commit. This prevents a
// staged change from replacing its own required checks immediately before it
// is evaluated.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const POLICY_PATH = "otito.gate.json";
const MAX_COMMANDS = 20;
const MAX_TIMEOUT_SECONDS = 600;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_INHERITED_ENVIRONMENT_VARIABLES = 20;
const validationEngineVersion = 1;

/**
 * Execute the base-committed validation plan against an isolated materialised
 * copy of the exact staged tree. No checkout filters or working-tree source
 * participate in the snapshot.
 *
 * @param {{ root: string, subject: Record<string, any> | null }} options
 * @returns {{ status: "PASS" | "FAIL", summary: string, details: string[], evidence?: Record<string, any> }}
 */
export function executeValidationPlan(options) {
  const { root, subject } = options;
  if (!subject || subject.kind !== "git-index" || !subject.treeSha || !subject.baseSha) {
    return {
      status: "FAIL",
      summary: "Validation execution requires an exact staged Git-tree subject.",
      details: ["Run `otito gate <repo> --staged --run-validation` after staging the intended change."],
    };
  }

  let policy;
  try {
    policy = readValidationPolicy(root, String(subject.baseSha));
  } catch (/** @type {any} */ error) {
    return {
      status: "FAIL",
      summary: "Could not load a versioned validation policy from the selected base commit.",
      details: [error.message ?? String(error)],
    };
  }

  let snapshot = "";
  try {
    snapshot = fs.mkdtempSync(path.join(os.tmpdir(), "otito-gate-"));
    materializeTree(root, String(subject.treeSha), snapshot);
    const dependencyMode = linkDependencies(root, snapshot);
    const environment = validationEnvironment(snapshot, subject, policy);
    const results = policy.commands.map((command) => runValidationCommand(command, snapshot, subject, policy, environment.env));
    const passed = results.every((result) => result.status === "PASS");
    /** @type {Record<string, any>} */
    const evidence = {
      engine: validationEngineVersion,
      policy: {
        path: POLICY_PATH,
        version: policy.version,
        blobSha: policy.blobSha,
        contentSha256: policy.contentSha256,
      },
      subject: normalizeSubject(subject),
      environment: {
        dependencyMode,
        dependencyStateAttested: false,
        inheritedVariables: environment.inheritedVariables,
        isolatedHome: true,
      },
      commands: results,
    };
    evidence.receipt = makeValidationReceipt(evidence);
    return {
      status: passed ? "PASS" : "FAIL",
      summary: passed
        ? `${results.length} versioned validation command${results.length === 1 ? "" : "s"} passed against the exact staged tree.`
        : `${results.filter((result) => result.status !== "PASS").length} versioned validation command(s) failed against the exact staged tree.`,
      details: [`Dependency environment: ${dependencyMode.replaceAll("_", " ")} (not attested).`, ...results.map(formatResult)],
      evidence,
    };
  } catch (/** @type {any} */ error) {
    return {
      status: "FAIL",
      summary: "Validation execution could not materialize the exact staged tree.",
      details: [error.message ?? String(error)],
    };
  } finally {
    if (snapshot) fs.rmSync(snapshot, { recursive: true, force: true });
  }
}

/**
 * Deterministic receipt over the declared policy, exact subject, and bounded
 * command outcomes. Raw output is not retained; only its SHA-256 digest is
 * bound into the receipt.
 * @param {Record<string, any>} evidence
 */
export function makeValidationReceipt(evidence) {
  const canonical = {
    receiptVersion: 1,
    engine: evidence.engine,
    policy: {
      path: evidence.policy.path,
      version: evidence.policy.version,
      blobSha: evidence.policy.blobSha,
      contentSha256: evidence.policy.contentSha256,
    },
    subject: normalizeSubject(evidence.subject),
    environment: evidence.environment,
    commands: evidence.commands.map((/** @type {any} */ command) => ({
      id: command.id,
      command: command.command,
      timeoutSeconds: command.timeoutSeconds,
      status: command.status,
      exitCode: command.exitCode,
      signal: command.signal,
      stdoutSha256: command.stdoutSha256,
      stderrSha256: command.stderrSha256,
      packageScript: command.packageScript ?? null,
      failureReason: command.failureReason ?? null,
    })),
  };
  const inputsHash = sha256(JSON.stringify(canonical));
  return {
    id: `vrcpt_${inputsHash.slice(0, 12)}`,
    algorithm: "sha256",
    receiptVersion: 1,
    inputsHash,
    subject: canonical.subject,
  };
}

/** @param {string} root @param {string} baseSha */
function readValidationPolicy(root, baseSha) {
  const blobSha = gitText(root, ["rev-parse", "--verify", `${baseSha}:${POLICY_PATH}`], `validation policy ${POLICY_PATH}`).trim();
  const raw = gitBuffer(root, ["cat-file", "blob", blobSha], `validation policy ${POLICY_PATH}`).toString("utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${POLICY_PATH} in base ${baseSha} is not valid JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.version !== 1) {
    throw new Error(`${POLICY_PATH} in base ${baseSha} must declare version 1.`);
  }
  const validation = parsed.validation;
  const commands = validation?.commands;
  if (!Array.isArray(commands) || commands.length === 0 || commands.length > MAX_COMMANDS) {
    throw new Error(`${POLICY_PATH} must declare 1–${MAX_COMMANDS} validation.commands entries.`);
  }
  const environment = normalizeValidationEnvironment(validation?.environment);
  const baseScripts = readBasePackageScripts(root, baseSha);
  const ids = new Set();
  const normalized = commands.map((/** @type {any} */ command, index) => {
    if (!command || typeof command !== "object" || Array.isArray(command)) {
      throw new Error(`${POLICY_PATH} validation.commands[${index}] must be an object.`);
    }
    const id = String(command.id ?? "").trim();
    const value = String(command.command ?? "").trim();
    const timeoutSeconds = Number(command.timeoutSeconds ?? 300);
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id) || ids.has(id)) {
      throw new Error(`${POLICY_PATH} validation command ${index + 1} needs a unique id using letters, numbers, _ or -.`);
    }
    if (!value) throw new Error(`${POLICY_PATH} validation command ${id} needs a non-empty command.`);
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > MAX_TIMEOUT_SECONDS) {
      throw new Error(`${POLICY_PATH} validation command ${id} timeoutSeconds must be an integer from 1 to ${MAX_TIMEOUT_SECONDS}.`);
    }
    ids.add(id);
    return { id, command: value, timeoutSeconds, packageScript: pinnedPackageScript(baseScripts, value) };
  });
  return { version: 1, blobSha, contentSha256: sha256(raw), commands: normalized, environment };
}

/** @param {{ id: string, command: string, timeoutSeconds: number, packageScript?: Record<string, string> | null }} command @param {string} cwd @param {Record<string, any>} subject @param {Record<string, any>} policy @param {Record<string, string>} environment */
function runValidationCommand(command, cwd, subject, policy, environment) {
  const startedAt = Date.now();
  const scriptFailure = verifyPinnedPackageScript(command.packageScript, cwd);
  if (scriptFailure) return failedCommand(command, scriptFailure, startedAt);
  const result = spawnSync(command.command, {
    cwd,
    shell: "/bin/sh",
    encoding: "buffer",
    timeout: command.timeoutSeconds * 1000,
    maxBuffer: MAX_OUTPUT_BYTES,
    env: environment,
  });
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(result.stderr ?? "");
  const errorCode = /** @type {any} */ (result.error)?.code;
  const timedOut = errorCode === "ETIMEDOUT";
  const outputTooLarge = errorCode === "ENOBUFS";
  const passed = result.status === 0 && !result.error && !result.signal;
  return {
    ...command,
    status: passed ? "PASS" : "FAIL",
    exitCode: typeof result.status === "number" ? result.status : null,
    signal: result.signal ?? null,
    timedOut,
    outputTooLarge,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    durationMs: Date.now() - startedAt,
  };
}

/** @param {string} snapshot @param {Record<string, any>} subject @param {Record<string, any>} policy */
function validationEnvironment(snapshot, subject, policy) {
  const home = path.join(snapshot, ".otito-validation-home");
  fs.mkdirSync(home, { recursive: true });
  /** @type {Record<string, string>} */
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    OTITO_GATE_SUBJECT_TREE: String(subject.treeSha),
    OTITO_GATE_BASE_SHA: String(subject.baseSha),
    OTITO_GATE_POLICY_BLOB: String(policy.blobSha),
  };
  for (const name of ["TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "SystemRoot", "ComSpec"]) {
    if (process.env[name] !== undefined) env[name] = String(process.env[name]);
  }
  const inheritedVariables = policy.environment.allow.filter((/** @type {string} */ name) => process.env[name] !== undefined);
  for (const name of inheritedVariables) env[name] = String(process.env[name]);
  return { env, inheritedVariables };
}

/** @param {unknown} config */
function normalizeValidationEnvironment(config) {
  if (config === undefined) return { allow: /** @type {string[]} */ ([]) };
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error(`${POLICY_PATH} validation.environment must be an object.`);
  const allow = /** @type {Record<string, unknown>} */ (config).allow ?? [];
  if (!Array.isArray(allow) || allow.length > MAX_INHERITED_ENVIRONMENT_VARIABLES) {
    throw new Error(`${POLICY_PATH} validation.environment.allow must list at most ${MAX_INHERITED_ENVIRONMENT_VARIABLES} variable names.`);
  }
  const names = allow.map((name) => String(name));
  if (new Set(names).size !== names.length || names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || name.startsWith("OTITO_GATE_"))) {
    throw new Error(`${POLICY_PATH} validation.environment.allow must contain unique environment variable names and cannot override OTITO_GATE_* values.`);
  }
  return { allow: names };
}

/** @param {string} root @param {string} baseSha */
function readBasePackageScripts(root, baseSha) {
  try {
    const raw = gitBuffer(root, ["show", `${baseSha}:package.json`], "base package.json").toString("utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.scripts === "object" && !Array.isArray(parsed.scripts) ? parsed.scripts : {};
  } catch {
    return {};
  }
}

/** @param {Record<string, unknown>} baseScripts @param {string} command */
function pinnedPackageScript(baseScripts, command) {
  const invocation = packageScriptInvocation(command);
  if (!invocation) return null;
  const { packageManager, scriptName: name } = invocation;
  const script = baseScripts[name];
  if (typeof script !== "string") {
    throw new Error(`${POLICY_PATH} command \`${command}\` refers to package script \`${name}\` that is absent from the selected base commit.`);
  }
  return { packageManager, packagePath: "package.json", scriptName: name, baseScriptSha256: sha256(script) };
}

/**
 * Identify script invocations independently of what the documentation happens
 * to illustrate. Direct `test` and explicit `run test` forms both resolve a
 * package.json script for npm, pnpm, and Yarn; Bun requires `run` because
 * `bun test` is its built-in test runner. Corepack is a transparent launcher.
 * @param {string} command
 */
function packageScriptInvocation(command) {
  const match = /^(?:corepack\s+)?(npm|pnpm|yarn|bun)\s+(.+)$/.exec(command);
  if (!match) return null;
  const [, packageManager, tail] = match;
  const run = /^run\s+([A-Za-z0-9:_-]+)(?:\s+--.*)?$/.exec(tail);
  if (run) return { packageManager, scriptName: run[1] };
  if (packageManager === "bun") return null;
  const direct = /^([A-Za-z0-9:_-]+)(?:\s+--.*)?$/.exec(tail);
  if (!direct) return null;
  const scriptName = direct[1];
  if (new Set(["add", "audit", "ci", "dlx", "exec", "init", "install", "pack", "publish", "remove", "uninstall", "update", "why"]).has(scriptName)) return null;
  return { packageManager, scriptName };
}

/** @param {Record<string, string> | null | undefined} packageScript @param {string} cwd */
function verifyPinnedPackageScript(packageScript, cwd) {
  if (!packageScript) return "";
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(cwd, packageScript.packagePath), "utf8"));
    const script = parsed?.scripts?.[packageScript.scriptName];
    if (typeof script === "string" && sha256(script) === packageScript.baseScriptSha256) return "";
  } catch {
    // The fixed message below intentionally does not include staged content.
  }
  return `Pinned base package script \`${packageScript.scriptName}\` does not match the exact staged tree.`;
}

/** @param {Record<string, any>} command @param {string} message @param {number} startedAt */
function failedCommand(command, message, startedAt) {
  const stderr = Buffer.from(message);
  return {
    ...command,
    status: "FAIL",
    exitCode: null,
    signal: null,
    timedOut: false,
    outputTooLarge: false,
    failureReason: message,
    stdoutSha256: sha256(Buffer.alloc(0)),
    stderrSha256: sha256(stderr),
    durationMs: Date.now() - startedAt,
  };
}

/** @param {Record<string, any>} result */
function formatResult(result) {
  const outcome = result.status === "PASS" ? "passed" : result.timedOut ? "timed out" : result.outputTooLarge ? "exceeded the output limit" : "failed";
  const exit = result.exitCode === null ? "no exit code" : `exit ${result.exitCode}`;
  return `${result.id}: ${outcome} (${exit}; stdout sha256 ${result.stdoutSha256.slice(0, 12)}; stderr sha256 ${result.stderrSha256.slice(0, 12)})${result.failureReason ? ` — ${result.failureReason}` : ""}`;
}

/** @param {string} root @param {string} treeSha @param {string} target */
function materializeTree(root, treeSha, target) {
  const entries = gitBuffer(root, ["ls-tree", "-r", "-z", treeSha], "staged tree entries").toString("utf8").split("\0").filter(Boolean);
  for (const entry of entries) {
    const match = /^(\d+)\s+(\w+)\s+([0-9a-f]+)\t([\s\S]+)$/.exec(entry);
    if (!match) throw new Error("Could not parse an entry in the exact staged tree.");
    const [, mode, type, blobSha, relative] = match;
    if (type !== "blob" || mode === "120000") {
      throw new Error(`Exact validation snapshots do not support ${type === "commit" ? "submodules" : "symbolic links"}: ${relative}`);
    }
    const destination = safeSnapshotPath(target, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, gitBuffer(root, ["cat-file", "blob", blobSha], `staged blob ${relative}`));
    if (mode === "100755") fs.chmodSync(destination, 0o755);
  }
}

/** @param {string} root @param {string} snapshot */
function linkDependencies(root, snapshot) {
  const dependencies = path.join(root, "node_modules");
  if (fs.existsSync(dependencies)) {
    fs.symlinkSync(dependencies, path.join(snapshot, "node_modules"), "dir");
    return "linked_local_node_modules";
  }
  return "none";
}

/** @param {string} target @param {string} relative */
function safeSnapshotPath(target, relative) {
  const destination = path.resolve(target, relative);
  if (destination !== target && !destination.startsWith(`${target}${path.sep}`)) {
    throw new Error(`Refusing to materialize an unsafe staged path: ${relative}`);
  }
  return destination;
}

/** @param {string} root @param {string[]} args @param {string} label */
function gitBuffer(root, args, label) {
  const result = spawnSync("git", ["--no-replace-objects", ...args], { cwd: root, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  if (result.status === 0 && Buffer.isBuffer(result.stdout)) return result.stdout;
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr.toString("utf8").trim() : String(result.stderr ?? "").trim();
  throw new Error(`Could not read ${label}: ${stderr || "git command failed"}`);
}

/** @param {string} root @param {string[]} args @param {string} label */
function gitText(root, args, label) {
  return gitBuffer(root, args, label).toString("utf8");
}

/** @param {Record<string, any>} subject */
function normalizeSubject(subject) {
  return {
    kind: String(subject.kind),
    baseSha: String(subject.baseSha).toLowerCase(),
    parentSha: String(subject.parentSha).toLowerCase(),
    treeSha: String(subject.treeSha).toLowerCase(),
  };
}

/** @param {string | Buffer} value */
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
