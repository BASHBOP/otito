import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { inspectRepo, listRepoFiles } from "./repo.js";
import { estimateTokens, estimateTokenSections } from "./tokens.js";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".go", ".cs", ".py", ".java", ".rb", ".rs"]);
const declarationPatterns = [
  { type: "class", pattern: /\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g },
  { type: "class", pattern: /\b(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g },
  { type: "function", pattern: /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g },
  { type: "function", pattern: /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g },
  { type: "const", pattern: /\bexport\s+const\s+([A-Za-z_$][\w$]*)/g },
  { type: "const", pattern: /\bconst\s+([A-Za-z_$][\w$]*)\s*=/g },
  { type: "interface", pattern: /\bexport\s+interface\s+([A-Za-z_$][\w$]*)/g },
  { type: "type", pattern: /\bexport\s+type\s+([A-Za-z_$][\w$]*)/g },
  { type: "enum", pattern: /\bexport\s+enum\s+([A-Za-z_$][\w$]*)/g },
];

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

export function formatCodeMapMarkdown(map) {
  const lines = [
    `# Code Map: ${map.repo.name}`,
    "",
    `- Root: ${map.repo.root}`,
    `- Source files: ${map.repo.sourceFileCount}`,
    `- Symbols: ${map.summary.symbols}`,
    `- Entrypoints: ${map.repo.entrypoints.join(", ") || "none detected"}`,
    `- Estimated JSON tokens: ${map.tokenEstimate?.fullJson ?? "unknown"}`,
    "",
    "## Summary",
    "",
    ...Object.entries(map.summary).map(([key, value]) => `- ${key}: ${value}`),
    "",
    "## Domains",
    "",
    "| Domain | Files | Key Kinds |",
    "|---|---:|---|",
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

const sqlVerbAlternation =
  "SELECT|INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?|ALTER\\s+TABLE|DROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?|MERGE\\s+INTO|TRUNCATE(?:\\s+TABLE)?|WITH";
const prismaOpRegex =
  /\b(?:prisma|db|tx|ctx\.db|this\.db)\.([a-z][a-zA-Z0-9_]*)\.(findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|findMany|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\b/g;

export function extractDataAccess(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const out = [];
  const seen = new Set();

  const stringRegex = /"""([\s\S]*?)"""|@"((?:[^"]|"")*)"|"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  const sqlStructureRegex = /\b(FROM|INTO|SET|VALUES|WHERE|JOIN|TABLE|GROUP\s+BY|ORDER\s+BY)\b/i;
  const verbRegex = new RegExp(`^(${sqlVerbAlternation})\\b`, "i");

  for (const match of text.matchAll(stringRegex)) {
    const content = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
    if (!content) continue;
    const trimmed = content.trim();
    const verbMatch = trimmed.match(verbRegex);
    if (!verbMatch) continue;
    if (!sqlStructureRegex.test(trimmed)) continue;
    const op = verbMatch[1].toUpperCase().split(/\s+/)[0];
    const table = inferSqlTable(trimmed, op);
    const line = lineNumberAt(text, match.index ?? 0);
    const key = `sql:${op}:${table ?? "?"}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source: "sql",
      op,
      table,
      line,
      snippet: trimmed.replace(/\s+/g, " ").slice(0, 100),
    });
  }

  for (const match of text.matchAll(prismaOpRegex)) {
    const line = lineNumberAt(text, match.index ?? 0);
    const key = `prisma:${match[2]}:${match[1]}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source: "prisma",
      op: match[2],
      table: match[1],
      line,
      snippet: match[0].slice(0, 100),
    });
  }

  return out;
}

function inferSqlTable(query, op) {
  let match;
  if (op === "SELECT" || op === "DELETE") {
    match = query.match(/\bFROM\s+([A-Za-z_][\w.]*)/i);
    if (match) return match[1];
  }
  if (op === "INSERT") {
    match = query.match(/\bINSERT\s+INTO\s+([A-Za-z_][\w.]*)/i);
    if (match) return match[1];
  }
  if (op === "UPDATE") {
    match = query.match(/\bUPDATE\s+([A-Za-z_][\w.]*)/i);
    if (match) return match[1];
  }
  if (op === "CREATE" || op === "DROP" || op === "ALTER" || op === "TRUNCATE") {
    match = query.match(/\b(?:TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?)?([A-Za-z_][\w.]*)/i);
    if (match) return match[1];
  }
  if (op === "MERGE") {
    match = query.match(/\bINTO\s+([A-Za-z_][\w.]*)/i);
    if (match) return match[1];
  }
  return undefined;
}

const vendorLibPrefixes = [
  "jquery",
  "angular",
  "vue",
  "react",
  "preact",
  "bootstrap",
  "lodash",
  "moment",
  "underscore",
  "backbone",
  "ember",
  "alpine",
  "htmx",
  "chart",
  "d3",
];
const vendorPathSegments = new Set(["node_modules", "bower_components", "vendor", "third_party", "third-party", "dist", "build"]);
const vendorFileSuffixes = [".min.js", ".min.css", ".min.mjs", ".bundle.js", ".bundle.min.js", ".chunk.js"];

export function isVendorFile(relativePath, text) {
  const lower = relativePath.toLowerCase();
  const segments = lower.split(/[/\\]/);
  if (segments.some((seg) => vendorPathSegments.has(seg))) return true;
  if (vendorFileSuffixes.some((s) => lower.endsWith(s))) return true;

  const filename = segments[segments.length - 1];
  for (const prefix of vendorLibPrefixes) {
    if (filename.startsWith(prefix) && /\.(js|mjs|cjs|css)$/.test(filename)) {
      return true;
    }
  }

  if (typeof text === "string" && text.length > 50_000 && /\.(js|mjs|cjs|css)$/.test(filename)) {
    let longest = 0;
    const sample = text.slice(0, 8192);
    for (const line of sample.split("\n")) {
      if (line.length > longest) longest = line.length;
      if (longest > 500) return true;
    }
  }

  return false;
}

function extractAstFacts(relativePath, text) {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === ".go") {
    return extractGoFacts(text);
  }
  if (ext === ".cs") {
    return extractCsharpFacts(text);
  }
  if (ext === ".py") {
    return extractPythonFacts(text);
  }
  if (ext === ".java") {
    return extractJavaFacts(text);
  }
  if (ext === ".rb") {
    return extractRubyFacts(text);
  }
  if (ext === ".rs") {
    return extractRustFacts(text);
  }

  try {
    const sourceFile = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, scriptKindForFile(relativePath));
    const facts = {
      imports: new Set(),
      exports: new Set(),
      symbols: [],
    };
    const seenSymbols = new Set();

    visit(sourceFile);
    return {
      imports: [...facts.imports].slice(0, 100),
      exports: [...facts.exports].slice(0, 100),
      symbols: facts.symbols,
    };

    function visit(node) {
      collectImport(node, facts.imports);
      collectExport(node, facts.exports);
      collectSymbol(sourceFile, node, facts.symbols, seenSymbols);
      ts.forEachChild(node, visit);
    }
  } catch {
    const codeText = stripNonCode(text);
    return {
      imports: extractImports(text),
      exports: extractExports(codeText),
      symbols: extractSymbols(codeText),
    };
  }
}

function scriptKindForFile(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".tsx" || extension === ".jsx") return ts.ScriptKind.TSX;
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function collectImport(node, imports) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && isStringLiteralNode(node.moduleSpecifier)) {
    imports.add(node.moduleSpecifier.text);
    return;
  }

  if (!ts.isCallExpression(node) || node.arguments.length === 0 || !isStringLiteralNode(node.arguments[0])) {
    return;
  }

  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    imports.add(node.arguments[0].text);
    return;
  }

  if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
    imports.add(node.arguments[0].text);
  }
}

function collectExport(node, exports) {
  if (hasExportModifier(node)) {
    for (const name of declarationNames(node)) {
      exports.add(name);
    }
  }

  if (ts.isExportAssignment(node)) {
    exports.add("default");
  }

  if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
    for (const element of node.exportClause.elements) {
      exports.add(element.propertyName?.text ?? element.name.text);
    }
  }
}

function isStringLiteralNode(node) {
  return Boolean(node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)));
}

function collectSymbol(sourceFile, node, symbols, seen) {
  const symbol = symbolForNode(sourceFile, node);
  if (!symbol) {
    return;
  }

  const key = `${symbol.type}:${symbol.name}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  symbols.push(symbol);
}

function symbolForNode(sourceFile, node) {
  if (ts.isClassDeclaration(node) && node.name) {
    return symbol(sourceFile, node, "class", node.name.text);
  }
  if (ts.isFunctionDeclaration(node) && node.name) {
    return symbol(sourceFile, node, "function", node.name.text);
  }
  if (ts.isInterfaceDeclaration(node)) {
    return symbol(sourceFile, node, "interface", node.name.text);
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return symbol(sourceFile, node, "type", node.name.text);
  }
  if (ts.isEnumDeclaration(node)) {
    return symbol(sourceFile, node, "enum", node.name.text);
  }
  if (ts.isVariableStatement(node) && isTopLevelNode(node)) {
    const declaration = node.declarationList.declarations.find((item) => ts.isIdentifier(item.name));
    if (declaration) {
      return symbol(sourceFile, declaration, variableKind(node), declaration.name.text);
    }
  }
  return undefined;
}

function symbol(sourceFile, node, type, name) {
  return {
    type,
    name,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  };
}

function declarationNames(node) {
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.filter((declaration) => ts.isIdentifier(declaration.name)).map((declaration) => declaration.name.text);
  }
  return node.name?.text ? [node.name.text] : [];
}

function hasExportModifier(node) {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

function variableKind(node) {
  const flags = node.declarationList.flags;
  if (flags & ts.NodeFlags.Const) return "const";
  if (flags & ts.NodeFlags.Let) return "let";
  return "var";
}

function isTopLevelNode(node) {
  return ts.isSourceFile(node.parent);
}

function classifyFile(file) {
  const base = path.basename(file);
  if (isTestFilePath(file)) return "test";
  if (/(^|\/)app\/api\/.*\/route\.[cm]?[jt]s$/.test(file)) return "apiRoute";
  if (base === "page.tsx" || base === "page.ts" || base === "layout.tsx" || base === "layout.ts") return "route";
  if (base.endsWith(".controller.ts")) return "controller";
  if (base.endsWith(".service.ts")) return "service";
  if (base.endsWith(".module.ts")) return "module";
  if (base.endsWith(".dto.ts")) return "dto";
  if (base.endsWith(".schema.ts") || file.includes("/schemas/")) return "schema";
  if (base.startsWith("use") && /\.(ts|tsx)$/.test(base)) return "hook";
  if (
    file.startsWith("redux/apis/") ||
    file.startsWith("src/redux/apis/") ||
    file.startsWith("services/") ||
    file.startsWith("src/services/") ||
    file === "lib/api-client.ts" ||
    file === "src/lib/api-client.ts" ||
    file === "utils/api-client.ts" ||
    file === "src/utils/api-client.ts"
  )
    return "apiClient";
  if (/^[A-Z]/.test(base) && /\.(tsx|jsx)$/.test(base)) return "component";
  return "source";
}

function isTestFilePath(file) {
  const normalized = file.replaceAll("\\", "/");
  return /(^|\/)(__tests__|test|tests)(\/|$)/.test(normalized) || /\.(spec|test)\.[jt]sx?$/.test(normalized) || /(^|\/)[^/]+_test\.go$/.test(normalized);
}

function inferDomain(file) {
  return inferDomainInfo(file).primary;
}

// Returns both the primary domain (existing behavior, used for display/scoring)
// and the full set of domain tags this file should be discoverable under.
// Feature subdirs (components/livestream/*) get both "components" and "livestream"
// so domain searches don't miss them.
function inferDomainInfo(file) {
  const normalized = file.replaceAll("\\", "/").replace(/^src\//, "");
  const parts = normalized.split("/");
  const all = new Set();
  const add = (value) => {
    const cleaned = cleanDomain(value);
    if (cleaned) all.add(cleaned);
  };

  // Treat parts[i] as a feature directory only if a deeper segment exists —
  // otherwise it's actually the file (e.g. components/Button.tsx → parts[1]
  // is the file, not a feature).
  const isDir = (i) => i < parts.length - 1;

  let primary;
  if (normalized.startsWith("app/api/") && parts[2]) {
    primary = cleanDomain(parts[2]);
    if (isDir(3)) add(parts[3]);
  } else if ((parts[0] === "app" || parts[0] === "pages") && parts[1]) {
    primary = cleanDomain(parts[1]);
    if (isDir(2)) add(parts[2]);
  } else if (normalized.startsWith("redux/apis/") && parts[2]) {
    primary = cleanDomain(parts[2].replace(/-api\.[jt]s$/, "").replace(/-apis\.[jt]s$/, ""));
  } else if (normalized.startsWith("services/") && parts[1]) {
    primary = cleanDomain(parts[1].replace(/-service\.[jt]s$/, ""));
  } else {
    const sharedRoots = new Set(["components", "lib", "utils", "schemas", "hooks", "types"]);
    if (sharedRoots.has(parts[0])) {
      primary = cleanDomain(parts[0]);
      if (isDir(1)) add(parts[1]);
    } else {
      const interestingRoots = new Set(["app", "src", "redux", "services"]);
      if (interestingRoots.has(parts[0]) && parts[1]) {
        primary = cleanDomain(parts[1]);
        if (isDir(2)) add(parts[2]);
      } else {
        primary = cleanDomain(parts[0] ?? "root");
      }
    }
  }

  add(primary);
  return { primary, all: [...all] };
}

function cleanDomain(value) {
  return (
    value
      .replace(/\.[cm]?[jt]sx?$/, "")
      .replace(/-api$/, "")
      .replace(/-apis$/, "")
      .replace(/-service$/, "")
      .replace(/[()[\]]/g, "")
      .replace(/^\.+$/, "root") || "root"
  );
}

function inferNextRoute(file) {
  const normalized = file.replaceAll("\\", "/");
  if (!normalized.startsWith("app/") && !normalized.startsWith("src/app/") && !normalized.startsWith("pages/") && !normalized.startsWith("src/pages/")) {
    return undefined;
  }

  if (!/(page|layout|route)\.[cm]?[jt]sx?$/.test(path.basename(normalized))) {
    return undefined;
  }

  return (
    normalized
      .replace(/^src\//, "")
      .replace(/^app/, "")
      .replace(/^pages/, "")
      .replace(/\/(page|layout|route)\.[cm]?[jt]sx?$/, "")
      .replace(/\([^/]+\)\//g, "")
      .replace(/\[[^/]+\]/g, (segment) => `:${segment.slice(1, -1)}`) || "/"
  );
}

function inferControllerBasePath(text) {
  return readDecoratorCalls(text, ["Controller"]).find((call) => call.argument !== undefined)?.argument;
}

function extractHttpMethods(text) {
  return readDecoratorCalls(text, ["Get", "Post", "Put", "Patch", "Delete", "Options", "Head"]).map((call) => ({
    method: call.name.toUpperCase(),
    path: call.argument?.trim() || "/",
  }));
}

function extractImports(text) {
  const imports = new Set();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const staticImport = trimmed.match(/^import\s+(?:type\s+)?(?:.+?\s+from\s+)?['"]([^'"]+)['"]/);
    const reExport = trimmed.match(/^export\s+(?:type\s+)?(?:.+?\s+from\s+)['"]([^'"]+)['"]/);
    const source = staticImport?.[1] ?? reExport?.[1];
    if (source) {
      imports.add(source);
    }
  }
  for (const source of readStringCallArguments(text, "import")) {
    imports.add(source);
  }
  for (const source of readStringCallArguments(text, "require")) {
    imports.add(source);
  }
  return [...imports].slice(0, 100);
}

function extractExports(text) {
  const exports = new Set();
  const patterns = [/export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g, /export\s*{\s*([^}]+)\s*}/g];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      for (const name of match[1]
        .split(",")
        .map((item) =>
          item
            .trim()
            .split(/\s+as\s+/)[0]
            .trim(),
        )
        .filter(Boolean)) {
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

function extractGoFacts(text) {
  const codeText = stripNonCode(text);
  const symbols = extractGoSymbols(codeText);
  return {
    imports: extractGoImports(text),
    exports: symbols.filter((symbol) => /^[A-Z]/.test(symbol.name)).map((symbol) => symbol.name),
    symbols,
  };
}

function extractGoImports(text) {
  const imports = new Set();
  for (const match of text.matchAll(/^\s*import\s+(?:"([^"]+)"|\(([\s\S]*?)\))/gm)) {
    if (match[1]) {
      imports.add(match[1]);
      continue;
    }
    for (const item of (match[2] ?? "").matchAll(/"([^"]+)"/g)) {
      imports.add(item[1]);
    }
  }
  return [...imports].slice(0, 100);
}

function extractGoSymbols(text) {
  const symbols = [];
  const seen = new Set();
  const definitions = [
    { type: "function", pattern: /^\s*func\s+(?:\([^)]+\)\s*)?([A-Za-z_]\w*)\s*\(/gm },
    { type: "type", pattern: /^\s*type\s+([A-Za-z_]\w*)\b/gm },
    { type: "const", pattern: /^\s*const\s+([A-Za-z_]\w*)\b/gm },
    { type: "var", pattern: /^\s*var\s+([A-Za-z_]\w*)\b/gm },
  ];

  for (const definition of definitions) {
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

function extractCsharpFacts(text) {
  const codeText = stripNonCode(text);
  const symbols = extractCsharpSymbols(codeText);
  const exportable = new Set(["class", "interface", "struct", "enum", "record"]);
  return {
    imports: extractCsharpImports(codeText),
    exports: symbols.filter((s) => exportable.has(s.type) && s.isPublic).map((s) => s.name),
    symbols: symbols.map(({ isPublic: _isPublic, ...rest }) => rest),
  };
}

function extractCsharpImports(text) {
  const imports = new Set();
  for (const match of text.matchAll(/^\s*using\s+(?:static\s+)?([A-Za-z_][\w.]*)\s*;/gm)) {
    imports.add(match[1]);
  }
  return [...imports].slice(0, 100);
}

function extractCsharpSymbols(text) {
  const symbols = [];
  const seen = new Set();
  const accessModifiers = "(?:public|private|protected|internal|protected\\s+internal|private\\s+protected)";
  const otherModifiers = "(?:static|sealed|abstract|partial|virtual|override|async|readonly|extern|unsafe|new)";
  const modifierGroup = `(?:(?:${accessModifiers}|${otherModifiers})\\s+)*`;
  const definitions = [
    { type: "namespace", pattern: /\bnamespace\s+([A-Za-z_][\w.]*)/g, alwaysPublic: true },
    { type: "class", pattern: new RegExp(`\\b(${accessModifiers}\\s+)?${modifierGroup}class\\s+([A-Za-z_]\\w*)`, "g") },
    { type: "interface", pattern: new RegExp(`\\b(${accessModifiers}\\s+)?${modifierGroup}interface\\s+([A-Za-z_]\\w*)`, "g") },
    { type: "struct", pattern: new RegExp(`\\b(${accessModifiers}\\s+)?${modifierGroup}struct\\s+([A-Za-z_]\\w*)`, "g") },
    { type: "enum", pattern: new RegExp(`\\b(${accessModifiers}\\s+)?${modifierGroup}enum\\s+([A-Za-z_]\\w*)`, "g") },
    { type: "record", pattern: new RegExp(`\\b(${accessModifiers}\\s+)?${modifierGroup}record\\s+([A-Za-z_]\\w*)`, "g") },
  ];

  for (const definition of definitions) {
    for (const match of text.matchAll(definition.pattern)) {
      const name = match[match.length - 1];
      if (!name) continue;
      const key = `${definition.type}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const isPublic = definition.alwaysPublic ? true : Boolean(match[1] && /\bpublic\b/.test(match[1]));
      symbols.push({ type: definition.type, name, line: lineNumberAt(text, match.index ?? 0), isPublic });
    }
  }

  const methodPattern = new RegExp(
    `^[ \\t]*(?:\\[[^\\]]*\\][ \\t]*\\r?\\n[ \\t]*)*` +
      `(?:(${accessModifiers})\\s+)?(?:${otherModifiers}\\s+)*` +
      `[A-Za-z_][\\w<>?\\[\\],\\.\\s]*?\\s+([A-Za-z_]\\w*)\\s*\\([^;{}=>]*?\\)\\s*(?:where[^{;]*)?\\{`,
    "gm",
  );
  const methodKeywords = new Set([
    "if",
    "for",
    "foreach",
    "while",
    "switch",
    "using",
    "lock",
    "catch",
    "try",
    "finally",
    "fixed",
    "do",
    "else",
    "return",
    "throw",
    "new",
    "checked",
    "unchecked",
  ]);
  for (const match of text.matchAll(methodPattern)) {
    const name = match[2];
    if (!name || methodKeywords.has(name)) continue;
    const key = `method:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isPublic = Boolean(match[1] && /\bpublic\b/.test(match[1]));
    symbols.push({ type: "method", name, line: lineNumberAt(text, match.index ?? 0), isPublic });
  }

  return symbols;
}

function extractPythonFacts(text) {
  const codeText = stripPythonComments(text);
  const symbols = extractPythonSymbols(codeText);
  return {
    imports: extractPythonImports(codeText),
    exports: symbols.filter((s) => !s.name.startsWith("_")).map((s) => s.name),
    symbols,
  };
}

function stripPythonComments(text) {
  const chars = [];
  let index = 0;
  let inString = false;
  let stringQuote = "";
  let stringIsTriple = false;
  while (index < text.length) {
    const ch = text[index];
    const next2 = text.slice(index, index + 3);
    if (!inString && ch === "#") {
      while (index < text.length && text[index] !== "\n") {
        chars.push(" ");
        index += 1;
      }
      continue;
    }
    if (!inString && (next2 === '"""' || next2 === "'''")) {
      stringQuote = ch;
      stringIsTriple = true;
      inString = true;
      chars.push(" ", " ", " ");
      index += 3;
      continue;
    }
    if (inString && stringIsTriple && next2 === `${stringQuote}${stringQuote}${stringQuote}`) {
      chars.push(" ", " ", " ");
      index += 3;
      inString = false;
      stringIsTriple = false;
      stringQuote = "";
      continue;
    }
    if (!inString && (ch === '"' || ch === "'")) {
      stringQuote = ch;
      stringIsTriple = false;
      inString = true;
      chars.push(ch);
      index += 1;
      continue;
    }
    if (inString && !stringIsTriple && ch === stringQuote && text[index - 1] !== "\\") {
      inString = false;
      stringQuote = "";
      chars.push(ch);
      index += 1;
      continue;
    }
    chars.push(inString && ch !== "\n" ? " " : ch);
    index += 1;
  }
  return chars.join("");
}

function extractPythonImports(text) {
  const imports = new Set();
  for (const match of text.matchAll(/^\s*import\s+([A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*)/gm)) {
    for (const name of match[1].split(",")) {
      const cleaned = name.trim().split(/\s+as\s+/)[0];
      if (cleaned) imports.add(cleaned);
    }
  }
  for (const match of text.matchAll(/^\s*from\s+(\.*[A-Za-z_][\w.]*|\.+)\s+import\s+/gm)) {
    imports.add(match[1]);
  }
  return [...imports].slice(0, 100);
}

function extractPythonSymbols(text) {
  const symbols = [];
  const seen = new Set();
  const definitions = [
    { type: "class", pattern: /^[ \t]*class\s+([A-Za-z_]\w*)/gm },
    { type: "function", pattern: /^[ \t]*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm },
  ];
  for (const definition of definitions) {
    for (const match of text.matchAll(definition.pattern)) {
      const name = match[1];
      if (!name) continue;
      const key = `${definition.type}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({ type: definition.type, name, line: lineNumberAt(text, match.index ?? 0) });
    }
  }
  return symbols;
}

function extractJavaFacts(text) {
  const codeText = stripNonCode(text);
  const symbols = extractJavaSymbols(codeText);
  const exportable = new Set(["class", "interface", "enum", "record"]);
  return {
    imports: extractJavaImports(codeText),
    exports: symbols.filter((s) => exportable.has(s.type) && s.isPublic).map((s) => s.name),
    symbols: symbols.map(({ isPublic: _isPublic, ...rest }) => rest),
  };
}

function extractJavaImports(text) {
  const imports = new Set();
  for (const match of text.matchAll(/^\s*import\s+(?:static\s+)?([A-Za-z_][\w.]*(?:\.\*)?)\s*;/gm)) {
    imports.add(match[1]);
  }
  return [...imports].slice(0, 100);
}

function extractJavaSymbols(text) {
  const symbols = [];
  const seen = new Set();
  const accessModifiers = "(?:public|private|protected)";
  const otherModifiers = "(?:static|final|abstract|sealed|non-sealed|strictfp|default)";
  const modifierGroup = `(?:(?:${accessModifiers}|${otherModifiers})\\s+)*`;
  const definitions = [
    { type: "package", pattern: /^\s*package\s+([A-Za-z_][\w.]*)\s*;/gm, alwaysPublic: true },
    { type: "class", pattern: new RegExp(`\\b(${accessModifiers}\\s+)?${modifierGroup}class\\s+([A-Za-z_]\\w*)`, "g") },
    { type: "interface", pattern: new RegExp(`\\b(${accessModifiers}\\s+)?${modifierGroup}interface\\s+([A-Za-z_]\\w*)`, "g") },
    { type: "enum", pattern: new RegExp(`\\b(${accessModifiers}\\s+)?${modifierGroup}enum\\s+([A-Za-z_]\\w*)`, "g") },
    { type: "record", pattern: new RegExp(`\\b(${accessModifiers}\\s+)?${modifierGroup}record\\s+([A-Za-z_]\\w*)`, "g") },
  ];
  for (const definition of definitions) {
    for (const match of text.matchAll(definition.pattern)) {
      const name = match[match.length - 1];
      if (!name) continue;
      const key = `${definition.type}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const isPublic = definition.alwaysPublic ? true : Boolean(match[1] && /\bpublic\b/.test(match[1]));
      symbols.push({ type: definition.type, name, line: lineNumberAt(text, match.index ?? 0), isPublic });
    }
  }

  const methodPattern = new RegExp(
    `^[ \\t]*(?:@[A-Za-z_][\\w.]*(?:\\([^)]*\\))?[ \\t]*\\r?\\n[ \\t]*)*` +
      `(?:(${accessModifiers})\\s+)?(?:${otherModifiers}\\s+)*` +
      `(?:<[^>]+>\\s+)?[A-Za-z_][\\w<>?\\[\\],\\.\\s]*?\\s+([A-Za-z_]\\w*)\\s*\\([^;{}=]*?\\)\\s*(?:throws\\s+[A-Za-z_][\\w.,\\s]*)?\\{`,
    "gm",
  );
  const methodKeywords = new Set(["if", "for", "while", "switch", "catch", "try", "synchronized", "return", "new"]);
  for (const match of text.matchAll(methodPattern)) {
    const name = match[2];
    if (!name || methodKeywords.has(name)) continue;
    const key = `method:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const isPublic = Boolean(match[1] && /\bpublic\b/.test(match[1]));
    symbols.push({ type: "method", name, line: lineNumberAt(text, match.index ?? 0), isPublic });
  }
  return symbols;
}

function extractRubyFacts(text) {
  const codeText = stripRubyComments(text);
  const symbols = extractRubySymbols(codeText);
  return {
    imports: extractRubyImports(codeText),
    exports: symbols.filter((s) => s.type === "class" || s.type === "module").map((s) => s.name),
    symbols,
  };
}

function stripRubyComments(text) {
  const lines = text.split("\n");
  const out = [];
  let inHeredoc = false;
  let inBlockComment = false;
  for (const line of lines) {
    if (inBlockComment) {
      if (/^=end\b/.test(line)) inBlockComment = false;
      out.push("");
      continue;
    }
    if (/^=begin\b/.test(line)) {
      inBlockComment = true;
      out.push("");
      continue;
    }
    if (inHeredoc) {
      out.push("");
      continue;
    }
    out.push(line.replace(/(^|[^$])#.*$/, "$1"));
  }
  return out.join("\n");
}

function extractRubyImports(text) {
  const imports = new Set();
  for (const match of text.matchAll(/^\s*require(?:_relative)?\s+["']([^"']+)["']/gm)) {
    imports.add(match[1]);
  }
  return [...imports].slice(0, 100);
}

function extractRubySymbols(text) {
  const symbols = [];
  const seen = new Set();
  const definitions = [
    { type: "module", pattern: /^[ \t]*module\s+([A-Z][\w:]*)/gm },
    { type: "class", pattern: /^[ \t]*class\s+([A-Z][\w:]*)/gm },
    { type: "method", pattern: /^[ \t]*def\s+(?:self\.)?([A-Za-z_]\w*[!?=]?)/gm },
  ];
  for (const definition of definitions) {
    for (const match of text.matchAll(definition.pattern)) {
      const name = match[1];
      if (!name) continue;
      const key = `${definition.type}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      symbols.push({ type: definition.type, name, line: lineNumberAt(text, match.index ?? 0) });
    }
  }
  return symbols;
}

function extractRustFacts(text) {
  const codeText = stripNonCode(text);
  const symbols = extractRustSymbols(codeText);
  return {
    imports: extractRustImports(codeText),
    exports: symbols.filter((s) => s.isPublic).map((s) => s.name),
    symbols: symbols.map(({ isPublic: _isPublic, ...rest }) => rest),
  };
}

function extractRustImports(text) {
  const imports = new Set();
  for (const match of text.matchAll(/^\s*use\s+([A-Za-z_][\w:]*(?:::[\w:{}*,\s]+)?)\s*;/gm)) {
    const cleaned = match[1].replace(/\s+/g, "");
    imports.add(cleaned);
  }
  return [...imports].slice(0, 100);
}

function extractRustSymbols(text) {
  const symbols = [];
  const seen = new Set();
  const visibility = "(?:pub(?:\\s*\\([^)]*\\))?)";
  const definitions = [
    { type: "mod", pattern: new RegExp(`^[ \\t]*(${visibility}\\s+)?mod\\s+([A-Za-z_]\\w*)`, "gm") },
    { type: "struct", pattern: new RegExp(`^[ \\t]*(${visibility}\\s+)?struct\\s+([A-Za-z_]\\w*)`, "gm") },
    { type: "enum", pattern: new RegExp(`^[ \\t]*(${visibility}\\s+)?enum\\s+([A-Za-z_]\\w*)`, "gm") },
    { type: "trait", pattern: new RegExp(`^[ \\t]*(${visibility}\\s+)?(?:unsafe\\s+)?trait\\s+([A-Za-z_]\\w*)`, "gm") },
    {
      type: "function",
      pattern: new RegExp(`^[ \\t]*(${visibility}\\s+)?(?:async\\s+|unsafe\\s+|const\\s+|extern\\s+(?:"[^"]+"\\s+)?)*fn\\s+([A-Za-z_]\\w*)`, "gm"),
    },
    { type: "type", pattern: new RegExp(`^[ \\t]*(${visibility}\\s+)?type\\s+([A-Za-z_]\\w*)`, "gm") },
  ];
  for (const definition of definitions) {
    for (const match of text.matchAll(definition.pattern)) {
      const name = match[2];
      if (!name) continue;
      const key = `${definition.type}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const isPublic = Boolean(match[1]);
      symbols.push({ type: definition.type, name, line: lineNumberAt(text, match.index ?? 0), isPublic });
    }
  }
  return symbols;
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

function stripNonCode(text) {
  const chars = [];
  let index = 0;
  while (index < text.length) {
    const next = skipNonCode(text, index);
    if (next !== index) {
      for (let cursor = index; cursor < next; cursor += 1) {
        chars.push(text[cursor] === "\n" ? "\n" : " ");
      }
      index = next;
      continue;
    }

    chars.push(text[index]);
    index += 1;
  }
  return chars.join("");
}

function readDecoratorCalls(text, names) {
  const calls = [];
  let index = 0;
  while (index < text.length) {
    const next = skipNonCode(text, index);
    if (next !== index) {
      index = next;
      continue;
    }

    if (text[index] !== "@") {
      index += 1;
      continue;
    }

    const name = names.find((candidate) => text.startsWith(candidate, index + 1) && !isIdentifierChar(text[index + 1 + candidate.length]));
    if (!name) {
      index += 1;
      continue;
    }

    let cursor = skipWhitespace(text, index + 1 + name.length);
    let argument;
    if (text[cursor] === "(") {
      const parsed = parseFirstCallArgument(text, cursor);
      argument = parsed.value;
      cursor = parsed.end;
    }
    calls.push({ name, argument });
    index = Math.max(cursor, index + 1);
  }
  return calls;
}

function readStringCallArguments(text, callee) {
  const args = [];
  let index = 0;
  while (index < text.length) {
    const next = skipNonCode(text, index);
    if (next !== index) {
      index = next;
      continue;
    }

    const before = text[index - 1];
    const after = text[index + callee.length];
    if (!text.startsWith(callee, index) || isIdentifierChar(before) || isIdentifierChar(after)) {
      index += 1;
      continue;
    }

    const openParen = skipWhitespace(text, index + callee.length);
    if (text[openParen] !== "(") {
      index += 1;
      continue;
    }

    const parsed = parseFirstCallArgument(text, openParen);
    if (parsed.value) {
      args.push(parsed.value);
    }
    index = Math.max(parsed.end, index + 1);
  }
  return args;
}

function parseFirstCallArgument(text, openParenIndex) {
  let cursor = skipWhitespace(text, openParenIndex + 1);
  if (text[cursor] === ")" || cursor >= text.length) {
    return { value: "", end: cursor + 1 };
  }

  if (isQuote(text[cursor])) {
    const parsed = parseStringLiteral(text, cursor);
    return { value: parsed.value, end: findClosingParen(text, parsed.end) };
  }

  return { value: undefined, end: findClosingParen(text, cursor) };
}

function findClosingParen(text, start) {
  let depth = 1;
  let index = start;
  while (index < text.length) {
    const next = skipNonCode(text, index);
    if (next !== index) {
      index = next;
      continue;
    }
    if (text[index] === "(") {
      depth += 1;
    } else if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return text.length;
}

function skipNonCode(text, index) {
  if (text[index] === "/" && text[index + 1] === "/") {
    const newline = text.indexOf("\n", index + 2);
    return newline === -1 ? text.length : newline;
  }
  if (text[index] === "/" && text[index + 1] === "*") {
    const end = text.indexOf("*/", index + 2);
    return end === -1 ? text.length : end + 2;
  }
  if (isQuote(text[index])) {
    return parseStringLiteral(text, index).end;
  }
  return index;
}

function parseStringLiteral(text, start) {
  const quote = text[start];
  let value = "";
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      if (index + 1 < text.length) {
        value += text[index + 1];
      }
      index += 2;
      continue;
    }
    if (char === quote) {
      return { value, end: index + 1 };
    }
    if (quote === "`" && char === "$" && text[index + 1] === "{") {
      return { value, end: skipTemplateLiteral(text, start) };
    }
    value += char;
    index += 1;
  }
  return { value, end: text.length };
}

function skipTemplateLiteral(text, start) {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] === "`") {
      return index + 1;
    }
    index += 1;
  }
  return text.length;
}

function skipWhitespace(text, index) {
  let cursor = index;
  while (/\s/.test(text[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function isQuote(char) {
  return char === "'" || char === '"' || char === "`";
}

function isIdentifierChar(char) {
  return Boolean(char && /[A-Za-z0-9_$]/.test(char));
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
