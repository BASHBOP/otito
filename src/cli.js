#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
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
import { createRenderer } from "./lib/render/fancy.js";
import { formatTerminalSummary, printHelp, printText, printJson, writeArtifact } from "./lib/output.js";
import { CONFIG_KEYS, gatePolicy, getConfigPath, listConfigSources, loadConfig, writeConfig } from "./lib/config.js";
import { appendEvent, clearTelemetryLog, noteResult, redactError, shareEvent, takePendingSignals, telemetryStatus } from "./lib/telemetry.js";

const packageVersion = String(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
const versionFlags = new Set(["--version", "-v"]);

// Commands that gate a repository named by a positional or --path. They take
// policy and governance from that repository's config (gatePolicy), not from
// the directory otito runs in, so main() leaves those two flags to them.
const gateCommands = new Set(["pass", "pass-pr", "gate", "review", "workspace-gate"]);

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
  obsidian: handleObsidian,
  ax: handleAx,
  route: handleRoute,
  converge: handleConverge,
  attest: handleAttest,
  calibrate: handleCalibrate,
  regret: handleRegret,
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
  "workspace-gate": handleWorkspaceGate,
  harness: handleHarness,
  eval: handleEval,
  "data-access": handleDataAccess,
  "agent-tools": handleAgentTools,
  config: handleConfig,
  help: handleHelp,
};

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && versionFlags.has(argv[0])) {
    printText(packageVersion);
    process.exitCode = 0;
    return;
  }

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
    if (!gateCommands.has(command)) {
      if (cfg.policy !== undefined && parsed.flags.policy === undefined) {
        parsed.flags.policy = cfg.policy;
      }
      if (cfg.governance !== undefined && parsed.flags.governance === undefined) {
        parsed.flags.governance = cfg.governance;
      }
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
    const record = appendEvent({ surface: "cli", cmd: "mcp", argsShape, outcome: "ok", durationMs: null, repoRoot: process.cwd() });
    void shareEvent(record);
  }

  const startedAt = performance.now();
  /** @type {unknown} */
  let caughtError = null;
  try {
    await handler(parsed);
  } catch (error) {
    caughtError = error;
    const message = explainError(error instanceof Error ? error.message : String(error));
    if (parsed.flags.json) {
      printJson({ ok: false, error: message });
    } else {
      console.error(`otito: ${message}`);
    }
    process.exitCode = 1;
  } finally {
    if (command !== "mcp") {
      const outcome = caughtError ? "error" : process.exitCode ? "fail" : "ok";
      const record = appendEvent({
        surface: "cli",
        cmd: command,
        argsShape,
        outcome,
        error: caughtError ? redactError(caughtError) : null,
        durationMs: performance.now() - startedAt,
        signals: takePendingSignals(),
        repoRoot: process.cwd(),
      });
      await shareEvent(record);
    }
  }
}

/** @param {CliArgs} parsed */
async function handleDoctor(parsed) {
  const { formatDoctorReport, getDoctorReport } = await import("./lib/doctor.js");
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
  const { inspectRepo } = await import("./lib/repo.js");
  const repoPath = parsed.positionals[0] ?? ".";
  const result = inspectRepo(repoPath);
  if (parsed.flags.json) {
    printJson(result);
    return;
  }

  printText(formatRepoSummary(result, { emoji: emojiPreference(parsed), color: colorPreference(parsed), theme: themePreference(parsed) }));
}

/** @param {CliArgs} parsed */
async function handleDiscover(parsed) {
  const { discoverRepositories, formatDiscoverSummary } = await import("./lib/catalog.js");
  const roots = parsed.positionals.length ? parsed.positionals : ["."];
  const result = discoverRepositories(roots, {
    depth: parsed.flags.depth,
    limit: parsed.flags.limit,
  });

  if (parsed.flags.json) {
    printJson(result);
    return;
  }

  printText(formatDiscoverSummary(result, { emoji: emojiPreference(parsed), color: colorPreference(parsed), theme: themePreference(parsed) }));
}

/** @param {CliArgs} parsed */
async function handleIndex(parsed) {
  const { formatIndexSummary, indexRepositories } = await import("./lib/catalog.js");
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

  printText(formatIndexSummary(result, { emoji: emojiPreference(parsed), color: colorPreference(parsed), theme: themePreference(parsed) }));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

/** @param {CliArgs} parsed */
async function handleCatalog(parsed) {
  const { formatCatalogSummary, listCatalog } = await import("./lib/catalog.js");
  const result = listCatalog({
    catalog: parsed.flags.catalog,
  });

  if (parsed.flags.json) {
    printJson(result);
    return;
  }

  printText(formatCatalogSummary(result, { emoji: emojiPreference(parsed), color: colorPreference(parsed), theme: themePreference(parsed) }));
}

/** @param {CliArgs} parsed */
async function handleSearch(parsed) {
  const { formatSearchResults, searchCatalog } = await import("./lib/catalog.js");
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

  printText(formatSearchResults(result, { emoji: emojiPreference(parsed), color: colorPreference(parsed), theme: themePreference(parsed) }));
}

/** @param {CliArgs} parsed */
async function handleContext(parsed) {
  const { formatContextPackTerminal, generateContextPack } = await import("./lib/context-engine.js");
  const query = parsed.positionals.join(" ").trim();
  let result = generateContextPack(query, {
    path: parsed.flags.path,
    limit: parsed.flags.limit,
  });
  // Opt-in: ask a System One model to read the request. Never on by default,
  // because an ordinary otito command makes no network call.
  if (parsed.flags.online === true) {
    const { readContextPack } = await import("./lib/context-read.js");
    result = await readContextPack(result);
  }

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

/**
 * One advisory routing line under commands that already hold an impact pass and
 * an AX score. Offline by construction: no ordinary otito command makes a
 * network call, and a failure here must never change the command's own output.
 * @param {CliArgs} parsed
 * @param {string} query
 * @param {any} impact
 * @param {any} ax
 */
async function printRouteFooter(parsed, query, impact, ax) {
  if (parsed.flags.json || parsed.flags.out || parsed.flags.mermaid) return;
  if (parsed.flags.no_route === true) return;
  try {
    const { routeFooter } = await import("./lib/model-route.js");
    printText(`\n${routeFooter(query, impact, ax).line}`);
  } catch {
    // Advisory only. A router problem must not break the command the user ran.
  }
}

/**
 * Render a command's Markdown report with otito's shared document treatment.
 * Presentation only: the source Markdown still reaches the terminal, and
 * `--json` / `--out` never reach this path.
 * @param {CliArgs} parsed
 * @param {string} markdown
 * @param {{ title: string, glyph?: string, subtitle?: string }} meta
 */
async function printDocument(parsed, markdown, meta) {
  const { renderDocument } = await import("./lib/render/document.js");
  printText(
    renderDocument(
      markdown,
      meta,
      createRenderer({
        emoji: emojiPreference(parsed),
        color: colorPreference(parsed),
        theme: themePreference(parsed),
      }),
    ),
  );
}

/** @param {CliArgs} parsed */
async function handleImpact(parsed) {
  const { formatImpactMermaid, formatImpactTerminal, generateImpact } = await import("./lib/impact.js");
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

  const { generateAxScore } = await import("./lib/ax.js");
  await printRouteFooter(parsed, query, result.data, generateAxScore(query, { path: repoPath, top: parsed.flags.top }));
}

/** @param {CliArgs} parsed */
async function handleObsidian(parsed) {
  const { writeObsidianVault } = await import("./lib/obsidian.js");
  const repoPath = parsed.positionals[0] ?? ".";
  const query = typeof parsed.flags.query === "string" ? parsed.flags.query : undefined;
  const vaultPath = typeof parsed.flags.out === "string" ? parsed.flags.out : join(repoPath, ".otito", "obsidian");
  const manifest = writeObsidianVault(repoPath, vaultPath, {
    query,
    limit: parsed.flags.limit,
    top: parsed.flags.top,
  });

  if (parsed.flags.json) {
    printJson(manifest);
    return;
  }

  printText(`Obsidian vault written: ${manifest.vaultPath} (${manifest.noteCount} note(s))`);
}

/** @param {CliArgs} parsed */
async function handleAx(parsed) {
  const { formatAxMarkdown, generateAxScore } = await import("./lib/ax.js");
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

  await printDocument(parsed, formatAxMarkdown(data), {
    title: `AGENT EXPERIENCE   ${data.repo?.name ?? ""}`,
    glyph: "\u{1F9ED}",
    subtitle: data.query,
  });

  const { generateImpact } = await import("./lib/impact.js");
  await printRouteFooter(parsed, query, generateImpact(query, { path: repoPath, top: parsed.flags.top }).data, data);
}

/** @param {CliArgs} parsed */
async function handleRoute(parsed) {
  const { generateRoute, hostModelFor } = await import("./lib/model-route.js");
  const { formatRouteMarkdown, formatRouteTerminal } = await import("./lib/render/route.js");

  // Mirror `ax` and `impact` arg parsing.
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
    throw new Error('route requires a change request, e.g. `otito route . "add a --json flag"`');
  }

  const data = await generateRoute(query, {
    path: repoPath,
    top: parsed.flags.top,
    offline: parsed.flags.offline === true,
  });

  // The router decides a TIER. Each host turns that tier into whatever it calls
  // a model, so nothing about the scoring is specific to one editor.
  if (typeof parsed.flags.host === "string") {
    data.hostModel = hostModelFor(repoPath, parsed.flags.host, data.tier);
  }

  noteResult(data);

  if (parsed.flags.json) {
    printJson(data);
    return;
  }

  if (parsed.flags.tier_only) {
    printText(data.tier);
    return;
  }

  if (data.hostModel) {
    printText(data.hostModel);
    return;
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, formatRouteMarkdown(data));
    printText(`Model route written: ${artifact.path}`);
    return;
  }

  printText(
    formatRouteTerminal(
      data,
      createRenderer({
        emoji: emojiPreference(parsed),
        color: colorPreference(parsed),
        theme: themePreference(parsed),
      }),
    ),
  );
}

/** @param {CliArgs} parsed */
async function handleCalibrate(parsed) {
  const { formatCalibrationMarkdown, generateCalibration } = await import("./lib/calibrate.js");
  const data = generateCalibration(parsed.positionals[0] ?? parsed.flags.path ?? ".", {
    window: parsed.flags.window,
    minSample: parsed.flags.min_sample,
    since: parsed.flags.since,
    max: parsed.flags.max,
  });
  noteResult(data);

  if (parsed.flags.json) {
    printJson(data);
    return;
  }

  await printDocument(parsed, formatCalibrationMarkdown(data), {
    title: `CALIBRATION   ${data.repo?.name ?? ""}`,
    glyph: "\u{1F4CF}",
  });
}

/** @param {CliArgs} parsed */
async function handleConverge(parsed) {
  const { formatConvergenceMarkdown, generateConvergence } = await import("./lib/converge.js");
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
    head: parsed.flags.head,
    top: parsed.flags.top,
    staged: parsed.flags.staged,
    includeUntracked: parsed.flags.include_untracked,
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

  await printDocument(parsed, formatConvergenceMarkdown(data), {
    title: `CONVERGENCE   ${data.repo?.name ?? ""}`,
    glyph: "\u{1F3AF}",
  });
}

/** @param {CliArgs} parsed */
async function handlePass(parsed) {
  const { evaluateLocal, formatPassMarkdown, formatPassTerminal } = await import("./lib/pass-local.js");
  const repoPath = parsed.positionals[0] ?? ".";
  const { policy, governance } = gatePolicy(repoPath, parsed.flags);
  // evaluateLocal returns a loosely-typed record; it is a PassData at runtime.
  const data = /** @type {PassData} */ (
    evaluateLocal(repoPath, {
      base: parsed.flags.base,
      head: parsed.flags.head,
      policy,
      governance,
      request: parsed.flags.request,
      minConvergence: parsed.flags.min_convergence,
      receipt: parsed.flags.receipt,
      staged: parsed.flags.staged,
      runValidation: parsed.flags.run_validation,
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
  const { evaluatePR, formatPassPrMarkdown, formatPassPrTerminal } = await import("./lib/pass-pr.js");
  // No selector gates the current branch's PR, as `gh pr view` does. A blank
  // one is `otito pass-pr "$PR_NUMBER"` with the variable unset, not a request
  // for that PR.
  const selector = parsed.positionals[0];
  if (selector !== undefined && !isPrSelector(selector)) {
    throw new Error("pass-pr was given a blank PR selector; name the PR, e.g. `otito pass-pr 123 --path .`, or leave it out to gate the current branch's PR");
  }
  const repoPath = parsed.flags.path ?? ".";
  const { policy, governance } = gatePolicy(repoPath, parsed.flags);
  // evaluatePR returns a loosely-typed record; it is a PassPrData at runtime.
  const data = /** @type {PassPrData} */ (
    await evaluatePR(repoPath, selector ?? "", {
      policy,
      governance,
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

/**
 * `otito attest [repo] --verdict file --merge sha [...]` appends a hash-chained
 * record to the repository's audit ledger; `otito attest [repo] --verify`
 * recomputes the whole chain and exits 1 if any record was altered.
 * @param {CliArgs} parsed
 */
async function handleAttest(parsed) {
  const { appendAttestation, formatAttested, formatVerify, resolveLedgerPath, verifyLedger } = await import("./lib/attest.js");
  const repoPath = parsed.flags.path ?? parsed.positionals[0] ?? ".";
  const ledgerPath = resolveLedgerPath({ ledger: parsed.flags.ledger, path: repoPath });

  if (parsed.flags.verify) {
    const result = verifyLedger(ledgerPath);
    if (!result.ok) process.exitCode = 1;
    if (parsed.flags.json) {
      printJson(result);
      return;
    }
    printText(formatVerify(result));
    return;
  }

  if (!parsed.flags.verdict || parsed.flags.verdict === true) {
    throw new Error("attest requires --verdict <file> (from `otito review --json`) and --merge <sha>, or --verify");
  }
  const verdict = JSON.parse(readFileSync(String(parsed.flags.verdict), "utf8"));
  const record = appendAttestation({
    ledgerPath,
    verdict,
    merge: String(parsed.flags.merge ?? ""),
    prev: parsed.flags.prev === undefined ? undefined : String(parsed.flags.prev),
    pr: parsed.flags.pr === undefined ? null : String(parsed.flags.pr),
    author: parsed.flags.author === undefined ? undefined : String(parsed.flags.author),
    committed: parsed.flags.committed === undefined ? null : String(parsed.flags.committed),
  });
  if (parsed.flags.json) {
    printJson({ ok: true, ledger: ledgerPath, record });
    return;
  }
  printText(formatAttested(record));
}

/**
 * `otito regret <repo>` grades the router's tier against the repository's own
 * history: replay commits, recompute the tier from the parent tree, join to
 * the same `repaired` outcome calibrate uses. Offline unless a key is set;
 * `--offline` keeps it keyless either way. `--rescore <run.json>` grades the
 * current arithmetic against a saved run's answers instead of replaying.
 * @param {CliArgs} parsed
 */
async function handleRegret(parsed) {
  const { formatRegretMarkdown, generateRegret, rescoreRegret } = await import("./lib/regret.js");
  const quiet = parsed.flags.quiet === true;
  /** @type {Record<string, any>} */
  let data;
  try {
    const rescore = parsed.flags.rescore;
    if (rescore === true) {
      throw new Error("--rescore needs the path of a saved `otito regret --json` run");
    }
    data =
      rescore === undefined
        ? await generateRegret(parsed.positionals[0] ?? parsed.flags.path ?? ".", {
            window: parsed.flags.window,
            minSample: parsed.flags.min_sample,
            since: parsed.flags.since,
            max: parsed.flags.max,
            top: parsed.flags.top,
            offline: parsed.flags.offline === true,
            // Progress goes to stderr so `--json` on stdout stays parseable.
            onProgress: quiet ? undefined : ({ done, total, sha }) => process.stderr.write(`regret: ${done}/${total} ${sha.slice(0, 7)}\n`),
          })
        : // Nothing is replayed or called: the saved rows carry what the arithmetic reads.
          rescoreRegret(JSON.parse(readFileSync(String(rescore), "utf8")));
  } catch (error) {
    // The replay has already removed its worktree; exit the way a shell
    // expects an interrupted command to, not as a failed one.
    const signal = /** @type {any} */ (error)?.signal;
    if (signal === "SIGINT" || signal === "SIGTERM") {
      process.stderr.write(`otito: regret interrupted by ${signal}; the replay worktree was removed\n`);
      process.exit(signal === "SIGTERM" ? 143 : 130);
    }
    throw error;
  }
  noteResult(data);

  if (parsed.flags.json) {
    printJson(data);
    return;
  }

  if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, formatRegretMarkdown(data));
    printText(`Route regret written: ${artifact.path}`);
    return;
  }

  await printDocument(parsed, formatRegretMarkdown(data), {
    title: `ROUTE REGRET   ${data.repo?.name ?? ""}`,
    glyph: "\u{1F4C9}",
  });
}

// `gate` is the canonical v2 merge-gate command. It maps to `pass` for the
// local gate (no --pr) and to `pass-pr` for the GitHub gate (--pr <selector>),
// mirroring the review_gate MCP tool's local-vs-PR dispatch. `pass` and
// `pass-pr` remain available as legacy aliases.
/** @param {CliArgs} parsed */
async function handleGate(parsed) {
  const selector = parsed.flags.pr;
  // Refused before the repository is settled: `--pr "$PR_NUMBER"` with the
  // variable unset leaves --pr bare and its empty string as a positional,
  // which would otherwise be taken for the repository.
  if (selector !== undefined && !isPrSelector(selector)) {
    throw new Error("gate --pr needs a PR number or URL, e.g. `otito gate --pr 123 --path .`");
  }
  const repoPath = gateRepoPath(parsed);
  if (selector !== undefined) {
    // pass-pr reads the selector from positionals[0] and the repo from --path.
    return handlePassPr({
      ...parsed,
      positionals: [selector],
      flags: { ...parsed.flags, path: repoPath },
    });
  }
  // pass reads the repo from positionals[0].
  return handlePass({ ...parsed, positionals: [repoPath] });
}

/**
 * Whether a --pr value (or pass-pr's positional) names a PR. A bare `--pr`
 * parses as `true` and `--pr=` as `""`; read as "no PR", either ran the local
 * gate instead, and a blank selector that reached `gh pr view` gated whatever
 * PR the checked-out branch has. The PR commands refuse both.
 * @param {unknown} selector
 * @returns {selector is string}
 */
function isPrSelector(selector) {
  return typeof selector === "string" && selector.trim() !== "";
}

/**
 * The repository `gate` runs against, in either mode: the positional `<repo>`
 * or `--path`, else the working directory. pass reads only the positional and
 * pass-pr only --path, so gate settles it here and hands each the form it
 * reads. Both may name it only if they name the same directory; otherwise
 * gating either would silently ignore the other, so gate refuses.
 * @param {CliArgs} parsed
 * @returns {string}
 */
function gateRepoPath(parsed) {
  const positional = parsed.positionals[0];
  const flag = parsed.flags.path;
  if (flag === true) {
    throw new Error("gate --path needs a repository, e.g. `otito gate --path .`");
  }
  if (positional === undefined || flag === undefined) {
    return positional ?? flag ?? ".";
  }
  // realpath, so `.` and a symlinked spelling of the same checkout agree.
  const identity = (/** @type {string} */ dir) => {
    try {
      return realpathSync(dir);
    } catch {
      return resolve(dir);
    }
  };
  if (identity(positional) !== identity(flag)) {
    throw new Error(`gate was given two repositories (${positional} and --path ${flag}); pass only one`);
  }
  return positional;
}

/** @param {CliArgs} parsed */
async function handleReview(parsed) {
  const { formatReviewMermaid, formatReviewTerminal, generateReview } = await import("./lib/review.js");
  if (parsed.flags.pr !== undefined && !isPrSelector(parsed.flags.pr)) {
    throw new Error("review --pr needs a PR number or URL, e.g. `otito review . --pr 123`");
  }
  // Mirror `impact` and `ax` arg parsing: `review "<request>" --path <repo>` or
  // `review <repo> "<request>"`. Policy and governance come from the same repo.
  if (parsed.flags.path === true) {
    throw new Error("review --path needs a repository, e.g. `otito review --path .`");
  }
  let repoPath;
  let trailingRequest;
  if (parsed.flags.path) {
    repoPath = parsed.flags.path;
    trailingRequest = parsed.positionals.join(" ").trim();
  } else {
    repoPath = parsed.positionals[0] ?? ".";
    trailingRequest = parsed.positionals.slice(1).join(" ").trim();
  }
  const { policy, governance } = gatePolicy(repoPath, parsed.flags);
  const { data } = await generateReview(repoPath, {
    request: parsed.flags.request ?? (trailingRequest || undefined),
    base: parsed.flags.base,
    head: parsed.flags.head,
    prSelector: parsed.flags.pr,
    policy,
    governance,
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
  const { formatInstallSummary, installOtito } = await import("./lib/install.js");
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

  printText(formatInstallSummary(result, { emoji: emojiPreference(parsed), color: colorPreference(parsed), theme: themePreference(parsed) }));
  if (result.applied === false) {
    process.exitCode = 1;
  }
}

/** @param {CliArgs} parsed */
async function handleMap(parsed) {
  const { formatCodeMapMermaid, formatCodeMapMarkdown, generateCodeMap } = await import("./lib/code-map.js");
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

  await printDocument(parsed, formatCodeMapMarkdown(result), {
    title: `CODE MAP   ${result.repo?.name ?? ""}`,
    glyph: "\u{1F5FA}",
  });
}

/** @param {CliArgs} parsed */
async function handleStructure(parsed) {
  const { generateStructure } = await import("./lib/structure.js");
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
  const { inspectDependency } = await import("./lib/deps.js");
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
  const { getToolMatrix } = await import("./lib/matrix.js");
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
  await printDocument(parsed, ["# Tool Evaluation Matrix", "", ...rows].join("\n"), {
    title: "TOOL MATRIX",
    glyph: "\u{1F4CA}",
  });
}

/** @param {CliArgs} parsed */
async function handleInit(parsed) {
  const { formatInitSummary, initProject } = await import("./lib/init.js");
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

  printText(formatInitSummary(result, { emoji: emojiPreference(parsed), color: colorPreference(parsed), theme: themePreference(parsed) }));
}

/**
 * Ask a yes/no question at an interactive TTY. Used only by `init`; never
 * reached for non-interactive callers (guarded by process.stdin.isTTY).
 * @param {string} question
 * @param {boolean} defaultValue
 * @returns {Promise<boolean>}
 */
async function promptYesNo(question, defaultValue) {
  const readline = await import("node:readline/promises");
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
  const { startMcpServer } = await import("./lib/mcp.js");
  await startMcpServer();
}

/** @param {CliArgs} parsed */
async function handlePr(parsed) {
  const { generatePrReview } = await import("./lib/pr-review.js");
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

  await printDocument(parsed, [result.markdown, formatCommentResult(result.data.comment)].filter(Boolean).join("\n"), {
    title: `PULL REQUEST   ${result.data?.repo?.name ?? ""}`,
    glyph: "\u{1F500}",
  });
}

/** @param {CliArgs} parsed */
async function handleReport(parsed) {
  const { formatReportMermaid, formatReportTerminal, generateReport } = await import("./lib/report.js");
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

  await printDocument(parsed, formatReportTerminal(result.data, { columns: process.stdout.columns }), {
    // report's RepoInfo carries a root path, not a name.
    title: `REPORT   ${basename(result.data?.repo?.root ?? "")}`,
    glyph: "\u{1F4C4}",
  });
}

/** @param {CliArgs} parsed */
async function handleWorkspace(parsed) {
  const { formatWorkspaceMermaid, generateWorkspaceReport } = await import("./lib/workspace.js");
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

  await printDocument(parsed, result.markdown, {
    title: "WORKSPACE",
    glyph: "\u{1F5C2}",
  });
}

/** @param {CliArgs} parsed */
async function handleWorkspaceGate(parsed) {
  const { evaluateWorkspaceGate, formatWorkspaceGateMarkdown } = await import("./lib/workspace-gate.js");
  if (parsed.positionals.length < 2) {
    throw new Error("workspace-gate requires at least two repo paths, for example: otito workspace-gate ../web ../api --staged");
  }
  const data = evaluateWorkspaceGate(parsed.positionals, {
    base: parsed.flags.base,
    ...workspaceGatePolicy(parsed.positionals, parsed.flags),
    request: parsed.flags.request,
    minConvergence: parsed.flags.min_convergence,
    runValidation: parsed.flags.run_validation,
  });
  noteResult(data);
  if (parsed.flags.json) {
    printJson(data);
  } else if (parsed.flags.out) {
    const artifact = writeArtifact(parsed.flags.out, formatWorkspaceGateMarkdown(data));
    printText(`Workspace gate report written: ${artifact.path}`);
  } else {
    await printDocument(parsed, formatWorkspaceGateMarkdown(data), {
      title: "WORKSPACE GATE",
      glyph: "\u{1F6A6}",
    });
  }
  if (data.verdict === "FAIL") process.exitCode = 1;
}

/**
 * The one policy and governance a workspace gate runs every repository under:
 * the flag when given, else what each repository's own config resolves to. The
 * parent receipt records a single value of each for the whole change, so
 * repositories whose configs disagree are refused rather than gated under a
 * setting one of them did not choose. The flag settles it for all of them.
 * @param {string[]} repoPaths
 * @param {Record<string, any>} flags
 */
function workspaceGatePolicy(repoPaths, flags) {
  const resolved = repoPaths.map((repoPath) => gatePolicy(repoPath, flags));
  /** @param {"policy" | "governance"} key */
  const agreed = (key) => {
    if (new Set(resolved.map((entry) => entry[key])).size > 1) {
      const each = repoPaths.map((repoPath, index) => `${repoPath}: ${resolved[index][key]}`).join(", ");
      throw new Error(`workspace-gate runs every repository under one ${key}, and their configs disagree (${each}); pass --${key} to choose it`);
    }
    return resolved[0][key];
  };
  return { policy: agreed("policy"), governance: agreed("governance") };
}

/** @param {CliArgs} parsed */
async function handleHarness(parsed) {
  const { generateHarness } = await import("./lib/harness.js");
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

  await printDocument(parsed, result.markdown, {
    title: `HARNESS   ${result.data?.repo?.name ?? ""}`,
    glyph: "\u{1F6E0}",
  });
}

/** @param {CliArgs} parsed */
async function handleEval(parsed) {
  const { runEval, runGateEffectivenessEval, runHarnessExecutionEval, runRetrievalEval } = await import("./lib/eval.js");
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
      await printDocument(parsed, result.markdown, { title: "ACCURACY EVAL", glyph: "\\u{1F9EA}" });
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
      await printDocument(parsed, result.markdown, { title: "HARNESS EVAL", glyph: "\\u{1F9EA}" });
    }
    if (!(/** @type {{ passed?: boolean }} */ (result.data).passed)) {
      process.exitCode = 1;
    }
    return;
  }

  // --gate-effectiveness runs reviewed staged change-sets through the real
  // local gate in isolated temporary Git repositories. It checks both the
  // verdict and the encoded deterministic reason for each result.
  if (parsed.flags.gate_effectiveness) {
    const result = runGateEffectivenessEval({ corpusPath: parsed.flags.corpus });
    noteResult(result.data);
    if (parsed.flags.json) {
      printJson(result.data);
    } else if (parsed.flags.out) {
      const artifact = writeArtifact(parsed.flags.out, result.markdown);
      printText(`Gate effectiveness eval written: ${artifact.path}`);
    } else {
      await printDocument(parsed, result.markdown, { title: "GATE EFFECTIVENESS", glyph: "\\u{1F9EA}" });
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
  await printDocument(parsed, result.markdown, { title: "EVAL", glyph: "\u{1F9EA}" });
}

/** @param {CliArgs} parsed */
async function handleDashboard(parsed) {
  const { generateDashboard } = await import("./lib/dashboard.js");
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

  if (sub === "share") {
    const action = parsed.positionals[1] ?? "status";
    if (action === "on" || action === "off") {
      const scope = parsed.flags.local ? "local" : "user";
      writeConfig(action === "on" ? { telemetry: true, telemetryShare: true } : { telemetryShare: false }, scope);
      printText(
        action === "on"
          ? `Anonymous usage sharing on (${getConfigPath(scope)}). Local capture is also on.`
          : `Anonymous usage sharing off (${getConfigPath(scope)}). Local capture is unchanged.`,
      );
      return;
    }
    if (action !== "status") throw new Error("Usage: otito telemetry share [status|on|off]");
  }

  if (sub === "on" || sub === "off") {
    const scope = parsed.flags.local ? "local" : "user";
    writeConfig(sub === "on" ? { telemetry: true } : { telemetry: false, telemetryShare: false }, scope);
    printText(
      sub === "on"
        ? `Local telemetry on (${getConfigPath(scope)}). Nothing is shared unless you run \`otito telemetry share on\`.`
        : `Telemetry off (${getConfigPath(scope)}). Local capture and anonymous sharing are both disabled.`,
    );
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
      `Sharing:     ${status.sharing ? "on (anonymous, opt-in)" : "off"}`,
      `Log:         ${status.path}`,
      `Exists:      ${status.exists ? "yes" : "no"}`,
      `Size:        ${status.sizeBytes} bytes`,
      `Events:      ${status.events}`,
      "",
      status.enabled ? "Disable all telemetry with `otito telemetry off`." : "Enable local capture with `otito telemetry on`.",
      status.sharing ? "Disable sharing with `otito telemetry share off`." : "Share anonymous usage with `otito telemetry share on`.",
      "Clear the log with `otito telemetry clear`.",
    ].join("\n"),
  );
}

/** @param {CliArgs} parsed */
async function handleDataAccess(parsed) {
  const { formatDataAccessMermaid, generateDataAccessReport } = await import("./lib/data-access.js");
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
  await printDocument(parsed, result.markdown, {
    title: "DATA ACCESS",
    glyph: "\u{1F5C4}",
  });
}

/** @param {CliArgs} parsed */
async function handleAgentTools(parsed) {
  const { getAgentTools } = await import("./lib/agent-tools.js");
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
      "  otito gate [repo | --path repo] [--base ref] [--head ref | --staged] [--run-validation] [--policy x] [--governance x] [--request text] [--min-convergence n] [--receipt hash|file] [--json]   # local gate",
      "  otito gate --pr <selector> [repo | --path repo] [--policy x] [--governance x] [--request text] [--min-convergence n] [--receipt hash|file] [--json]            # GitHub PR gate",
      "  otito workspace-gate <repo...> [--base ref] [--run-validation] [--policy x] [--governance x] [--request text] [--json]                           # one staged receipt across repositories",
      "",
      "Evaluation gates (v2):",
      "  otito eval --accuracy [--corpus path] [--json] [--out file]   # labeled retrieval + risk corpus; non-zero exit below thresholds",
      "  otito eval --harness [--corpus path] [--json] [--out file]    # run inferred install/test/typecheck/build commands in isolated fixtures",
      "  otito eval --gate-effectiveness [--corpus path] [--json] [--out file] # assert gate verdicts and deterministic reasons in isolated Git fixtures",
      "",
      "Canonical vs legacy commands:",
      "  gate                 canonical merge gate; `pass` (local) and `pass-pr` (PR) remain as legacy aliases",
      "  review               canonical composite verdict (impact + review context + gate)",
      "  pr                   produces review context only (diff/comment metadata, no verdict)",
      "",
      "Legacy MCP tool names (pr_review, review_pr, merge_readiness, pr_merge_readiness,",
      "repo_catalog, repo_discover, find_*) still work via tools/call in 3.x, and no",
      "release is named to remove them. Each maps to a canonical tool:",
      "https://bashbop.github.io/otito/02-mcp-agent-workflows/#legacy-tool-names",
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
 * @param {ReturnType<typeof import("./lib/repo.js").inspectRepo>} result
 * @returns {string}
 */
function formatRepoSummary(result, options = {}) {
  return formatTerminalSummary({
    title: "otito repo · repository overview",
    glyph: "📦",
    subtitle: result.root,
    facts: [
      ["Files scanned", result.fileCount],
      ["Primary languages", result.languages.map((item) => `${item.language} (${item.count})`).join(", ") || "unknown"],
      ["Package managers", result.packageManagers.join(", ") || "none detected"],
      ["Entrypoints", result.entrypoints.join(", ") || "none detected"],
    ],
    sections: [
      { title: "Scripts", items: Object.entries(result.scripts).map(([name, value]) => `${name}: ${value}`), glyph: "⚙️" },
      { title: "Important directories", items: result.importantDirectories, glyph: "📁" },
    ],
    options,
  });
}

/**
 * Turn a bare module-resolution failure into an actionable one. `typescript` is
 * a runtime dependency (the code-map AST parser), so a broken or partial
 * install surfaces as "Cannot find package 'typescript'" from deep inside the
 * code map with no hint about what the user should do.
 *
 * @param {string} message
 * @returns {string}
 */
function explainError(message) {
  if (/Cannot find (?:package|module) ['"]typescript['"]/.test(message)) {
    return `${message}\n\notito needs its bundled \`typescript\` dependency to build code maps. Reinstall it with \`npm install -g @bashbop/otito\`, or run \`npm install\` in a source checkout.`;
  }
  return message;
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
