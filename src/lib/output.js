import fs from "node:fs";
import path from "node:path";
import { createRenderer } from "./render/fancy.js";

/**
 * @typedef {{ emoji?: boolean, color?: boolean, theme?: string }} TerminalOptions
 * @typedef {{ status: "verified" | "tests-pass" | "runs" | "not-verified", detail?: string }} ClosingLine
 * @typedef {{ title: string, items: string[], glyph?: string, kind?: "list" | "tree" }} SummarySection
 * @typedef {{ title: string, glyph?: string, subtitle?: string, facts?: [string, string | number][], sections?: SummarySection[], close?: ClosingLine, options?: TerminalOptions }} SummaryInput
 */

/**
 * Render a compact, human-first terminal summary in otito's shared shape: the
 * header box, the facts as a table, each section as a list (a file list as a
 * tree), and the closing line last. JSON and Markdown callers should continue
 * using their dedicated serializers instead of this helper.
 *
 * @param {SummaryInput} input
 * @returns {string}
 */
export function formatTerminalSummary(input) {
  const renderer = createRenderer(input.options);
  const lines = [];
  const headlines = input.subtitle ? [{ text: input.subtitle, glyph: "💬" }] : [];
  lines.push(renderer.header({ text: input.title, glyph: input.glyph }, headlines));

  if (input.facts?.length) {
    const facts = renderer.table(
      input.facts.map(([label, value]) => [label, String(value)]),
      { width: renderer.width - 2 },
    );
    lines.push("");
    lines.push(renderer.section(`${renderer.pick({ emoji: "📌 ", ascii: "" })}At a glance`, facts.split("\n")));
  }

  for (const section of input.sections ?? []) {
    lines.push("");
    const title = `${renderer.pick({ emoji: section.glyph ? `${section.glyph} ` : "", ascii: "" })}${section.title}`;
    const item = renderer.paint(renderer.glyphs.item, "dim");
    const body = !section.items.length
      ? [`${item} none`]
      : section.kind === "tree"
        ? renderer.tree(section.items).split("\n")
        : section.items.map((line) => `${item} ${line}`);
    lines.push(renderer.section(title, body));
  }

  if (input.close) {
    lines.push("");
    lines.push(renderer.close(input.close));
  }
  return lines.join("\n");
}

/**
 * The closing line for a command that wrote files: `Verified.` once every
 * file re-reads as a non-empty file, otherwise the first one that did not.
 * @param {string} root
 * @param {string[]} relativePaths
 * @returns {ClosingLine}
 */
export function verifyWrittenFiles(root, relativePaths) {
  for (const relativePath of relativePaths) {
    try {
      if (fs.statSync(path.join(root, relativePath)).size > 0) continue;
    } catch {
      // Missing file: fall through to the closing line below.
    }
    return { status: "not-verified", detail: `${relativePath} did not re-read after writing` };
  }
  return { status: "verified" };
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
  otito context <query> [--path repo] [--limit n] [--online] [--out file] [--json]
  otito impact <repo> <query> [--top n] [--diff-base ref] [--out file] [--json] [--mermaid]
  otito obsidian <repo> [--query text] [--out vault-dir] [--limit n] [--top n] [--json]
  otito ax <repo> <query> [--top n] [--out file] [--json]
  otito route <repo> <query> [--host id] [--tier-only] [--offline] [--top n] [--out file] [--json]   # recommend a model tier before spending on the task
  otito converge <repo> <query> --base <ref> [--head ref | --staged] [--include-untracked] [--top n] [--out file] [--json]
  otito attest [repo] --verdict file --merge sha [--prev sha] [--pr n] [--author name] [--committed iso] [--ledger file] [--json]   # append a hash-chained record of a merged commit
  otito attest [repo] --verify [--ledger file] [--json]                                     # recompute the chain; exits 1 if any record was altered
  otito calibrate <repo> [--window days] [--min-sample n] [--since date] [--max n] [--json]   # grade risk flags against this repo's own history
  otito regret <repo> [--window days] [--min-sample n] [--since date] [--max commits] [--offline] [--quiet] [--out file] [--json]   # grade route tiers against this repo's own history
  otito regret --rescore run.json [--out file] [--json]                                     # regrade a saved run with the current arithmetic; replays and calls nothing
  otito pass <repo> [--base ref] [--head ref | --staged] [--run-validation] [--policy standard|company|high-risk] [--governance team|solo] [--request text] [--min-convergence n] [--receipt hash|file] [--out file] [--json]
  otito gate [repo | --path repo] [--base ref] [--head ref | --staged] [--run-validation] [--policy standard|company|high-risk] [--governance team|solo] [--request text] [--min-convergence n] [--receipt hash|file] [--out file] [--json]
  otito pass-pr [selector] [--path repo] [--policy x] [--governance x] [--request text] [--min-convergence n] [--receipt hash|file] [--out file] [--json]
  otito review [repo | --path repo] [request] [--request text] [--base ref] [--pr selector] [--policy x] [--governance x] [--min-convergence n] [--receipt hash|file] [--json] [--mermaid]
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
  otito config set emoji true                   # opt back into emoji glyphs in user config
  otito config set telemetry true               # opt in to local usage capture for the dashboard
  otito telemetry share on                      # optionally share a minimal anonymous usage shape

Global flags (every command that prints for a terminal):
  --emoji | --no-emoji        emoji glyphs on, or ASCII glyphs off; the default is plain Unicode (ASCII under CI, NO_EMOJI=1 or TERM=dumb)
  --color | --no-color        ANSI colour on or off; the default follows the terminal, NO_COLOR and FORCE_COLOR
  --theme name                default | color | minimal | high-contrast

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
  node src/cli.js attest . --verify
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
