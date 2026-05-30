import fs from "node:fs";
import path from "node:path";
import { inspectRepo } from "./repo.js";
import { generateCodeMap } from "./code-map.js";
import { generateHarness } from "./harness.js";
import { generateContextPack } from "./context-engine.js";

const DEFAULTS = {
  query: "understand and refactor this codebase",
  naiveFileCap: 40,
};

const SOURCE_EXTS = new Set([
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".cs",
  ".vb",
  ".aspx",
  ".master",
  ".cshtml",
  ".razor",
  ".php",
  ".scala",
  ".clj",
  ".ex",
  ".exs",
  ".html",
  ".vue",
  ".svelte",
  ".astro",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".config",
]);

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".dev-context",
  "bin",
  "obj",
  "coverage",
  "site",
  "vendor",
  ".venv",
  "__pycache__",
  "target",
  ".cache",
  ".turbo",
]);

const CHARS_PER_TOKEN = 4;

export function runEval(repoPath, options = {}) {
  const root = path.resolve(repoPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`repo not found: ${root}`);
  }
  const opts = { ...DEFAULTS, ...options };

  const tasks = [runRepoOverview(root), runCodeMap(root, opts), runHarness(root), runContextPack(root, opts)];

  const totals = aggregate(tasks);

  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    evalVersion: 1,
    repo: { root, name: path.basename(root) },
    method: `ceil(characters / ${CHARS_PER_TOKEN})`,
    query: opts.query,
    naiveFileCap: opts.naiveFileCap,
    tasks,
    totals,
  };

  return { data, markdown: formatEvalMarkdown(data) };
}

function runRepoOverview(root) {
  const repoctx = safeRun(() => {
    const result = inspectRepo(root);
    return JSON.stringify(result);
  });

  let naiveBytes = naiveListing(root).length;
  for (const f of ["README.md", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "Web.config"]) {
    const p = path.join(root, f);
    if (isFile(p)) naiveBytes += statSize(p);
  }

  return makeTaskResult("repo_overview", "Identify what this repo is", repoctx, naiveBytes);
}

function runCodeMap(root, opts) {
  let mapFileCount;
  const repoctx = safeRun(() => {
    const map = generateCodeMap(root);
    mapFileCount = (map.files ?? []).length;
    return JSON.stringify(map);
  });

  const sources = listSourceFiles(root).slice(0, opts.naiveFileCap);
  const naiveBytes = sources.reduce((sum, p) => sum + statSize(p), 0);

  return makeTaskResult("code_map", `Map the source (naive caps at ${opts.naiveFileCap} files)`, repoctx, naiveBytes, {
    mapFileCount,
    naiveFileCount: sources.length,
  });
}

function runHarness(root) {
  const repoctx = safeRun(() => {
    const result = generateHarness(root);
    return result.markdown ?? JSON.stringify(result.data);
  });

  let naiveBytes = 0;
  const candidates = ["package.json", "Makefile", "justfile", "pyproject.toml", "Cargo.toml", "go.mod", "Gemfile", "WebProject.csproj", "packages.config"];
  for (const f of candidates) {
    const p = path.join(root, f);
    if (isFile(p)) naiveBytes += statSize(p);
  }
  const ciDir = path.join(root, ".github", "workflows");
  if (isDir(ciDir)) {
    for (const f of readDirSafe(ciDir)) {
      const p = path.join(ciDir, f);
      if (isFile(p)) naiveBytes += statSize(p);
    }
  }

  return makeTaskResult("harness", "Identify setup/validation/runtime commands", repoctx, naiveBytes);
}

function runContextPack(root, opts) {
  const repoctx = safeRun(() => {
    const result = generateContextPack(opts.query, { path: root });
    return result.markdown ?? JSON.stringify(result.data ?? result);
  });

  const sources = listSourceFiles(root).slice(0, opts.naiveFileCap);
  const naiveBytes = sources.reduce((sum, p) => sum + statSize(p), 0);

  return makeTaskResult("context_pack", `Task-aware context for: "${opts.query}"`, repoctx, naiveBytes);
}

function safeRun(fn) {
  try {
    const text = fn();
    return { ok: true, bytes: Buffer.byteLength(text, "utf8") };
  } catch (err) {
    return { ok: false, bytes: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

function makeTaskResult(name, description, repoctx, naiveBytes, extra = {}) {
  const repoctxTokens = Math.ceil(repoctx.bytes / CHARS_PER_TOKEN);
  const naiveTokens = Math.ceil(naiveBytes / CHARS_PER_TOKEN);
  const savedTokens = naiveTokens - repoctxTokens;
  const savedPct = naiveBytes > 0 ? Math.round(((naiveBytes - repoctx.bytes) / naiveBytes) * 100) : 0;
  return {
    name,
    description,
    ok: repoctx.ok,
    error: repoctx.error,
    repoctxBytes: repoctx.bytes,
    repoctxTokens,
    naiveBytes,
    naiveTokens,
    savedTokens,
    savedPct,
    ...extra,
  };
}

function aggregate(tasks) {
  const repoctxBytes = tasks.reduce((s, t) => s + t.repoctxBytes, 0);
  const naiveBytes = tasks.reduce((s, t) => s + t.naiveBytes, 0);
  const repoctxTokens = Math.ceil(repoctxBytes / CHARS_PER_TOKEN);
  const naiveTokens = Math.ceil(naiveBytes / CHARS_PER_TOKEN);
  return {
    repoctxBytes,
    naiveBytes,
    repoctxTokens,
    naiveTokens,
    savedTokens: naiveTokens - repoctxTokens,
    savedPct: naiveBytes > 0 ? Math.round(((naiveBytes - repoctxBytes) / naiveBytes) * 100) : 0,
  };
}

function naiveListing(root) {
  const lines = [];
  walk(root, root, lines, 0);
  return lines.join("\n");
}

function walk(start, dir, lines, depth) {
  if (depth > 4) return;
  const entries = readDirEnts(dir);
  for (const ent of entries) {
    if (IGNORED_DIRS.has(ent.name)) continue;
    if (depth === 0 && ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    const rel = path.relative(start, full);
    lines.push(rel + (ent.isDirectory() ? "/" : ""));
    if (ent.isDirectory()) walk(start, full, lines, depth + 1);
  }
}

function listSourceFiles(root) {
  const out = [];
  walkFiles(root, out);
  out.sort();
  return out;
}

function walkFiles(dir, out) {
  for (const ent of readDirEnts(dir)) {
    if (IGNORED_DIRS.has(ent.name)) continue;
    if (ent.name.startsWith(".")) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(full, out);
    else if (SOURCE_EXTS.has(path.extname(ent.name).toLowerCase())) out.push(full);
  }
}

function readDirEnts(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function readDirSafe(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function statSize(p) {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

export function formatEvalMarkdown(data) {
  const lines = [
    `# repoctx Eval: ${data.repo.name}`,
    "",
    `Generated: ${data.generatedAt}`,
    `Eval version: ${data.evalVersion}`,
    `Token method: ${data.method}`,
    `Query (for context_pack): "${data.query}"`,
    `Naive file cap: ${data.naiveFileCap}`,
    "",
    "## Per-task",
    "",
    "| Task | repoctx tokens | naive tokens | saved | saved% | coverage | ok |",
    "|---|---:|---:|---:|---:|:---:|:---:|",
    ...data.tasks.map(
      (t) => `| ${t.name} | ${t.repoctxTokens} | ${t.naiveTokens} | ${t.savedTokens} | ${t.savedPct}% | ${formatCoverage(t)} | ${t.ok ? "yes" : "no"} |`,
    ),
    "",
    "## Totals",
    "",
    `- repoctx: **${data.totals.repoctxTokens} tokens** (${data.totals.repoctxBytes} bytes)`,
    `- naive:   **${data.totals.naiveTokens} tokens** (${data.totals.naiveBytes} bytes)`,
    `- saved:   **${data.totals.savedTokens} tokens (${data.totals.savedPct}%)**`,
    "",
    "_Naive is a deterministic JS-side approximation of what a grep+ls+read agent would absorb, not a live subagent transcript. Same approximation runs on every run, so deltas across builds are the trustworthy signal._",
    "",
    "_Coverage on `code_map` is `files_mapped / files_naive_would_read`. A high savings% with low coverage means repoctx is smaller because it understands less, not because it summarised better — fix the language adapter before celebrating._",
    "",
  ];
  return lines.join("\n");
}

function formatCoverage(t) {
  if (t.mapFileCount === undefined || t.naiveFileCount === undefined) return "-";
  return `${t.mapFileCount}/${t.naiveFileCount}`;
}
