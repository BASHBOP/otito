#!/usr/bin/env node
import { parseArgv } from "./lib/args.js";
import { getDoctorReport } from "./lib/doctor.js";
import { inspectRepo } from "./lib/repo.js";
import { generateStructure } from "./lib/structure.js";
import { inspectDependency } from "./lib/deps.js";
import { getToolMatrix } from "./lib/matrix.js";
import { generateReport } from "./lib/report.js";
import { getAgentTools } from "./lib/agent-tools.js";
import { printHelp, printText, printJson, writeArtifact } from "./lib/output.js";

const commandHandlers = {
  doctor: handleDoctor,
  repo: handleRepo,
  structure: handleStructure,
  deps: handleDeps,
  matrix: handleMatrix,
  report: handleReport,
  "agent-tools": handleAgentTools,
  help: handleHelp
};

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgv(argv);
  const command = parsed.command ?? "help";
  const handler = commandHandlers[command];

  if (!handler || parsed.flags.help) {
    handleHelp(parsed);
    process.exitCode = handler ? 0 : 1;
    return;
  }

  try {
    await handler(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (parsed.flags.json) {
      printJson({ ok: false, error: message });
    } else {
      console.error(`dev-context: ${message}`);
    }
    process.exitCode = 1;
  }
}

async function handleDoctor(parsed) {
  const report = getDoctorReport();
  if (parsed.flags.json) {
    printJson(report);
    return;
  }

  const rows = report.tools.map((tool) => {
    const marker = tool.available ? "ok" : "missing";
    const version = tool.version ? ` (${tool.version})` : "";
    const hint = tool.available ? "" : ` - ${tool.installHint}`;
    return `- ${marker}: ${tool.name}${version}${hint}`;
  });
  printText(["# dev-context doctor", "", ...rows].join("\n"));
}

async function handleRepo(parsed) {
  const repoPath = parsed.positionals[0] ?? ".";
  const result = inspectRepo(repoPath);
  if (parsed.flags.json) {
    printJson(result);
    return;
  }

  printText(formatRepoSummary(result));
}

async function handleStructure(parsed) {
  const repoPath = parsed.positionals[0] ?? ".";
  const result = generateStructure(repoPath, {
    out: parsed.flags.out,
    exclude: parsed.flags.exclude
  });

  if (parsed.flags.json) {
    printJson(result);
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (!result.ok) {
    printText(`Structure generation skipped: ${result.error}\n${result.installHint}`);
    process.exitCode = 1;
    return;
  }

  printText(`Structure generated: ${result.outputPath}`);
}

async function handleDeps(parsed) {
  const packageName = parsed.positionals[0];
  if (!packageName) {
    throw new Error("deps requires a package name, for example: dev-context deps zod --query parse");
  }

  const result = inspectDependency(packageName, {
    query: parsed.flags.query,
    limit: Number(parsed.flags.limit ?? 25)
  });

  if (parsed.flags.json) {
    printJson(result);
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (!result.ok) {
    printText(`Dependency lookup failed: ${result.error}\n${result.installHint}`);
    process.exitCode = 1;
    return;
  }

  const lines = [`# Dependency Source: ${result.packageName}`, "", `Path: ${result.sourcePath}`];
  if (result.matches?.length) {
    lines.push("", `Matches for "${result.query}":`);
    for (const match of result.matches) {
      lines.push(`- ${match.file}:${match.line}: ${match.text}`);
    }
  } else if (result.query) {
    lines.push("", `No matches found for "${result.query}".`);
  }
  printText(lines.join("\n"));
}

async function handleMatrix(parsed) {
  const matrix = getToolMatrix();
  if (parsed.flags.json) {
    printJson(matrix);
    return;
  }

  const rows = [
    "| Tool | Role | Pilot Use | Notes |",
    "|---|---|---|---|",
    ...matrix.tools.map((tool) => `| ${tool.name} | ${tool.role} | ${tool.pilotUse} | ${tool.notes} |`)
  ];
  printText(["# Tool Evaluation Matrix", "", ...rows].join("\n"));
}

async function handleReport(parsed) {
  const repoPath = parsed.positionals[0] ?? ".";
  const result = generateReport(repoPath);

  if (parsed.flags.json) {
    printJson(result.data);
    return;
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, result.markdown);
    printText(`Report written: ${artifact.path}`);
    return;
  }

  printText(result.markdown);
}

async function handleAgentTools(parsed) {
  const tools = getAgentTools();
  if (parsed.flags.json || !parsed.flags.markdown) {
    printJson(tools);
    return;
  }

  const lines = ["# Agent Tool Surface", ""];
  for (const tool of tools.tools) {
    lines.push(`## ${tool.name}`, "", tool.description, "", `Input: \`${JSON.stringify(tool.input)}\``, "");
  }
  printText(lines.join("\n"));
}

function handleHelp() {
  printHelp();
}

function formatRepoSummary(result) {
  return [
    `# Repo: ${result.root}`,
    "",
    `Files scanned: ${result.fileCount}`,
    `Primary languages: ${result.languages.map((item) => `${item.language} (${item.count})`).join(", ") || "unknown"}`,
    `Package managers: ${result.packageManagers.join(", ") || "none detected"}`,
    `Entrypoints: ${result.entrypoints.join(", ") || "none detected"}`,
    "",
    "Scripts:",
    ...Object.entries(result.scripts).map(([name, value]) => `- ${name}: ${value}`),
    "",
    "Important directories:",
    ...result.importantDirectories.map((dir) => `- ${dir}`)
  ].join("\n");
}

main();
