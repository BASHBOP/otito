import fs from "node:fs";
import path from "node:path";

export function printText(text) {
  process.stdout.write(`${text}\n`);
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printHelp() {
  printText(`dev-context

Usage:
  dev-context doctor [--json]
  dev-context repo <path> [--json]
  dev-context structure <path> [--pattern glob] [--out file] [--exclude file] [--json]
  dev-context deps <package> [--query text] [--limit n] [--json]
  dev-context matrix [--json]
  dev-context report <path> [--out file] [--json]
  dev-context workspace <repo...> [--out file] [--json]
  dev-context agent-tools [--json|--markdown]

Examples:
  node src/cli.js doctor
  node src/cli.js repo . --json
  node src/cli.js deps zod --query parse
  node src/cli.js report . --out .dev-context/report.md
  node src/cli.js workspace ../web ../api --out .dev-context/workspace.md
  node src/cli.js structure ../web --pattern 'app/**/*.tsx' --out .dev-context/app.html
`);
}

export function writeArtifact(targetPath, contents) {
  const absolutePath = path.resolve(targetPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
  return { path: absolutePath };
}
