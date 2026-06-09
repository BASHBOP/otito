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
    summary: {
      routes: sourceFiles.filter((file) => file.kind === "route").length,
      apiRoutes: sourceFiles.filter((file) => file.kind === "apiRoute").length,
      controllers: sourceFiles.filter((file) => file.kind === "controller").length,
      services: sourceFiles.filter((file) => file.kind === "service").length,
      modules: sourceFiles.filter((file) => file.kind === "module").length,
      components: sourceFiles.filter((file) => file.kind === "component").length,
      hooks: sourceFiles.filter((file) => file.kind === "hook").length,
      apiClients: sourceFiles.filter((file) => file.kind === "apiClient").length,
      dtos: sourceFiles.filter((file) => file.kind === "dto").length,
      schemas: sourceFiles.filter((file) => file.kind === "schema").length,
      tests: sourceFiles.filter((file) => file.kind === "test").length,
      symbols: sourceFiles.reduce((total, file) => total + file.symbols.length, 0),
      dataAccessFiles: sourceFiles.filter((file) => (file.dataAccess ?? []).length > 0).length,
      dataAccessHits: sourceFiles.reduce((total, file) => total + (file.dataAccess?.length ?? 0), 0),
    },
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
