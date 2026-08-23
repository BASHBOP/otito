import fs from "node:fs";
import path from "node:path";
import { generateContextPack } from "./context-engine.js";
import { generateImpact } from "./impact.js";
import { inspectRepo } from "./repo.js";

/**
 * @typedef {object} ObsidianOptions
 * @property {string} [query]
 * @property {number} [limit]
 * @property {number} [top]
 */

/**
 * Generate an Obsidian-compatible Markdown vault from Otito's local evidence.
 * The vault is a navigable projection; the repository and Otito remain the
 * sources of truth.
 *
 * @param {string} repoPath
 * @param {string} vaultPath
 * @param {ObsidianOptions} [options]
 * @returns {{ manifest: Record<string, unknown>, files: Map<string, string> }}
 */
export function generateObsidianVault(repoPath = ".", vaultPath = ".otito/obsidian", options = {}) {
  const root = path.resolve(repoPath);
  const absoluteVaultPath = path.resolve(vaultPath);
  const repo = inspectRepo(root);
  const generatedAt = new Date().toISOString();
  const query = String(options.query ?? "").trim();
  const context = query ? generateContextPack(query, { path: root, limit: options.limit, includeEvidence: true }) : null;
  const impact = query ? generateImpact(query, { path: root, top: options.top }) : null;
  const notes = new Map();
  const querySlug = query ? slugify(query) : undefined;

  notes.set("Home.md", renderHome(repo, generatedAt, querySlug));
  notes.set("Repository.md", renderRepository(repo, absoluteVaultPath, root, generatedAt));
  notes.set("Evidence.md", renderEvidence(repo, generatedAt, query, context, impact));

  if (querySlug && context && impact) {
    notes.set(`Context/${querySlug}.md`, context.markdown);
    notes.set(`Impact/${querySlug}.md`, impact.markdown);
  }

  return {
    manifest: {
      ok: true,
      generatedAt,
      vaultPath: absoluteVaultPath,
      repository: repo.root,
      repositoryName: repo.package?.name ?? path.basename(root),
      query: query || null,
      noteCount: notes.size,
      notes: [...notes.keys()],
    },
    files: notes,
  };
}

/**
 * @param {string} repoPath
 * @param {string} vaultPath
 * @param {ObsidianOptions} [options]
 * @returns {Record<string, unknown>}
 */
export function writeObsidianVault(repoPath = ".", vaultPath = ".otito/obsidian", options = {}) {
  const result = generateObsidianVault(repoPath, vaultPath, options);
  for (const [relativePath, contents] of result.files) {
    const target = path.join(String(result.manifest.vaultPath), relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return result.manifest;
}

/** @param {any} repo @param {string} generatedAt @param {string | undefined} querySlug */
function renderHome(repo, generatedAt, querySlug) {
  const repositoryName = repo.package?.name ?? path.basename(repo.root);
  const lines = [
    "---",
    "type: otito-vault",
    `generated: ${generatedAt}`,
    `repository: ${quoteYaml(repositoryName)}`,
    "---",
    "",
    `# ${repositoryName} · Otito`,
    "",
    "This vault is a local, human-readable projection of Otito repository evidence.",
    "",
    "- [[Repository]]",
    "- [[Evidence]]",
  ];
  if (querySlug) {
    lines.push(`- [[Context/${querySlug}]]`, `- [[Impact/${querySlug}]]`);
  }
  lines.push("", "Otito remains the source of truth for generated context, impact, review, and gate evidence.", "");
  return lines.join("\n");
}

/** @param {any} repo @param {string} vaultPath @param {string} root @param {string} generatedAt */
function renderRepository(repo, vaultPath, root, generatedAt) {
  const packageName = repo.package?.name ?? path.basename(repo.root);
  const lines = [
    "---",
    "type: repository-map",
    `generated: ${generatedAt}`,
    `repository: ${quoteYaml(packageName)}`,
    "---",
    "",
    `# ${packageName} · Repository Map`,
    "",
    `- Root: \`${repo.root}\``,
    `- Files: ${repo.fileCount}${repo.filesTruncated ? " (showing first 200)" : ""}`,
    `- Package managers: ${repo.packageManagers.join(", ") || "none detected"}`,
    `- Git: ${formatGit(repo.git)}`,
    "",
    "## Languages",
    "",
    ...repo.languages.map((/** @type {{ language: string, count: number }} */ item) => `- ${item.language}: ${item.count}`),
    "",
    "## Entrypoints",
    "",
    ...(repo.entrypoints.length ? repo.entrypoints.map((/** @type {string} */ file) => `- ${formatEntrypoint(file, vaultPath, root)}`) : ["- none detected"]),
    "",
    "## Important Directories",
    "",
    ...(repo.importantDirectories.length ? repo.importantDirectories.map((/** @type {string} */ directory) => `- \`${directory}/\``) : ["- none detected"]),
    "",
    "## Scripts",
    "",
    ...(repo.scriptNames.length ? repo.scriptNames.map((/** @type {string} */ name) => `- \`${name}\``) : ["- none detected"]),
    "",
    "## Files",
    "",
    ...repo.files.map((/** @type {string} */ file) => `- ${linkToSource("Repository.md", file, vaultPath, root)}`),
    "",
  ];
  return lines.join("\n");
}

/** @param {any} repo @param {string} generatedAt @param {string} query @param {any} context @param {any} impact */
function renderEvidence(repo, generatedAt, query, context, impact) {
  const lines = [
    "---",
    "type: otito-evidence-index",
    `generated: ${generatedAt}`,
    `repository: ${quoteYaml(repo.package?.name ?? path.basename(repo.root))}`,
    "---",
    "",
    "# Evidence Index",
    "",
    "These notes are generated locally by Otito and are intended for navigation, discussion, and agent handoff.",
    "They do not replace exact staged-tree gates, hosted CI, CODEOWNERS, or human review.",
    "",
    `- Generated: ${generatedAt}`,
    `- Repository: \`${repo.root}\``,
    `- Task query: ${query ? quoteMarkdown(query) : "none supplied"}`,
    `- Context packet: ${context ? "[[Context/" + slugify(query) + "]]" : "not generated"}`,
    `- Impact analysis: ${impact ? "[[Impact/" + slugify(query) + "]]" : "not generated"}`,
    "",
    "Regenerate this vault after meaningful repository or task changes with `otito obsidian`.",
    "",
  ];
  return lines.join("\n");
}

/** @param {any} git */
function formatGit(git) {
  if (!git?.available) return "not available";
  const branch = git.branch ?? "detached";
  const commit = git.commit ? ` at ${git.commit}` : "";
  return `${branch}${commit}; ${git.clean ? "clean" : `${git.changes} change(s)`}`;
}

/** @param {string} sourcePath @param {string} vaultPath @param {string} root */
function formatEntrypoint(sourcePath, vaultPath, root) {
  if (!fs.existsSync(path.join(root, sourcePath))) {
    return `\`${sourcePath}\` (declared but not present in the checkout)`;
  }
  return linkToSource("Repository.md", sourcePath, vaultPath, root);
}

/** @param {string} notePath @param {string} sourcePath @param {string} vaultPath @param {string} root */
function linkToSource(notePath, sourcePath, vaultPath, root) {
  const noteDirectory = path.join(vaultPath, path.dirname(notePath));
  let relative = path.relative(noteDirectory, path.join(root, sourcePath)).split(path.sep).join("/");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return `[${sourcePath}](${encodeURI(relative)})`;
}

/** @param {string} value */
function slugify(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "task"
  );
}

/** @param {unknown} value */
function quoteYaml(value) {
  return JSON.stringify(String(value));
}

/** @param {string} value */
function quoteMarkdown(value) {
  return `\`${value.replaceAll("`", "\\`")}\``;
}
