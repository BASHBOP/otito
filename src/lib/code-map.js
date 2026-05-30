import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { inspectRepo, listRepoFiles } from "./repo.js";
import { estimateTokens, estimateTokenSections } from "./tokens.js";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".go", ".cs"]);
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
  return {
    path: relativePath,
    kind: classifyFile(relativePath),
    domain: inferDomain(relativePath),
    route: inferNextRoute(relativePath),
    controllerBasePath: inferControllerBasePath(text),
    httpMethods: extractHttpMethods(text),
    imports: ast.imports,
    exports: ast.exports,
    symbols: ast.symbols.slice(0, maxSymbols),
  };
}

function extractAstFacts(relativePath, text) {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === ".go") {
    return extractGoFacts(text);
  }
  if (ext === ".cs") {
    return extractCsharpFacts(text);
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
  const normalized = file.replaceAll("\\", "/").replace(/^src\//, "");
  const parts = normalized.split("/");
  if (normalized.startsWith("app/api/") && parts[2]) {
    return cleanDomain(parts[2]);
  }
  if ((parts[0] === "app" || parts[0] === "pages") && parts[1]) {
    return cleanDomain(parts[1]);
  }
  if (normalized.startsWith("redux/apis/") && parts[2]) {
    return cleanDomain(parts[2].replace(/-api\.[jt]s$/, "").replace(/-apis\.[jt]s$/, ""));
  }
  if (normalized.startsWith("services/") && parts[1]) {
    return cleanDomain(parts[1].replace(/-service\.[jt]s$/, ""));
  }
  const sharedRoots = new Set(["components", "lib", "utils", "schemas", "hooks", "types"]);
  if (sharedRoots.has(parts[0])) {
    return cleanDomain(parts[0]);
  }
  const interestingRoots = new Set(["app", "src", "redux", "services"]);
  if (interestingRoots.has(parts[0]) && parts[1]) {
    return cleanDomain(parts[1]);
  }
  return cleanDomain(parts[0] ?? "root");
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
      const isPublic = definition.alwaysPublic
        ? true
        : Boolean(match[1] && /\bpublic\b/.test(match[1]));
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
    "if", "for", "foreach", "while", "switch", "using", "lock", "catch", "try",
    "finally", "fixed", "do", "else", "return", "throw", "new", "checked", "unchecked",
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
    const domain = domains.get(file.domain) ?? { name: file.domain, fileCount: 0, kinds: new Map() };
    domain.fileCount += 1;
    domain.kinds.set(file.kind, (domain.kinds.get(file.kind) ?? 0) + 1);
    domains.set(file.domain, domain);
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
