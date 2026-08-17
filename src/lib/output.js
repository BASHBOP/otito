import fs from "node:fs";
import path from "node:path";
import { createRenderer } from "./render/fancy.js";

/**
 * @typedef {{ emoji?: boolean, color?: boolean, theme?: string }} TerminalOptions
 */

/**
 * Render a compact, human-first terminal summary. JSON and Markdown callers
 * should continue using their dedicated serializers instead of this helper.
 *
 * @param {{ title: string, glyph?: string, subtitle?: string, facts?: [string, string | number][], sections?: { title: string, items: string[], glyph?: string }[], options?: TerminalOptions }} input
 * @returns {string}
 */
export function formatTerminalSummary(input) {
  const renderer = createRenderer(input.options);
  const lines = [];
  const headlines = input.subtitle ? [{ text: input.subtitle, glyph: "💬" }] : [];
  lines.push(renderer.header({ text: input.title, glyph: input.glyph }, headlines));

  if (input.facts?.length) {
    lines.push("");
    lines.push(
      renderer.section(
        renderer.emoji ? "📌 At a glance" : "At a glance",
        input.facts.map(([label, value]) => `${label}: ${value}`),
      ),
    );
  }

  for (const section of input.sections ?? []) {
    lines.push("");
    lines.push(
      renderer.section(
        `${section.glyph && renderer.emoji ? `${section.glyph} ` : ""}${section.title}`,
        section.items.length ? section.items.map((item) => `${renderer.emoji ? "•" : "-"} ${item}`) : [renderer.emoji ? "• none" : "- none"],
      ),
    );
  }

  return lines.join("\n");
}

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
  printText(`otito

Usage:
  otito --version | -v
  otito doctor [--json]
  otito repo <path> [--json]
  otito discover <root...> [--depth n] [--limit n] [--json]
  otito index <repo...> [--discover] [--catalog file] [--json]
  otito catalog [--catalog file] [--json]
  otito search <query> [--catalog file] [--limit n] [--offline] [--json]
  otito context <query> [--path repo] [--limit n] [--out file] [--json] [--no-emoji] [--color|--no-color] [--theme name]
  otito impact <repo> <query> [--top n] [--diff-base ref] [--out file] [--json] [--mermaid] [--no-emoji] [--color|--no-color] [--theme name]
  otito ax <repo> <query> [--top n] [--out file] [--json]
  otito converge <repo> <query> --base <ref> [--staged] [--top n] [--out file] [--json]
  otito pass <repo> [--base ref] [--staged] [--run-validation] [--policy standard|company|high-risk] [--governance team|solo] [--request text] [--min-convergence n] [--receipt hash|file] [--out file] [--json] [--no-emoji]
  otito gate <repo> [--base ref] [--staged] [--run-validation] [--policy standard|company|high-risk] [--governance team|solo] [--request text] [--min-convergence n] [--receipt hash|file] [--out file] [--json] [--no-emoji]
  otito pass-pr [selector] [--path repo] [--policy x] [--governance x] [--request text] [--min-convergence n] [--receipt hash|file] [--out file] [--json] [--no-emoji]
  otito review <repo> [--request text] [--base ref] [--pr selector] [--policy x] [--governance x] [--min-convergence n] [--receipt hash|file] [--json] [--mermaid] [--no-emoji]
  otito install|i [--global|--link] [--json]
  otito map <path> [--out file] [--json] [--mermaid]
  otito structure <path> [--pattern glob] [--out file] [--exclude file] [--json]
  otito deps <package> [--query text] [--limit n] [--json]
  otito init <path> [--tool-repo owner/repo] [--tool-ref ref] [--force] [--no-workflow] [--no-gates] [--no-precommit] [--hooks-path] [--yes] [--json]
  otito matrix [--json]
  otito mcp
  otito pr <path> [--number n] [--base ref] [--head ref] [--out file] [--comment] [--json]
  otito report <path> [--out file] [--json] [--mermaid]
  otito workspace <repo...> [--out file] [--json] [--mermaid]
  otito workspace-gate <repo...> [--base ref] [--run-validation] [--policy standard|company|high-risk] [--governance team|solo] [--request text] [--json]
  otito harness <path> [--out file] [--json]
  otito eval <path> [--query text] [--naive-cap n] [--out file] [--json]
  otito eval --accuracy|--harness|--gate-effectiveness [--corpus file] [--out file] [--json]
  otito data-access <path> [--out file] [--json] [--mermaid]
  otito agent-tools [--json|--markdown]
  otito dashboard [<repo>] [--out file] [--json] [--clear] [--no-artifacts] [--no-git]   # local usage & performance UI (HTML)
  otito telemetry [status|on|off|clear] [--json]                                          # opt-in local usage capture
  otito telemetry share [status|on|off]                                                    # separate anonymous sharing opt-in
  otito config [list]                           # show config with source annotations
  otito config get [key]                        # show one or all resolved values
  otito config set <key> <value> [--local]      # write to user (or local) config
  otito config set color true                   # enable color in user config
  otito config set theme high-contrast          # set theme (default|color|minimal|high-contrast)
  otito config set emoji false                  # disable emoji in user config
  otito config set telemetry true               # opt in to local usage capture for the dashboard
  otito telemetry share on                      # optionally share a minimal anonymous usage shape

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
  node src/cli.js pr . --base origin/main --out .otito/pr-review.md
  node src/cli.js harness . --out .otito/harness.md
  node src/cli.js deps zod --query parse
  node src/cli.js report . --out .otito/report.md
  node src/cli.js workspace ../web ../api --out .otito/workspace.md
  node src/cli.js structure ../web --pattern 'app/**/*.tsx' --out .otito/app.html
  node src/cli.js eval . --out .otito/eval.md
  node src/cli.js eval --gate-effectiveness
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
