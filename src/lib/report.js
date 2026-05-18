import { getDoctorReport } from "./doctor.js";
import { getToolMatrix } from "./matrix.js";
import { inspectRepo } from "./repo.js";

export function generateReport(repoPath = ".") {
  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    repo: inspectRepo(repoPath),
    doctor: getDoctorReport(),
    matrix: getToolMatrix()
  };

  return {
    data,
    markdown: formatReport(data)
  };
}

function formatReport(data) {
  const repo = data.repo;
  const missing = data.doctor.tools.filter((tool) => !tool.available);
  const present = data.doctor.tools.filter((tool) => tool.available);

  return [
    "# Dev Context Report",
    "",
    `Generated: ${data.generatedAt}`,
    "",
    "## Repo Overview",
    "",
    `- Root: ${repo.root}`,
    `- Files scanned: ${repo.fileCount}`,
    `- Git: ${formatGit(repo.git)}`,
    `- Languages: ${repo.languages.map((item) => `${item.language} (${item.count})`).join(", ") || "unknown"}`,
    `- Package managers: ${repo.packageManagers.join(", ") || "none detected"}`,
    `- Entrypoints: ${repo.entrypoints.join(", ") || "none detected"}`,
    "",
    "## Available Tools",
    "",
    ...(present.length ? present.map((tool) => `- ${tool.name}${tool.version ? `: ${tool.version}` : ""}`) : ["- none"]),
    "",
    "## Missing Optional Tools",
    "",
    ...(missing.length ? missing.map((tool) => `- ${tool.name}: ${tool.installHint}`) : ["- none"]),
    "",
    "## Tool Fit",
    "",
    "| Tool | Role | Pilot Use | Notes |",
    "|---|---|---|---|",
    ...data.matrix.tools.map((tool) => `| ${tool.name} | ${tool.role} | ${tool.pilotUse} | ${tool.notes} |`),
    "",
    "## Recommended Next Steps",
    "",
    "- Use this wrapper to standardize repo inspection and dependency lookup.",
    "- Install `opensrc` first if dependency-source inspection is important.",
    "- Install `code-structure` only for TypeScript structure HTML generation.",
    "- Add Daytona after execution isolation becomes a real workflow requirement.",
    "- Add MCP/Harnss integration after CLI JSON output has stabilized.",
    ""
  ].join("\n");
}

function formatGit(git) {
  if (!git.available) {
    return "not detected";
  }

  const dirty = git.clean ? "clean" : `${git.changes} change(s)`;
  return `${git.branch ?? "unknown"} @ ${git.commit ?? "unknown"} (${dirty})`;
}
