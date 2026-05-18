import path from "node:path";
import { getDoctorReport } from "./doctor.js";
import { inspectRepo } from "./repo.js";

const keyScriptNames = ["dev", "start", "build", "lint", "tsc:check", "check:type", "test", "test:e2e"];

export function generateWorkspaceReport(repoPaths) {
  const repos = repoPaths.map((repoPath) => inspectRepo(repoPath));
  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    repoCount: repos.length,
    totalFiles: repos.reduce((total, repo) => total + repo.fileCount, 0),
    languages: aggregateLanguages(repos),
    packageManagers: [...new Set(repos.flatMap((repo) => repo.packageManagers))],
    repos: repos.map(summarizeRepo),
    doctor: getDoctorReport()
  };

  return {
    data,
    markdown: formatWorkspaceReport(data)
  };
}

function summarizeRepo(repo) {
  return {
    name: path.basename(repo.root),
    root: repo.root,
    fileCount: repo.fileCount,
    languages: repo.languages,
    packageManagers: repo.packageManagers,
    entrypoints: repo.entrypoints,
    importantDirectories: repo.importantDirectories,
    git: repo.git,
    scripts: pickKeyScripts(repo.scripts)
  };
}

function aggregateLanguages(repos) {
  const counts = new Map();
  for (const repo of repos) {
    for (const item of repo.languages) {
      counts.set(item.language, (counts.get(item.language) ?? 0) + item.count);
    }
  }

  return [...counts.entries()]
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));
}

function pickKeyScripts(scripts) {
  return Object.fromEntries(keyScriptNames.filter((name) => scripts[name]).map((name) => [name, scripts[name]]));
}

function formatWorkspaceReport(data) {
  const lines = [
    "# Dev Context Workspace Report",
    "",
    `Generated: ${data.generatedAt}`,
    "",
    "## Workspace Overview",
    "",
    `- Repositories: ${data.repoCount}`,
    `- Files scanned: ${data.totalFiles}`,
    `- Languages: ${data.languages.map((item) => `${item.language} (${item.count})`).join(", ") || "unknown"}`,
    `- Package managers: ${data.packageManagers.join(", ") || "none detected"}`,
    "",
    "## Repositories",
    "",
    "| Repo | Files | Git | Languages | Entrypoints |",
    "|---|---:|---|---|---|"
  ];

  for (const repo of data.repos) {
    const git = formatGit(repo.git);
    lines.push(`| ${repo.name} | ${repo.fileCount} | ${git} | ${repo.languages.map((item) => `${item.language} ${item.count}`).join(", ") || "unknown"} | ${repo.entrypoints.join(", ") || "none detected"} |`);
  }

  lines.push("", "## Key Scripts", "");
  for (const repo of data.repos) {
    lines.push(`### ${repo.name}`, "");
    const entries = Object.entries(repo.scripts);
    if (!entries.length) {
      lines.push("- none detected", "");
      continue;
    }

    for (const [name, script] of entries) {
      lines.push(`- \`${name}\`: \`${script}\``);
    }
    lines.push("");
  }

  lines.push(
    "## Product-Level Notes",
    "",
    "- Treat these as one product workspace: Next frontend plus Nest/Prisma API.",
    "- Use repo-level reports for detailed file lists, and this workspace report for cross-repo orientation.",
    "- Avoid full-repo `code-structure` on this workspace; prefer narrowed scopes like `app/**/*.tsx` or `src/**/*.ts`.",
    "- Add MCP tooling around `workspace` next so agents can understand both repos before editing either one.",
    ""
  );

  return lines.join("\n");
}

function formatGit(git) {
  if (!git.available) {
    return "not detected";
  }

  const dirty = git.clean ? "clean" : `${git.changes} change(s)`;
  return `${git.branch ?? "unknown"} @ ${git.commit ?? "unknown"} (${dirty})`;
}
