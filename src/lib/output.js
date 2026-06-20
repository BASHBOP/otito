import fs from "node:fs";
import path from "node:path";

/**
 * @param {string} text
 * @returns {void}
 */
export function printText(text) {
  process.stdout.write(`${text}\n`);
}

/**
 * @param {unknown} value
 * @returns {void}
 */
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
  repoctx impact <repo> <query> [--top n] [--diff-base ref] [--out file] [--json] [--mermaid] [--no-emoji] [--color|--no-color] [--theme name]
  repoctx ax <repo> <query> [--top n] [--out file] [--json]
  repoctx converge <repo> <query> --base <ref> [--top n] [--out file] [--json]
  repoctx pass <repo> [--base ref] [--policy standard|company|high-risk] [--governance team|solo] [--request text] [--out file] [--json] [--no-emoji]
  repoctx pass-pr [selector] [--path repo] [--policy x] [--governance x] [--request text] [--out file] [--json] [--no-emoji]
  repoctx review <repo> [--request text] [--base ref] [--pr selector] [--policy x] [--governance x] [--json] [--mermaid] [--no-emoji]
  repoctx install|i [--global|--link] [--json]
  repoctx map <path> [--out file] [--json] [--mermaid]
  repoctx structure <path> [--pattern glob] [--out file] [--exclude file] [--json]
  repoctx deps <package> [--query text] [--limit n] [--json]
  repoctx init <path> [--tool-repo owner/repo] [--tool-ref ref] [--force] [--no-workflow] [--no-gates] [--no-precommit] [--hooks-path] [--yes] [--json]
  repoctx matrix [--json]
  repoctx mcp
  repoctx pr <path> [--number n] [--base ref] [--head ref] [--out file] [--comment] [--json]
  repoctx report <path> [--out file] [--json] [--mermaid]
  repoctx workspace <repo...> [--out file] [--json] [--mermaid]
  repoctx harness <path> [--out file] [--json]
  repoctx eval <path> [--query text] [--naive-cap n] [--out file] [--json]
  repoctx data-access <path> [--out file] [--json] [--mermaid]
  repoctx agent-tools [--json|--markdown]
  repoctx dashboard [<repo>] [--out file] [--json] [--clear] [--no-artifacts] [--no-git]   # local usage & performance UI (HTML)
  repoctx telemetry [status|on|off|clear] [--json]                                          # opt-in usage capture (off by default)
  repoctx config [list]                           # show config with source annotations
  repoctx config get [key]                        # show one or all resolved values
  repoctx config set <key> <value> [--local]      # write to user (or local) config
  repoctx config set color true                   # enable color in user config
  repoctx config set theme high-contrast          # set theme (default|color|minimal|high-contrast)
  repoctx config set emoji false                  # disable emoji in user config
  repoctx config set telemetry true               # opt in to local usage capture for the dashboard

Legacy alias (deprecated, removed in v3.0.0 — use repoctx):
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
  node src/cli.js init ../my-repo --hooks-path --yes
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

/**
 * @param {string} targetPath
 * @param {string | NodeJS.ArrayBufferView} contents
 * @returns {{ path: string }}
 */
export function writeArtifact(targetPath, contents) {
  const absolutePath = path.resolve(targetPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
  return { path: absolutePath };
}
