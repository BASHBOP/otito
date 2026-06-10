import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commandExists, quote, runShellCommand } from "./tools.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultExcludes = [
  "node_modules/**",
  ".git/**",
  ".dev-context/**",
  ".next/**",
  ".turbo/**",
  ".cache/**",
  ".worktrees/**",
  ".yarn/**",
  "dist/**",
  "build/**",
  "coverage/**",
];

/**
 * @typedef {object} StructureOptions
 * @property {string} [out] Output HTML path.
 * @property {string | string[]} [pattern] Glob pattern(s) to include.
 * @property {string | string[]} [exclude] Glob pattern(s) to exclude.
 */

/**
 * @typedef {object} ResolvedCodeStructure
 * @property {boolean} available
 * @property {string} [runner]
 * @property {string[]} [commandParts]
 */

/**
 * @param {string} [repoPath]
 * @param {StructureOptions} [options]
 * @returns {object}
 */
export function generateStructure(repoPath = ".", options = {}) {
  const root = path.resolve(repoPath);
  const outputPath = path.resolve(options.out ?? path.join(root, ".dev-context", "structure.html"));
  const localBin = path.join(packageRoot, "node_modules", ".bin", "code-structure");
  const installed = resolveCodeStructure(localBin);

  if (!installed.available) {
    return {
      ok: false,
      error: "code-structure is not installed.",
      installHint: "Install with: npm install -g code-structure, or make npx available.",
      outputPath,
    };
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const patterns = normalizeList(options.pattern).length ? normalizeList(options.pattern) : ["**/*.ts", "**/*.tsx"];
  const excludes = [...defaultExcludes, ...normalizeList(options.exclude)];
  // installed.available is true past the guard above, which in this code always
  // implies commandParts is set; assert that for the type checker.
  const commandParts = /** @type {string[]} */ (installed.commandParts);
  const args = [...commandParts.map((part) => quote(part)), ...patterns.map((pattern) => quote(pattern)), "-o", quote(outputPath)];
  for (const excluded of excludes) {
    args.push("--exclude", quote(excluded));
  }

  const commandLine = args.join(" ");
  const result = runShellCommand(commandLine, { cwd: root, timeout: 120000 });
  const failureOutput = [result.stderr.trim(), result.stdout.trim(), result.error?.message].filter(Boolean).join("\n");

  return {
    ok: result.ok,
    outputPath,
    runner: installed.runner,
    command: commandLine,
    status: result.status,
    stdoutLineCount: countLines(result.stdout),
    stdoutPreview: previewOutput(result.stdout),
    stderr: result.stderr.trim(),
    error: result.ok ? undefined : failureOutput || `code-structure failed with status ${result.status ?? "unknown"}`,
  };
}

/**
 * @param {string} localBin
 * @returns {ResolvedCodeStructure}
 */
function resolveCodeStructure(localBin) {
  if (fs.existsSync(localBin)) {
    return { available: true, runner: "local", commandParts: [localBin] };
  }

  const global = commandExists("code-structure");
  if (global.available) {
    return { available: true, runner: "global", commandParts: [global.path ?? "code-structure"] };
  }

  const npx = commandExists("npx");
  if (npx.available) {
    return { available: true, runner: "npx", commandParts: [npx.path ?? "npx", "--yes", "code-structure"] };
  }

  return { available: false };
}

/**
 * @param {string | string[] | undefined} value
 * @returns {string[]}
 */
function normalizeList(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

/**
 * @param {string} text
 * @returns {number}
 */
function countLines(text) {
  return text.trim() ? text.trim().split("\n").length : 0;
}

/**
 * @param {string} text
 * @param {number} [lineLimit]
 * @returns {string}
 */
function previewOutput(text, lineLimit = 40) {
  const lines = text
    .trim()
    .split("\n")
    .filter((line) => line && !/^\d+$/.test(line.trim()));
  if (lines.length <= lineLimit) {
    return lines.join("\n");
  }

  return [...lines.slice(0, Math.floor(lineLimit / 2)), `... ${lines.length - lineLimit} lines omitted ...`, ...lines.slice(-Math.ceil(lineLimit / 2))].join(
    "\n",
  );
}
