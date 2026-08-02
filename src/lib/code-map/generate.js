import fs from "node:fs";
import path from "node:path";
import { inspectRepo, listRepoFiles } from "../repo.js";
import { estimateTokens, estimateTokenSections } from "../tokens.js";
import { extractAstFacts } from "./ast.js";
import { classifyFile, extractHttpMethods, inferControllerBasePath, inferDomainInfo, inferNextRoute } from "./classify.js";
import { extractDataAccess } from "./data-access.js";
import { isVendorFile } from "./vendor.js";

const sourceExtensions = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".go",
  ".cs",
  ".py",
  ".java",
  ".rb",
  ".rs",
  ".hbs",
  ".handlebars",
  ".json",
  ".yaml",
  ".yml",
  ".snap",
]);

/** @param {string} file @returns {boolean} */
export function isSourceFilePath(file) {
  const basename = path.posix.basename(file);
  // Manifest and compiler metadata are ubiquitous but are not useful change
  // owners. Keep application JSON (translations and flag config) indexable.
  if (["package.json", "package-lock.json", "tsconfig.json"].includes(basename)) return false;
  return sourceExtensions.has(path.posix.extname(file)) || /^changelog(?:\.[a-z0-9_-]+)?\.md$/i.test(basename);
}

/**
 * @typedef {import('./data-access.js').DataAccessHit} DataAccessHit
 * @typedef {import('./ast.js').CodeSymbol} CodeSymbol
 */

/**
 * Per-file analysis record.
 * @typedef {object} FileRecord
 * @property {string} path
 * @property {string} kind
 * @property {string} domain
 * @property {string[]} domains
 * @property {string | undefined} route
 * @property {string | undefined} controllerBasePath
 * @property {{ method: string, path: string }[]} httpMethods
 * @property {string[]} imports
 * @property {string[]} exports
 * @property {CodeSymbol[]} symbols
 * @property {string[]} formFields
 * @property {string[]} navigationTargets
 * @property {string[]} localIdentifiers
 * @property {boolean} isVendor
 * @property {DataAccessHit[]} [dataAccess]
 */

/**
 * Aggregated counters across all analyzed source files.
 * @typedef {Record<string, number>} CodeMapSummary
 */

/**
 * One domain grouping in the code map.
 * @typedef {object} DomainKindCount
 * @property {string} kind
 * @property {number} count
 *
 * @typedef {object} DomainSummary
 * @property {string} name
 * @property {number} fileCount
 * @property {DomainKindCount[]} kinds
 */

/**
 * The full generated code map.
 * @typedef {object} CodeMap
 * @property {boolean} ok
 * @property {object} repo
 * @property {string} repo.root
 * @property {string} repo.name
 * @property {unknown} repo.package
 * @property {unknown} repo.git
 * @property {number} repo.fileCount
 * @property {number} repo.sourceFileCount
 * @property {unknown} repo.languages
 * @property {string[]} repo.entrypoints
 * @property {CodeMapSummary} summary
 * @property {DomainSummary[]} domains
 * @property {FileRecord[]} files
 * @property {{ fullJson: number, estimated: boolean, method: string, total: number, sections: { name: string, tokens: number, characters: number }[] }} [tokenEstimate]
 */

/**
 * @param {string} [repoPath]
 * @param {{ maxSymbols?: number }} [options]
 * @returns {CodeMap}
 */
export function generateCodeMap(repoPath = ".", options = {}) {
  const repo = inspectRepo(repoPath);
  const files = listRepoFiles(repo.root).filter(isSourceFilePath);
  const maxSymbols = Number(options.maxSymbols ?? 5000);
  const sourceFiles = /** @type {FileRecord[]} */ (files.map((file) => analyzeFile(repo.root, file, maxSymbols)).filter(Boolean));
  return assembleCodeMap(repo, sourceFiles);
}

/**
 * Build the same scoring map from caller-supplied immutable source text. This
 * avoids filesystem checkout semantics (filters, case folding, Unicode path
 * normalisation) when a Git tree is the exact receipt subject.
 * @param {string} repoRoot
 * @param {Iterable<{ path: string, text: string }>} sources
 * @param {{ maxSymbols?: number, name?: string }} [options]
 * @returns {CodeMap}
 */
export function generateCodeMapFromSources(repoRoot, sources, options = {}) {
  const root = path.resolve(repoRoot);
  const maxSymbols = Number(options.maxSymbols ?? 5000);
  /** @type {FileRecord[]} */
  const sourceFiles = [];
  let sourceCount = 0;
  for (const source of sources) {
    sourceCount += 1;
    const record = analyzeSource(source.path, source.text, maxSymbols);
    if (record) sourceFiles.push(record);
  }
  return assembleCodeMap(
    {
      root,
      name: options.name ?? path.basename(root),
      package: null,
      git: null,
      fileCount: sourceCount,
      languages: [],
      entrypoints: [],
    },
    sourceFiles,
  );
}

/**
 * @param {any} repo
 * @param {FileRecord[]} sourceFiles
 * @returns {CodeMap}
 */
function assembleCodeMap(repo, sourceFiles) {
  const domains = summarizeDomains(sourceFiles);

  /** @type {CodeMap} */
  const map = {
    ok: true,
    repo: {
      root: repo.root,
      name: repo.package?.name ?? repo.name ?? path.basename(repo.root),
      package: repo.package,
      git: repo.git,
      fileCount: repo.fileCount,
      sourceFileCount: sourceFiles.length,
      languages: repo.languages,
      entrypoints: repo.entrypoints,
    },
    summary: summarizeFiles(sourceFiles),
    domains,
    files: sourceFiles,
  };
  map.tokenEstimate = {
    fullJson: estimateTokens(map),
    ...estimateTokenSections([
      { name: "repo", value: map.repo },
      { name: "summary", value: map.summary },
      { name: "domains", value: map.domains },
      { name: "files", value: map.files },
    ]),
  };
  return map;
}

// Maps a file kind to its summary counter key. Kinds without an entry (e.g.
// "source", "page") are counted toward symbols/data-access only.
/** @type {Record<string, string>} */
const summaryKindKeys = {
  route: "routes",
  apiRoute: "apiRoutes",
  controller: "controllers",
  service: "services",
  module: "modules",
  component: "components",
  hook: "hooks",
  apiClient: "apiClients",
  dto: "dtos",
  schema: "schemas",
  test: "tests",
};

/**
 * @param {FileRecord[]} sourceFiles
 * @returns {CodeMapSummary}
 */
function summarizeFiles(sourceFiles) {
  /** @type {CodeMapSummary} */
  const summary = {
    routes: 0,
    apiRoutes: 0,
    controllers: 0,
    services: 0,
    modules: 0,
    components: 0,
    hooks: 0,
    apiClients: 0,
    dtos: 0,
    schemas: 0,
    tests: 0,
    symbols: 0,
    dataAccessFiles: 0,
    dataAccessHits: 0,
  };

  for (const file of sourceFiles) {
    const key = summaryKindKeys[file.kind];
    if (key) {
      summary[key] += 1;
    }
    summary.symbols += file.symbols.length;
    const dataAccessHits = file.dataAccess?.length ?? 0;
    if (dataAccessHits > 0) {
      summary.dataAccessFiles += 1;
      summary.dataAccessHits += dataAccessHits;
    }
  }

  return summary;
}

/**
 * @param {string} root
 * @param {string} relativePath
 * @param {number} maxSymbols
 * @returns {FileRecord | undefined}
 */
function analyzeFile(root, relativePath, maxSymbols) {
  const absolute = path.join(root, relativePath);
  const text = safeRead(absolute);
  return analyzeSource(relativePath, text, maxSymbols);
}

/**
 * @param {string} relativePath
 * @param {string} text
 * @param {number} maxSymbols
 * @returns {FileRecord | undefined}
 */
function analyzeSource(relativePath, text, maxSymbols) {
  if (!text) {
    return undefined;
  }

  const ast = extractAstFacts(relativePath, text);
  const artifactFacts = extractArtifactFacts(relativePath, text);
  const vendor = isVendorFile(relativePath, text);
  const dataAccess = vendor ? [] : extractDataAccess(text);
  const domainInfo = inferDomainInfo(relativePath);
  /** @type {FileRecord} */
  const record = {
    path: relativePath,
    kind: classifyFile(relativePath),
    domain: domainInfo.primary,
    domains: domainInfo.all,
    route: inferNextRoute(relativePath),
    controllerBasePath: inferControllerBasePath(text),
    httpMethods: extractHttpMethods(text),
    imports: [...new Set([...ast.imports, ...artifactFacts.imports])],
    exports: ast.exports,
    symbols: [...ast.symbols, ...artifactFacts.symbols].slice(0, maxSymbols),
    formFields: ast.formFields ?? [],
    navigationTargets: ast.navigationTargets ?? [],
    localIdentifiers: ast.localIdentifiers ?? [],
    isVendor: vendor,
  };
  if (dataAccess.length > 0) {
    record.dataAccess = dataAccess.slice(0, 50);
  }
  return record;
}

/**
 * Extract only stable identifiers from templates and configuration. This makes
 * Handlebars partials, translation keys and feature-flag names searchable
 * without indexing template bodies, customer copy or configuration values.
 * @param {string} relativePath
 * @param {string} text
 */
function extractArtifactFacts(relativePath, text) {
  const extension = path.extname(relativePath).toLowerCase();
  /** @type {string[]} */
  const imports = [];
  /** @type {CodeSymbol[]} */
  const symbols = [];
  const seen = new Set();
  /** @param {string} type @param {string} name @param {number} offset */
  const add = (type, name, offset) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    symbols.push({ type, name, line: text.slice(0, offset).split("\n").length });
  };

  if (extension === ".hbs" || extension === ".handlebars") {
    for (const match of text.matchAll(/{{\s*[#/>]?\s*([A-Za-z_$][\w$.-]*)/g)) {
      const name = match[1];
      add("template", name, match.index ?? 0);
      if (text.slice(match.index ?? 0, (match.index ?? 0) + 5).includes(">")) imports.push(name);
    }
  } else if (extension === ".json") {
    for (const match of text.matchAll(/"([^"\\]{2,120})"\s*:/g)) add("config", match[1], match.index ?? 0);
  } else if (extension === ".yaml" || extension === ".yml") {
    for (const match of text.matchAll(/^\s*([A-Za-z_$][\w$.-]{1,120})\s*:/gm)) add("config", match[1], match.index ?? 0);
  }
  return { imports: [...new Set(imports)], symbols };
}

/**
 * @param {FileRecord[]} files
 * @returns {DomainSummary[]}
 */
function summarizeDomains(files) {
  /** @type {Map<string, { name: string, fileCount: number, kinds: Map<string, number> }>} */
  const domains = new Map();
  for (const file of files) {
    const tags = file.domains?.length ? file.domains : [file.domain];
    for (const name of tags) {
      const domain = domains.get(name) ?? { name, fileCount: 0, kinds: new Map() };
      domain.fileCount += 1;
      domain.kinds.set(file.kind, (domain.kinds.get(file.kind) ?? 0) + 1);
      domains.set(name, domain);
    }
  }

  return [...domains.values()]
    .map((domain) => ({
      name: domain.name,
      fileCount: domain.fileCount,
      kinds: [...domain.kinds.entries()].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    }))
    .sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name));
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function safeRead(filePath) {
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > 1024 * 1024) {
      return "";
    }
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}
