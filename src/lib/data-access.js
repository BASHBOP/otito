import path from "node:path";
import { generateCodeMap } from "./code-map.js";
import { inspectRepo } from "./repo.js";
import { estimateTokens } from "./tokens.js";

/** @typedef {import('./index-cache.js').CodeMapFile} CodeMapFile */
/** @typedef {import('./code-map/data-access.js').DataAccessHit} DataAccessHit */

/**
 * A data-access hit annotated with the owning file's repo-relative path.
 * @typedef {DataAccessHit & { path: string }} Hit
 */

/**
 * One `{ key, count }` aggregation row.
 * @typedef {{ key: string, count: number }} AggregateRow
 */

/**
 * @typedef {object} DataAccessReportOptions
 * @property {number} [maxSymbols] Per-file symbol cap forwarded to generateCodeMap.
 */

/**
 * @param {string} [repoPath]
 * @param {DataAccessReportOptions} [options]
 * @returns {{ data: object, markdown: string }}
 */
export function generateDataAccessReport(repoPath = ".", options = {}) {
  const repo = inspectRepo(repoPath);
  const map = generateCodeMap(repo.root, { maxSymbols: options.maxSymbols });
  const hits = collectHits(map.files);
  const byOp = aggregateBy(hits, (h) => h.op);
  const byTable = aggregateBy(hits, (h) => h.table ?? "?");
  const bySource = aggregateBy(hits, (h) => h.source);
  const byFile = aggregateByFile(map.files);

  /** @type {Record<string, any> & { tokenEstimate?: { fullJson: number, markdown: number } }} */
  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    dataAccessVersion: 1,
    repo: {
      root: repo.root,
      name: repo.package?.name ?? path.basename(repo.root),
      sourceFileCount: map.repo.sourceFileCount,
    },
    summary: {
      totalHits: hits.length,
      filesWithHits: byFile.length,
      operations: byOp.length,
      tables: byTable.length,
    },
    byOp,
    byTable,
    bySource,
    byFile,
  };

  const markdown = formatDataAccessMarkdown(data);
  data.tokenEstimate = {
    fullJson: estimateTokens(data),
    markdown: estimateTokens(markdown),
  };

  return { data, markdown };
}

/**
 * @param {CodeMapFile[]} files
 * @returns {Hit[]}
 */
function collectHits(files) {
  /** @type {Hit[]} */
  const hits = [];
  for (const file of files) {
    for (const access of file.dataAccess ?? []) {
      hits.push({ .../** @type {DataAccessHit} */ (access), path: file.path });
    }
  }
  return hits;
}

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} keyFn
 * @returns {AggregateRow[]}
 */
function aggregateBy(items, keyFn) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/**
 * @param {CodeMapFile[]} files
 * @returns {object[]}
 */
function aggregateByFile(files) {
  return files
    .filter((f) => (f.dataAccess ?? []).length > 0)
    .map((f) => {
      // The shared CodeMapDataAccess typedef is a subset; the records produced
      // here carry the full DataAccessHit fields (source/op/table/snippet).
      const accesses = /** @type {DataAccessHit[]} */ (f.dataAccess ?? []);
      return {
        path: f.path,
        kind: f.kind,
        hits: accesses.length,
        operations: [...new Set(accesses.map((d) => d.op))].sort(),
        tables: [...new Set(accesses.map((d) => d.table).filter(Boolean))].sort(),
        samples: accesses.slice(0, 5).map((d) => ({
          source: d.source,
          op: d.op,
          table: d.table,
          line: d.line,
          snippet: d.snippet,
        })),
      };
    })
    .sort((a, b) => b.hits - a.hits || a.path.localeCompare(b.path));
}

/**
 * @param {any} data Data-access report payload from generateDataAccessReport.
 * @returns {string}
 */
export function formatDataAccessMarkdown(data) {
  const lines = [
    `# Data-Access Surface: ${data.repo.name}`,
    "",
    `Generated: ${data.generatedAt}`,
    `Data-access engine version: ${data.dataAccessVersion}`,
    "",
    "## Summary",
    "",
    `- Source files scanned: ${data.repo.sourceFileCount}`,
    `- Files with data access: **${data.summary.filesWithHits}**`,
    `- Total hits: **${data.summary.totalHits}**`,
    `- Distinct operations: ${data.summary.operations}`,
    `- Distinct tables/models: ${data.summary.tables}`,
    "",
    "## By Source",
    "",
    "| Source | Count |",
    "|---|---:|",
    ...data.bySource.map((/** @type {AggregateRow} */ row) => `| ${row.key} | ${row.count} |`),
    "",
    "## By Operation",
    "",
    "| Operation | Count |",
    "|---|---:|",
    ...data.byOp.map((/** @type {AggregateRow} */ row) => `| ${row.key} | ${row.count} |`),
    "",
    "## By Table / Model",
    "",
    "| Table | Count |",
    "|---|---:|",
    ...data.byTable.slice(0, 50).map((/** @type {AggregateRow} */ row) => `| ${row.key} | ${row.count} |`),
    "",
    "## By File",
    "",
  ];
  for (const file of data.byFile.slice(0, 40)) {
    lines.push(`### \`${file.path}\` (${file.kind}, ${file.hits} hit(s))`);
    lines.push("");
    lines.push(`- Ops: ${file.operations.join(", ")}`);
    if (file.tables.length > 0) lines.push(`- Tables: ${file.tables.join(", ")}`);
    lines.push("");
    for (const sample of file.samples) {
      lines.push(`  - L${sample.line} \`${sample.source}/${sample.op}\` on \`${sample.table ?? "?"}\` — \`${sample.snippet}\``);
    }
    lines.push("");
  }
  return lines.join("\n");
}
