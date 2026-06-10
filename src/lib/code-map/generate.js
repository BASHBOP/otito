import fs from "node:fs";
import path from "node:path";
import { inspectRepo, listRepoFiles } from "../repo.js";
import { estimateTokens, estimateTokenSections } from "../tokens.js";
import { extractAstFacts } from "./ast.js";
import { classifyFile, extractHttpMethods, inferControllerBasePath, inferDomainInfo, inferNextRoute } from "./classify.js";
import { extractDataAccess } from "./data-access.js";
import { isVendorFile } from "./vendor.js";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".go", ".cs", ".py", ".java", ".rb", ".rs"]);

export function generateCodeMap(repoPath = ".", options = {}) {
  const repo = inspectRepo(repoPath);
  const files = listRepoFiles(repo.root).filter((file) => sourceExtensions.has(path.extname(file)));
  const maxSymbols = Number(options.maxSymbols ?? 5000);
  const sourceFiles = files.map((file) => analyzeFile(repo.root, file, maxSymbols)).filter(Boolean);
  const domains = summarizeDomains(sourceFiles);

  const map = {
    ok: true,
    repo: {
      root: repo.root,
      name: repo.package?.name ?? path.basename(repo.root),
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

function summarizeFiles(sourceFiles) {
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

function analyzeFile(root, relativePath, maxSymbols) {
  const absolute = path.join(root, relativePath);
  const text = safeRead(absolute);
  if (!text) {
    return undefined;
  }

  const ast = extractAstFacts(relativePath, text);
  const vendor = isVendorFile(relativePath, text);
  const dataAccess = vendor ? [] : extractDataAccess(text);
  const domainInfo = inferDomainInfo(relativePath);
  const record = {
    path: relativePath,
    kind: classifyFile(relativePath),
    domain: domainInfo.primary,
    domains: domainInfo.all,
    route: inferNextRoute(relativePath),
    controllerBasePath: inferControllerBasePath(text),
    httpMethods: extractHttpMethods(text),
    imports: ast.imports,
    exports: ast.exports,
    symbols: ast.symbols.slice(0, maxSymbols),
    isVendor: vendor,
  };
  if (dataAccess.length > 0) {
    record.dataAccess = dataAccess.slice(0, 50);
  }
  return record;
}

function summarizeDomains(files) {
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
