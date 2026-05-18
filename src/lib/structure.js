import fs from "node:fs";
import path from "node:path";
import { commandExists, runCommand } from "./tools.js";

export function generateStructure(repoPath = ".", options = {}) {
  const root = path.resolve(repoPath);
  const outputPath = path.resolve(options.out ?? path.join(root, ".dev-context", "structure.html"));
  const installed = commandExists("code-structure");

  if (!installed.available) {
    return {
      ok: false,
      error: "code-structure is not installed.",
      installHint: "Install with: npm install -g code-structure",
      outputPath
    };
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const args = ["**/*.ts", "-o", outputPath];
  for (const excluded of options.exclude ?? []) {
    args.push("--exclude", excluded);
  }

  const result = runCommand("code-structure", args, { cwd: root, timeout: 120000 });
  return {
    ok: result.ok,
    outputPath,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    error: result.ok ? undefined : result.stderr.trim() || result.error?.message || "code-structure failed"
  };
}
