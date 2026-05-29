#!/usr/bin/env node
import { parseArgv } from "./lib/args.js";
import { formatDoctorReport, getDoctorReport } from "./lib/doctor.js";
import { inspectRepo } from "./lib/repo.js";
import { formatCodeMapMarkdown, generateCodeMap } from "./lib/code-map.js";
import { generateStructure } from "./lib/structure.js";
import { inspectDependency } from "./lib/deps.js";
import {
  discoverRepositories,
  formatCatalogSummary,
  formatDiscoverSummary,
  formatIndexSummary,
  formatSearchResults,
  indexRepositories,
  listCatalog,
  searchCatalog,
} from "./lib/catalog.js";
import { formatInitSummary, initProject } from "./lib/init.js";
import { formatInstallSummary, installDevContext } from "./lib/install.js";
import { getToolMatrix } from "./lib/matrix.js";
import { startMcpServer } from "./lib/mcp.js";
import { generateContextPack } from "./lib/context-engine.js";
import { formatImpactTerminal, generateImpact } from "./lib/impact.js";
import { createRenderer } from "./lib/render/fancy.js";
import { generatePrReview } from "./lib/pr-review.js";
import { formatReportTerminal, generateReport } from "./lib/report.js";
import { generateWorkspaceReport } from "./lib/workspace.js";
import { generateHarness } from "./lib/harness.js";
import { getAgentTools } from "./lib/agent-tools.js";
import { printHelp, printText, printJson, writeArtifact } from "./lib/output.js";

const commandHandlers = {
  doctor: handleDoctor,
  repo: handleRepo,
  discover: handleDiscover,
  index: handleIndex,
  catalog: handleCatalog,
  search: handleSearch,
  context: handleContext,
  impact: handleImpact,
  install: handleInstall,
  i: handleInstall,
  map: handleMap,
  structure: handleStructure,
  deps: handleDeps,
  init: handleInit,
  matrix: handleMatrix,
  mcp: handleMcp,
  pr: handlePr,
  report: handleReport,
  workspace: handleWorkspace,
  harness: handleHarness,
  "agent-tools": handleAgentTools,
  help: handleHelp,
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
      console.error(`repoctx: ${message}`);
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

  printText(formatDoctorReport(report, { emoji: emojiPreference(parsed) }));
}

function emojiPreference(parsed) {
  if (parsed.flags.no_emoji) return false;
  if (parsed.flags.emoji) return true;
  return undefined;
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

async function handleDiscover(parsed) {
  const roots = parsed.positionals.length ? parsed.positionals : ["."];
  const result = discoverRepositories(roots, {
    depth: parsed.flags.depth,
    limit: parsed.flags.limit,
  });

  if (parsed.flags.json) {
    printJson(result);
    return;
  }

  printText(formatDiscoverSummary(result));
}

async function handleIndex(parsed) {
  const repoPaths = parsed.positionals.length ? parsed.positionals : ["."];
  const result = indexRepositories(repoPaths, {
    catalog: parsed.flags.catalog,
    discover: parsed.flags.discover,
    depth: parsed.flags.depth,
    limit: parsed.flags.limit,
  });

  if (parsed.flags.json) {
    printJson(result);
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  printText(formatIndexSummary(result));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function handleCatalog(parsed) {
  const result = listCatalog({
    catalog: parsed.flags.catalog,
  });

  if (parsed.flags.json) {
    printJson(result);
    return;
  }

  printText(formatCatalogSummary(result));
}

async function handleSearch(parsed) {
  const query = parsed.positionals.join(" ").trim();
  const result = searchCatalog(query, {
    catalog: parsed.flags.catalog,
    limit: parsed.flags.limit,
    offline: parsed.flags.offline,
  });

  if (parsed.flags.json) {
    printJson(result);
    return;
  }

  printText(formatSearchResults(result));
}

async function handleContext(parsed) {
  const query = parsed.positionals.join(" ").trim();
  const result = generateContextPack(query, {
    path: parsed.flags.path,
    limit: parsed.flags.limit,
  });

  if (parsed.flags.json) {
    printJson(result.data);
    return;
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, result.markdown);
    printText(`Context pack written: ${artifact.path}`);
    return;
  }

  printText(result.markdown);
}

async function handleImpact(parsed) {
  let repoPath;
  let query;
  if (parsed.flags.path) {
    repoPath = parsed.flags.path;
    query = parsed.positionals.join(" ").trim();
  } else {
    repoPath = parsed.positionals[0] ?? ".";
    query = parsed.positionals.slice(1).join(" ").trim();
  }
  if (!query) {
    throw new Error('impact requires a change request, e.g. `repoctx impact . "add Stripe refunds"`');
  }
  const result = generateImpact(query, {
    path: repoPath,
    top: parsed.flags.top,
    diffBase: parsed.flags.diff_base,
  });

  if (parsed.flags.json) {
    printJson(result.data);
    return;
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, result.markdown);
    printText(`Change impact written: ${artifact.path}`);
    return;
  }

  printText(formatImpactTerminal(result.data, (opts) => createRenderer({ ...opts, emoji: emojiPreference(parsed) })));
}

async function handleInstall(parsed) {
  const result = installDevContext({
    global: parsed.flags.global,
    link: parsed.flags.link,
  });

  if (parsed.flags.json) {
    printJson(result);
    if (result.applied === false) {
      process.exitCode = 1;
    }
    return;
  }

  printText(formatInstallSummary(result));
  if (result.applied === false) {
    process.exitCode = 1;
  }
}

async function handleMap(parsed) {
  const repoPath = parsed.positionals[0] ?? ".";
  const result = generateCodeMap(repoPath, {
    maxSymbols: parsed.flags.max_symbols,
  });

  if (parsed.flags.json) {
    printJson(result);
    return;
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, formatCodeMapMarkdown(result));
    printText(`Code map written: ${artifact.path}`);
    return;
  }

  printText(formatCodeMapMarkdown(result));
}

async function handleStructure(parsed) {
  const repoPath = parsed.positionals[0] ?? ".";
  const result = generateStructure(repoPath, {
    out: parsed.flags.out,
    pattern: parsed.flags.pattern,
    exclude: parsed.flags.exclude,
  });

  if (parsed.flags.json) {
    printJson(result);
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (!result.ok) {
    const details = [`Structure generation skipped: ${result.error}`, result.command ? `Command: ${result.command}` : undefined, result.installHint].filter(
      Boolean,
    );
    printText(details.join("\n"));
    process.exitCode = 1;
    return;
  }

  printText(`Structure generated: ${result.outputPath}`);
}

async function handleDeps(parsed) {
  const packageName = parsed.positionals[0];
  if (!packageName) {
    throw new Error("deps requires a package name, for example: repoctx deps zod --query parse");
  }

  const result = inspectDependency(packageName, {
    query: parsed.flags.query,
    limit: Number(parsed.flags.limit ?? 25),
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
    ...matrix.tools.map((tool) => `| ${tool.name} | ${tool.role} | ${tool.pilotUse} | ${tool.notes} |`),
  ];
  printText(["# Tool Evaluation Matrix", "", ...rows].join("\n"));
}

async function handleInit(parsed) {
  const targetPath = parsed.positionals[0] ?? ".";
  const result = initProject(targetPath, {
    force: parsed.flags.force,
    noWorkflow: parsed.flags.no_workflow,
    toolRepo: parsed.flags.tool_repo,
    toolRef: parsed.flags.tool_ref,
  });

  if (parsed.flags.json) {
    printJson(result);
    return;
  }

  printText(formatInitSummary(result));
}

async function handleMcp() {
  await startMcpServer();
}

async function handlePr(parsed) {
  const repoPath = parsed.positionals[0] ?? ".";
  const result = generatePrReview(repoPath, {
    number: parsed.flags.number ?? parsed.flags.pr,
    github: parsed.flags.github,
    comment: parsed.flags.comment,
    base: parsed.flags.base,
    head: parsed.flags.head,
  });

  if (parsed.flags.json) {
    printJson(result.data);
    return;
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, result.markdown);
    printText(["PR review context written:", artifact.path, formatCommentResult(result.data.comment)].filter(Boolean).join("\n"));
    return;
  }

  printText([result.markdown, formatCommentResult(result.data.comment)].filter(Boolean).join("\n"));
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

  printText(formatReportTerminal(result.data, { columns: process.stdout.columns }));
}

async function handleWorkspace(parsed) {
  if (parsed.positionals.length < 2) {
    throw new Error("workspace requires at least two repo paths, for example: repoctx workspace ../web ../api");
  }

  const result = generateWorkspaceReport(parsed.positionals);

  if (parsed.flags.json) {
    printJson(result.data);
    return;
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, result.markdown);
    printText(`Workspace report written: ${artifact.path}`);
    return;
  }

  printText(result.markdown);
}

async function handleHarness(parsed) {
  const repoPath = parsed.positionals[0] ?? ".";
  const result = generateHarness(repoPath, {
    maxSymbols: parsed.flags.max_symbols,
  });

  if (parsed.flags.json) {
    printJson(result.data);
    return;
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, result.markdown);
    printText(`Harness written: ${artifact.path}`);
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

function formatCommentResult(comment) {
  if (!comment) {
    return undefined;
  }
  if (comment.ok) {
    return `PR comment ${comment.action}: ${comment.url ?? comment.id ?? "ok"}`;
  }
  return `PR comment skipped: ${comment.error}`;
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
    ...result.importantDirectories.map((dir) => `- ${dir}`),
  ].join("\n");
}

main();
