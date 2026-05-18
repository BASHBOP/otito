import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./tools.js";

const ignoredDirs = new Set([
  ".git",
  ".husky",
  ".vscode",
  ".dev-context",
  ".augment",
  ".claude",
  ".codex",
  ".vercel",
  ".worktrees",
  ".yarn",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "database-backups",
  "backups",
  "documentation",
  ".next",
  "playwright-report",
  "storybook-static",
  "test-results",
  ".turbo",
  ".cache",
  "target",
  "vendor"
]);

const languageByExtension = new Map([
  [".js", "JavaScript"],
  [".jsx", "JavaScript"],
  [".mjs", "JavaScript"],
  [".cjs", "JavaScript"],
  [".ts", "TypeScript"],
  [".tsx", "TypeScript"],
  [".py", "Python"],
  [".go", "Go"],
  [".rs", "Rust"],
  [".java", "Java"],
  [".kt", "Kotlin"],
  [".swift", "Swift"],
  [".rb", "Ruby"],
  [".php", "PHP"],
  [".cs", "C#"],
  [".json", "JSON"],
  [".md", "Markdown"],
  [".yml", "YAML"],
  [".yaml", "YAML"],
  [".toml", "TOML"]
]);

export function inspectRepo(repoPath = ".") {
  const root = path.resolve(repoPath);
  if (!fs.existsSync(root)) {
    throw new Error(`repo path does not exist: ${root}`);
  }

  const files = walk(root);
  const packageJson = readJsonIfExists(path.join(root, "package.json"));
  const languageCounts = countLanguages(files);

  return {
    ok: true,
    root,
    fileCount: files.length,
    languages: [...languageCounts.entries()]
      .map(([language, count]) => ({ language, count }))
      .sort((a, b) => b.count - a.count || languagePriority(a.language) - languagePriority(b.language) || a.language.localeCompare(b.language)),
    packageManagers: detectPackageManagers(root),
    scripts: packageJson?.scripts ?? {},
    entrypoints: detectEntrypoints(root, files, packageJson),
    importantDirectories: detectImportantDirectories(root),
    git: getGitInfo(root),
    files: files.slice(0, 250)
  };
}

function languagePriority(language) {
  const priorities = {
    TypeScript: 1,
    JavaScript: 2,
    Python: 3,
    Go: 4,
    Rust: 5,
    Swift: 6,
    Kotlin: 7,
    Java: 8,
    JSON: 20,
    Markdown: 21,
    YAML: 22,
    TOML: 23
  };
  return priorities[language] ?? 10;
}

export function walk(root) {
  const results = [];
  visit(root);
  return results;

  function visit(current) {
    const entries = safeReadDir(current);
    for (const entry of entries) {
      if (entry.isDirectory() && ignoredDirs.has(entry.name)) {
        continue;
      }

      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute);

      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && !isIgnoredFile(entry.name)) {
        results.push(relative);
      }
    }
  }
}

function isIgnoredFile(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return fileName === ".DS_Store"
    || fileName === ".eslintcache"
    || fileName === ".env"
    || fileName.startsWith(".env.")
    || fileName.endsWith(".log")
    || fileName.endsWith(".tsbuildinfo")
    || [".pem", ".key", ".crt", ".p12", ".sql", ".gz", ".tar"].includes(extension);
}

function safeReadDir(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function countLanguages(files) {
  const counts = new Map();
  for (const file of files) {
    const language = languageByExtension.get(path.extname(file));
    if (!language) {
      continue;
    }
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return counts;
}

function detectPackageManagers(root) {
  const checks = [
    ["package-lock.json", "npm"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["requirements.txt", "pip"],
    ["pyproject.toml", "python"],
    ["Cargo.toml", "cargo"],
    ["go.mod", "go"],
    ["Gemfile", "bundler"]
  ];
  return checks.filter(([file]) => fs.existsSync(path.join(root, file))).map(([, manager]) => manager);
}

function detectEntrypoints(root, files, packageJson) {
  const candidates = new Set();
  for (const key of ["main", "module", "types"]) {
    if (typeof packageJson?.[key] === "string") {
      candidates.add(packageJson[key]);
    }
  }

  for (const file of ["src/index.ts", "src/index.tsx", "src/index.js", "index.ts", "index.js", "main.py", "cmd/main.go"]) {
    if (files.includes(file) || fs.existsSync(path.join(root, file))) {
      candidates.add(file);
    }
  }

  for (const file of ["src/main.ts", "main.ts", "middleware.ts", "next.config.js", "next.config.mjs", "next.config.ts"]) {
    if (files.includes(file) || fs.existsSync(path.join(root, file))) {
      candidates.add(file);
    }
  }

  if (packageJson?.dependencies?.next || packageJson?.devDependencies?.next) {
    for (const file of ["app/page.tsx", "app/layout.tsx", "pages/index.tsx", "src/app/page.tsx", "src/pages/index.tsx"]) {
      if (files.includes(file) || fs.existsSync(path.join(root, file))) {
        candidates.add(file);
      }
    }
  }

  return [...candidates];
}

function detectImportantDirectories(root) {
  const candidates = ["src", "app", "pages", "lib", "server", "client", "components", "tests", "test", "docs", "scripts"];
  return candidates.filter((dir) => fs.existsSync(path.join(root, dir)));
}

function getGitInfo(root) {
  const result = runCommand("git", ["rev-parse", "--show-toplevel"], { cwd: root, timeout: 5000 });
  if (!result.ok) {
    return { available: false };
  }

  const branch = runCommand("git", ["branch", "--show-current"], { cwd: root, timeout: 5000 });
  const commit = runCommand("git", ["rev-parse", "--short", "HEAD"], { cwd: root, timeout: 5000 });
  const status = runCommand("git", ["status", "--short", "--branch"], { cwd: root, timeout: 5000 });
  const statusLines = status.stdout.trim().split("\n").filter(Boolean);
  const branchLine = statusLines[0] ?? "";
  const changeLines = statusLines.slice(1);
  return {
    available: true,
    root: result.stdout.trim(),
    branch: branch.stdout.trim() || undefined,
    commit: commit.stdout.trim() || undefined,
    clean: changeLines.length === 0,
    changes: changeLines.length,
    status: branchLine || undefined
  };
}
