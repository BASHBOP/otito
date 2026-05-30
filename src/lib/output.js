import fs from "node:fs";
import path from "node:path";

export function printText(text) {
  process.stdout.write(`${text}\n`);
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function printHelp() {
  printText(`repoctx

Usage:
  repoctx doctor [--json]
  repoctx repo <path> [--json]
  repoctx discover <root...> [--depth n] [--limit n] [--json]
  repoctx index <repo...> [--discover] [--catalog file] [--json]
  repoctx catalog [--catalog file] [--json]
  repoctx search <query> [--catalog file] [--limit n] [--offline] [--json]
  repoctx context <query> [--path repo] [--limit n] [--out file] [--json]
  repoctx impact <repo> <query> [--top n] [--diff-base ref] [--out file] [--json] [--no-emoji]
  repoctx pass <repo> [--base ref] [--policy standard|company|high-risk] [--governance team|solo] [--request text] [--out file] [--json] [--no-emoji]
  repoctx pass-pr [selector] [--path repo] [--policy x] [--governance x] [--request text] [--out file] [--json] [--no-emoji]
  repoctx review <repo> [--request text] [--base ref] [--pr selector] [--policy x] [--governance x] [--json] [--no-emoji]
  repoctx install|i [--global|--link] [--json]
  repoctx map <path> [--out file] [--json]
  repoctx structure <path> [--pattern glob] [--out file] [--exclude file] [--json]
  repoctx deps <package> [--query text] [--limit n] [--json]
  repoctx init <path> [--tool-repo owner/repo] [--tool-ref ref] [--force] [--no-workflow] [--json]
  repoctx matrix [--json]
  repoctx mcp
  repoctx pr <path> [--number n] [--base ref] [--head ref] [--out file] [--comment] [--json]
  repoctx report <path> [--out file] [--json]
  repoctx workspace <repo...> [--out file] [--json]
  repoctx harness <path> [--out file] [--json]
  repoctx eval <path> [--query text] [--naive-cap n] [--out file] [--json]
  repoctx agent-tools [--json|--markdown]

Legacy alias:
  dev-context <command>

Examples:
  node src/cli.js doctor
  node src/cli.js repo . --json
  node src/cli.js discover ~/projects --depth 2
  node src/cli.js index ~/projects --discover
  node src/cli.js catalog
  node src/cli.js search "events controller"
  node src/cli.js context "add a new MCP tool" --path .
  node src/cli.js install
  node src/cli.js map . --json
  node src/cli.js init ../my-repo
  node src/cli.js mcp
  node src/cli.js pr . --base origin/main --out .dev-context/pr-review.md
  node src/cli.js harness . --out .dev-context/harness.md
  node src/cli.js deps zod --query parse
  node src/cli.js report . --out .dev-context/report.md
  node src/cli.js workspace ../web ../api --out .dev-context/workspace.md
  node src/cli.js structure ../web --pattern 'app/**/*.tsx' --out .dev-context/app.html
  node src/cli.js eval . --out .dev-context/eval.md
`);
}

export function writeArtifact(targetPath, contents) {
  const absolutePath = path.resolve(targetPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
  return { path: absolutePath };
}
