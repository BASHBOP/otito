/// <reference types="node" />
import path from "node:path";
import { generateHarness } from "./harness.js";
import { getCachedCodeMap } from "./index-cache.js";
import { estimateTokens, estimateTokenSections } from "./tokens.js";

/**
 * @typedef {import('./index-cache.js').CodeMap} CodeMap
 * @typedef {import('./index-cache.js').CodeMapFile} CodeMapFile
 * @typedef {import('./index-cache.js').CodeMapHttpMethod} CodeMapHttpMethod
 * @typedef {import('./index-cache.js').CodeMapSymbol} CodeMapSymbol
 */

/**
 * Parsed task intent derived from the query.
 * @typedef {object} Intent
 * @property {string} action
 * @property {string[]} topics
 * @property {string[]} hints
 */

/**
 * A file selected and scored by the context engine. `imports`/`exports`/`symbols`
 * are optional because stripEvidence may remove them from the returned packet.
 * @typedef {object} ScoredFile
 * @property {{ name: string, root: string }} repo
 * @property {string} path
 * @property {string} kind
 * @property {string} domain
 * @property {number} score
 * @property {string[]} reasons
 * @property {string|null} [route]
 * @property {string|null} [controllerBasePath]
 * @property {CodeMapHttpMethod[]} httpMethods
 * @property {string[]} [imports]
 * @property {string[]} [exports]
 * @property {CodeMapSymbol[]} [symbols]
 * @property {Array<{ type: string, name: string, line?: number, matchedTokens: string[], score: number }>} [matchedSymbols]
 */

/**
 * Per-repo import adjacency built from code-map file imports.
 * @typedef {object} ImportGraph
 * @property {Map<string, Set<string>>} importsByPath
 * @property {Map<string, Set<string>>} importedByPath
 */

/**
 * A validation/refresh command surfaced in a context pack.
 * @typedef {object} EngineCommand
 * @property {string} command
 * @property {string} reason
 * @property {string} [repo]
 * @property {string} [script]
 */

/**
 * Options accepted by generateContextPack.
 * @typedef {object} ContextPackOptions
 * @property {number} [limit]
 * @property {boolean} [includeEvidence]
 * @property {string[]} [paths]
 * @property {string} [path]
 */

const contextEngineVersion = 3;
const defaultLimit = 8;
const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "let",
  "me",
  "new",
  "of",
  "on",
  "or",
  "the",
  "to",
  "we",
  "what",
  "where",
  "which",
  "who",
  "with",
  "app",
  "mobile",
  "show",
]);

const actionWords = new Set(["add", "build", "change", "create", "debug", "fix", "implement", "refactor", "review", "test", "update"]);
const importExtensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

/**
 * @param {string} query
 * @param {ContextPackOptions} [options]
 */
export function generateContextPack(query, options = {}) {
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) {
    throw new Error("context requires a non-empty query");
  }

  const limit = normalizeLimit(options.limit, defaultLimit, 50);
  const includeEvidence = Boolean(options.includeEvidence);
  const repoPaths = normalizePaths(options.paths ?? [options.path ?? "."]);
  const maps = repoPaths.map((repoPath) => getCachedCodeMap(repoPath));
  const graphs = new Map(maps.map((map) => [map.repo.root, buildImportGraph(map.files)]));
  const tokens = tokenize(normalizedQuery);
  const intent = inferIntent(normalizedQuery, tokens);
  const scoredFiles = scoreMaps(maps, tokens, intent);
  const matchedPrimaryFiles = selectPrimaryFiles(scoredFiles, limit);
  const usedFallback = matchedPrimaryFiles.length === 0;
  const primaryFiles = stripEvidence(usedFallback ? selectFallbackPrimaryFiles(maps, limit) : matchedPrimaryFiles, includeEvidence);
  const relatedFiles = stripEvidence(selectRelatedFiles(maps, graphs, scoredFiles, primaryFiles, intent, limit), includeEvidence);
  const tests = stripEvidence(selectTests(maps, graphs, scoredFiles, primaryFiles, limit), includeEvidence);
  const hotspots = buildHotspots(scoredFiles, primaryFiles, relatedFiles, tokens);
  const commands = inferCommands(repoPaths, normalizedQuery);
  const patterns = inferPatterns(primaryFiles, relatedFiles, tests, intent);
  const conflicts = inferConflicts(maps);
  const openQuestions = inferOpenQuestions(primaryFiles, commands, intent, usedFallback, hotspots);
  const sources = inferSources(maps, commands);

  const data = /** @type {Record<string, any> & { tokenEstimate?: any }} */ ({
    ok: true,
    generatedAt: new Date().toISOString(),
    contextEngineVersion,
    query: normalizedQuery,
    intent,
    repos: maps.map(summarizeRepo),
    hotspots,
    primaryFiles,
    relatedFiles,
    tests,
    patterns,
    commands,
    conflicts,
    openQuestions,
    sources,
    agentPrompt: formatAgentPrompt(normalizedQuery, primaryFiles, relatedFiles, tests, commands, hotspots),
  });

  data.tokenEstimate = {
    ...estimateTokenSections([
      { name: "intent", value: data.intent },
      { name: "repos", value: data.repos },
      { name: "hotspots", value: data.hotspots },
      { name: "primaryFiles", value: data.primaryFiles },
      { name: "relatedFiles", value: data.relatedFiles },
      { name: "tests", value: data.tests },
      { name: "patterns", value: data.patterns },
      { name: "commands", value: data.commands },
    ]),
  };
  data.tokenEstimate.fullJson = estimateTokens(data);

  let markdown = formatContextPackMarkdown(data);
  data.tokenEstimate.markdown = estimateTokens(markdown);
  markdown = formatContextPackMarkdown(data);

  return {
    data,
    markdown,
  };
}

/**
 * @param {Record<string, any>} data - The context pack data object built by generateContextPack.
 */
export function formatContextPackMarkdown(data) {
  const lines = [
    `# Context Pack: ${data.query}`,
    "",
    `Generated: ${data.generatedAt}`,
    `Context engine version: ${data.contextEngineVersion}`,
    `Intent: ${data.intent.action}${data.intent.topics.length ? ` (${data.intent.topics.join(", ")})` : ""}`,
    `Estimated JSON tokens: ${data.tokenEstimate.fullJson}`,
    `Estimated Markdown tokens: ${data.tokenEstimate.markdown ?? "pending"}`,
    "",
    "## Repositories",
    "",
    ...data.repos.map(
      (/** @type {{ name: string, root: string, sourceFileCount: number }} */ repo) => `- ${repo.name}: ${repo.root} (${repo.sourceFileCount} source file(s))`,
    ),
    "",
    "## Hotspots",
    "",
    ...formatHotspots(data.hotspots),
    "",
    "## Primary Files",
    "",
    ...formatFiles(data.primaryFiles, "No primary files matched the query."),
    "",
    "## Related Files",
    "",
    ...formatFiles(data.relatedFiles, "No related files selected."),
    "",
    "## Tests",
    "",
    ...formatFiles(data.tests, "No matching tests found."),
    "",
    "## Patterns",
    "",
    ...(data.patterns.length ? data.patterns.map((/** @type {string} */ item) => `- ${item}`) : ["- none inferred"]),
    "",
    "## Commands",
    "",
    ...(data.commands.length ? data.commands.map((/** @type {EngineCommand} */ item) => `- \`${item.command}\`: ${item.reason}`) : ["- none inferred"]),
    "",
    "## Conflicts",
    "",
    ...(data.conflicts.length ? data.conflicts.map((/** @type {string} */ item) => `- ${item}`) : ["- none detected"]),
    "",
    "## Open Questions",
    "",
    ...(data.openQuestions.length ? data.openQuestions.map((/** @type {string} */ item) => `- ${item}`) : ["- none"]),
    "",
    "## Agent Prompt",
    "",
    data.agentPrompt,
    "",
  ];
  return lines.join("\n");
}

/**
 * Render the full context pack for an interactive terminal. Markdown remains
 * the durable artifact format; this presentation uses the shared renderer so
 * a long report stays easy to scan in a real terminal.
 *
 * @param {Record<string, any>} data
 * @param {(options: Record<string, unknown>) => ReturnType<typeof import("./render/fancy.js").createRenderer>} rendererFactory
 * @returns {string}
 */
export function formatContextPackTerminal(data, rendererFactory) {
  const renderer = rendererFactory({});
  /** @type {string[]} */
  const lines = [];
  const repoCount = data.repos.length;
  const sourceCount = data.repos.reduce((/** @type {number} */ sum, /** @type {{ sourceFileCount?: number }} */ repo) => sum + (repo.sourceFileCount ?? 0), 0);

  lines.push(
    renderer.header({ text: "otito context · repository guide", glyph: "🧭" }, [
      { text: `"${data.query}"`, glyph: "💬" },
      { text: `${repoCount} repo${repoCount === 1 ? "" : "s"} · ${sourceCount} source file(s)`, glyph: "📂" },
      { text: `${data.primaryFiles.length} primary · ${data.hotspots.length} hotspots · ${data.tests.length} tests`, glyph: "🎯" },
    ]),
  );
  lines.push("");

  if (data.hotspots.length) {
    lines.push(
      renderer.section(
        `${renderer.emoji ? "🔥" : ">"} Start here`,
        data.hotspots.slice(0, 8).map((/** @type {any} */ hotspot, /** @type {number} */ index) => {
          const location = `${hotspot.path}${hotspot.line ? `:${hotspot.line}` : ""}`;
          return `${rankLabel(index, renderer.emoji)} ${location}  ${hotspot.type} ${hotspot.symbol}  ${formatMatch(hotspot.matchedTokens)}`;
        }),
      ),
    );
  } else {
    lines.push(renderer.tip("No precise symbol hotspots yet. Start with the primary files, then refine the query with a route or method name."));
  }

  appendFileSection(
    lines,
    renderer,
    `${renderer.emoji ? "🥇" : ">"} Primary files`,
    data.primaryFiles,
    "No primary files matched the query.",
    true,
    data.intent,
  );
  appendFileSection(lines, renderer, `${renderer.emoji ? "🔗" : ">"} Related files`, data.relatedFiles, "No related files selected.", false, data.intent);
  appendFileSection(lines, renderer, `${renderer.emoji ? "🧪" : ">"} Tests`, data.tests, "No matching tests found.", false, data.intent);

  lines.push("");
  lines.push(
    renderer.section(
      `${renderer.emoji ? "🧩" : ">"} Patterns`,
      data.patterns.length ? data.patterns.map((/** @type {string} */ pattern) => renderer.bullet(pattern)) : [renderer.bullet("none inferred")],
    ),
  );
  lines.push("");
  lines.push(
    renderer.section(
      `${renderer.emoji ? "▶️" : ">"} Commands`,
      data.commands.length
        ? data.commands.map((/** @type {EngineCommand} */ command) => `${renderer.emoji ? "•" : "-"} ${command.command}\n    ${command.reason}`)
        : [renderer.bullet("none inferred")],
    ),
  );

  if (data.conflicts.length) {
    lines.push("");
    lines.push(renderer.statusLine("warn", "Working tree", data.conflicts[0], data.conflicts.slice(1)));
  }
  if (data.openQuestions.length) {
    lines.push("");
    lines.push(
      renderer.section(
        `${renderer.emoji ? "❓" : ">"} Check before changing`,
        data.openQuestions.map((/** @type {string} */ question) => renderer.bullet(question)),
      ),
    );
  }

  lines.push("");
  lines.push(renderer.section(`${renderer.emoji ? "🤖" : ">"} Agent handoff`, data.agentPrompt.split("\n")));
  lines.push("");
  lines.push(
    renderer.tip(`Context engine v${data.contextEngineVersion} · ${data.tokenEstimate.fullJson} JSON tokens · ${data.tokenEstimate.markdown} markdown tokens`),
  );
  return lines.join("\n");
}

/**
 * @param {string[]} lines
 * @param {ReturnType<import("./render/fancy.js").createRenderer>} renderer
 * @param {string} title
 * @param {ScoredFile[]} files
 * @param {string} fallback
 * @param {boolean} [ranked]
 * @param {Intent} [intent]
 */
function appendFileSection(lines, renderer, title, files, fallback, ranked = false, intent) {
  lines.push("");
  lines.push(
    renderer.section(
      title,
      files.length
        ? files.map((file, index) => {
            const rank = ranked ? `${rankLabel(index, renderer.emoji)} ` : "";
            const method = selectDisplayHttpMethod(file.httpMethods, intent);
            const route = method ? ` · ${method.method} ${method.path}` : "";
            const reasons = file.reasons.length ? `\n    ${renderer.emoji ? "└─" : "|-"} ${file.reasons.join(" · ")}` : "";
            return `${rank}${file.path}  ${file.kind}/${file.domain} · score ${file.score}${route}${reasons}`;
          })
        : [renderer.bullet(fallback)],
    ),
  );
}

/**
 * Show a route that supports the question where one exists. Controllers often
 * expose several endpoints, and their source-order first route can be wholly
 * unrelated to the selected context.
 *
 * @param {CodeMapHttpMethod[]|undefined} methods
 * @param {Intent|undefined} intent
 * @returns {CodeMapHttpMethod|undefined}
 */
function selectDisplayHttpMethod(methods, intent) {
  if (!methods?.length) return undefined;
  if (intent?.hints.includes("auth-flow")) {
    return (
      methods.find((method) => /register|signup/i.test(method.path)) ??
      methods.find((method) => /validate.*otp|otp/i.test(method.path)) ??
      methods.find((method) => /verify/i.test(method.path)) ??
      methods[0]
    );
  }
  return methods[0];
}

/**
 * @param {number} index
 * @param {boolean} emoji
 */
function rankLabel(index, emoji) {
  if (!emoji) return `${index + 1}.`;
  return ["🥇", "🥈", "🥉"][index] ?? "🏅";
}

/**
 * @param {string[]|undefined} tokens
 */
function formatMatch(tokens) {
  return tokens?.length ? `matches ${tokens.join(", ")}` : "matched symbol";
}

/**
 * @param {CodeMap[]} maps
 * @param {string[]} tokens
 * @param {Intent} intent
 * @returns {ScoredFile[]}
 */
function scoreMaps(maps, tokens, intent) {
  /** @type {ScoredFile[]} */
  const scored = [];
  for (const map of maps) {
    for (const file of map.files ?? []) {
      const candidate = scoreFile(map, file, tokens, intent);
      if (candidate.score > 0) {
        scored.push(candidate);
      }
    }
  }

  return scored.sort((a, b) => b.score - a.score || a.repo.name.localeCompare(b.repo.name) || a.path.localeCompare(b.path));
}

/**
 * @param {CodeMap} map
 * @param {CodeMapFile} file
 * @param {string[]} tokens
 * @param {Intent} intent
 * @returns {ScoredFile}
 */
function scoreFile(map, file, tokens, intent) {
  /** @type {string[]} */
  const reasons = [];
  let score = 0;

  if (file.isVendor) {
    return summarizeFile(map, file, 0, []);
  }

  score += scoreField(file.path, tokens, 8, "path", reasons);
  score += scoreField(file.kind, tokens, 4, "kind", reasons);
  score += scoreField(file.domains?.length ? file.domains.join(" ") : file.domain, tokens, 5, "domain", reasons);
  score += scoreField(file.route, tokens, 7, "route", reasons);
  score += scoreField(file.controllerBasePath, tokens, 7, "controller", reasons);
  score += scoreField(map.repo.name, tokens, 3, "repo", reasons);
  score += scoreField(map.repo.package?.name, tokens, 3, "package", reasons);

  let httpScore = 0;
  for (const method of file.httpMethods ?? []) {
    httpScore += scoreField(`${method.method} ${method.path}`, tokens, 7, "http", reasons);
  }
  score += Math.min(httpScore, 56);
  score += scoreCollection(file.imports ?? [], tokens, 3, "import", reasons, 18);
  score += scoreCollection(file.exports ?? [], tokens, 8, "export", reasons, 32);
  score += scoreField((file.formFields ?? []).join(" "), tokens, 5, "form field", reasons);
  score += scoreField((file.navigationTargets ?? []).join(" "), tokens, 7, "navigation", reasons);
  score += scoreField((file.localIdentifiers ?? []).join(" "), tokens, 4, "local identifier", reasons);

  const symbolMatch = scoreSymbols(file.symbols ?? [], tokens);
  score += symbolMatch.score;
  reasons.push(...symbolMatch.reasons);

  if ((file.dataAccess?.length ?? 0) > 0) {
    score += Math.min(15, 3 + (file.dataAccess?.length ?? 0));
    reasons.push("data access");
  }

  score += scoreIntentHints(file, intent, reasons);
  score += scoreTemplateIntent(file, tokens, reasons);
  score += scoreConceptCoverage(file, tokens, reasons);

  if (isTypeOnlyFile(file)) {
    score = Math.floor(score * 0.4);
    reasons.push("type reference");
  }

  if (file.kind === "test" && score > 0) {
    score = Math.max(1, Math.floor(score * 0.7));
    reasons.push("test");
  }

  const summarized = summarizeFile(map, file, score, reasons);
  summarized.matchedSymbols = symbolMatch.matches;
  return summarized;
}

/**
 * A request that explicitly names Handlebars, a template, a layout, or a
 * partial is asking to inspect the rendered artifact itself. Give that
 * artifact a bounded preference over a generic service that happens to share
 * broad words such as "email" or "campaign"; the service remains in the pack
 * as execution context rather than displacing the template.
 * @param {CodeMapFile} file
 * @param {string[]} tokens
 * @param {string[]} reasons
 */
function scoreTemplateIntent(file, tokens, reasons) {
  if (file.kind !== "template") return 0;
  if (!tokens.some((token) => ["template", "templates", "handlebars", "layout", "partial"].includes(token))) return 0;
  reasons.push("explicit template intent");
  return 36;
}

/**
 * @param {CodeMapFile} file
 * @param {Intent} intent
 * @param {string[]} reasons
 * @returns {number}
 */
function scoreIntentHints(file, intent, reasons) {
  const ownText = normalizeText(
    `${file.path} ${file.kind} ${file.domain} ${file.exports?.join(" ")} ${symbolTerms(file.symbols)} ${file.formFields?.join(" ")} ${file.navigationTargets?.join(" ")} ${file.localIdentifiers?.join(" ")}`,
  );
  const importText = normalizeText(file.imports?.join(" ") ?? "");
  let score = 0;

  for (const hint of intent.hints) {
    if (hint === "mcp" && ownText.includes("mcp")) {
      score += 16;
      reasons.push("mcp surface");
    }
    if (hint === "cli" && (ownText.includes("cli") || ownText.includes("command"))) {
      score += 12;
      reasons.push("cli surface");
    }
    if (hint === "tool" && (ownText.includes("agent tools") || file.path.includes("tools") || (!intent.hints.includes("mcp") && ownText.includes("tool")))) {
      score += 10;
      reasons.push("tool surface");
    }
    if (hint === "api" && (file.kind === "apiClient" || file.kind === "apiRoute" || ownText.includes("api") || importText.includes("api"))) {
      score += 8;
      reasons.push("api surface");
    }
    if (hint === "test" && file.kind === "test") {
      score += 10;
      reasons.push("test surface");
    }
    if (hint === "auth-flow") {
      score += scoreAuthSignupVerificationFlow(file, reasons);
    }
  }

  if (intent.hints.includes("configuration") && intent.hints.includes("privacy")) {
    const fields = new Set(tokenize((file.formFields ?? []).join(" ")));
    const controlsPrivacy = ["address", "location", "venue", "hide", "hidden", "visibility", "private"].some((term) => fields.has(term));
    const controlsRsvp = ["rsvp", "invite", "invitation", "guest"].some((term) => fields.has(term));
    if (controlsPrivacy && controlsRsvp) {
      score += 120;
      reasons.push("privacy configuration control");
      if (file.kind === "component" || file.kind === "route") {
        score += 36;
        reasons.push("configuration surface");
      }
    }
  }

  const domain = normalizeText(file.domain || "");
  if (domain && intent.topics.includes(domain)) {
    score += 18;
    reasons.push("topic domain");
    if (file.kind === "service" || file.kind === "source" || file.kind === "hook") {
      score += 12;
      reasons.push("implementation surface");
    }
  }

  return score;
}

/**
 * Reward files that connect several distinct concepts from a plain-language
 * question, rather than only repeating a broad noun such as `event`.
 *
 * @param {CodeMapFile} file
 * @param {string[]} tokens
 * @param {string[]} reasons
 */
function scoreConceptCoverage(file, tokens, reasons) {
  const text = normalizeText(
    `${file.path} ${file.kind} ${file.domain} ${file.route ?? ""} ${file.controllerBasePath ?? ""} ${file.exports?.join(" ")} ${symbolTerms(file.symbols)} ${file.formFields?.join(" ")} ${file.navigationTargets?.join(" ")} ${file.localIdentifiers?.join(" ")}`,
  );
  const textTokens = new Set(tokenize(text));
  const matched = tokens.filter((token) => tokenVariants(token).some((variant) => textTokens.has(variant)));
  if (matched.length < 3) {
    return 0;
  }
  reasons.push("multi-concept match");
  return Math.min(36, (matched.length - 2) * 12);
}

/**
 * Declaration-only files are valuable supporting context, but dense barrels of
 * interfaces should not outrank the screen, controller, or service that owns
 * the behaviour requested in plain language.
 *
 * @param {CodeMapFile} file
 */
function isTypeOnlyFile(file) {
  const symbols = file.symbols ?? [];
  return symbols.length > 0 && symbols.every((symbol) => ["interface", "type", "enum"].includes(symbol.type));
}

/** @param {CodeMapFile["symbols"]|undefined} symbols */
function symbolTerms(symbols) {
  return (symbols ?? []).map((symbol) => `${symbol.name} ${symbol.terms?.join(" ") ?? ""}`).join(" ");
}

/**
 * A query such as "where is email verification implemented during signup?"
 * is asking for an account lifecycle, not a generic email operation. Prefer
 * the auth boundary only when the same file carries both registration and OTP
 * or verification evidence, keeping ordinary email searches unchanged.
 *
 * @param {CodeMapFile} file
 * @param {string[]} reasons
 * @returns {number}
 */
function scoreAuthSignupVerificationFlow(file, reasons) {
  const boundaryTokens = new Set(tokenize(`${file.path} ${file.kind} ${file.domain}`));
  const isAuthBoundary = [...boundaryTokens].some((token) => token === "auth" || token.startsWith("authent"));
  if (!isAuthBoundary) {
    return 0;
  }

  const text = normalizeText(`${file.path} ${file.kind} ${file.domain} ${file.exports?.join(" ")} ${symbolTerms(file.symbols)}`);
  const tokens = new Set(tokenize(text));
  const hasRegistration = ["signup", "register", "registration"].some((term) => tokens.has(term));
  const hasVerification = ["verification", "verify", "verified", "validate", "otp"].some((term) => tokens.has(term));
  if (hasRegistration && hasVerification) {
    reasons.push("signup verification flow");
    return 220;
  }
  if (file.kind === "test") {
    reasons.push("auth flow test");
    return 80;
  }
  return 0;
}

/**
 * Prefer multi-token method/symbol hits over flooding score from every weak
 * single-token symbol match in large Nest services.
 * @param {CodeMapSymbol[]} symbols
 * @param {string[]} tokens
 * @returns {{ score: number, matches: Array<{ type: string, name: string, line?: number, matchedTokens: string[], score: number }>, reasons: string[] }}
 */
function scoreSymbols(symbols, tokens) {
  if (!symbols.length || !tokens.length) {
    return { score: 0, matches: [], reasons: [] };
  }

  /** @type {Array<{ type: string, name: string, line?: number, matchedTokens: string[], score: number }>} */
  const matches = [];
  let strongScore = 0;
  /** @type {Map<string, number>} */
  const weakByToken = new Map();

  for (const symbol of symbols) {
    const nameTokens = new Set(tokenize(`${symbol.name} ${symbol.terms?.join(" ") ?? ""}`));
    const matchedTokens = tokens.filter((token) => tokenVariants(token).some((variant) => nameTokens.has(variant)));
    if (!matchedTokens.length) {
      continue;
    }

    const variantHits = tokens.flatMap((token) => tokenVariants(token).filter((variant) => nameTokens.has(variant)));
    let hitScore = matchedTokens.length * 9 + Math.max(0, variantHits.length - matchedTokens.length) * 9;
    if (symbol.type === "method" && matchedTokens.length >= 2) {
      hitScore += matchedTokens.length * 12;
    }
    if (symbol.type === "method" && matchedTokens.length >= 3) {
      hitScore += 24;
    }

    if (matchedTokens.length >= 2 || variantHits.length >= 2) {
      strongScore += hitScore;
    } else {
      for (const token of matchedTokens) {
        weakByToken.set(token, Math.max(weakByToken.get(token) ?? 0, hitScore));
      }
    }
    matches.push({
      type: symbol.type,
      name: symbol.name,
      line: symbol.line,
      matchedTokens,
      score: hitScore,
    });
  }

  matches.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return {
    score: Math.min(
      strongScore +
        Math.min(
          [...weakByToken.values()].reduce((sum, value) => sum + value, 0),
          36,
        ),
      180,
    ),
    matches: matches.slice(0, 8),
    reasons: matches.length ? ["symbol"] : [],
  };
}

/**
 * Keep primary packs useful across domains instead of filling the budget with
 * one controller-heavy domain (e.g. booking) when the task spans email too.
 * @param {ScoredFile[]} files
 * @param {number} limit
 * @param {number} maxPerDomain
 * @returns {ScoredFile[]}
 */
function diversifyByDomain(files, limit, maxPerDomain = 3) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {ScoredFile[]} */
  const picked = [];

  for (const file of files) {
    const domain = file.domain || "unknown";
    const count = counts.get(domain) ?? 0;
    if (count >= maxPerDomain) {
      continue;
    }
    counts.set(domain, count + 1);
    picked.push(file);
    if (picked.length >= limit) {
      return picked;
    }
  }

  if (picked.length >= limit) {
    return picked;
  }

  for (const file of files) {
    if (picked.some((item) => fileKey(item) === fileKey(file))) {
      continue;
    }
    picked.push(file);
    if (picked.length >= limit) {
      break;
    }
  }

  return picked;
}

/**
 * @param {ScoredFile[]} scoredFiles
 * @param {ScoredFile[]} primaryFiles
 * @param {ScoredFile[]} relatedFiles
 * @param {string[]} tokens
 */
function buildHotspots(scoredFiles, primaryFiles, relatedFiles, tokens) {
  const focusKeys = new Set([...primaryFiles, ...relatedFiles].map(fileKey));
  /** @type {Array<{ repo: string, path: string, kind: string, domain: string, symbol: string, type: string, line?: number, matchedTokens: string[], score: number, rank: number }>} */
  const hotspots = [];

  for (const file of scoredFiles) {
    if (!focusKeys.has(fileKey(file)) || !file.matchedSymbols?.length) {
      continue;
    }
    for (const match of file.matchedSymbols) {
      const topPrimary = primaryFiles.slice(0, 2).some((primary) => fileKey(primary) === fileKey(file));
      if (match.matchedTokens.length < 2 && !tokens.some((token) => token === normalizeText(file.domain)) && !topPrimary) {
        continue;
      }
      hotspots.push({
        repo: file.repo.name,
        path: file.path,
        kind: file.kind,
        domain: file.domain,
        symbol: match.name,
        type: match.type,
        line: match.line,
        matchedTokens: match.matchedTokens,
        score: match.score,
        rank: match.score + (topPrimary ? 12 : 0),
      });
    }
  }

  return hotspots
    .sort((a, b) => b.rank - a.rank || a.path.localeCompare(b.path) || a.symbol.localeCompare(b.symbol))
    .slice(0, 10)
    .map(({ rank: _rank, ...hotspot }) => hotspot);
}

/**
 * @param {Array<{ repo: string, path: string, symbol: string, type: string, line?: number, matchedTokens: string[], score: number }>|undefined} hotspots
 * @returns {string[]}
 */
function formatHotspots(hotspots) {
  if (!hotspots?.length) {
    return ["- No multi-token symbol hotspots matched; start with primary files."];
  }

  return hotspots.map((item) => {
    const line = item.line ? `:${item.line}` : "";
    return `- \`${item.repo}:${item.path}${line}\` \`${item.type} ${item.symbol}\` (tokens: ${item.matchedTokens.join(", ")}; score ${item.score})`;
  });
}

/**
 * @param {ScoredFile[]} scoredFiles
 * @param {number} limit
 * @returns {ScoredFile[]}
 */
function selectPrimaryFiles(scoredFiles, limit) {
  const files = uniqueFiles(scoredFiles.filter((file) => file.kind !== "test"));
  const strong = files.filter((file) => file.score >= 25);
  const pool = strong.length ? strong : files.slice(0, Math.min(limit, 3));
  return diversifyByDomain(pool, limit, 2);
}

const fallbackEntryStems = new Map([
  ["main", 24],
  ["app", 20],
  ["index", 18],
  ["server", 16],
]);
const fallbackConfigPattern = /^(?:vite|webpack|rollup|next|nuxt|astro|svelte|remix|metro|babel|postcss|tailwind|esbuild|rsbuild)\.config\.[a-z]+$/;

// When task tokens match nothing (common on small repos or broad queries such
// as "improve SEO and performance"), fall back to a deterministic ranking of
// entrypoints, app/main/index files, and build configuration so primaryFiles
// is never empty while the repo has source files.
/**
 * @param {CodeMap[]} maps
 * @param {number} limit
 * @returns {ScoredFile[]}
 */
function selectFallbackPrimaryFiles(maps, limit) {
  /** @type {ScoredFile[]} */
  const candidates = [];
  /** @type {ScoredFile[]} */
  const everything = [];

  for (const map of maps) {
    const entrypoints = new Set(map.repo.entrypoints ?? []);
    for (const file of map.files ?? []) {
      if (file.isVendor || file.kind === "test") {
        continue;
      }

      const reasons = ["fallback: no task keywords matched indexed files"];
      let score = 0;
      const normalizedPath = normalizeRepoPath(file.path);
      const baseName = path.posix.basename(normalizedPath).toLowerCase();
      const stem = baseName.replace(/\..*$/, "");

      if (entrypoints.has(file.path)) {
        score += 30;
        reasons.push("repo entrypoint");
      }
      if (fallbackEntryStems.has(stem)) {
        score += fallbackEntryStems.get(stem) ?? 0;
        reasons.push(`${stem} entry file`);
      }
      if (fallbackConfigPattern.test(baseName)) {
        score += 14;
        reasons.push("build configuration");
      }

      const depth = normalizedPath.split("/").length - 1;
      score += Math.max(0, 6 - depth * 2);

      const summarized = summarizeFile(map, file, score, reasons);
      everything.push(summarized);
      if (score > 0) {
        candidates.push(summarized);
      }
    }
  }

  const pool = candidates.length ? candidates : everything;
  return uniqueFiles(pool)
    .sort((a, b) => b.score - a.score || a.repo.name.localeCompare(b.repo.name) || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/**
 * @param {CodeMap[]} maps
 * @param {Map<string, ImportGraph>} graphs
 * @param {ScoredFile[]} scoredFiles
 * @param {ScoredFile[]} primaryFiles
 * @param {Intent} intent
 * @param {number} limit
 * @returns {ScoredFile[]}
 */
function selectRelatedFiles(maps, graphs, scoredFiles, primaryFiles, intent, limit) {
  const primaryKeys = new Set(primaryFiles.map(fileKey));
  /** @type {ScoredFile[]} */
  const related = [];
  const primaryByRepo = groupByRepo(primaryFiles);

  for (const map of maps) {
    // graphs is built from the same `maps` in generateContextPack, so every
    // repo.root key is present; assert non-null rather than guarding (which
    // would change runtime behavior).
    const graph = /** @type {ImportGraph} */ (graphs.get(map.repo.root));
    const filesByPath = new Map((map.files ?? []).map((file) => [file.path, file]));
    const repoPrimary = primaryByRepo.get(map.repo.root) ?? [];

    for (const primary of repoPrimary) {
      for (const imported of graph.importsByPath.get(primary.path) ?? []) {
        addRelated(related, map, filesByPath.get(imported), 18, "imported by primary file", primaryKeys);
      }
      for (const importer of graph.importedByPath.get(primary.path) ?? []) {
        addRelated(related, map, filesByPath.get(importer), 18, "imports primary file", primaryKeys);
      }
      for (const sibling of samePatternFiles(map.files, primary)) {
        addRelated(related, map, sibling, 10, "same kind/domain pattern", primaryKeys);
      }
    }

    for (const file of map.files ?? []) {
      if (intent.hints.includes("cli") && isCliEntrypoint(map, file)) {
        addRelated(related, map, file, 14, "cli entrypoint", primaryKeys);
      }
      if (intent.hints.includes("tool") && normalizeText(file.path).includes("agent tools")) {
        addRelated(related, map, file, 14, "agent tool metadata", primaryKeys);
      }
    }
  }

  return uniqueFiles([...related, ...scoredFiles.filter((file) => file.kind !== "test" && !primaryKeys.has(fileKey(file)))])
    .sort((a, b) => b.score - a.score || a.repo.name.localeCompare(b.repo.name) || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/**
 * @param {CodeMap[]} maps
 * @param {Map<string, ImportGraph>} graphs
 * @param {ScoredFile[]} scoredFiles
 * @param {ScoredFile[]} primaryFiles
 * @param {number} limit
 * @returns {ScoredFile[]}
 */
function selectTests(maps, graphs, scoredFiles, primaryFiles, limit) {
  /** @type {ScoredFile[]} */
  const selected = [];
  const contextFiles = primaryFiles;
  const contextKeys = new Set(contextFiles.map(fileKey));
  const contextDomains = new Set(contextFiles.map((file) => file.domain).filter(Boolean));

  for (const file of scoredFiles.filter((item) => item.kind === "test")) {
    selected.push(file);
  }

  for (const map of maps) {
    // See selectRelatedFiles: graphs always contains this repo.root.
    const graph = /** @type {ImportGraph} */ (graphs.get(map.repo.root));
    for (const file of map.files?.filter((entry) => entry.kind === "test") ?? []) {
      const imports = graph.importsByPath.get(file.path) ?? new Set();
      const importsContext = [...imports].some((target) => contextKeys.has(`${map.repo.root}:${target}`));
      const matchesDomain =
        contextDomains.has(file.domain) || [...contextDomains].some((domain) => file.path.toLowerCase().includes(String(domain).toLowerCase()));
      if (importsContext || matchesDomain) {
        selected.push(summarizeFile(map, file, importsContext ? 16 : 8, [importsContext ? "imports selected file" : "matches selected domain", "test"]));
      }
    }
  }

  return uniqueFiles(selected)
    .sort((a, b) => b.score - a.score || a.repo.name.localeCompare(b.repo.name) || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/**
 * @param {ScoredFile[]} related
 * @param {CodeMap} map
 * @param {CodeMapFile|undefined} file
 * @param {number} score
 * @param {string} reason
 * @param {Set<string>} primaryKeys
 */
function addRelated(related, map, file, score, reason, primaryKeys) {
  if (!file || file.kind === "test") {
    return;
  }
  const summarized = summarizeFile(map, file, score, [reason]);
  if (!primaryKeys.has(fileKey(summarized))) {
    related.push(summarized);
  }
}

/**
 * `primary` is always supplied by callers; it is typed optional only because the
 * `files = []` default makes the leading parameter optional, and TS forbids a
 * required parameter after an optional one (TS1016). No runtime contract change.
 * @param {CodeMapFile[]} [files]
 * @param {CodeMapFile|ScoredFile} [primary]
 * @returns {CodeMapFile[]}
 */
function samePatternFiles(files = [], primary) {
  const ref = /** @type {CodeMapFile|ScoredFile} */ (primary);
  return files.filter((file) => file.path !== ref.path && file.kind === ref.kind && file.domain === ref.domain && file.kind !== "source").slice(0, 3);
}

/**
 * @param {string[]} repoPaths
 * @param {string} query
 * @returns {EngineCommand[]}
 */
function inferCommands(repoPaths, query) {
  /** @type {EngineCommand[]} */
  const commands = [];
  for (const repoPath of repoPaths) {
    const harness = generateHarness(repoPath).data;
    commands.push(
      .../** @type {EngineCommand[]} */ (harness.commands.validate).map((command) => ({
        ...command,
        repo: harness.repo.name,
      })),
    );
    commands.push({
      repo: harness.repo.name,
      command: `otito context ${JSON.stringify(query)} --path ${JSON.stringify(harness.repo.root)} --json`,
      reason: "refresh this context packet before planning or review",
    });
  }
  return uniqueCommands(commands);
}

/**
 * @param {ScoredFile[]} primaryFiles
 * @param {ScoredFile[]} relatedFiles
 * @param {ScoredFile[]} tests
 * @param {Intent} intent
 * @returns {string[]}
 */
function inferPatterns(primaryFiles, relatedFiles, tests, intent) {
  const files = [...primaryFiles, ...relatedFiles];
  /** @type {string[]} */
  const patterns = [];
  const byKind = countBy(files, (file) => file.kind);

  for (const [kind, count] of byKind) {
    if (kind && kind !== "source") {
      patterns.push(`Selected context includes ${count} ${kind} file(s); follow nearby files of the same kind before inventing a new structure.`);
    }
  }

  if (files.some((file) => file.path.endsWith("src/lib/mcp.js") || file.path.endsWith("lib/mcp.js"))) {
    patterns.push("MCP tool changes should update the tool list, input schema, dispatcher, and MCP tests together.");
  }
  if (files.some((file) => file.path.endsWith("src/cli.js") || file.path.endsWith("/cli.js"))) {
    patterns.push("CLI command changes should register the command, add a handler, and update help output in the same change.");
  }
  if (files.some((file) => file.path.includes("agent-tools"))) {
    patterns.push("Agent-facing tool metadata should stay aligned with the CLI and MCP surfaces.");
  }
  if (tests.length) {
    patterns.push("Matching tests were found; update them with the behavior change and run the listed validation command.");
  }
  if (intent.hints.includes("api") && files.some((file) => ["controller", "apiClient", "apiRoute"].includes(file.kind))) {
    patterns.push("API work should keep route/controller/client contracts in sync across selected files.");
  }

  return [...new Set(patterns)];
}

/**
 * @param {CodeMap[]} maps
 * @returns {string[]}
 */
function inferConflicts(maps) {
  /** @type {string[]} */
  const conflicts = [];
  for (const map of maps) {
    const git = /** @type {{ available?: boolean, clean?: boolean, changes?: number }} */ (map.repo.git);
    if (git?.available && !git.clean) {
      conflicts.push(`${map.repo.name} has ${git.changes} uncommitted git change(s); inspect the working tree before editing.`);
    }
  }
  return conflicts;
}

/**
 * @param {ScoredFile[]} primaryFiles
 * @param {EngineCommand[]} commands
 * @param {Intent} intent
 * @param {boolean} usedFallback
 * @param {Array<{ path: string }>|undefined} [hotspots]
 * @returns {string[]}
 */
function inferOpenQuestions(primaryFiles, commands, intent, usedFallback, hotspots = []) {
  /** @type {string[]} */
  const questions = [];
  if (!primaryFiles.length) {
    questions.push("No strong primary files matched the task; refine the query or index more repositories.");
  } else if (usedFallback) {
    questions.push(
      "No task keywords matched indexed files; primary files fall back to repo entrypoints and build configuration — refine the query for tighter context.",
    );
  }
  if (!commands.some((command) => command.script && /test|lint|type|build|tsc/.test(command.script))) {
    questions.push("No validation script was detected; decide how the change should be verified.");
  }
  if (intent.action === "unknown") {
    questions.push("The requested action is ambiguous; clarify whether this is implementation, review, debugging, or exploration.");
  }
  if (!hotspots.length && primaryFiles.length && !usedFallback) {
    questions.push("No multi-token symbol hotspots matched; confirm the exact methods or types to change.");
  }
  const primaryDomains = new Set(primaryFiles.map((file) => normalizeText(file.domain || "")).filter(Boolean));
  for (const topic of intent.topics) {
    if (
      ["email", "branding", "payment", "fees", "booking", "organisation", "organization", "auth"].includes(topic) &&
      ![...primaryDomains].some((domain) => domain.includes(topic) || topic.includes(domain))
    ) {
      questions.push(`Query topic "${topic}" is not represented in primary file domains; consider narrowing path or re-indexing.`);
    }
  }
  return questions.slice(0, 6);
}

/**
 * @param {CodeMap[]} maps
 * @param {EngineCommand[]} commands
 */
function inferSources(maps, commands) {
  return [
    ...maps.map((map) => ({
      type: "code-map",
      repo: map.repo.name,
      path: map.cache?.path,
      cacheHit: Boolean(map.cache?.hit),
      fingerprint: map.cache?.fingerprint,
    })),
    ...uniqueBy(
      commands.filter((command) => command.repo),
      (command) => command.repo ?? "",
    ).map((command) => ({
      type: "harness",
      repo: command.repo,
      command: "otito harness <path> --json",
    })),
  ];
}

/**
 * @param {string} query
 * @param {string[]} tokens
 * @returns {Intent}
 */
function inferIntent(query, tokens) {
  const normalized = normalizeText(query);
  const action = tokens.find((token) => actionWords.has(token)) ?? "unknown";
  /** @type {string[]} */
  const hints = [];
  if (normalized.includes("mcp")) hints.push("mcp", "tool");
  if (normalized.includes("cli") || normalized.includes("command")) hints.push("cli");
  if (normalized.includes("tool") || normalized.includes("agent")) hints.push("tool");
  if (normalized.includes("api") || normalized.includes("route") || normalized.includes("integration") || normalized.includes("client")) hints.push("api");
  if (normalized.includes("test") || normalized.includes("verify")) hints.push("test");
  if (/\b(configure|configuration|setting|settings|organiser|organizer)\b/.test(normalized)) hints.push("configuration");
  if (/\b(private|privacy|hide|hidden|visibility|confidential)\b/.test(normalized)) hints.push("privacy");
  const hasSignup = tokens.some((token) => ["signup", "register", "registration"].includes(token));
  const hasVerification = tokens.some((token) => ["verification", "verify", "verified", "validate", "otp"].includes(token));
  if (hasSignup && hasVerification) hints.push("auth-flow");

  return {
    action,
    topics: tokens.filter((token) => !actionWords.has(token)).slice(0, 8),
    hints: [...new Set(hints)],
  };
}

/**
 * @param {string} query
 * @param {ScoredFile[]} primaryFiles
 * @param {ScoredFile[]} relatedFiles
 * @param {ScoredFile[]} tests
 * @param {EngineCommand[]} commands
 * @param {Array<{ repo: string, path: string, symbol: string, type: string, line?: number }>|undefined} [hotspots]
 * @returns {string}
 */
function formatAgentPrompt(query, primaryFiles, relatedFiles, tests, commands, hotspots = []) {
  const hotspotList =
    hotspots
      .slice(0, 6)
      .map((item) => `${item.repo}:${item.path}${item.line ? `:${item.line}` : ""}#${item.symbol}`)
      .join(", ") || "none";
  const fileList =
    [...primaryFiles, ...relatedFiles]
      .slice(0, 12)
      .map((file) => `${file.repo.name}:${file.path}`)
      .join(", ") || "none";
  const testList =
    tests
      .slice(0, 8)
      .map((file) => `${file.repo.name}:${file.path}`)
      .join(", ") || "none";
  const validation =
    commands
      .filter((command) => command.script)
      .slice(0, 5)
      .map((command) => command.command)
      .join(", ") || "none detected";
  return [
    `Task: ${query}`,
    `Start at these hotspots: ${hotspotList}.`,
    `Read these files first: ${fileList}.`,
    `Check these tests: ${testList}.`,
    `Use the selected patterns before adding new structure.`,
    `Verify with: ${validation}.`,
  ].join("\n");
}

/**
 * @param {CodeMapFile[]} [files]
 * @returns {ImportGraph}
 */
function buildImportGraph(files = []) {
  const fileSet = new Set(files.map((file) => file.path));
  /** @type {Map<string, Set<string>>} */
  const importsByPath = new Map();
  /** @type {Map<string, Set<string>>} */
  const importedByPath = new Map();

  for (const file of files) {
    /** @type {Set<string>} */
    const imports = new Set();
    for (const specifier of file.imports ?? []) {
      const resolved = resolveImport(file.path, specifier, fileSet);
      if (!resolved) {
        continue;
      }
      imports.add(resolved);
      const importers = importedByPath.get(resolved) ?? new Set();
      importers.add(file.path);
      importedByPath.set(resolved, importers);
    }
    importsByPath.set(file.path, imports);
  }

  return { importsByPath, importedByPath };
}

/**
 * @param {string} fromPath
 * @param {string} specifier
 * @param {Set<string>} fileSet
 * @returns {string|undefined}
 */
function resolveImport(fromPath, specifier, fileSet) {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const base = normalizeRepoPath(path.posix.join(path.posix.dirname(fromPath), specifier));
  for (const extension of importExtensions) {
    const candidate = normalizeRepoPath(`${base}${extension}`);
    if (fileSet.has(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * @param {CodeMap} map
 */
function summarizeRepo(map) {
  return {
    root: map.repo.root,
    name: map.repo.name,
    package: map.repo.package,
    git: map.repo.git,
    sourceFileCount: map.repo.sourceFileCount,
    summary: map.summary,
    domains: map.domains.slice(0, 12),
  };
}

/**
 * @param {CodeMap} map
 * @param {CodeMapFile} file
 * @param {number} score
 * @param {string[]} reasons
 * @returns {ScoredFile}
 */
function summarizeFile(map, file, score, reasons) {
  return {
    repo: {
      name: map.repo.name,
      root: map.repo.root,
    },
    path: file.path,
    kind: file.kind,
    domain: file.domain,
    score,
    reasons: [...new Set(reasons)].filter(Boolean).slice(0, 8),
    route: file.route,
    controllerBasePath: file.controllerBasePath,
    httpMethods: file.httpMethods ?? [],
    imports: file.imports?.slice(0, 12) ?? [],
    exports: file.exports?.slice(0, 12) ?? [],
    symbols: file.symbols?.slice(0, 16) ?? [],
  };
}

// imports/exports/symbols are the bulk of a file entry's bytes and are only
// useful when an agent wants the evidence trail. They are dropped by default
// (includeEvidence:false) so the packet stays compact; path/kind/score/reasons
// and routing fields are always kept.
const evidenceFields = ["imports", "exports", "symbols", "matchedSymbols"];

/**
 * @param {ScoredFile[]} files
 * @param {boolean} includeEvidence
 * @returns {ScoredFile[]}
 */
function stripEvidence(files, includeEvidence) {
  if (includeEvidence) {
    return files;
  }
  return files.map((file) => {
    /** @type {Record<string, any>} */
    const rest = { ...file };
    for (const field of evidenceFields) {
      delete rest[field];
    }
    return /** @type {ScoredFile} */ (rest);
  });
}

/**
 * @param {string|null|undefined} value
 * @param {string[]} tokens
 * @param {number} weight
 * @param {string} reason
 * @param {string[]} reasons
 * @returns {number}
 */
function scoreField(value, tokens, weight, reason, reasons) {
  if (!value) {
    return 0;
  }

  const normalized = normalizeText(String(value));
  const normalizedTokens = new Set(tokenize(String(value)));
  let score = 0;
  for (const token of tokens) {
    const variants = tokenVariants(token);
    if (variants.some((variant) => normalized === variant)) {
      score += weight * 2;
    } else if (variants.some((variant) => normalizedTokens.has(variant) || normalized.includes(variant))) {
      score += weight;
    }
  }

  if (score > 0) {
    reasons.push(reason);
  }
  return score;
}

/**
 * Score a set of imports or exports once per query concept rather than once
 * per matching declaration. This stops a broad barrel such as `types/index`
 * from winning solely because it repeats a word like `event` many times.
 *
 * @param {string[]} values
 * @param {string[]} tokens
 * @param {number} weight
 * @param {string} reason
 * @param {string[]} reasons
 * @param {number} cap
 */
function scoreCollection(values, tokens, weight, reason, reasons, cap) {
  /** @type {Map<string, number>} */
  const scoreByToken = new Map();
  for (const value of values) {
    const normalized = normalizeText(value);
    const normalizedTokens = new Set(tokenize(value));
    for (const token of tokens) {
      const variants = tokenVariants(token);
      const hit = variants.some((variant) => normalized === variant)
        ? weight * 2
        : variants.some((variant) => normalizedTokens.has(variant) || normalized.includes(variant))
          ? weight
          : 0;
      if (hit > 0) {
        scoreByToken.set(token, Math.max(scoreByToken.get(token) ?? 0, hit));
      }
    }
  }
  const score = Math.min(
    [...scoreByToken.values()].reduce((sum, value) => sum + value, 0),
    cap,
  );
  if (score > 0) {
    reasons.push(reason);
  }
  return score;
}

/**
 * @param {ScoredFile[]} files
 * @param {string} fallback
 * @returns {string[]}
 */
function formatFiles(files, fallback) {
  if (!files.length) {
    return [`- ${fallback}`];
  }

  return files.map((file) => {
    const reasons = file.reasons.length ? `; ${file.reasons.join(", ")}` : "";
    return `- \`${file.repo.name}:${file.path}\` (${file.kind}/${file.domain}, score ${file.score}${reasons})`;
  });
}

/**
 * @param {ScoredFile[]} files
 * @returns {Map<string, ScoredFile[]>}
 */
function groupByRepo(files) {
  /** @type {Map<string, ScoredFile[]>} */
  const grouped = new Map();
  for (const file of files) {
    const values = grouped.get(file.repo.root) ?? [];
    values.push(file);
    grouped.set(file.repo.root, values);
  }
  return grouped;
}

/**
 * @param {CodeMap} map
 * @param {CodeMapFile} file
 * @returns {boolean|undefined}
 */
function isCliEntrypoint(map, file) {
  return map.repo.entrypoints?.includes(file.path) || file.path === "src/cli.js" || file.path.endsWith("/cli.js");
}

/**
 * @param {ScoredFile[]} files
 * @returns {ScoredFile[]}
 */
function uniqueFiles(files) {
  return uniqueBy(files, fileKey);
}

/**
 * @param {EngineCommand[]} commands
 * @returns {EngineCommand[]}
 */
function uniqueCommands(commands) {
  return uniqueBy(commands, (command) => `${command.repo}:${command.command}`);
}

/**
 * @template T
 * @param {T[]} values
 * @param {(value: T) => string} keyForValue
 * @returns {T[]}
 */
function uniqueBy(values, keyForValue) {
  const seen = new Set();
  /** @type {T[]} */
  const result = [];
  for (const value of values) {
    const key = keyForValue(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

/**
 * @param {ScoredFile|CodeMapFile & { repo: { root: string } }} file
 * @returns {string}
 */
function fileKey(file) {
  return `${file.repo.root}:${file.path}`;
}

/**
 * @template T
 * @param {T[]} values
 * @param {(value: T) => string} keyForValue
 * @returns {Map<string, number>}
 */
function countBy(values, keyForValue) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const value of values) {
    const key = keyForValue(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

/**
 * Lightweight plural / British spelling variants so query tokens like
 * "emails" still hit symbols named `...Email` / `organisation` ↔ `organization`.
 * @param {string} token
 * @returns {string[]}
 */
function tokenVariants(token) {
  /** @type {Set<string>} */
  const variants = new Set([token]);
  if (token.endsWith("ies") && token.length > 4) {
    variants.add(`${token.slice(0, -3)}y`);
  }
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) {
    variants.add(token.slice(0, -1));
  }
  if (token === "organisation") {
    variants.add("organization");
  }
  if (token === "organization") {
    variants.add("organisation");
  }
  if (token === "branding") {
    variants.add("brand");
  }
  if (token === "signup") {
    variants.add("register");
    variants.add("registration");
  }
  if (token === "verification") {
    variants.add("verify");
    variants.add("verified");
    variants.add("validate");
    variants.add("otp");
  }
  if (token === "qr") {
    variants.add("scan");
    variants.add("ticket");
  }
  if (token === "check" || token === "checkin") {
    variants.add("scan");
  }
  if (token === "venue") {
    variants.add("address");
    variants.add("location");
  }
  if (token === "private" || token === "privacy") {
    variants.add("hide");
    variants.add("hidden");
    variants.add("visibility");
  }
  return [...variants];
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeText(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * @param {string[]} paths
 * @returns {string[]}
 */
function normalizePaths(paths) {
  const values = Array.isArray(paths) && paths.length ? paths : ["."];
  return [...new Set(values.map((value) => path.resolve(String(value || "."))))];
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeRepoPath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} max
 * @returns {number}
 */
function normalizeLimit(value, fallback, max) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), max);
}
