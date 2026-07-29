#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { parseArgv } from "./lib/args.js";

/** @typedef {import('./lib/args.js').ParsedArgs} ParsedArgs */
/** @typedef {import('./lib/args.js').FlagValue} FlagValue */

/**
 * The parsed-args shape as consumed by the command handlers. Identical to
 * {@link ParsedArgs} except flag values are read positionally and forwarded
 * into typed option bags; they are FlagValue at runtime but are typed `any`
 * here so the existing dynamic forwarding type-checks without runtime changes.
 * @typedef {Object} CliArgs
 * @property {string | undefined} command
 * @property {string[]} positionals
 * @property {Record<string, any>} flags
 */

/** @typedef {import('./lib/pass-local.js').PassData} PassData */
/** @typedef {import('./lib/pass-pr.js').PassPrData} PassPrData */
/** @typedef {import('./lib/review.js').ReviewData} ReviewData */
/** @typedef {import('./lib/eval.js').EvalOptions} EvalOptions */
import { formatDoctorReport, getDoctorReport } from "./lib/doctor.js";
import { inspectRepo } from "./lib/repo.js";
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
import { formatInstallSummary, installOtito } from "./lib/install.js";
import { getToolMatrix } from "./lib/matrix.js";
import { startMcpServer } from "./lib/mcp.js";
import { formatContextPackTerminal, generateContextPack } from "./lib/context-engine.js";
import { formatImpactMermaid, formatImpactTerminal, generateImpact } from "./lib/impact.js";
import { formatAxMarkdown, generateAxScore } from "./lib/ax.js";
import { formatConvergenceMarkdown, generateConvergence } from "./lib/converge.js";
import { evaluateLocal, formatPassMarkdown, formatPassTerminal } from "./lib/pass-local.js";
import { evaluatePR, formatPassPrMarkdown, formatPassPrTerminal } from "./lib/pass-pr.js";
import { formatReviewMermaid, formatReviewTerminal, generateReview } from "./lib/review.js";
import { createRenderer } from "./lib/render/fancy.js";
import { generatePrReview } from "./lib/pr-review.js";
import { formatReportMermaid, formatReportTerminal, generateReport } from "./lib/report.js";
import { formatWorkspaceMermaid, generateWorkspaceReport } from "./lib/workspace.js";
import { generateHarness } from "./lib/harness.js";
import { runEval, runHarnessExecutionEval, runRetrievalEval } from "./lib/eval.js";
import { formatDataAccessMermaid, generateDataAccessReport } from "./lib/data-access.js";
import { getAgentTools } from "./lib/agent-tools.js";
import { formatCodeMapMermaid, formatCodeMapMarkdown, generateCodeMap } from "./lib/code-map.js";
import { printHelp, printText, printJson, writeArtifact } from "./lib/output.js";
import { CONFIG_KEYS, getConfigPath, listConfigSources, loadConfig, writeConfig } from "./lib/config.js";
import { appendEvent, clearTelemetryLog, noteResult, redactError, takePendingSignals, telemetryStatus } from "./lib/telemetry.js";
import { generateDashboard } from "./lib/dashboard.js";

/** @type {Record<string, ((parsed: CliArgs) => void | Promise<void>) | undefined>} */
const commandHandlers = {
  doctor: handleDoctor,
  repo: handleRepo,
  discover: handleDiscover,
  index: handleIndex,
  catalog: handleCatalog,
  search: handleSearch,
  context: handleContext,
  impact: handleImpact,
  ax: handleAx,
  converge: handleConverge,
  dashboard: handleDashboard,
  telemetry: handleTelemetry,
  pass: handlePass,
  "pass-pr": handlePassPr,
  gate: handleGate,
  review: handleReview,
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
  eval: handleEval,
  "data-access": handleDataAccess,
  "agent-tools": handleAgentTools,
  config: handleConfig,
  help: handleHelp,
};

async function main(argv = process.argv.slice(2)) {
  const parsed = parseArgv(argv);
  const command = parsed.command ?? "help";
  const handler = commandHandlers[command];

  // Load persisted config and inject defaults into flags. CLI flags always win —
  // only inject when the user hasn't already supplied the flag.
  if (command !== "config") {
    const cfg = loadConfig();
    if (cfg.emoji !== undefined && parsed.flags.emoji === undefined && parsed.flags.no_emoji === undefined) {
      parsed.flags[cfg.emoji ? "emoji" : "no_emoji"] = true;
    }
    if (cfg.color !== undefined && parsed.flags.color === undefined && parsed.flags.no_color === undefined) {
      parsed.flags[cfg.color ? "color" : "no_color"] = true;
    }
    if (cfg.theme !== undefined && cfg.theme !== "default" && parsed.flags.theme === undefined) {
      parsed.flags.theme = cfg.theme;
    }
    if (cfg.policy !== undefined && parsed.flags.policy === undefined) {
      parsed.flags.policy = cfg.policy;
    }
    if (cfg.governance !== undefined && parsed.flags.governance === undefined) {
      parsed.flags.governance = cfg.governance;
    }
  }

  if (!handler || parsed.flags.help) {
    handleHelp(parsed);
    process.exitCode = handler ? 0 : 1;
    return;
  }

  // Opt-in usage telemetry: the long-lived `mcp` server records a single
  // start-only event here (per-tool events come from mcp.js), every other
  // command records once in the finally below. `argsShape` is keys only —
  // never flag values — so no paths or queries reach the log.
  const argsShape = { positionals: parsed.positionals.length, flags: Object.keys(parsed.flags).sort() };
  if (command === "mcp") {
    appendEvent({ surface: "cli", cmd: "mcp", argsShape, outcome: "ok", durationMs: null, repoRoot: process.cwd() });
  }

  const startedAt = performance.now();
  /** @type {unknown} */
  let caughtError = null;
  try {
    await handler(parsed);
  } catch (error) {
    caughtError = error;
    const message = error instanceof Error ? error.message : String(error);
    if (parsed.flags.json) {
      printJson({ ok: false, error: message });
    } else {
      console.error(`otito: ${message}`);
    }
    process.exitCode = 1;
  } finally {
    if (command !== "mcp") {
      const outcome = caughtError ? "error" : process.exitCode ? "fail" : "ok";
      appendEvent({
        surface: "cli",
        cmd: command,
        argsShape,
        outcome,
        error: caughtError ? redactError(caughtError) : null,
        durationMs: performance.now() - startedAt,
        signals: takePendingSignals(),
        repoRoot: process.cwd(),
      });
    }
  }
}

/** @param {CliArgs} parsed */
async function handleDoctor(parsed) {
  const report = getDoctorReport();
  if (parsed.flags.json) {
    printJson(report);
    return;
  }

  printText(formatDoctorReport(report, { emoji: emojiPreference(parsed), color: colorPreference(parsed), theme: themePreference(parsed) }));
}

/**
 * @param {CliArgs} parsed
 * @returns {boolean | undefined}
 */
function emojiPreference(parsed) {
  if (parsed.flags.no_emoji) return false;
  if (parsed.flags.emoji) return true;
  return undefined;
}

/**
 * @param {CliArgs} parsed
 * @returns {boolean | undefined}
 */
function colorPreference(parsed) {
  if (parsed.flags.no_color) return false;
  if (parsed.flags.color) return true;
  return undefined;
}

/**
 * @param {CliArgs} parsed
 * @returns {string | undefined}
 */
function themePreference(parsed) {
  const t = parsed.flags.theme;
  return typeof t === "string" ? t : undefined;
}

/** @param {CliArgs} parsed */
async function handleRepo(parsed) {
  const repoPath = parsed.positionals[0] ?? ".";
  const result = inspectRepo(repoPath);
  if (parsed.flags.json) {
    printJson(result);
    return;
  }

  printText(formatRepoSummary(result));
}

/** @param {CliArgs} parsed */
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

/** @param {CliArgs} parsed */
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

/** @param {CliArgs} parsed */
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

/** @param {CliArgs} parsed */
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

/** @param {CliArgs} parsed */
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

  printText(
    formatContextPackTerminal(result.data, (/** @type {object} */ opts) =>
      createRenderer({ ...opts, emoji: emojiPreference(parsed), color: colorPreference(parsed), theme: themePreference(parsed) }),
    ),
  );
}

/** @param {CliArgs} parsed */
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
    throw new Error('impact requires a change request, e.g. `otito impact . "add Stripe refunds"`');
  }
  const result = generateImpact(query, {
    path: repoPath,
    top: parsed.flags.top,
    diffBase: parsed.flags.diff_base,
  });
  noteResult(result.data);

  if (parsed.flags.json) {
    printJson(result.data);
    return;
  }

  if (parsed.flags.mermaid) {
    return writeMermaid(parsed, formatImpactMermaid(result.data), "Impact diagram");
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, result.markdown);
    printText(`Change impact written: ${artifact.path}`);
    return;
  }

  printText(
    formatImpactTerminal(result.data, (/** @type {object} */ opts) =>
      createRenderer({ ...opts, emoji: emojiPreference(parsed), color: colorPreference(parsed), theme: themePreference(parsed) }),
    ),
  );
}

/** @param {CliArgs} parsed */
async function handleAx(parsed) {
  // Mirror `impact` arg parsing: `ax "<task>" --path .` or `ax <repo> "<task>"`.
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
    throw new Error('ax requires a change request, e.g. `otito ax "add a new MCP tool" --path .`');
  }
  const data = generateAxScore(query, { path: repoPath, top: parsed.flags.top });
  noteResult(data);

  if (parsed.flags.json) {
    printJson(data);
    return;
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, formatAxMarkdown(data));
    printText(`AX score written: ${artifact.path}`);
    return;
  }

  printText(formatAxMarkdown(data));
}

/** @param {CliArgs} parsed */
async function handleConverge(parsed) {
  // Mirror `impact` arg parsing: `converge "<task>" --path . --base <ref>` or
  // `converge <repo> "<task>" --base <ref>`.
  let repoPath;
  let query;
  if (parsed.flags.path) {
    repoPath = parsed.flags.path;
    query = parsed.positionals.join(" ").trim();
  } else if (parsed.positionals.length >= 2) {
    // `converge <repo> "<task>"` form.
    repoPath = parsed.positionals[0];
    query = parsed.positionals.slice(1).join(" ").trim();
  } else {
    // `converge "<task>"` form — repo defaults to cwd.
    repoPath = ".";
    query = parsed.positionals.join(" ").trim();
  }
  if (!query) {
    throw new Error('converge requires a task, e.g. `otito converge "add Stripe refunds" --base origin/main`');
  }
  const data = generateConvergence(query, {
    path: repoPath,
    base: parsed.flags.base ?? parsed.flags.diff_base,
    top: parsed.flags.top,
    staged: parsed.flags.staged,
  });
  noteResult(data);

  if (parsed.flags.json) {
    printJson(data);
    return;
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, formatConvergenceMarkdown(data));
    printText(`Convergence report written: ${artifact.path}`);
    return;
  }

  printText(formatConvergenceMarkdown(data));
}

/** @param {CliArgs} parsed */
async function handlePass(parsed) {
  const repoPath = parsed.positionals[0] ?? ".";
  // evaluateLocal returns a loosely-typed record; it is a PassData at runtime.
  const data = /** @type {PassData} */ (
    evaluateLocal(repoPath, {
      base: parsed.flags.base,
      policy: parsed.flags.policy,
      governance: parsed.flags.governance,
      request: parsed.flags.request,
      minConvergence: parsed.flags.min_convergence,
      receipt: parsed.flags.receipt,
      staged: parsed.flags.staged,
    })
  );
  noteResult(data);

  if (parsed.flags.json) {
    printJson(data);
    if (data.verdict === "FAIL") process.exitCode = 1;
    return;
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, formatPassMarkdown(data));
    printText(`Pass report written: ${artifact.path}`);
    if (data.verdict === "FAIL") process.exitCode = 1;
    return;
  }

  printText(
    formatPassTerminal(data, (/** @type {object} */ opts) =>
      createRenderer({ ...opts, emoji: emojiPreference(parsed), color: colorPreference(parsed), theme: themePreference(parsed) }),
    ),
  );
  if (data.verdict === "FAIL") process.exitCode = 1;
}

/** @param {CliArgs} parsed */
async function handlePassPr(parsed) {
  const selector = parsed.positionals[0] ?? "";
  // evaluatePR returns a loosely-typed record; it is a PassPrData at runtime.
  const data = /** @type {PassPrData} */ (
    await evaluatePR(parsed.flags.path ?? ".", selector, {
      policy: parsed.flags.policy,
      governance: parsed.flags.governance,
      request: parsed.flags.request,
      minConvergence: parsed.flags.min_convergence,
      receipt: parsed.flags.receipt,
    })
  );
  noteResult(data);

  if (parsed.flags.json) {
    printJson(data);
    if (data.verdict === "FAIL") process.exitCode = 1;
    return;
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, formatPassPrMarkdown(data));
    printText(`PR pass report written: ${artifact.path}`);
    if (data.verdict === "FAIL") process.exitCode = 1;
    return;
  }

  printText(
    formatPassPrTerminal(data, (/** @type {object} */ opts) =>
      createRenderer({ ...opts, emoji: emojiPreference(parsed), color: colorPreference(parsed), theme: themePreference(parsed) }),
    ),
  );
  if (data.verdict === "FAIL") process.exitCode = 1;
}

// `gate` is the canonical v2 merge-gate command. It maps to `pass` for the
// local gate (no --pr) and to `pass-pr` for the GitHub gate (--pr <selector>),
// mirroring the review_gate MCP tool's local-vs-PR dispatch. `pass` and
// `pass-pr` remain available as legacy aliases.
/** @param {CliArgs} parsed */
async function handleGate(parsed) {
  const selector = parsed.flags.pr;
  if (selector && selector !== true) {
    // pass-pr reads the selector from positionals[0] and the repo from --path.
    return handlePassPr({
      ...parsed,
      positionals: [selector],
    });
  }
  return handlePass(parsed);
}

/** @param {CliArgs} parsed */
async function handleReview(parsed) {
  const repoPath = parsed.positionals[0] ?? ".";
  const trailingRequest = parsed.positionals.slice(1).join(" ").trim();
  const { data } = await generateReview(repoPath, {
    request: parsed.flags.request ?? (trailingRequest || undefined),
    base: parsed.flags.base,
    head: parsed.flags.head,
    prSelector: parsed.flags.pr,
    policy: parsed.flags.policy,
    governance: parsed.flags.governance,
    minConvergence: parsed.flags.min_convergence,
    receipt: parsed.flags.receipt,
    impactTop: parsed.flags.top,
  });
  noteResult(data);

  if (parsed.flags.json) {
    printJson(data);
    if (data.verdict === "FAIL") process.exitCode = 1;
    return;
  }

  if (parsed.flags.mermaid) {
    writeMermaid(parsed, formatReviewMermaid(/** @type {ReviewData} */ (data)), "Review diagram");
    if (data.verdict === "FAIL") process.exitCode = 1;
    return;
  }

  printText(
    formatReviewTerminal(/** @type {ReviewData} */ (data), (/** @type {object} */ opts) =>
      createRenderer({ ...opts, emoji: emojiPreference(parsed), color: colorPreference(parsed), theme: themePreference(parsed) }),
    ),
  );
  if (data.verdict === "FAIL") process.exitCode = 1;
}

/** @param {CliArgs} parsed */
async function handleInstall(parsed) {
  const result = installOtito({
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

/** @param {CliArgs} parsed */
async function handleMap(parsed) {
  const repoPath = parsed.positionals[0] ?? ".";
  const result = generateCodeMap(repoPath, {
    maxSymbols: parsed.flags.max_symbols,
  });

  if (parsed.flags.json) {
    printJson(result);
    return;
  }

  if (parsed.flags.mermaid) {
    return writeMermaid(parsed, formatCodeMapMermaid(result), "Code map diagram");
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, formatCodeMapMarkdown(result));
    printText(`Code map written: ${artifact.path}`);
    return;
  }

  printText(formatCodeMapMarkdown(result));
}

/** @param {CliArgs} parsed */
async function handleStructure(parsed) {
  const repoPath = parsed.positionals[0] ?? ".";
  // generateStructure returns an opaque `object`; describe the fields used here.
  const result = /** @type {{ ok: boolean, error?: string, command?: string, installHint?: string, outputPath?: string }} */ (
    generateStructure(repoPath, {
      out: parsed.flags.out,
      pattern: parsed.flags.pattern,
      exclude: parsed.flags.exclude,
    })
  );

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

/** @param {CliArgs} parsed */
async function handleDeps(parsed) {
  const packageName = parsed.positionals[0];
  if (!packageName) {
    throw new Error("deps requires a package name, for example: otito deps zod --query parse");
  }

  // inspectDependency is declared to return an opaque `object`; describe the
  // ok-vs-error fields the CLI reads off it.
  const result =
    /** @type {{ ok: boolean, packageName: string, sourcePath?: string, query?: string, matches?: { file: string, line: number, text: string }[], error?: string, installHint?: string }} */ (
      inspectDependency(packageName, {
        query: parsed.flags.query,
        limit: Number(parsed.flags.limit ?? 25),
      })
    );

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

/** @param {CliArgs} parsed */
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

/** @param {CliArgs} parsed */
async function handleInit(parsed) {
  const targetPath = parsed.positionals[0] ?? ".";

  // Resolve scaffold options from flags first. --no-gates / --no-precommit turn
  // the new behaviors off; --hooks-path opts into the git core.hooksPath write.
  let gates = !parsed.flags.no_gates;
  let precommit = !parsed.flags.no_precommit;
  let hooksPath = Boolean(parsed.flags.hooks_path);

  // Prompting lives only here, and only for a human at a TTY. MCP, agents, CI,
  // and --json/--yes callers run fully non-interactively off the flags above, so
  // init never blocks an unattended caller.
  const interactive = Boolean(process.stdin.isTTY) && !parsed.flags.yes && !parsed.flags.json;
  if (interactive) {
    gates = await promptYesNo("Generate harness-driven CI quality gates?", gates);
    precommit = await promptYesNo("Scaffold a dependency-free pre-commit hook (.githooks/pre-commit)?", precommit);
    if (precommit && !hooksPath) {
      hooksPath = await promptYesNo("Point git core.hooksPath at .githooks now?", false);
    }
  }

  const result = initProject(targetPath, {
    force: parsed.flags.force,
    noWorkflow: parsed.flags.no_workflow,
    toolRepo: parsed.flags.tool_repo,
    toolRef: parsed.flags.tool_ref,
    gates,
    precommit,
    hooksPath,
  });

  if (parsed.flags.json) {
    printJson(result);
    return;
  }

  printText(formatInitSummary(result));
}

/**
 * Ask a yes/no question at an interactive TTY. Used only by `init`; never
 * reached for non-interactive callers (guarded by process.stdin.isTTY).
 * @param {string} question
 * @param {boolean} defaultValue
 * @returns {Promise<boolean>}
 */
async function promptYesNo(question, defaultValue) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const hint = defaultValue ? "Y/n" : "y/N";
    const answer = (await rl.question(`${question} [${hint}] `)).trim().toLowerCase();
    if (!answer) {
      return defaultValue;
    }
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

async function handleMcp() {
  await startMcpServer();
}

/** @param {CliArgs} parsed */
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

/** @param {CliArgs} parsed */
async function handleReport(parsed) {
  const repoPath = parsed.positionals[0] ?? ".";
  const result = generateReport(repoPath);

  if (parsed.flags.json) {
    printJson(result.data);
    return;
  }

  if (parsed.flags.mermaid) {
    return writeMermaid(parsed, formatReportMermaid(result.data), "Report diagram");
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, result.markdown);
    printText(`Report written: ${artifact.path}`);
    return;
  }

  printText(formatReportTerminal(result.data, { columns: process.stdout.columns }));
}

/** @param {CliArgs} parsed */
async function handleWorkspace(parsed) {
  if (parsed.positionals.length < 2) {
    throw new Error("workspace requires at least two repo paths, for example: otito workspace ../web ../api");
  }

  const result = generateWorkspaceReport(parsed.positionals);

  if (parsed.flags.json) {
    printJson(result.data);
    return;
  }

  if (parsed.flags.mermaid) {
    return writeMermaid(parsed, formatWorkspaceMermaid(result.data), "Workspace diagram");
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, result.markdown);
    printText(`Workspace report written: ${artifact.path}`);
    return;
  }

  printText(result.markdown);
}

/** @param {CliArgs} parsed */
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

/** @param {CliArgs} parsed */
async function handleEval(parsed) {
  // --accuracy runs the labeled corpus (retrieval precision + risk
  // classification) instead of the token-savings eval, and exits non-zero
  // when the scoreboard falls below the corpus thresholds so CI can gate on it.
  if (parsed.flags.accuracy) {
    const result = runRetrievalEval({ corpusPath: parsed.flags.corpus });
    noteResult(result.data);
    if (parsed.flags.json) {
      printJson(result.data);
    } else if (parsed.flags.out) {
      const artifact = writeArtifact(parsed.flags.out, result.markdown);
      printText(`Accuracy eval written: ${artifact.path}`);
    } else {
      printText(result.markdown);
    }
    if (!(/** @type {{ passed?: boolean }} */ (result.data).passed)) {
      process.exitCode = 1;
    }
    return;
  }

  // --harness runs only the committed, fixture-backed command corpus. It
  // proves that the inferred install/test/typecheck/build commands execute in
  // an isolated temp copy rather than executing an inspected user repository.
  if (parsed.flags.harness) {
    const result = runHarnessExecutionEval({ corpusPath: parsed.flags.corpus });
    noteResult(result.data);
    if (parsed.flags.json) {
      printJson(result.data);
    } else if (parsed.flags.out) {
      const artifact = writeArtifact(parsed.flags.out, result.markdown);
      printText(`Harness execution eval written: ${artifact.path}`);
    } else {
      printText(result.markdown);
    }
    if (!(/** @type {{ passed?: boolean }} */ (result.data).passed)) {
      process.exitCode = 1;
    }
    return;
  }

  const repoPath = parsed.positionals[0] ?? ".";
  /** @type {EvalOptions} */
  const options = {};
  if (parsed.flags.query) options.query = parsed.flags.query;
  if (parsed.flags.naive_cap) options.naiveFileCap = Number(parsed.flags.naive_cap);
  const result = runEval(repoPath, options);
  noteResult(result.data);

  if (parsed.flags.json) {
    printJson(result.data);
    return;
  }
  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, result.markdown);
    printText(`Eval written: ${artifact.path}`);
    return;
  }
  printText(result.markdown);
}

/** @param {CliArgs} parsed */
async function handleDashboard(parsed) {
  // `--clear` purges the local usage log (the "delete your own data" path) and
  // does nothing else.
  if (parsed.flags.clear) {
    const { removed, path: logPath } = clearTelemetryLog();
    printText(removed.length ? `Usage log cleared: ${removed.join(", ")}` : `No usage log to clear at ${logPath}`);
    return;
  }

  const repoPath = parsed.positionals[0] ?? ".";
  const { data, html } = generateDashboard(repoPath, {
    includeArtifacts: !parsed.flags.no_artifacts,
    includeGit: !parsed.flags.no_git,
  });

  if (parsed.flags.json) {
    printJson(data);
    return;
  }

  const target = parsed.flags.out ?? join(repoPath, ".otito", "dashboard.html");
  const artifact = writeArtifact(target, html);
  printText(`Dashboard written: ${artifact.path}`);
  if (!data.totals.events) {
    printText("No usage events recorded yet. Enable capture with `otito config set telemetry true`, then run some commands.");
  }
}

/** @param {CliArgs} parsed */
async function handleTelemetry(parsed) {
  const sub = parsed.positionals[0] ?? "status";

  if (sub === "on" || sub === "off") {
    const scope = parsed.flags.local ? "local" : "user";
    writeConfig({ telemetry: sub === "on" }, scope);
    printText(`Telemetry ${sub} (${getConfigPath(scope)}).`);
    return;
  }

  if (sub === "clear") {
    const { removed, path: logPath } = clearTelemetryLog();
    printText(removed.length ? `Usage log cleared: ${removed.join(", ")}` : `No usage log to clear at ${logPath}`);
    return;
  }

  // Default: status.
  const status = telemetryStatus();
  if (parsed.flags.json) {
    printJson(status);
    return;
  }
  printText(
    [
      `Telemetry:   ${status.enabled ? "on" : "off"}`,
      `Log:         ${status.path}`,
      `Exists:      ${status.exists ? "yes" : "no"}`,
      `Size:        ${status.sizeBytes} bytes`,
      `Events:      ${status.events}`,
      "",
      status.enabled ? "Disable with `otito telemetry off`." : "Enable with `otito telemetry on` (or `otito config set telemetry true`).",
      "Clear the log with `otito telemetry clear`.",
    ].join("\n"),
  );
}

/** @param {CliArgs} parsed */
async function handleDataAccess(parsed) {
  const repoPath = parsed.positionals[0] ?? ".";
  const result = generateDataAccessReport(repoPath);
  if (parsed.flags.json) {
    printJson(result.data);
    return;
  }
  if (parsed.flags.mermaid) {
    return writeMermaid(parsed, formatDataAccessMermaid(result.data), "Data-access diagram");
  }
  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, result.markdown);
    printText(`Data-access report written: ${artifact.path}`);
    return;
  }
  printText(result.markdown);
}

/** @param {CliArgs} parsed */
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

/** @param {CliArgs} parsed */
async function handleConfig(parsed) {
  const sub = parsed.positionals[0];

  if (sub === "set") {
    const key = parsed.positionals[1];
    const rawValue = parsed.positionals[2];
    if (!key || rawValue === undefined) {
      throw new Error("config set requires a key and a value, e.g. otito config set color true");
    }
    if (!CONFIG_KEYS.includes(key)) {
      throw new Error(`config set: unknown key "${key}". Valid keys: ${CONFIG_KEYS.join(", ")}`);
    }
    let value = /** @type {unknown} */ (rawValue);
    if (rawValue === "true") value = true;
    else if (rawValue === "false") value = false;
    else if (!isNaN(Number(rawValue)) && rawValue.trim() !== "") value = Number(rawValue);
    const scope = parsed.flags.local ? "local" : "user";
    writeConfig({ [key]: value }, scope);
    const target = getConfigPath(scope);
    printText(`Set ${key} = ${String(value)} in ${target}`);
    return;
  }

  if (sub === "get") {
    const key = parsed.positionals[1];
    const cfg = loadConfig();
    if (parsed.flags.json) {
      printJson(key ? { [key]: /** @type {Record<string,unknown>} */ (cfg)[key] } : cfg);
      return;
    }
    if (key) {
      if (!CONFIG_KEYS.includes(key)) {
        throw new Error(`config get: unknown key "${key}". Valid keys: ${CONFIG_KEYS.join(", ")}`);
      }
      printText(String(/** @type {Record<string,unknown>} */ (cfg)[key] ?? ""));
      return;
    }
    for (const k of CONFIG_KEYS) {
      printText(`${k.padEnd(14)} ${String(/** @type {Record<string,unknown>} */ (cfg)[k] ?? "")}`);
    }
    return;
  }

  // Default: list with source annotations (also handles explicit "list" sub-command).
  const sources = listConfigSources();
  if (parsed.flags.json) {
    printJson(sources);
    return;
  }
  printText("otito config");
  printText("");
  for (const { key, value, source } of sources) {
    const annotation = source === "default" ? "" : `  [${source}]`;
    printText(`  ${key.padEnd(14)} ${String(value ?? "").padEnd(16)}${annotation}`);
  }
  printText("");
  printText(`User config:  ${getConfigPath("user")}`);
  printText(`Local config: ${getConfigPath("local")}`);
}

/**
 * Shared mermaid output: print fenced block to stdout or write to --out file.
 * @param {CliArgs} parsed
 * @param {string} diagram
 * @param {string} label
 * @returns {void}
 */
function writeMermaid(parsed, diagram, label) {
  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, diagram);
    printText(`${label} written: ${artifact.path}`);
    return;
  }
  printText(["```mermaid", diagram, "```"].join("\n"));
}

/**
 * @param {CliArgs} [_parsed]
 * @returns {void}
 */
function handleHelp(_parsed) {
  printHelp();
  // v2 supplement: the canonical merge-gate command plus the canonical-vs-legacy
  // mapping. The base usage block lives in output.js; this keeps the v2 surface
  // discoverable without rewriting it.
  printText(
    [
      "Merge gate (v2):",
      "  otito gate <repo> [--base ref] [--policy x] [--governance x] [--request text] [--min-convergence n] [--receipt hash|file] [--json]   # local gate",
      "  otito gate --pr <selector> [--path repo] [--policy x] [--governance x] [--request text] [--min-convergence n] [--receipt hash|file] [--json]            # GitHub PR gate",
      "",
      "Accuracy eval (v2):",
      "  otito eval --accuracy [--corpus path] [--json] [--out file]   # labeled retrieval + risk corpus; non-zero exit below thresholds",
      "  otito eval --harness [--corpus path] [--json] [--out file]    # run inferred install/test/typecheck/build commands in isolated fixtures",
      "",
      "Canonical vs legacy commands:",
      "  gate                 canonical merge gate; `pass` (local) and `pass-pr` (PR) remain as legacy aliases",
      "  review               canonical composite verdict (impact + review context + gate)",
      "  pr                   produces review context only (diff/comment metadata, no verdict)",
      "",
      "Legacy MCP tool names (pr_review, review_pr, merge_readiness, pr_merge_readiness,",
      "repo_catalog, repo_discover, find_*) keep working via tools/call until 3.0.",
      "See docs/MIGRATION-2.0.md.",
    ].join("\n"),
  );
}

/**
 * @param {{ ok?: boolean, action?: string, url?: string, id?: string | number, error?: string } | null | undefined} comment
 * @returns {string | undefined}
 */
function formatCommentResult(comment) {
  if (!comment) {
    return undefined;
  }
  if (comment.ok) {
    return `PR comment ${comment.action}: ${comment.url ?? comment.id ?? "ok"}`;
  }
  return `PR comment skipped: ${comment.error}`;
}

/**
 * @param {ReturnType<typeof inspectRepo>} result
 * @returns {string}
 */
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

export { main };

// npm bin shims invoke this file through a symlink, so argv[1] is the symlink
// path while import.meta.url is already realpath-resolved by the ESM loader.
// Compare realpaths on both sides or the guard never fires for installed bins
// (npx / npm i -g) and the CLI exits silently with no output.
const invokedAsScript = (() => {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedAsScript) {
  main();
}
