import fs from "node:fs";
import path from "node:path";
import { generateCodeMap } from "./code-map.js";
import { inspectRepo } from "./repo.js";
import { runCommand } from "./tools.js";

const ghPrFields = [
  "number",
  "title",
  "body",
  "state",
  "url",
  "author",
  "baseRefName",
  "headRefName",
  "comments",
  "reviews",
  "files"
].join(",");

const statusNames = {
  A: "added",
  C: "copied",
  D: "deleted",
  M: "modified",
  R: "renamed",
  T: "type-changed",
  U: "unmerged",
  X: "unknown"
};

const preferredScripts = [
  "lint",
  "typecheck",
  "type-check",
  "check:type",
  "tsc",
  "tsc:check",
  "test",
  "test:unit",
  "test:e2e",
  "build"
];

export function generatePrReview(repoPath = ".", options = {}) {
  const repo = inspectRepo(repoPath);
  if (!repo.git.available) {
    throw new Error(`PR review requires a git repository: ${repo.root}`);
  }

  const root = repo.git.root ?? repo.root;
  const pr = loadPrMetadata(root, options);
  const base = resolveBaseRef(root, options, pr);
  const head = String(options.head ?? pr.headRefName ?? "HEAD");
  const diff = getDiff(root, base, head);
  const codeMap = generateCodeMap(root);
  const changedFiles = enrichChangedFiles(diff.files, diff.numstat, codeMap);
  const domains = summarizeDomains(changedFiles);
  const reviewComments = normalizeReviewComments(pr);
  const risk = inferRisk(changedFiles, diff, reviewComments);
  const testHints = inferTestHints(repo, changedFiles, risk);

  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    repo: {
      root,
      name: path.basename(root),
      git: repo.git,
      packageManagers: repo.packageManagers,
      scripts: repo.scripts
    },
    pr,
    comparison: {
      base,
      head,
      mode: diff.mode,
      changedFileCount: changedFiles.length,
      insertions: diff.insertions,
      deletions: diff.deletions,
      shortstat: diff.shortstat,
      fallbackReason: diff.fallbackReason
    },
    changedFiles,
    domains,
    reviewComments,
    risk,
    testHints,
    nextSteps: inferNextSteps(changedFiles, risk, reviewComments, testHints)
  };

  return {
    data,
    markdown: formatPrReviewMarkdown(data)
  };
}

export function formatPrReviewMarkdown(data) {
  const lines = [
    "# PR Review Context",
    "",
    `Generated: ${data.generatedAt}`,
    "",
    "## Overview",
    "",
    `- Repo: ${data.repo.name}`,
    `- Root: ${data.repo.root}`,
    `- Git: ${formatGit(data.repo.git)}`,
    `- Comparison: ${data.comparison.base}...${data.comparison.head}`,
    `- Changed files: ${data.comparison.changedFileCount}`,
    `- Diff: ${data.comparison.shortstat || `${data.comparison.insertions} insertion(s), ${data.comparison.deletions} deletion(s)`}`,
    `- Risk: ${data.risk.level} (${data.risk.score})`
  ];

  if (data.comparison.fallbackReason) {
    lines.push(`- Diff fallback: ${data.comparison.fallbackReason}`);
  }

  if (data.pr.available) {
    lines.push(`- PR: #${data.pr.number} ${data.pr.title || ""}`.trim());
    if (data.pr.url) {
      lines.push(`- URL: ${data.pr.url}`);
    }
  } else if (data.pr.requested) {
    lines.push(`- PR metadata: unavailable (${data.pr.error})`);
  }

  lines.push("", "## Risk Flags", "");
  if (data.risk.flags.length) {
    for (const flag of data.risk.flags) {
      lines.push(`- ${flag}`);
    }
  } else {
    lines.push("- none detected");
  }

  lines.push("", "## Changed Domains", "");
  if (data.domains.length) {
    lines.push("| Domain | Files | +/- | Kinds |", "|---|---:|---:|---|");
    for (const domain of data.domains.slice(0, 20)) {
      lines.push(`| ${domain.name} | ${domain.fileCount} | +${domain.additions} / -${domain.deletions} | ${domain.kinds.map((item) => `${item.kind} ${item.count}`).join(", ")} |`);
    }
  } else {
    lines.push("- none detected");
  }

  lines.push("", "## Changed Files", "");
  if (data.changedFiles.length) {
    lines.push("| File | Status | Kind | Domain | +/- | Notes |", "|---|---|---|---|---:|---|");
    for (const file of data.changedFiles.slice(0, 80)) {
      lines.push(`| ${formatFileCell(file)} | ${file.statusName} | ${file.kind} | ${file.domain} | +${file.additions} / -${file.deletions} | ${file.riskFlags.join("; ") || ""} |`);
    }
  } else {
    lines.push("- no changed files detected");
  }

  lines.push("", "## PR Comments", "");
  if (data.reviewComments.items.length) {
    for (const comment of data.reviewComments.items.slice(0, 30)) {
      const location = comment.path ? ` (${comment.path}${comment.line ? `:${comment.line}` : ""})` : "";
      lines.push(`- ${comment.author || "unknown"}${location}: ${comment.body}`);
    }
  } else {
    lines.push(data.pr.requested ? "- no comments returned by GitHub CLI" : "- not loaded; pass `--number <pr>` to enrich from GitHub");
  }

  lines.push("", "## Suggested Verification", "");
  if (!data.changedFiles.length) {
    lines.push("- no verification needed; no changed files detected");
  } else if (data.testHints.length) {
    for (const hint of data.testHints) {
      lines.push(`- \`${hint.command}\`: ${hint.reason}`);
    }
  } else {
    lines.push("- no obvious package scripts detected");
  }

  lines.push("", "## Next Steps", "");
  for (const step of data.nextSteps) {
    lines.push(`- ${step}`);
  }

  lines.push("");
  return lines.join("\n");
}

function loadPrMetadata(root, options) {
  const number = options.number ?? options.pr;
  const shouldLoad = Boolean(number ?? options.github);
  if (!shouldLoad) {
    return {
      requested: false,
      available: false,
      comments: [],
      reviews: [],
      reviewComments: []
    };
  }

  const args = ["pr", "view"];
  if (number) {
    args.push(String(number));
  }
  args.push("--json", ghPrFields);

  const result = runCommand("gh", args, { cwd: root, timeout: 30000 });
  if (!result.ok) {
    return {
      requested: true,
      available: false,
      number,
      error: cleanCommandError(result, "gh pr view failed"),
      comments: [],
      reviews: [],
      reviewComments: []
    };
  }

  try {
    const raw = JSON.parse(result.stdout);
    const prNumber = raw.number ?? number;
    return {
      requested: true,
      available: true,
      source: "gh",
      number: prNumber,
      title: raw.title,
      body: raw.body,
      state: raw.state,
      url: raw.url,
      author: raw.author?.login ?? raw.author?.name,
      baseRefName: raw.baseRefName,
      headRefName: raw.headRefName,
      files: Array.isArray(raw.files) ? raw.files : [],
      comments: Array.isArray(raw.comments) ? raw.comments : [],
      reviews: Array.isArray(raw.reviews) ? raw.reviews : [],
      reviewComments: prNumber ? loadGhReviewComments(root, prNumber) : []
    };
  } catch (error) {
    return {
      requested: true,
      available: false,
      number,
      error: `failed to parse gh output: ${error.message}`,
      comments: [],
      reviews: [],
      reviewComments: []
    };
  }
}

function loadGhReviewComments(root, number) {
  const repo = runCommand("gh", ["repo", "view", "--json", "nameWithOwner"], { cwd: root, timeout: 20000 });
  if (!repo.ok) {
    return [];
  }

  try {
    const nameWithOwner = JSON.parse(repo.stdout).nameWithOwner;
    if (!nameWithOwner) {
      return [];
    }

    const comments = runCommand("gh", ["api", `repos/${nameWithOwner}/pulls/${number}/comments`, "--paginate"], {
      cwd: root,
      timeout: 30000
    });
    if (!comments.ok || !comments.stdout.trim()) {
      return [];
    }
    return JSON.parse(comments.stdout);
  } catch {
    return [];
  }
}

function resolveBaseRef(root, options, pr) {
  const candidates = [
    options.base,
    pr.baseRefName,
    upstreamRef(root),
    "origin/main",
    "main",
    "origin/master",
    "master",
    "HEAD~1"
  ].filter(Boolean).map(String);

  for (const candidate of candidates) {
    if (refExists(root, candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not resolve a base ref. Pass --base <ref>.");
}

function upstreamRef(root) {
  const result = runCommand("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], {
    cwd: root,
    timeout: 5000
  });
  return result.ok ? result.stdout.trim() : undefined;
}

function refExists(root, ref) {
  return runCommand("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd: root, timeout: 5000 }).ok;
}

function getDiff(root, base, head) {
  const comparison = `${base}...${head}`;
  const nameStatus = runCommand("git", ["diff", "--name-status", "--find-renames", comparison], { cwd: root });
  const numstat = runCommand("git", ["diff", "--numstat", "--find-renames", comparison], { cwd: root });
  const shortstat = runCommand("git", ["diff", "--shortstat", comparison], { cwd: root });

  if (nameStatus.ok) {
    const files = parseNameStatus(nameStatus.stdout);
    if (files.length || head !== "HEAD") {
      const stats = parseNumstat(numstat.stdout);
      return {
        mode: "merge-base",
        files,
        numstat: stats.files,
        insertions: stats.insertions,
        deletions: stats.deletions,
        shortstat: shortstat.stdout.trim()
      };
    }
  }

  const fallback = runCommand("git", ["diff", "--name-status", "--find-renames", "HEAD"], { cwd: root });
  if (!fallback.ok) {
    throw new Error(cleanCommandError(nameStatus, "git diff failed"));
  }

  const fallbackNumstat = runCommand("git", ["diff", "--numstat", "--find-renames", "HEAD"], { cwd: root });
  const fallbackShortstat = runCommand("git", ["diff", "--shortstat", "HEAD"], { cwd: root });
  const stats = parseNumstat(fallbackNumstat.stdout);
  const fallbackFiles = includeUntrackedFiles(root, parseNameStatus(fallback.stdout), stats.files);
  const insertions = sumStats(stats.files, "additions");
  const deletions = sumStats(stats.files, "deletions");
  if (!fallbackFiles.length) {
    return {
      mode: "merge-base",
      files: [],
      numstat: new Map(),
      insertions: 0,
      deletions: 0,
      shortstat: shortstat.stdout.trim()
    };
  }

  return {
    mode: "working-tree",
    files: fallbackFiles,
    numstat: stats.files,
    insertions,
    deletions,
    shortstat: formatShortstat(fallbackFiles.length, insertions, deletions, fallbackShortstat.stdout.trim()),
    fallbackReason: `no committed diff found for ${comparison}; used working tree diff from HEAD`
  };
}

function includeUntrackedFiles(root, files, stats) {
  const result = [...files];
  const seen = new Set(result.map((file) => file.path));
  const untracked = runCommand("git", ["ls-files", "--others", "--exclude-standard"], { cwd: root, timeout: 5000 });
  if (!untracked.ok) {
    return result;
  }

  for (const filePath of untracked.stdout.trim().split("\n").filter(Boolean)) {
    if (seen.has(filePath)) {
      continue;
    }
    result.push({ status: "A", path: filePath });
    stats.set(filePath, { additions: countFileLines(path.join(root, filePath)), deletions: 0 });
  }
  return result;
}

function countFileLines(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    if (!text) {
      return 0;
    }
    return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
  } catch {
    return 0;
  }
}

function sumStats(stats, key) {
  let total = 0;
  for (const item of stats.values()) {
    total += item[key] ?? 0;
  }
  return total;
}

function formatShortstat(fileCount, insertions, deletions, fallback) {
  if (!fileCount) {
    return fallback;
  }
  return `${fileCount} file(s) changed, ${insertions} insertion(s), ${deletions} deletion(s)`;
}

function parseNameStatus(output) {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("\t");
      const rawStatus = parts[0] ?? "";
      const status = rawStatus[0] ?? "X";
      if (status === "R" || status === "C") {
        return {
          status,
          score: rawStatus.slice(1) || undefined,
          previousPath: parts[1],
          path: parts[2]
        };
      }
      return {
        status,
        path: parts[1]
      };
    })
    .filter((file) => file.path);
}

function parseNumstat(output) {
  const files = new Map();
  let insertions = 0;
  let deletions = 0;

  for (const line of output.trim().split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    const additions = parseStatNumber(parts[0]);
    const removals = parseStatNumber(parts[1]);
    const filePath = parts.slice(2).join("\t");
    const normalizedPath = normalizeNumstatPath(filePath);
    insertions += additions;
    deletions += removals;
    files.set(normalizedPath, { additions, deletions: removals });
  }

  return { files, insertions, deletions };
}

function normalizeNumstatPath(filePath) {
  const renameMatch = filePath.match(/^(.*) => (.*)$/);
  if (!renameMatch) {
    return filePath;
  }

  const before = renameMatch[1].replace(/^{/, "");
  const after = renameMatch[2].replace(/}$/, "");
  const sharedPrefix = before.slice(0, before.lastIndexOf("/") + 1);
  return `${sharedPrefix}${after}`;
}

function parseStatNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function enrichChangedFiles(files, numstat, codeMap) {
  const byPath = new Map(codeMap.files.map((file) => [file.path, file]));
  return files.map((file) => {
    const codeInfo = byPath.get(file.path) ?? byPath.get(file.previousPath);
    const stats = numstat.get(file.path) ?? numstat.get(file.previousPath) ?? { additions: 0, deletions: 0 };
    const enriched = {
      path: file.path,
      previousPath: file.previousPath,
      status: file.status,
      statusName: statusNames[file.status] ?? file.status,
      additions: stats.additions,
      deletions: stats.deletions,
      kind: codeInfo?.kind ?? inferBasicKind(file.path),
      domain: codeInfo?.domain ?? inferBasicDomain(file.path),
      route: codeInfo?.route,
      controllerBasePath: codeInfo?.controllerBasePath,
      httpMethods: codeInfo?.httpMethods ?? [],
      imports: codeInfo?.imports?.slice(0, 20) ?? [],
      exports: codeInfo?.exports?.slice(0, 20) ?? [],
      symbols: codeInfo?.symbols?.slice(0, 20) ?? []
    };
    enriched.riskFlags = inferFileRiskFlags(enriched);
    return enriched;
  });
}

function inferBasicKind(file) {
  const base = path.basename(file);
  const extension = path.extname(file).toLowerCase();
  if (/\.(spec|test)\.[jt]sx?$/.test(file) || file.includes("__tests__")) return "test";
  if (file.includes("/app/api/") && base === "route.ts") return "apiRoute";
  if (base === "page.tsx" || base === "page.ts" || base === "layout.tsx" || base === "layout.ts") return "route";
  if (base.endsWith(".controller.ts")) return "controller";
  if (base.endsWith(".service.ts")) return "service";
  if (base.endsWith(".module.ts")) return "module";
  if (base.endsWith(".dto.ts")) return "dto";
  if (base.endsWith(".schema.ts") || file.includes("/schemas/")) return "schema";
  if (base.startsWith("use") && /\.(ts|tsx)$/.test(base)) return "hook";
  if (file.startsWith("redux/apis/") || file.startsWith("services/") || base.includes("api-client")) return "apiClient";
  if (/^[A-Z]/.test(base) && /\.(tsx|jsx)$/.test(base)) return "component";
  if (["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"].includes(base)) return "dependency";
  if ([".toml", ".yml", ".yaml"].includes(extension) || base.includes("config") || file.startsWith(".codex/")) return "config";
  return "source";
}

function inferBasicDomain(file) {
  const parts = file.split("/");
  const interestingRoots = new Set(["app", "src", "components", "lib", "utils", "redux", "services", "schemas", "hooks", "types"]);
  if (interestingRoots.has(parts[0]) && parts[1]) {
    return cleanDomain(parts[1]);
  }
  return cleanDomain(parts[0] ?? "root");
}

function cleanDomain(value) {
  return value
    .replace(/\.[cm]?[jt]sx?$/, "")
    .replace(/-api$/, "")
    .replace(/-apis$/, "")
    .replace(/-service$/, "")
    .replace(/[()[\]]/g, "")
    .replace(/^\.+$/, "root")
    || "root";
}

function inferFileRiskFlags(file) {
  const flags = [];
  const searchable = `${file.path} ${file.domain} ${file.kind}`.toLowerCase();
  if (["route", "apiRoute", "controller"].includes(file.kind)) {
    flags.push("request surface");
  }
  if (file.kind === "apiClient") {
    flags.push("frontend/backend contract");
  }
  if (file.kind === "schema" || searchable.includes("prisma") || searchable.includes("migration")) {
    flags.push("data model");
  }
  if (/(auth|session|jwt|permission|role|password|token)/.test(searchable)) {
    flags.push("auth/security");
  }
  if (/(payment|billing|checkout|webhook|stripe|refund)/.test(searchable)) {
    flags.push("money flow");
  }
  if (file.kind === "config" || /(package\.json|lock|docker|next\.config|vite\.config|tsconfig|env)/.test(searchable)) {
    flags.push("configuration");
  }
  if (file.additions + file.deletions >= 300) {
    flags.push("large file diff");
  }
  return flags;
}

function summarizeDomains(files) {
  const domains = new Map();
  for (const file of files) {
    const domain = domains.get(file.domain) ?? {
      name: file.domain,
      fileCount: 0,
      additions: 0,
      deletions: 0,
      kinds: new Map()
    };
    domain.fileCount += 1;
    domain.additions += file.additions;
    domain.deletions += file.deletions;
    domain.kinds.set(file.kind, (domain.kinds.get(file.kind) ?? 0) + 1);
    domains.set(file.domain, domain);
  }

  return [...domains.values()]
    .map((domain) => ({
      name: domain.name,
      fileCount: domain.fileCount,
      additions: domain.additions,
      deletions: domain.deletions,
      kinds: [...domain.kinds.entries()]
        .map(([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
    }))
    .sort((a, b) => b.fileCount - a.fileCount || b.additions + b.deletions - (a.additions + a.deletions) || a.name.localeCompare(b.name));
}

function normalizeReviewComments(pr) {
  const items = [];
  for (const comment of pr.reviewComments ?? []) {
    items.push({
      type: "review_comment",
      author: comment.user?.login,
      path: comment.path,
      line: comment.line ?? comment.original_line,
      body: compactText(comment.body),
      url: comment.html_url
    });
  }

  for (const comment of pr.comments ?? []) {
    items.push({
      type: "comment",
      author: comment.author?.login ?? comment.author?.name,
      body: compactText(comment.body),
      url: comment.url
    });
  }

  for (const review of pr.reviews ?? []) {
    if (!review.body) {
      continue;
    }
    items.push({
      type: "review",
      author: review.author?.login ?? review.author?.name,
      state: review.state,
      body: compactText(review.body),
      url: review.url
    });
  }

  return {
    count: items.length,
    items
  };
}

function inferRisk(files, diff, comments) {
  const flags = new Set();
  let score = 0;
  const nonTestFiles = files.filter((file) => file.kind !== "test");
  const behaviorFiles = nonTestFiles.filter((file) => !["config", "dependency"].includes(file.kind));
  const testFiles = files.filter((file) => file.kind === "test");

  for (const file of files) {
    for (const flag of file.riskFlags) {
      flags.add(flag);
    }
  }

  if (flags.has("request surface")) score += 2;
  if (flags.has("frontend/backend contract")) score += 2;
  if (flags.has("data model")) score += 3;
  if (flags.has("auth/security")) score += 3;
  if (flags.has("money flow")) score += 3;
  if (flags.has("configuration")) score += 2;
  if (flags.has("large file diff")) score += 2;

  if (diff.insertions + diff.deletions >= 800) {
    flags.add("large PR");
    score += 2;
  }
  if (behaviorFiles.length > 0 && testFiles.length === 0) {
    flags.add("no test files changed");
    score += 2;
  }
  if (comments.count > 0) {
    flags.add("has PR discussion to resolve");
    score += Math.min(comments.count, 3);
  }
  if (testFiles.length > 0) {
    score = Math.max(0, score - 1);
  }

  return {
    level: score >= 9 ? "high" : score >= 4 ? "medium" : "low",
    score,
    flags: [...flags].sort()
  };
}

function inferTestHints(repo, files, risk) {
  if (!files.length) {
    return [];
  }

  const scripts = repo.scripts ?? {};
  const runner = packageRunner(repo.packageManagers);
  const hints = [];

  for (const name of preferredScripts) {
    if (!scripts[name]) {
      continue;
    }
    const reason = reasonForScript(name, files, risk);
    if (!reason) {
      continue;
    }
    hints.push({
      script: name,
      command: commandForScript(runner, name),
      reason
    });
  }

  return uniqueBy(hints, (hint) => hint.command).slice(0, 6);
}

function reasonForScript(name, files, risk) {
  const changedKinds = new Set(files.map((file) => file.kind));
  const hasTypedSource = files.some((file) => /\.[cm]?[jt]sx?$/.test(file.path));
  const hasRuntimeSource = hasTypedSource || files.some((file) => ["route", "apiRoute", "controller", "service", "module", "component", "hook", "apiClient", "dto", "schema"].includes(file.kind));
  if (name.includes("lint")) return hasRuntimeSource ? "changed source files should pass style/static checks" : undefined;
  if (name.includes("type") || name === "tsc") return hasTypedSource ? "TypeScript contracts changed" : undefined;
  if (name === "build") return hasRuntimeSource && (changedKinds.has("route") || changedKinds.has("component") || risk.level !== "low") ? "build catches integration and bundling issues" : undefined;
  if (name.includes("e2e")) return risk.flags.some((flag) => ["request surface", "money flow", "auth/security"].includes(flag)) ? "request/user-flow surface changed" : undefined;
  if (name.includes("test")) return hasRuntimeSource ? "verify behavior around changed domains" : undefined;
  return undefined;
}

function packageRunner(packageManagers = []) {
  if (packageManagers.includes("pnpm")) return "pnpm";
  if (packageManagers.includes("yarn")) return "yarn";
  if (packageManagers.includes("bun")) return "bun";
  return "npm";
}

function commandForScript(runner, script) {
  if (runner === "npm") {
    return script === "test" ? "npm test" : `npm run ${script}`;
  }
  return `${runner} ${script}`;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function inferNextSteps(files, risk, comments, hints) {
  const steps = [];
  if (!files.length) {
    return ["No changed files detected for this comparison."];
  }

  if (comments.count > 0) {
    steps.push("Resolve or explicitly answer each PR comment before merging.");
  }
  if (risk.flags.includes("no test files changed") && files.some((file) => file.kind !== "test")) {
    steps.push("Decide whether the changed behavior needs a focused test or a written no-test rationale.");
  }
  if (risk.flags.includes("frontend/backend contract")) {
    steps.push("Check the matching backend route/controller for each frontend API client change.");
  }
  if (risk.flags.includes("request surface")) {
    steps.push("Confirm route/controller behavior, auth expectations, and error responses.");
  }
  if (risk.flags.includes("data model")) {
    steps.push("Review migration/data compatibility and rollback behavior.");
  }
  if (risk.flags.includes("configuration")) {
    steps.push("Check the affected runtime/tooling configuration in the environment where it is used.");
  }
  if (hints.length) {
    steps.push("Run the suggested verification commands and paste failures back into the PR context.");
  }
  if (!steps.length) {
    steps.push("Review the changed files by domain, then run the closest available test command.");
  }
  return steps;
}

function formatGit(git) {
  if (!git.available) {
    return "not detected";
  }
  const dirty = git.clean ? "clean" : `${git.changes} change(s)`;
  return `${git.branch ?? "unknown"} @ ${git.commit ?? "unknown"} (${dirty})`;
}

function formatFileCell(file) {
  if (file.previousPath) {
    return `${file.previousPath} -> ${file.path}`;
  }
  return file.path;
}

function compactText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function cleanCommandError(result, fallback) {
  const message = `${result.stderr || result.stdout || result.error?.message || fallback}`.trim();
  return message.split("\n")[0] || fallback;
}
