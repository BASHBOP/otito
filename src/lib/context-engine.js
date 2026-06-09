import path from "node:path";
import { generateHarness } from "./harness.js";
import { getCachedCodeMap } from "./index-cache.js";
import { estimateTokens, estimateTokenSections } from "./tokens.js";

const contextEngineVersion = 1;
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
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
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
]);

const actionWords = new Set(["add", "build", "change", "create", "debug", "fix", "implement", "refactor", "review", "test", "update"]);
const importExtensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

export function generateContextPack(query, options = {}) {
  const normalizedQuery = String(query ?? "").trim();
  if (!normalizedQuery) {
    throw new Error("context requires a non-empty query");
  }

  const limit = normalizeLimit(options.limit, defaultLimit, 50);
  const repoPaths = normalizePaths(options.paths ?? [options.path ?? "."]);
  const maps = repoPaths.map((repoPath) => getCachedCodeMap(repoPath));
  const graphs = new Map(maps.map((map) => [map.repo.root, buildImportGraph(map.files)]));
  const tokens = tokenize(normalizedQuery);
  const intent = inferIntent(normalizedQuery, tokens);
  const scoredFiles = scoreMaps(maps, tokens, intent);
  const matchedPrimaryFiles = selectPrimaryFiles(scoredFiles, limit);
  const usedFallback = matchedPrimaryFiles.length === 0;
  const primaryFiles = usedFallback ? selectFallbackPrimaryFiles(maps, limit) : matchedPrimaryFiles;
  const relatedFiles = selectRelatedFiles(maps, graphs, scoredFiles, primaryFiles, intent, limit);
  const tests = selectTests(maps, graphs, scoredFiles, primaryFiles, limit);
  const commands = inferCommands(repoPaths, normalizedQuery);
  const patterns = inferPatterns(primaryFiles, relatedFiles, tests, intent);
  const conflicts = inferConflicts(maps);
  const openQuestions = inferOpenQuestions(primaryFiles, commands, intent, usedFallback);
  const sources = inferSources(maps, commands);

  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    contextEngineVersion,
    query: normalizedQuery,
    intent,
    repos: maps.map(summarizeRepo),
    primaryFiles,
    relatedFiles,
    tests,
    patterns,
    commands,
    conflicts,
    openQuestions,
    sources,
    agentPrompt: formatAgentPrompt(normalizedQuery, primaryFiles, relatedFiles, tests, commands),
  };

  data.tokenEstimate = {
    ...estimateTokenSections([
      { name: "intent", value: data.intent },
      { name: "repos", value: data.repos },
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
    ...data.repos.map((repo) => `- ${repo.name}: ${repo.root} (${repo.sourceFileCount} source file(s))`),
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
    ...(data.patterns.length ? data.patterns.map((item) => `- ${item}`) : ["- none inferred"]),
    "",
    "## Commands",
    "",
    ...(data.commands.length ? data.commands.map((item) => `- \`${item.command}\`: ${item.reason}`) : ["- none inferred"]),
    "",
    "## Conflicts",
    "",
    ...(data.conflicts.length ? data.conflicts.map((item) => `- ${item}`) : ["- none detected"]),
    "",
    "## Open Questions",
    "",
    ...(data.openQuestions.length ? data.openQuestions.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## Agent Prompt",
    "",
    data.agentPrompt,
    "",
  ];
  return lines.join("\n");
}

function scoreMaps(maps, tokens, intent) {
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

function scoreFile(map, file, tokens, intent) {
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

  for (const method of file.httpMethods ?? []) {
    score += scoreField(`${method.method} ${method.path}`, tokens, 7, "http", reasons);
  }
  for (const value of file.imports ?? []) {
    score += scoreField(value, tokens, 3, "import", reasons);
  }
  for (const value of file.exports ?? []) {
    score += scoreField(value, tokens, 8, "export", reasons);
  }
  for (const symbol of file.symbols ?? []) {
    score += scoreField(`${symbol.type} ${symbol.name}`, tokens, 9, "symbol", reasons);
  }

  if ((file.dataAccess?.length ?? 0) > 0) {
    score += Math.min(15, 3 + file.dataAccess.length);
    reasons.push("data access");
  }

  score += scoreIntentHints(file, intent, reasons);

  if (file.kind === "test" && score > 0) {
    score = Math.max(1, Math.floor(score * 0.7));
    reasons.push("test");
  }

  return summarizeFile(map, file, score, reasons);
}

function scoreIntentHints(file, intent, reasons) {
  const ownText = normalizeText(`${file.path} ${file.kind} ${file.domain} ${file.exports?.join(" ")} ${file.symbols?.map((symbol) => symbol.name).join(" ")}`);
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
  }

  return score;
}

function selectPrimaryFiles(scoredFiles, limit) {
  const files = uniqueFiles(scoredFiles.filter((file) => file.kind !== "test"));
  const strong = files.filter((file) => file.score >= 25);
  return (strong.length ? strong : files.slice(0, Math.min(limit, 3))).slice(0, limit);
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
function selectFallbackPrimaryFiles(maps, limit) {
  const candidates = [];
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
        score += fallbackEntryStems.get(stem);
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

function selectRelatedFiles(maps, graphs, scoredFiles, primaryFiles, intent, limit) {
  const primaryKeys = new Set(primaryFiles.map(fileKey));
  const related = [];
  const primaryByRepo = groupByRepo(primaryFiles);

  for (const map of maps) {
    const graph = graphs.get(map.repo.root);
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

function selectTests(maps, graphs, scoredFiles, primaryFiles, limit) {
  const selected = [];
  const contextFiles = primaryFiles;
  const contextKeys = new Set(contextFiles.map(fileKey));
  const contextDomains = new Set(contextFiles.map((file) => file.domain).filter(Boolean));

  for (const file of scoredFiles.filter((item) => item.kind === "test")) {
    selected.push(file);
  }

  for (const map of maps) {
    const graph = graphs.get(map.repo.root);
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

function addRelated(related, map, file, score, reason, primaryKeys) {
  if (!file || file.kind === "test") {
    return;
  }
  const summarized = summarizeFile(map, file, score, [reason]);
  if (!primaryKeys.has(fileKey(summarized))) {
    related.push(summarized);
  }
}

function samePatternFiles(files = [], primary) {
  return files
    .filter((file) => file.path !== primary.path && file.kind === primary.kind && file.domain === primary.domain && file.kind !== "source")
    .slice(0, 3);
}

function inferCommands(repoPaths, query) {
  const commands = [];
  for (const repoPath of repoPaths) {
    const harness = generateHarness(repoPath).data;
    commands.push(
      ...harness.commands.validate.map((command) => ({
        ...command,
        repo: harness.repo.name,
      })),
    );
    commands.push({
      repo: harness.repo.name,
      command: `repoctx context ${JSON.stringify(query)} --path ${JSON.stringify(harness.repo.root)} --json`,
      reason: "refresh this context packet before planning or review",
    });
  }
  return uniqueCommands(commands);
}

function inferPatterns(primaryFiles, relatedFiles, tests, intent) {
  const files = [...primaryFiles, ...relatedFiles];
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

function inferConflicts(maps) {
  const conflicts = [];
  for (const map of maps) {
    if (map.repo.git?.available && !map.repo.git.clean) {
      conflicts.push(`${map.repo.name} has ${map.repo.git.changes} uncommitted git change(s); inspect the working tree before editing.`);
    }
  }
  return conflicts;
}

function inferOpenQuestions(primaryFiles, commands, intent, usedFallback) {
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
  return questions;
}

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
      (command) => command.repo,
    ).map((command) => ({
      type: "harness",
      repo: command.repo,
      command: "repoctx harness <path> --json",
    })),
  ];
}

function inferIntent(query, tokens) {
  const normalized = normalizeText(query);
  const action = tokens.find((token) => actionWords.has(token)) ?? "unknown";
  const hints = [];
  if (normalized.includes("mcp")) hints.push("mcp", "tool");
  if (normalized.includes("cli") || normalized.includes("command")) hints.push("cli");
  if (normalized.includes("tool") || normalized.includes("agent")) hints.push("tool");
  if (normalized.includes("api") || normalized.includes("route") || normalized.includes("integration") || normalized.includes("client")) hints.push("api");
  if (normalized.includes("test") || normalized.includes("verify")) hints.push("test");

  return {
    action,
    topics: tokens.filter((token) => !actionWords.has(token)).slice(0, 8),
    hints: [...new Set(hints)],
  };
}

function formatAgentPrompt(query, primaryFiles, relatedFiles, tests, commands) {
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
    `Read these files first: ${fileList}.`,
    `Check these tests: ${testList}.`,
    `Use the selected patterns before adding new structure.`,
    `Verify with: ${validation}.`,
  ].join("\n");
}

function buildImportGraph(files = []) {
  const fileSet = new Set(files.map((file) => file.path));
  const importsByPath = new Map();
  const importedByPath = new Map();

  for (const file of files) {
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

function scoreField(value, tokens, weight, reason, reasons) {
  if (!value) {
    return 0;
  }

  const normalized = normalizeText(String(value));
  let score = 0;
  for (const token of tokens) {
    if (normalized === token) {
      score += weight * 2;
    } else if (normalized.includes(token)) {
      score += weight;
    }
  }

  if (score > 0) {
    reasons.push(reason);
  }
  return score;
}

function formatFiles(files, fallback) {
  if (!files.length) {
    return [`- ${fallback}`];
  }

  return files.map((file) => {
    const reasons = file.reasons.length ? `; ${file.reasons.join(", ")}` : "";
    return `- \`${file.repo.name}:${file.path}\` (${file.kind}/${file.domain}, score ${file.score}${reasons})`;
  });
}

function groupByRepo(files) {
  const grouped = new Map();
  for (const file of files) {
    const values = grouped.get(file.repo.root) ?? [];
    values.push(file);
    grouped.set(file.repo.root, values);
  }
  return grouped;
}

function isCliEntrypoint(map, file) {
  return map.repo.entrypoints?.includes(file.path) || file.path === "src/cli.js" || file.path.endsWith("/cli.js");
}

function uniqueFiles(files) {
  return uniqueBy(files, fileKey);
}

function uniqueCommands(commands) {
  return uniqueBy(commands, (command) => `${command.repo}:${command.command}`);
}

function uniqueBy(values, keyForValue) {
  const seen = new Set();
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

function fileKey(file) {
  return `${file.repo.root}:${file.path}`;
}

function countBy(values, keyForValue) {
  const counts = new Map();
  for (const value of values) {
    const key = keyForValue(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function tokenize(value) {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !stopWords.has(token));
}

function normalizeText(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizePaths(paths) {
  const values = Array.isArray(paths) && paths.length ? paths : ["."];
  return [...new Set(values.map((value) => path.resolve(String(value || "."))))];
}

function normalizeRepoPath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function normalizeLimit(value, fallback, max) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), max);
}
