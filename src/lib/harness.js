import fs from "node:fs";
import path from "node:path";
import { generateCodeMap } from "./code-map.js";
import { inspectRepo } from "./repo.js";
import { estimateTokens, estimateTokenSections } from "./tokens.js";

const validationScripts = [
  "lint",
  "format:check",
  "typecheck",
  "type-check",
  "check:type",
  "tsc",
  "test",
  "test:unit",
  "test:integration",
  "test:e2e",
  "build"
];

const runtimeScripts = ["dev", "start", "preview"];

export function generateHarness(repoPath = ".", options = {}) {
  const repo = inspectRepo(repoPath);
  const map = generateCodeMap(repo.root, { maxSymbols: options.maxSymbols });
  const commands = inferCommands(repo);
  const context = summarizeContext(map);
  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    harnessVersion: 1,
    repo: {
      root: repo.root,
      name: repo.package?.name ?? path.basename(repo.root),
      package: repo.package,
      packageManagers: repo.packageManagers,
      git: repo.git,
      entrypoints: repo.entrypoints
    },
    commands,
    context,
    focusAreas: inferFocusAreas(map, commands)
  };

  data.tokenEstimate = {
    ...estimateTokenSections([
      { name: "repo", value: data.repo },
      { name: "commands", value: data.commands },
      { name: "context", value: data.context },
      { name: "focusAreas", value: data.focusAreas }
    ])
  };
  data.tokenEstimate.fullJson = estimateTokens(data);

  let markdown = formatHarnessMarkdown(data);
  data.tokenEstimate.markdown = estimateTokens(markdown);
  markdown = formatHarnessMarkdown(data);

  return { data, markdown };
}

export function formatHarnessMarkdown(data) {
  const lines = [
    `# Dev Context Harness: ${data.repo.name}`,
    "",
    `Generated: ${data.generatedAt}`,
    `Harness version: ${data.harnessVersion}`,
    "",
    "## Token Budget",
    "",
    `- Estimated JSON tokens: ${data.tokenEstimate.fullJson}`,
    `- Estimated Markdown tokens: ${data.tokenEstimate.markdown ?? "pending"}`,
    `- Method: ${data.tokenEstimate.method}`,
    "",
    "## Repo",
    "",
    `- Root: ${data.repo.root}`,
    `- Git: ${formatGit(data.repo.git)}`,
    `- Package managers: ${data.repo.packageManagers.join(", ") || "none detected"}`,
    `- Entrypoints: ${data.repo.entrypoints.join(", ") || "none detected"}`,
    "",
    "## Setup",
    "",
    ...formatCommands(data.commands.setup, "No setup command detected."),
    "",
    "## Validation",
    "",
    ...formatCommands(data.commands.validate, "No validation scripts detected."),
    "",
    "## Runtime",
    "",
    ...formatCommands(data.commands.runtime, "No runtime scripts detected."),
    "",
    "## Context Commands",
    "",
    ...formatCommands(data.commands.context, "No context commands generated."),
    "",
    "## Focus Areas",
    "",
    ...(data.focusAreas.length ? data.focusAreas.map((item) => `- ${item}`) : ["- none detected"]),
    "",
    "## Top Domains",
    "",
    ...(data.context.domains.length ? data.context.domains.map((domain) => `- ${domain.name}: ${domain.fileCount} file(s)`) : ["- none detected"]),
    ""
  ];
  return lines.join("\n");
}

function inferCommands(repo) {
  const runner = packageRunner(repo.packageManagers);
  return {
    setup: inferSetupCommands(repo),
    validate: inferScriptCommands(repo.scripts, runner, validationScripts),
    runtime: inferScriptCommands(repo.scripts, runner, runtimeScripts),
    context: [
      {
        command: "repoctx repo . --json",
        reason: "inspect repository facts"
      },
      {
        command: "repoctx map . --json",
        reason: "generate agent-readable code map"
      },
      {
        command: "repoctx harness . --json",
        reason: "refresh harness commands and token estimates"
      }
    ]
  };
}

function inferSetupCommands(repo) {
  const commands = [];
  const root = repo.root;
  if (repo.packageManagers.includes("pnpm")) commands.push({ command: "pnpm install", reason: "install Node dependencies" });
  else if (repo.packageManagers.includes("yarn")) commands.push({ command: "yarn install", reason: "install Node dependencies" });
  else if (repo.packageManagers.includes("bun")) commands.push({ command: "bun install", reason: "install Node dependencies" });
  else if (repo.packageManagers.includes("npm")) commands.push({ command: "npm install", reason: "install Node dependencies" });

  if (fs.existsSync(path.join(root, "requirements.txt"))) commands.push({ command: "pip install -r requirements.txt", reason: "install Python dependencies" });
  if (fs.existsSync(path.join(root, "go.mod"))) commands.push({ command: "go mod download", reason: "download Go modules" });
  if (fs.existsSync(path.join(root, "Cargo.toml"))) commands.push({ command: "cargo fetch", reason: "fetch Rust crates" });
  if (fs.existsSync(path.join(root, "Gemfile"))) commands.push({ command: "bundle install", reason: "install Ruby gems" });
  return commands;
}

function inferScriptCommands(scripts = {}, runner, names) {
  return names
    .filter((name) => scripts[name])
    .map((name) => ({
      script: name,
      command: commandForScript(runner, name),
      reason: scriptReason(name)
    }));
}

function summarizeContext(map) {
  return {
    sourceFileCount: map.repo.sourceFileCount,
    symbols: map.summary.symbols,
    summary: map.summary,
    domains: map.domains.slice(0, 12),
    notableFiles: map.files
      .filter((file) => ["route", "apiRoute", "controller", "service", "module", "apiClient"].includes(file.kind))
      .slice(0, 40)
      .map((file) => ({
        path: file.path,
        kind: file.kind,
        domain: file.domain,
        route: file.route,
        controllerBasePath: file.controllerBasePath
      }))
  };
}

function inferFocusAreas(map, commands) {
  const areas = [];
  if (map.summary.routes || map.summary.apiRoutes) areas.push("frontend/application routes");
  if (map.summary.controllers) areas.push("backend request controllers");
  if (map.summary.apiClients) areas.push("frontend/backend API contracts");
  if (map.summary.schemas || map.summary.dtos) areas.push("data schemas and DTO contracts");
  if (commands.validate.length) areas.push("validation scripts are available for agent/CI execution");
  if (!commands.validate.length) areas.push("add at least one validation script for the harness to run");
  return areas;
}

function packageRunner(packageManagers = []) {
  if (packageManagers.includes("pnpm")) return "pnpm";
  if (packageManagers.includes("yarn")) return "yarn";
  if (packageManagers.includes("bun")) return "bun";
  return "npm";
}

function commandForScript(runner, script) {
  if (runner === "npm") {
    return script === "test" ? "npm test" : `npm run ${script}`;
  }
  if (runner === "bun") {
    return `bun run ${script}`;
  }
  return `${runner} ${script}`;
}

function scriptReason(name) {
  if (name.includes("lint")) return "static checks";
  if (name.includes("type") || name === "tsc") return "type contract checks";
  if (name.includes("test")) return "behavior verification";
  if (name === "build") return "integration and bundling verification";
  if (name === "dev") return "local development server";
  if (name === "start") return "application start command";
  if (name === "preview") return "preview built application";
  return "project script";
}

function formatCommands(commands, fallback) {
  if (!commands.length) {
    return [`- ${fallback}`];
  }
  return commands.map((item) => `- \`${item.command}\`: ${item.reason}`);
}

function formatGit(git) {
  if (!git.available) {
    return "not detected";
  }
  const dirty = git.clean ? "clean" : `${git.changes} change(s)`;
  return `${git.branch ?? "unknown"} @ ${git.commit ?? "unknown"} (${dirty})`;
}
