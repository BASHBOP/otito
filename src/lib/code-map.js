import fs from "node:fs";
import path from "node:path";
import { inspectRepo, walk } from "./repo.js";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const declarationPatterns = [
  { type: "class", pattern: /\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g },
  { type: "class", pattern: /\b(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g },
  { type: "function", pattern: /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g },
  { type: "function", pattern: /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g },
  { type: "const", pattern: /\bexport\s+const\s+([A-Za-z_$][\w$]*)/g },
  { type: "const", pattern: /\bconst\s+([A-Za-z_$][\w$]*)\s*=/g },
  { type: "interface", pattern: /\bexport\s+interface\s+([A-Za-z_$][\w$]*)/g },
  { type: "type", pattern: /\bexport\s+type\s+([A-Za-z_$][\w$]*)/g },
  { type: "enum", pattern: /\bexport\s+enum\s+([A-Za-z_$][\w$]*)/g }
];

export function generateCodeMap(repoPath = ".", options = {}) {
  const repo = inspectRepo(repoPath);
  const files = walk(repo.root).filter((file) => sourceExtensions.has(path.extname(file)));
  const maxSymbols = Number(options.maxSymbols ?? 5000);
  const sourceFiles = files.map((file) => analyzeFile(repo.root, file, maxSymbols)).filter(Boolean);
  const domains = summarizeDomains(sourceFiles);

  return {
    ok: true,
    repo: {
      root: repo.root,
      name: path.basename(repo.root),
      git: repo.git,
      fileCount: repo.fileCount,
      sourceFileCount: sourceFiles.length,
      languages: repo.languages,
      entrypoints: repo.entrypoints
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
      symbols: sourceFiles.reduce((total, file) => total + file.symbols.length, 0)
    },
    domains,
    files: sourceFiles
  };
}

export function formatCodeMapMarkdown(map) {
  const lines = [
    `# Code Map: ${map.repo.name}`,
    "",
    `- Root: ${map.repo.root}`,
    `- Source files: ${map.repo.sourceFileCount}`,
    `- Symbols: ${map.summary.symbols}`,
    `- Entrypoints: ${map.repo.entrypoints.join(", ") || "none detected"}`,
    "",
    "## Summary",
    "",
    ...Object.entries(map.summary).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Domains",
    "",
    "| Domain | Files | Key Kinds |",
    "|---|---:|---|"
  ];

  for (const domain of map.domains.slice(0, 30)) {
    lines.push(`| ${domain.name} | ${domain.fileCount} | ${domain.kinds.map((kind) => `${kind.kind} ${kind.count}`).join(", ")} |`);
  }

  lines.push("", "## Notable Files", "");
  for (const file of map.files.filter(isNotableFile).slice(0, 80)) {
    lines.push(`- \`${file.path}\` (${file.kind}, ${file.symbols.length} symbol(s))`);
  }

  return lines.join("\n");
}

function analyzeFile(root, relativePath, maxSymbols) {
  const absolute = path.join(root, relativePath);
  const text = safeRead(absolute);
  if (!text) {
    return undefined;
  }

  const imports = extractImports(text);
  const symbols = extractSymbols(text).slice(0, maxSymbols);
  return {
    path: relativePath,
    kind: classifyFile(relativePath),
    domain: inferDomain(relativePath),
    route: inferNextRoute(relativePath),
    controllerBasePath: inferControllerBasePath(text),
    httpMethods: extractHttpMethods(text),
    imports,
    exports: extractExports(text),
    symbols
  };
}

function classifyFile(file) {
  const base = path.basename(file);
  if (file.includes("__tests__") || file.includes("/test/") || /\.(spec|test)\.[jt]sx?$/.test(file)) return "test";
  if (file.includes("/app/api/") && base === "route.ts") return "apiRoute";
  if (base === "page.tsx" || base === "page.ts" || base === "layout.tsx" || base === "layout.ts") return "route";
  if (base.endsWith(".controller.ts")) return "controller";
  if (base.endsWith(".service.ts")) return "service";
  if (base.endsWith(".module.ts")) return "module";
  if (base.endsWith(".dto.ts")) return "dto";
  if (base.endsWith(".schema.ts") || file.includes("/schemas/")) return "schema";
  if (base.startsWith("use") && /\.(ts|tsx)$/.test(base)) return "hook";
  if (file.startsWith("redux/apis/") || file.startsWith("services/") || file === "lib/api-client.ts" || file === "utils/api-client.ts") return "apiClient";
  if (/^[A-Z]/.test(base) && /\.(tsx|jsx)$/.test(base)) return "component";
  return "source";
}

function inferDomain(file) {
  const parts = file.split("/");
  if (file.startsWith("redux/apis/") && parts[2]) {
    return cleanDomain(parts[2].replace(/-api\.[jt]s$/, "").replace(/-apis\.[jt]s$/, ""));
  }
  if (file.startsWith("services/") && parts[1]) {
    return cleanDomain(parts[1].replace(/-service\.[jt]s$/, ""));
  }
  const interestingRoots = new Set(["app", "src", "components", "lib", "utils", "redux", "services", "schemas", "hooks", "types"]);
  if (interestingRoots.has(parts[0]) && parts[1]) {
    return cleanDomain(parts[1]);
  }
  return cleanDomain(parts[0] ?? "root");
}

function cleanDomain(value) {
  return value
    .replace(/\.[cm]?[jt]sx?$/, "")
    .replace(/-api$/, "")
    .replace(/-apis$/, "")
    .replace(/-service$/, "")
    .replace(/[()[\]]/g, "")
    .replace(/^\.+$/, "root")
    || "root";
}

function inferNextRoute(file) {
  if (!file.startsWith("app/") && !file.startsWith("src/app/") && !file.startsWith("pages/") && !file.startsWith("src/pages/")) {
    return undefined;
  }

  if (!/(page|layout|route)\.[jt]sx?$/.test(path.basename(file))) {
    return undefined;
  }

  return file
    .replace(/^src\//, "")
    .replace(/^app/, "")
    .replace(/^pages/, "")
    .replace(/\/(page|layout|route)\.[jt]sx?$/, "")
    .replace(/\([^/]+\)\//g, "")
    .replace(/\[[^/]+\]/g, (segment) => `:${segment.slice(1, -1)}`)
    || "/";
}

function inferControllerBasePath(text) {
  const match = text.match(/@Controller\((['"`])([^'"`]+)\1\)/);
  return match?.[2];
}

function extractHttpMethods(text) {
  const methods = [];
  const pattern = /@(Get|Post|Put|Patch|Delete|Options|Head)\(([^)]*)\)/g;
  for (const match of text.matchAll(pattern)) {
    methods.push({
      method: match[1].toUpperCase(),
      path: match[2].replace(/['"`]/g, "").trim() || "/"
    });
  }
  return methods;
}

function extractImports(text) {
  const imports = new Set();
  const patterns = [
    /from\s+['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      imports.add(match[1]);
    }
  }
  return [...imports].slice(0, 100);
}

function extractExports(text) {
  const exports = new Set();
  const patterns = [
    /export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    /export\s*{\s*([^}]+)\s*}/g
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      for (const name of match[1].split(",").map((item) => item.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean)) {
        exports.add(name);
      }
    }
  }
  return [...exports].slice(0, 100);
}

function extractSymbols(text) {
  const symbols = [];
  const seen = new Set();
  for (const definition of declarationPatterns) {
    for (const match of text.matchAll(definition.pattern)) {
      const key = `${definition.type}:${match[1]}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      symbols.push({ type: definition.type, name: match[1], line: lineNumberAt(text, match.index ?? 0) });
    }
  }
  return symbols;
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

function summarizeDomains(files) {
  const domains = new Map();
  for (const file of files) {
    const domain = domains.get(file.domain) ?? { name: file.domain, fileCount: 0, kinds: new Map() };
    domain.fileCount += 1;
    domain.kinds.set(file.kind, (domain.kinds.get(file.kind) ?? 0) + 1);
    domains.set(file.domain, domain);
  }

  return [...domains.values()]
    .map((domain) => ({
      name: domain.name,
      fileCount: domain.fileCount,
      kinds: [...domain.kinds.entries()]
        .map(([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
    }))
    .sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name));
}

function isNotableFile(file) {
  return ["route", "apiRoute", "controller", "service", "module", "apiClient"].includes(file.kind);
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
