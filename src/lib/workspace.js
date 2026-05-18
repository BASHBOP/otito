import path from "node:path";
import { generateCodeMap } from "./code-map.js";
import { getDoctorReport } from "./doctor.js";
import { inspectRepo } from "./repo.js";

const keyScriptNames = ["dev", "start", "build", "lint", "tsc:check", "check:type", "test", "test:e2e"];

export function generateWorkspaceReport(repoPaths) {
  const repos = repoPaths.map((repoPath) => inspectRepo(repoPath));
  const maps = repoPaths.map((repoPath) => generateCodeMap(repoPath));
  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    repoCount: repos.length,
    totalFiles: repos.reduce((total, repo) => total + repo.fileCount, 0),
    languages: aggregateLanguages(repos),
    packageManagers: [...new Set(repos.flatMap((repo) => repo.packageManagers))],
    repos: repos.map((repo, index) => summarizeRepo(repo, maps[index])),
    domains: aggregateDomains(maps),
    integrations: inferIntegrations(maps),
    doctor: getDoctorReport()
  };

  return {
    data,
    markdown: formatWorkspaceReport(data)
  };
}

function summarizeRepo(repo, codeMap) {
  return {
    name: path.basename(repo.root),
    root: repo.root,
    fileCount: repo.fileCount,
    languages: repo.languages,
    packageManagers: repo.packageManagers,
    entrypoints: repo.entrypoints,
    importantDirectories: repo.importantDirectories,
    git: repo.git,
    scripts: pickKeyScripts(repo.scripts),
    map: codeMap.summary,
    topDomains: codeMap.domains.slice(0, 10)
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
    "## Code Map Summary",
    "",
    "| Repo | Routes | Controllers | Services | Components | API Clients | Tests | Symbols |",
    "|---|---:|---:|---:|---:|---:|---:|---:|"
  );

  for (const repo of data.repos) {
    lines.push(`| ${repo.name} | ${repo.map.routes + repo.map.apiRoutes} | ${repo.map.controllers} | ${repo.map.services} | ${repo.map.components} | ${repo.map.apiClients} | ${repo.map.tests} | ${repo.map.symbols} |`);
  }

  lines.push("", "## Shared Domains", "", "| Domain | Files | Repos |", "|---|---:|---|");
  for (const domain of data.domains.slice(0, 20)) {
    lines.push(`| ${domain.name} | ${domain.fileCount} | ${domain.repos.join(", ")} |`);
  }

  lines.push(
    "",
    "## Likely Integration Domains",
    "",
    "| Domain | Frontend API Clients | Backend Controllers | Backend Services |",
    "|---|---:|---:|---:|"
  );

  if (data.integrations.length) {
    for (const integration of data.integrations.slice(0, 30)) {
      lines.push(`| ${integration.domain} | ${integration.frontendApiClients} | ${integration.backendControllers} | ${integration.backendServices} |`);
    }
  } else {
    lines.push("| none detected | 0 | 0 | 0 |");
  }

  lines.push(
    "",
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

function aggregateDomains(maps) {
  const domains = new Map();
  for (const map of maps) {
    for (const domain of map.domains) {
      const entry = domains.get(domain.name) ?? { name: domain.name, fileCount: 0, repos: new Set() };
      entry.fileCount += domain.fileCount;
      entry.repos.add(map.repo.name);
      domains.set(domain.name, entry);
    }
  }

  return [...domains.values()]
    .map((domain) => ({ name: domain.name, fileCount: domain.fileCount, repos: [...domain.repos].sort() }))
    .sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name));
}

function inferIntegrations(maps) {
  const frontend = maps.find((map) => map.summary.apiClients > 0 || map.summary.routes > 0);
  const backend = maps.find((map) => map.summary.controllers > 0 || map.summary.services > 0);
  if (!frontend || !backend) {
    return [];
  }

  const frontendCounts = countByDomain(frontend.files.filter((file) => file.kind === "apiClient"));
  const backendControllers = countByDomain(backend.files.filter((file) => file.kind === "controller"));
  const backendServices = countByDomain(backend.files.filter((file) => file.kind === "service"));
  const domains = new Set([...frontendCounts.keys(), ...backendControllers.keys(), ...backendServices.keys()]);

  return [...domains]
    .map((domain) => ({
      domain,
      frontendApiClients: frontendCounts.get(domain) ?? 0,
      backendControllers: backendControllers.get(domain) ?? 0,
      backendServices: backendServices.get(domain) ?? 0
    }))
    .filter((item) => item.frontendApiClients > 0 && (item.backendControllers > 0 || item.backendServices > 0))
    .sort((a, b) => scoreIntegration(b) - scoreIntegration(a) || a.domain.localeCompare(b.domain));
}

function countByDomain(files) {
  const counts = new Map();
  for (const file of files) {
    counts.set(file.domain, (counts.get(file.domain) ?? 0) + 1);
  }
  return counts;
}

function scoreIntegration(item) {
  return Math.min(item.frontendApiClients, 1) * 10 + item.backendControllers * 2 + item.backendServices;
}

function formatGit(git) {
  if (!git.available) {
    return "not detected";
  }

  const dirty = git.clean ? "clean" : `${git.changes} change(s)`;
  return `${git.branch ?? "unknown"} @ ${git.commit ?? "unknown"} (${dirty})`;
}
