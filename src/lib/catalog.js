import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getCachedCodeMap } from "./index-cache.js";
import { estimateTokens } from "./tokens.js";

const catalogVersion = 1;
const defaultLimit = 25;
const defaultDiscoverDepth = 4;
const ignoredDirectories = new Set([
  ".git",
  ".hg",
  ".svn",
  ".dev-context",
  ".cache",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);
const repoMarkers = new Set(["package.json", "pyproject.toml", "go.mod", "Cargo.toml", "Package.swift", "pom.xml", "build.gradle", "build.gradle.kts", ".git"]);
const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "where",
  "which",
  "who",
  "with",
]);

export function defaultCatalogPath() {
  return path.resolve(process.env.REPOCTX_CATALOG ?? process.env.DEV_CONTEXT_CATALOG ?? path.join(os.homedir(), ".dev-context", "catalog.json"));
}

export function discoverRepositories(rootPaths = ["."], options = {}) {
  const roots = normalizePathList(rootPaths);
  const maxDepth = normalizeLimit(options.depth, defaultDiscoverDepth, 20);
  const maxRepos = normalizeLimit(options.limit, 100, 1000);
  const seen = new Set();
  const repositories = [];

  for (const rootPath of roots) {
    visit(path.resolve(rootPath), 0);
  }

  return {
    ok: true,
    roots,
    maxDepth,
    repositoryCount: repositories.length,
    repositories: repositories.sort((a, b) => a.root.localeCompare(b.root)),
  };

  function visit(current, depth) {
    if (repositories.length >= maxRepos || depth > maxDepth || !isDirectory(current)) {
      return;
    }

    const realPath = realpath(current);
    if (!realPath || seen.has(realPath)) {
      return;
    }
    seen.add(realPath);

    const marker = repoMarker(current);
    if (marker) {
      repositories.push(discoveredRepository(current, marker));
      return;
    }

    for (const entry of safeReadDir(current)) {
      if (!entry.isDirectory() || ignoredDirectories.has(entry.name)) {
        continue;
      }
      visit(path.join(current, entry.name), depth + 1);
    }
  }
}

export function indexRepositories(repoPaths = ["."], options = {}) {
  const catalogPath = resolveCatalogPath(options);
  const catalog = loadCatalog({ catalogPath }).catalog;
  const indexedAt = new Date().toISOString();
  const repositories = [];
  const errors = [];
  const paths = options.discover ? discoverRepositories(repoPaths, options).repositories.map((repo) => repo.root) : normalizePathList(repoPaths);

  for (const repoPath of paths) {
    try {
      const map = getCachedCodeMap(repoPath);
      const entry = catalogEntryFromMap(map, indexedAt);
      upsertRepository(catalog, entry);
      repositories.push(entry);
    } catch (error) {
      errors.push({
        path: path.resolve(repoPath),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  catalog.updatedAt = indexedAt;
  saveCatalog(catalog, { catalogPath });

  return {
    ok: errors.length === 0,
    catalogPath,
    indexedAt,
    repositoryCount: catalog.repositories.length,
    indexedCount: repositories.length,
    repositories,
    errors,
  };
}

export function listCatalog(options = {}) {
  const { catalog, catalogPath } = loadCatalog(options);
  return {
    ok: true,
    catalogPath,
    version: catalog.version,
    updatedAt: catalog.updatedAt,
    repositoryCount: catalog.repositories.length,
    repositories: catalog.repositories,
  };
}

export function searchCatalog(query, options = {}) {
  const tokens = tokenize(query);
  if (!tokens.length) {
    throw new Error("search requires a non-empty query");
  }

  const limit = normalizeLimit(options.limit, defaultLimit, 200);
  const { catalog, catalogPath } = loadCatalog(options);
  const matches = [];
  const errors = [];

  for (const repository of catalog.repositories) {
    let map;
    try {
      map = options.offline ? readIndexedMap(repository) : getCachedCodeMap(repository.root);
    } catch (error) {
      errors.push({
        root: repository.root,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    for (const file of map.files ?? []) {
      const scored = scoreFile(repository, file, tokens);
      if (scored.score > 0) {
        matches.push(scored);
      }
    }
  }

  matches.sort((a, b) => b.score - a.score || a.repository.name.localeCompare(b.repository.name) || a.file.path.localeCompare(b.file.path));

  const result = {
    ok: true,
    query,
    tokens,
    catalogPath,
    repositoryCount: catalog.repositories.length,
    matchCount: matches.length,
    matches: matches.slice(0, limit),
    errors,
  };
  result.tokenEstimate = {
    fullJson: estimateTokens(result),
    estimated: true,
    method: "ceil(characters / 4)",
  };
  return result;
}

export function formatDiscoverSummary(result) {
  const lines = [`Repositories discovered: ${result.repositoryCount}`, ""];

  for (const repository of result.repositories) {
    lines.push(`- ${repository.root} (${repository.marker})`);
  }

  if (!result.repositories.length) {
    lines.push("No repositories found.");
  }

  return lines.join("\n").trimEnd();
}

export function formatIndexSummary(result) {
  const lines = [
    `Catalog indexed: ${result.catalogPath}`,
    `Indexed repositories: ${result.indexedCount}`,
    `Catalog repositories: ${result.repositoryCount}`,
    "",
  ];

  for (const repo of result.repositories) {
    lines.push(`- ${repo.name}: ${repo.root}`);
  }

  if (result.errors.length) {
    lines.push("", "Errors:");
    for (const error of result.errors) {
      lines.push(`- ${error.path}: ${error.error}`);
    }
  }

  return lines.join("\n").trimEnd();
}

export function formatCatalogSummary(result) {
  const lines = [
    `Catalog: ${result.catalogPath}`,
    `Repositories: ${result.repositoryCount}`,
    result.updatedAt ? `Updated: ${result.updatedAt}` : "Updated: never",
    "",
  ];

  for (const repo of result.repositories) {
    const domains = repo.domains
      ?.slice(0, 5)
      .map((domain) => domain.name)
      .join(", ");
    lines.push(`- ${repo.name}: ${repo.root}${domains ? ` (${domains})` : ""}`);
  }

  if (!result.repositories.length) {
    lines.push("No repositories indexed.");
  }

  return lines.join("\n").trimEnd();
}

export function formatSearchResults(result) {
  const lines = [`Search: ${result.query}`, `Matches: ${result.matchCount}`, ""];

  for (const match of result.matches) {
    const reasons = match.reasons.length ? ` - ${match.reasons.join(", ")}` : "";
    lines.push(`- ${match.repository.name}: ${match.file.path} [${match.file.kind}/${match.file.domain}]${reasons}`);
  }

  if (!result.matches.length) {
    lines.push("No matches found.");
  }

  if (result.errors.length) {
    lines.push("", "Errors:");
    for (const error of result.errors) {
      lines.push(`- ${error.root}: ${error.error}`);
    }
  }

  return lines.join("\n").trimEnd();
}

function loadCatalog(options = {}) {
  const catalogPath = resolveCatalogPath(options);
  let catalog;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  } catch {
    catalog = undefined;
  }

  if (!catalog || catalog.version !== catalogVersion || !Array.isArray(catalog.repositories)) {
    catalog = {
      version: catalogVersion,
      updatedAt: undefined,
      repositories: [],
    };
  }

  return { catalog, catalogPath };
}

function saveCatalog(catalog, options = {}) {
  const catalogPath = resolveCatalogPath(options);
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
}

function resolveCatalogPath(options = {}) {
  return path.resolve(options.catalogPath ?? options.catalog ?? defaultCatalogPath());
}

function normalizePathList(paths) {
  const values = Array.isArray(paths) && paths.length ? paths : ["."];
  return [...new Set(values.map((value) => path.resolve(value || ".")))];
}

function catalogEntryFromMap(map, indexedAt) {
  return {
    root: map.repo.root,
    name: map.repo.name,
    package: map.repo.package,
    git: map.repo.git,
    languages: map.repo.languages,
    entrypoints: map.repo.entrypoints,
    sourceFileCount: map.repo.sourceFileCount,
    summary: map.summary,
    domains: map.domains,
    indexPath: map.cache?.path ?? path.join(map.repo.root, ".dev-context", "index.json"),
    fingerprint: map.cache?.fingerprint,
    generatedAt: map.cache?.generatedAt ?? indexedAt,
    indexedAt,
  };
}

function upsertRepository(catalog, entry) {
  catalog.repositories = [...catalog.repositories.filter((repository) => repository.root !== entry.root), entry].sort(
    (a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root),
  );
}

function readIndexedMap(repository) {
  const cached = JSON.parse(fs.readFileSync(repository.indexPath, "utf8"));
  return cached.map ?? cached;
}

function scoreFile(repository, file, tokens) {
  const reasons = [];
  let score = 0;

  score += scoreField(file.path, tokens, 8, "path", reasons);
  score += scoreField(file.kind, tokens, 4, "kind", reasons);
  score += scoreField(file.domains?.length ? file.domains.join(" ") : file.domain, tokens, 5, "domain", reasons);
  score += scoreField(repository.name, tokens, 3, "repo", reasons);
  score += scoreField(repository.package?.name, tokens, 3, "package", reasons);
  score += scoreField(file.route, tokens, 6, "route", reasons);
  score += scoreField(file.controllerBasePath, tokens, 6, "controller", reasons);

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

  return {
    score,
    reasons: [...new Set(reasons)].slice(0, 6),
    repository: {
      name: repository.name,
      root: repository.root,
    },
    file: {
      path: file.path,
      kind: file.kind,
      domain: file.domain,
      domains: file.domains ?? (file.domain ? [file.domain] : []),
      route: file.route,
      controllerBasePath: file.controllerBasePath,
      httpMethods: file.httpMethods,
      imports: file.imports?.slice(0, 8) ?? [],
      exports: file.exports?.slice(0, 8) ?? [],
      symbols: file.symbols?.slice(0, 12) ?? [],
    },
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

function normalizeLimit(value, fallback, max) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(parsed), max);
}

function repoMarker(root) {
  for (const marker of repoMarkers) {
    if (fs.existsSync(path.join(root, marker))) {
      return marker;
    }
  }
  return undefined;
}

function discoveredRepository(root, marker) {
  const packageJson = readJson(path.join(root, "package.json"));
  return {
    root,
    name: packageJson?.name ?? path.basename(root),
    marker,
    package: packageJson
      ? {
          name: packageJson.name,
          version: packageJson.version,
          type: packageJson.type,
          private: packageJson.private,
        }
      : undefined,
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function safeReadDir(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isDirectory(value) {
  try {
    return fs.statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function realpath(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return undefined;
  }
}
