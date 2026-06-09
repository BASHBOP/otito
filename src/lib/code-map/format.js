import { isNotableFile } from "./classify.js";

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
