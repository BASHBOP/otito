// Ranking rules the context engine and the impact engine share. Each answers a
// question both engines got wrong on the same real request (bashbop-event-web,
// 2026-09-27; the recorded outputs are in .solumbe/runs/2026-09-27/):
//
// - A translation catalog holds thousands of keys, so it matched almost any
//   plain-language request, and its five locales took five ranked slots.
// - `event-service.ts` in a request tokenized to `event service ts`, and `ts`
//   then matched the extension of every TypeScript file in the repository.
// - A file or a symbol the request named outright ranked wherever its word
//   overlap happened to leave it: 40th, in the recorded case.

/// <reference types="node" />
import path from "node:path";
import { localeCatalogKey, localeOf } from "./code-map/classify.js";

/**
 * @typedef {import('./index-cache.js').CodeMapFile} CodeMapFile
 */

/**
 * A file the request names: by path or basename (`rule: "path"`), or as the
 * definition of a symbol the request names (`rule: "symbol"`).
 * @typedef {object} NamedFile
 * @property {string} path
 * @property {"path" | "symbol"} rule
 * @property {string} literal - the text in the request that named it
 * @property {number} [line] - the defining line, for a named symbol
 * @property {number} [importers] - non-test files importing the definer
 * @property {boolean} [exported]
 */

// A translation catalog is data an implementation reads. The same factor the
// impact engine applies to generated documentation.
export const TRANSLATION_DEMOTION = 0.3;

// A request about the words a user reads, rather than the code, is the one
// request a translation catalog can own.
const COPY_REQUEST_TERMS = new Set([
  "copy",
  "copywriting",
  "microcopy",
  "wording",
  "reword",
  "rephrase",
  "typo",
  "typos",
  "spelling",
  "i18n",
  "l10n",
  "translation",
  "translations",
  "translate",
  "translated",
  "translating",
  "locale",
  "locales",
  "localisation",
  "localization",
  "localise",
  "localize",
  "localised",
  "localized",
  "internationalisation",
  "internationalization",
  "language",
  "languages",
  "multilingual",
]);

/**
 * @param {Iterable<string>} terms lowercased request tokens
 * @returns {boolean}
 */
export function isCopyRequest(terms) {
  for (const term of terms) if (COPY_REQUEST_TERMS.has(term)) return true;
  return false;
}

// Extensions a request can name a file by. The indexer's own extensions, plus
// the common ones it does not index, so `styles.css` still reads as a file.
const NAMED_FILE_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "go",
  "cs",
  "py",
  "java",
  "rb",
  "rs",
  "hbs",
  "handlebars",
  "json",
  "yaml",
  "yml",
  "snap",
  "md",
  "mdx",
  "markdown",
  "css",
  "scss",
  "sass",
  "less",
  "html",
  "vue",
  "svelte",
  "sql",
  "prisma",
  "graphql",
  "gql",
  "sh",
  "toml",
  "kt",
  "swift",
  "php",
];
const extensionAlternation = NAMED_FILE_EXTENSIONS.join("|");
const trailingExtension = new RegExp(`\\.(?:${extensionAlternation})$`, "i");
const inlineExtension = new RegExp(`(?<=[\\w$\\])-])\\.(?:${extensionAlternation})(?![\\w$])`, "gi");

/**
 * Drop the extension from every file name a request mentions, so the words of
 * `event-service.ts` still score and `ts` does not: an extension is shared by
 * every file of that language, which makes it evidence for none of them.
 * @param {string} request
 * @returns {string}
 */
export function stripFileExtensions(request) {
  return String(request ?? "").replace(inlineExtension, "");
}

/**
 * The literal references in a request: path-shaped text (`services/event-service.ts`,
 * `EditableDate.tsx`, `utils/create-event`) and identifier-shaped words
 * (`combineDateAndTime`, `EventService`, `date_of_birth`). A plain word is
 * neither: it is ranked by overlap, as before.
 * @param {string} request
 * @returns {{ paths: string[], symbols: string[] }}
 */
export function requestLiterals(request) {
  const text = String(request ?? "");
  /** @type {Set<string>} */
  const paths = new Set();
  /** @type {Array<[number, number]>} */
  const fileNameSpans = [];
  for (const match of text.matchAll(/[^\s`'"<>,;|]+/g)) {
    const literal = match[0]
      .replace(/^[([{]+/, "")
      .replace(/[.,:;!?)\]}]+$/, "")
      .replace(/#L\d+.*$/i, "")
      .replace(/:\d+(?::\d+)?$/, "")
      .replace(/^\.?\//, "");
    if (!literal || literal.includes("://")) continue;
    if (trailingExtension.test(literal) && /[\w$\])-]\.[a-z]+$/i.test(literal)) {
      paths.add(literal);
      fileNameSpans.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
    } else if (/^[\w.@$()[\]-]+(?:\/[\w.@$()[\]-]+)+$/.test(literal)) {
      paths.add(literal);
    }
  }

  /** @type {Set<string>} */
  const symbols = new Set();
  for (const match of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const start = match.index ?? 0;
    // `EditableDate` inside `EditableDate.tsx` names the file, not a symbol.
    if (fileNameSpans.some(([from, to]) => start >= from && start < to)) continue;
    if (isIdentifierShaped(match[0])) symbols.add(match[0]);
  }
  return { paths: [...paths], symbols: [...symbols] };
}

/**
 * camelCase, PascalCase with a second hump, an acronym run into a word, or
 * snake_case: the shapes code names things in and prose does not.
 * @param {string} word
 * @returns {boolean}
 */
function isIdentifierShaped(word) {
  return /[a-z0-9][A-Z]/.test(word) || /[A-Z]{2}[a-z]/.test(word) || /[A-Za-z0-9]_[A-Za-z0-9]/.test(word);
}

// A literal that resolves to more files than this is a common name
// (`index.ts`, `page.tsx`), not a reference to one of them.
const MAX_FILES_PER_LITERAL = 3;
// A symbol defined in more files than this is a common helper name
// (`formatDate` has twelve definitions in bashbop-event-web).
const MAX_DEFINERS_PER_SYMBOL = 3;
// Symbols the indexer reads from data and prose rather than code: JSON and
// YAML keys, Markdown headings and frontmatter, Handlebars references.
const ARTIFACT_SYMBOL_TYPES = new Set(["config", "heading", "frontmatter", "template"]);

/**
 * The files a request names outright. A named path or basename is pinned. A
 * named symbol pins the file that defines, exports and is imported for it —
 * the definition the code actually uses. Its other definitions (a local copy,
 * an export nothing imports) are returned as `definers`, to be surfaced but
 * not pinned.
 * @param {CodeMapFile[]} files
 * @param {string} request
 * @param {{ limit?: number }} [options]
 * @returns {{ pinned: NamedFile[], definers: NamedFile[], symbols: string[] }}
 */
export function resolveNamedFiles(files, request, options = {}) {
  const { paths, symbols } = requestLiterals(request);
  const candidates = files.filter((file) => !file.isVendor);
  /** @type {NamedFile[]} */
  const pinned = [];
  /** @type {Map<string, NamedFile>} */
  const definers = new Map();
  /** @type {Set<string>} */
  const taken = new Set();

  for (const literal of paths) {
    const matches = matchNamedPath(candidates, literal);
    if (matches.length === 0 || matches.length > MAX_FILES_PER_LITERAL) continue;
    for (const file of matches) {
      if (taken.has(file.path)) continue;
      taken.add(file.path);
      pinned.push({ path: file.path, rule: "path", literal });
    }
  }

  /** @type {Map<string, number> | undefined} */
  let importers;
  for (const literal of symbols) {
    const owners = candidates.filter(
      (file) => file.kind !== "test" && (file.symbols ?? []).some((symbol) => symbol.name === literal && !ARTIFACT_SYMBOL_TYPES.has(symbol.type)),
    );
    if (owners.length === 0 || owners.length > MAX_DEFINERS_PER_SYMBOL) continue;
    importers ??= countImporters(files);
    for (const file of owners) {
      const symbol = (file.symbols ?? []).find((item) => item.name === literal && !ARTIFACT_SYMBOL_TYPES.has(item.type));
      const exported = (file.exports ?? []).includes(literal);
      /** @type {NamedFile} */
      const named = { path: file.path, rule: "symbol", literal, line: symbol?.line, importers: importers.get(file.path) ?? 0, exported };
      if (exported && (named.importers ?? 0) > 0) {
        if (taken.has(file.path)) continue;
        taken.add(file.path);
        pinned.push(named);
      } else if (!definers.has(file.path)) {
        definers.set(file.path, named);
      }
    }
  }

  const limit = options.limit ?? pinned.length;
  return { pinned: pinned.slice(0, limit), definers: [...definers.values()].filter((named) => !taken.has(named.path)), symbols };
}

/**
 * @param {CodeMapFile[]} files
 * @param {string} literal
 * @returns {CodeMapFile[]}
 */
function matchNamedPath(files, literal) {
  const wanted = literal.toLowerCase();
  const stem = (/** @type {string} */ value) => value.replace(/\.[^./]+$/, "");
  /** @param {(value: string) => string} shape */
  const matching = (shape) =>
    files.filter((file) => {
      const candidate = shape(file.path.toLowerCase());
      const target = shape(wanted);
      return candidate === target || candidate.endsWith(`/${target}`);
    });
  if (!trailingExtension.test(wanted)) return matching(stem);
  const exact = matching((value) => value);
  // `event-service.js` in a TypeScript ESM repository names `event-service.ts`.
  return exact.length ? exact : matching(stem);
}

const importSuffixes = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];

/**
 * How many non-test files import each file, resolving relative specifiers and
 * the root aliases (`@/`, `~/`, `#/`) that application code uses for most of
 * its imports. Bare package specifiers name dependencies, not files.
 * @param {CodeMapFile[]} files
 * @returns {Map<string, number>}
 */
function countImporters(files) {
  const fileSet = new Set(files.map((file) => file.path));
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const file of files) {
    if (file.kind === "test" || file.isVendor) continue;
    /** @type {Set<string>} */
    const targets = new Set();
    for (const specifier of file.imports ?? []) {
      const target = resolveImportSpecifier(file.path, specifier, fileSet);
      if (target && target !== file.path) targets.add(target);
    }
    for (const target of targets) counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return counts;
}

/**
 * @param {string} fromPath
 * @param {string} specifier
 * @param {Set<string>} fileSet
 * @returns {string | undefined}
 */
function resolveImportSpecifier(fromPath, specifier, fileSet) {
  /** @type {string[]} */
  let bases;
  if (specifier.startsWith(".")) {
    bases = [path.posix.join(path.posix.dirname(fromPath), specifier)];
  } else {
    const alias = /^[@~#]\/(.+)$/.exec(specifier);
    if (!alias) return undefined;
    bases = [alias[1], `src/${alias[1]}`];
  }
  for (const base of bases) {
    const normalized = path.posix.normalize(base).replace(/^\.\//, "");
    // TypeScript ESM imports name the emitted `.js`; the source is `.ts`.
    const stems = /\.[cm]?js$/.test(normalized) ? [normalized, normalized.replace(/\.([cm]?)js$/, ".$1ts"), normalized.replace(/\.js$/, ".tsx")] : [normalized];
    for (const stem of stems) {
      for (const suffix of importSuffixes) {
        if (fileSet.has(`${stem}${suffix}`)) return `${stem}${suffix}`;
      }
    }
  }
  return undefined;
}

/**
 * Fold the locale variants of one translation catalog into its highest-ranked
 * member, keeping list order, and record the others in that member's
 * `siblings`. A catalog is one owner whatever the number of locales it ships
 * in; five locales used to take five of twelve ranked slots. An entry
 * `isPinned` marks (exact Git diff evidence, a file the request names) is
 * never folded away.
 * @template {{ siblings?: string[] }} T
 * @param {T[]} entries in rank order
 * @param {(entry: T) => { path: string, kind: string, scope?: string }} describe
 * @param {(entry: T) => boolean} [isPinned]
 * @returns {T[]}
 */
export function collapseLocaleSiblings(entries, describe, isPinned = () => false) {
  /** @type {Map<string, T>} */
  const heads = new Map();
  /** @type {T[]} */
  const kept = [];
  for (const entry of entries) {
    const { path: filePath, kind, scope = "" } = describe(entry);
    const catalog = kind === "translation" ? localeCatalogKey(filePath) : null;
    const group = catalog ? `${scope}\0${catalog}` : null;
    const head = group ? heads.get(group) : undefined;
    if (!group || !head || isPinned(entry)) {
      if (group && !head) heads.set(group, entry);
      kept.push(entry);
      continue;
    }
    head.siblings = [...new Set([...(head.siblings ?? []), filePath, ...(entry.siblings ?? [])])];
  }
  return kept;
}

/**
 * `en-NG, en-US, fr` for a list of sibling catalog paths.
 * @param {string[]} siblings
 * @returns {string}
 */
export function formatLocales(siblings) {
  return siblings.map((sibling) => localeOf(sibling) ?? sibling).join(", ");
}
