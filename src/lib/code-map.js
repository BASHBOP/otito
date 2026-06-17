export { generateCodeMap } from "./code-map/generate.js";
export { formatCodeMapMarkdown } from "./code-map/format.js";
export { extractDataAccess } from "./code-map/data-access.js";
export { isVendorFile } from "./code-map/vendor.js";

/**
 * Mermaid xychart-beta bar chart: domain file distribution.
 * @param {ReturnType<import('./code-map/generate.js').generateCodeMap>} result
 * @returns {string}
 */
export function formatCodeMapMermaid(result) {
  const domains = (result.domains ?? []).slice(0, 12);
  const repoName = result.repo?.name ?? "repo";
  if (!domains.length) {
    return [`xychart-beta`, `    title "No domain data — ${repoName}"`].join("\n");
  }
  const names = domains.map((d) => `"${String(d.name).replace(/"/g, "'")}"`);
  const counts = domains.map((d) => d.fileCount);
  return [
    "xychart-beta",
    `    title "File Distribution — ${repoName}"`,
    `    x-axis [${names.join(", ")}]`,
    `    y-axis "Files"`,
    `    bar [${counts.join(", ")}]`,
  ].join("\n");
}
