import path from "node:path";
import ts from "typescript";
import { lineNumberAt, readStringCallArguments, stripNonCode } from "./text.js";
import { extractCsharpFacts, extractGoFacts, extractJavaFacts, extractPythonFacts, extractRubyFacts, extractRustFacts } from "./ast-languages.js";

/**
 * A code symbol extracted from a source file.
 * @typedef {object} CodeSymbol
 * @property {string} type
 * @property {string} name
 * @property {number} line
 */

/**
 * Language-agnostic AST facts extracted for a single file.
 * @typedef {object} AstFacts
 * @property {string[]} imports
 * @property {string[]} exports
 * @property {CodeSymbol[]} symbols
 */

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

/**
 * @param {string} relativePath
 * @param {string} text
 * @returns {AstFacts}
 */
export function extractAstFacts(relativePath, text) {
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
      /** @type {Set<string>} */
      imports: new Set(),
      /** @type {Set<string>} */
      exports: new Set(),
      /** @type {CodeSymbol[]} */
      symbols: [],
    };
    /** @type {Set<string>} */
    const seenSymbols = new Set();

    visit(sourceFile);
    return {
      imports: [...facts.imports].slice(0, 100),
      exports: [...facts.exports].slice(0, 100),
      symbols: facts.symbols,
    };

    /** @param {ts.Node} node */
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

/**
 * @param {string} file
 * @returns {ts.ScriptKind}
 */
function scriptKindForFile(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".tsx" || extension === ".jsx") return ts.ScriptKind.TSX;
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * @param {ts.Node} node
 * @param {Set<string>} imports
 */
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

/**
 * @param {ts.Node} node
 * @param {Set<string>} exports
 */
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

/**
 * @param {ts.Node | undefined} node
 * @returns {node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral}
 */
function isStringLiteralNode(node) {
  return Boolean(node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)));
}

/**
 * @param {ts.SourceFile} sourceFile
 * @param {ts.Node} node
 * @param {CodeSymbol[]} symbols
 * @param {Set<string>} seen
 */
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

/**
 * @param {ts.SourceFile} sourceFile
 * @param {ts.Node} node
 * @returns {CodeSymbol | undefined}
 */
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
    const declaration = node.declarationList.declarations.find(
      /** @returns {item is ts.VariableDeclaration & { name: ts.Identifier }} */
      (item) => ts.isIdentifier(item.name),
    );
    if (declaration) {
      return symbol(sourceFile, declaration, variableKind(node), declaration.name.text);
    }
  }
  return undefined;
}

/**
 * @param {ts.SourceFile} sourceFile
 * @param {ts.Node} node
 * @param {string} type
 * @param {string} name
 * @returns {CodeSymbol}
 */
function symbol(sourceFile, node, type, name) {
  return {
    type,
    name,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
  };
}

/**
 * @param {ts.Node} node
 * @returns {string[]}
 */
function declarationNames(node) {
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations
      .filter(
        /** @returns {declaration is ts.VariableDeclaration & { name: ts.Identifier }} */
        (declaration) => ts.isIdentifier(declaration.name),
      )
      .map((declaration) => declaration.name.text);
  }
  // `name` exists on most declaration node types but not on ts.Node generally.
  const named = /** @type {{ name?: { text?: string } }} */ (node);
  return named.name?.text ? [named.name.text] : [];
}

/**
 * @param {ts.Node} node
 * @returns {boolean}
 */
function hasExportModifier(node) {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword));
}

/**
 * @param {ts.VariableStatement} node
 * @returns {"const" | "let" | "var"}
 */
function variableKind(node) {
  const flags = node.declarationList.flags;
  if (flags & ts.NodeFlags.Const) return "const";
  if (flags & ts.NodeFlags.Let) return "let";
  return "var";
}

/**
 * @param {ts.Node} node
 * @returns {boolean}
 */
function isTopLevelNode(node) {
  return ts.isSourceFile(node.parent);
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractImports(text) {
  /** @type {Set<string>} */
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

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractExports(text) {
  /** @type {Set<string>} */
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

/**
 * @param {string} text
 * @returns {CodeSymbol[]}
 */
function extractSymbols(text) {
  /** @type {CodeSymbol[]} */
  const symbols = [];
  /** @type {Set<string>} */
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
