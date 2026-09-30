#!/usr/bin/env node
// Renames the project across every tracked file: contents and paths.
//
//   node scripts/rebrand.mjs plan  [--path <repo>] [--config <file>] [--manifest <file>]
//   node scripts/rebrand.mjs apply [--path <repo>] [--config <file>] [--manifest <file>]
//   node scripts/rebrand.mjs check [--path <repo>] [--config <file>]
//
// The names live in `.rebrandrc.json` at the repo root, never in this file, so
// the tool does not rewrite itself:
//
//   { "from": "<old>", "to": "<new>", "aliases": { "<old display>": "<New>" },
//     "keep": ["CHANGELOG.md", "some/dir/"], "preserve": ["example.com/<old>/v/"] }
//
// `from` is replaced case-preserving: lower, Capitalised and UPPER forms map to
// the same form of `to`, which also covers camelCase and PascalCase
// identifiers. A mixed-case spelling is left alone and reported, since there
// is no honest guess for it. `aliases` are exact strings (a display name with
// diacritics) matched in both NFC and NFD. Files under `keep` and lines holding
// the marker `rebrand-keep` are never touched, and `preserve` strings survive
// wherever they appear: links to things published under the old name, which
// keep living there. Only git-tracked text files are read, so ignored folders
// such as frozen evidence runs stay as they are.
//
// `plan` changes nothing. `apply` rewrites contents, then `git mv`s every path
// that holds the old name. `check` exits non-zero while any old name remains,
// which is the CI guard once the rename has landed. Running `apply` twice makes
// no changes the second time.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CONFIG_FILE = ".rebrandrc.json";
export const KEEP_MARKER = "rebrand-keep";

/**
 * @param {unknown} raw
 */
export function validateConfig(raw) {
  if (!raw || typeof raw !== "object") throw new Error("rebrand config must be an object");
  const cfg = /** @type {Record<string, unknown>} */ (raw);
  const from = String(cfg.from ?? "").trim();
  const to = String(cfg.to ?? "").trim();
  if (!/^[a-z][a-z0-9]*$/i.test(from)) throw new Error(`"from" must be a plain word, got "${from}"`);
  if (!/^[a-z][a-z0-9]*$/i.test(to)) throw new Error(`"to" must be a plain word, got "${to}"`);
  if (to.toLowerCase().includes(from.toLowerCase())) throw new Error(`"to" (${to}) contains "from" (${from}); the rename would never converge`);
  const aliases = /** @type {Record<string, string>} */ (cfg.aliases && typeof cfg.aliases === "object" ? cfg.aliases : {});
  const keep = Array.isArray(cfg.keep) ? cfg.keep.map(String) : [];
  // Longest first, so a preserved string that contains another is masked whole.
  const preserve = (Array.isArray(cfg.preserve) ? cfg.preserve.map(String) : []).filter(Boolean).sort((a, b) => b.length - a.length);
  return { from: from.toLowerCase(), to: to.toLowerCase(), aliases, keep, preserve };
}

/** @typedef {ReturnType<typeof validateConfig>} RebrandConfig */

/**
 * @param {string} s
 */
function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Maps one match of `from` to the same case form of `to`, or null when the
 * match is mixed case.
 * @param {string} match
 * @param {string} to
 */
export function mapCase(match, to) {
  if (match === match.toLowerCase()) return to;
  if (match === match.toUpperCase()) return to.toUpperCase();
  if (match === capitalise(match.toLowerCase())) return capitalise(to);
  return null;
}

/**
 * @param {string} s
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {RebrandConfig} cfg
 */
function aliasPairs(cfg) {
  /** @type {Array<[string, string]>} */
  const pairs = [];
  for (const [alias, target] of Object.entries(cfg.aliases)) {
    for (const form of new Set([alias, alias.normalize("NFC"), alias.normalize("NFD")])) pairs.push([form, target]);
  }
  // Longest first so an alias that contains another wins.
  return pairs.sort((a, b) => b[0].length - a[0].length);
}

/**
 * Rewrites one line. Returns the new line, how many replacements it made and
 * any mixed-case spellings it had to leave.
 * @param {string} line
 * @param {RebrandConfig} cfg
 */
export function rewriteLine(line, cfg) {
  if (line.includes(KEEP_MARKER)) return { line, count: 0, unhandled: /** @type {string[]} */ ([]) };
  let count = 0;
  /** @type {string[]} */
  const unhandled = [];
  // Preserved strings are swapped for NUL-delimited placeholders, which no
  // text file holds and no rule can match, then swapped back at the end.
  let out = cfg.preserve.reduce((acc, keep, i) => acc.split(keep).join(`\0${i}\0`), line);
  for (const [alias, target] of aliasPairs(cfg)) {
    const parts = out.split(alias);
    if (parts.length > 1) {
      count += parts.length - 1;
      out = parts.join(target);
    }
  }
  out = out.replace(new RegExp(escapeRegExp(cfg.from), "gi"), (match) => {
    const mapped = mapCase(match, cfg.to);
    if (mapped === null) {
      unhandled.push(match);
      return match;
    }
    count += 1;
    return mapped;
  });
  out = out.replace(/\0(\d+)\0/g, (_, i) => cfg.preserve[Number(i)]);
  return { line: out, count, unhandled };
}

/**
 * @param {string} text
 * @param {RebrandConfig} cfg
 */
export function rewriteText(text, cfg) {
  let count = 0;
  /** @type {Array<{ line: number, text: string }>} */
  const unhandled = [];
  const lines = text.split("\n").map((line, i) => {
    const result = rewriteLine(line, cfg);
    count += result.count;
    for (const _ of result.unhandled) unhandled.push({ line: i + 1, text: line.trim() });
    return result.line;
  });
  return { text: lines.join("\n"), count, unhandled };
}

/**
 * Rewrites each path segment with the same rules as file contents.
 * @param {string} relPath
 * @param {RebrandConfig} cfg
 */
export function rewritePath(relPath, cfg) {
  return relPath
    .split("/")
    .map((segment) => rewriteLine(segment, cfg).line)
    .join("/");
}

/**
 * @param {string} relPath
 * @param {RebrandConfig} cfg
 */
export function isKept(relPath, cfg) {
  if (relPath === CONFIG_FILE) return true;
  return cfg.keep.some((entry) => (entry.endsWith("/") ? relPath.startsWith(entry) : relPath === entry));
}

/**
 * @param {Buffer} buf
 */
function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

/**
 * @param {string} repo
 * @param {string[]} args
 */
function git(repo, args) {
  const res = spawnSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${res.stderr.trim()}`);
  return res.stdout;
}

/**
 * @param {string} repo
 */
function trackedFiles(repo) {
  return git(repo, ["ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .filter((f) => fs.existsSync(path.join(repo, f)));
}

/**
 * Computes every change without writing anything.
 * @param {string} repo
 * @param {RebrandConfig} cfg
 */
export function planRebrand(repo, cfg) {
  /** @type {Array<{ file: string, count: number, next: string }>} */
  const edits = [];
  /** @type {Array<{ from: string, to: string }>} */
  const renames = [];
  /** @type {Array<{ file: string, line: number, text: string }>} */
  const unhandled = [];
  for (const file of trackedFiles(repo)) {
    if (isKept(file, cfg)) continue;
    const buf = fs.readFileSync(path.join(repo, file));
    if (!isBinary(buf)) {
      const result = rewriteText(buf.toString("utf8"), cfg);
      if (result.count > 0) edits.push({ file, count: result.count, next: result.text });
      for (const u of result.unhandled) unhandled.push({ file, ...u });
    }
    const target = rewritePath(file, cfg);
    if (target !== file) renames.push({ from: file, to: target });
  }
  return { edits, renames, unhandled };
}

/**
 * @param {string} repo
 * @param {string} dir
 */
function removeEmptyDirs(repo, dir) {
  let current = dir;
  while (current && current !== ".") {
    const abs = path.join(repo, current);
    if (!fs.existsSync(abs) || fs.readdirSync(abs).length > 0) return;
    fs.rmdirSync(abs);
    current = path.dirname(current);
  }
}

/**
 * @param {string} repo
 * @param {ReturnType<typeof planRebrand>} plan
 */
export function applyRebrand(repo, plan) {
  for (const edit of plan.edits) fs.writeFileSync(path.join(repo, edit.file), edit.next);
  for (const rename of plan.renames) {
    if (fs.existsSync(path.join(repo, rename.to))) throw new Error(`cannot rename ${rename.from}: ${rename.to} already exists`);
    fs.mkdirSync(path.dirname(path.join(repo, rename.to)), { recursive: true });
    git(repo, ["mv", rename.from, rename.to]);
    removeEmptyDirs(repo, path.dirname(rename.from));
  }
}

/**
 * @param {ReturnType<typeof planRebrand>} plan
 */
export function manifestOf(plan) {
  return {
    edits: plan.edits.map(({ file, count }) => ({ file, count })),
    renames: plan.renames,
    unhandled: plan.unhandled,
    totals: {
      files: plan.edits.length,
      replacements: plan.edits.reduce((sum, e) => sum + e.count, 0),
      renames: plan.renames.length,
      unhandled: plan.unhandled.length,
    },
  };
}

/**
 * @param {string} repo
 * @param {string} [configPath]
 */
export function loadConfig(repo, configPath) {
  const file = configPath ? path.resolve(configPath) : path.join(repo, CONFIG_FILE);
  if (!fs.existsSync(file)) throw new Error(`no rebrand config at ${file}`);
  return validateConfig(JSON.parse(fs.readFileSync(file, "utf8")));
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const [command, ...rest] = argv;
  /** @type {Record<string, string>} */
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    if (!key.startsWith("--")) throw new Error(`unexpected argument: ${key}`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${key} needs a value`);
    flags[key.slice(2)] = value;
    i += 1;
  }
  return { command, flags };
}

/**
 * @param {ReturnType<typeof manifestOf>} manifest
 * @param {string} verb
 */
function printSummary(manifest, verb) {
  for (const e of manifest.edits) console.log(`  edit   ${e.file} (${e.count})`);
  for (const r of manifest.renames) console.log(`  rename ${r.from} -> ${r.to}`);
  for (const u of manifest.unhandled) console.log(`  MIXED  ${u.file}:${u.line} ${u.text}`);
  const t = manifest.totals;
  console.log(
    `${verb}: ${t.replacements} replacement(s) in ${t.files} file(s), ${t.renames} rename(s), ${t.unhandled} mixed-case spelling(s) left for a human`,
  );
}

/**
 * @param {string[]} argv
 */
export function main(argv) {
  const { command, flags } = parseArgs(argv);
  if (!["plan", "apply", "check"].includes(command)) {
    console.error("usage: rebrand.mjs <plan|apply|check> [--path <repo>] [--config <file>] [--manifest <file>]");
    return 2;
  }
  const repo = path.resolve(flags.path ?? ".");
  const cfg = loadConfig(repo, flags.config);
  const plan = planRebrand(repo, cfg);
  const manifest = manifestOf(plan);
  if (command === "check") {
    const total = manifest.totals.replacements + manifest.totals.renames + manifest.totals.unhandled;
    if (total === 0) {
      console.log(`rebrand check: no "${cfg.from}" left outside kept files`);
      return 0;
    }
    printSummary(manifest, `rebrand check FAILED, "${cfg.from}" still present`);
    return 1;
  }
  if (flags.manifest) {
    fs.mkdirSync(path.dirname(path.resolve(flags.manifest)), { recursive: true });
    fs.writeFileSync(path.resolve(flags.manifest), JSON.stringify(manifest, null, 2) + "\n");
  }
  if (command === "apply") applyRebrand(repo, plan);
  printSummary(manifest, command === "apply" ? "applied" : "plan (nothing written)");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    console.error(`rebrand: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 2;
  }
}
