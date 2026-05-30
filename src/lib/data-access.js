import path from "node:path";
import { generateCodeMap } from "./code-map.js";
import { inspectRepo } from "./repo.js";
import { estimateTokens } from "./tokens.js";

export function generateDataAccessReport(repoPath = ".", options = {}) {
  const repo = inspectRepo(repoPath);
  const map = generateCodeMap(repo.root, { maxSymbols: options.maxSymbols });
  const hits = collectHits(map.files);
  const byOp = aggregateBy(hits, (h) => h.op);
  const byTable = aggregateBy(hits, (h) => h.table ?? "?");
  const bySource = aggregateBy(hits, (h) => h.source);
  const byFile = aggregateByFile(map.files);

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

function collectHits(files) {
  const hits = [];
  for (const file of files) {
    for (const access of file.dataAccess ?? []) {
      hits.push({ ...access, path: file.path });
    }
  }
  return hits;
}

function aggregateBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function aggregateByFile(files) {
  return files
    .filter((f) => (f.dataAccess ?? []).length > 0)
    .map((f) => ({
      path: f.path,
      kind: f.kind,
      hits: f.dataAccess.length,
      operations: [...new Set(f.dataAccess.map((d) => d.op))].sort(),
      tables: [...new Set(f.dataAccess.map((d) => d.table).filter(Boolean))].sort(),
      samples: f.dataAccess.slice(0, 5).map((d) => ({
        source: d.source,
        op: d.op,
        table: d.table,
        line: d.line,
        snippet: d.snippet,
      })),
    }))
    .sort((a, b) => b.hits - a.hits || a.path.localeCompare(b.path));
}

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
    ...data.bySource.map((row) => `| ${row.key} | ${row.count} |`),
    "",
    "## By Operation",
    "",
    "| Operation | Count |",
    "|---|---:|",
    ...data.byOp.map((row) => `| ${row.key} | ${row.count} |`),
    "",
    "## By Table / Model",
    "",
    "| Table | Count |",
    "|---|---:|",
    ...data.byTable.slice(0, 50).map((row) => `| ${row.key} | ${row.count} |`),
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
