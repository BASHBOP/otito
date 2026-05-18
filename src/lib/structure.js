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
  "coverage/**"
];

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
      outputPath
    };
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const patterns = normalizeList(options.pattern).length ? normalizeList(options.pattern) : ["**/*.ts", "**/*.tsx"];
  const excludes = [...defaultExcludes, ...normalizeList(options.exclude)];
  const args = [...installed.commandParts.map((part) => quote(part)), ...patterns.map((pattern) => quote(pattern)), "-o", quote(outputPath)];
  for (const excluded of excludes) {
    args.push("--exclude", quote(excluded));
  }

  const commandLine = args.join(" ");
  const result = runShellCommand(commandLine, { cwd: root, timeout: 120000 });
  const failureOutput = [result.stderr.trim(), result.stdout.trim(), result.error?.message]
    .filter(Boolean)
    .join("\n");

  return {
    ok: result.ok,
    outputPath,
    runner: installed.runner,
    command: commandLine,
    status: result.status,
    stdoutLineCount: countLines(result.stdout),
    stdoutPreview: previewOutput(result.stdout),
    stderr: result.stderr.trim(),
    error: result.ok ? undefined : failureOutput || `code-structure failed with status ${result.status ?? "unknown"}`
  };
}

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

function normalizeList(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function countLines(text) {
  return text.trim() ? text.trim().split("\n").length : 0;
}

function previewOutput(text, lineLimit = 40) {
  const lines = text.trim().split("\n").filter((line) => line && !/^\d+$/.test(line.trim()));
  if (lines.length <= lineLimit) {
    return lines.join("\n");
  }

  return [
    ...lines.slice(0, Math.floor(lineLimit / 2)),
    `... ${lines.length - lineLimit} lines omitted ...`,
    ...lines.slice(-Math.ceil(lineLimit / 2))
  ].join("\n");
}
