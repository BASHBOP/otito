#!/usr/bin/env node
// Generate docs/assets/otito-how-it-works.html from the canonical tool catalog.
//
// The page is linked from the docs home page as *the* visual explanation of
// how otito works. It was once hand-maintained and drifted for eighteen
// releases, still advertising a `repo_catalog` tool that no longer existed and
// omitting `agent_experience` and `convergence_score` entirely.
//
// What the page says is tied to the code in four places:
//
//   - Tool names, CLI invocations and blurbs come from `getAgentTools()`, the
//     same catalog the MCP server and `otito agent-tools` are derived from; a
//     blurb is the tool's `summary` in src/lib/mcp.js. The generator fails when
//     the catalog and the LAYOUT table disagree in either direction.
//   - Every CLI command in `otito help` must be a card on the page or a row in
//     SUPPORTING_COMMANDS (tests/how-it-works.test.js).
//   - The footer carries the package version, so `npm version` re-renders the
//     page through the `version` lifecycle script and `--check` fails a release
//     that skipped it.
//   - The first guarantee on the page, that the gate never consults a model, is
//     checked against the gate modules' import graph (tests/gate-imports.test.js).
//
// `--check` re-renders and diffs against the committed file; it runs in
// `npm run quality`.
//
// Usage:
//   node scripts/generate-how-it-works.mjs            # write the file
//   node scripts/generate-how-it-works.mjs --check    # fail on drift

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import { getAgentTools } from "../src/lib/agent-tools.js";
import { GUARANTEES, LAYOUT, PHASES, STEPS, SURFACES } from "./how-it-works/content.js";
import { FONTS_HREF, SCRIPT, STYLE } from "./how-it-works/presentation.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(repoRoot, "docs", "assets", "otito-how-it-works.html");
const packageVersion = String(JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version);

/** @typedef {{ name: string, command: string, summary?: string }} CatalogTool */

async function main() {
  const check = process.argv.includes("--check");
  /** @type {CatalogTool[]} */
  const catalog = getAgentTools().tools;
  assertLayoutMatchesCatalog(catalog);
  assertStepsResolve();

  const rendered = render(catalog);
  const formatted = await prettier.format(rendered, { ...loadPrettierConfig(), parser: "html" });

  if (!check) {
    fs.writeFileSync(outputPath, formatted);
    console.log(`wrote ${path.relative(repoRoot, outputPath)} (${catalog.length} tools, v${packageVersion})`);
    return;
  }

  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (current === formatted) {
    console.log(`ok: ${path.relative(repoRoot, outputPath)} matches the tool catalog (${catalog.length} tools, v${packageVersion})`);
    return;
  }
  console.error(
    `${path.relative(repoRoot, outputPath)} is out of date with the tool catalog, a tool summary, or the package version.\n` +
      `Run \`npm run docs:diagram\` and commit the result.`,
  );
  process.exitCode = 1;
}

/**
 * The whole point of generating this file: a tool can never appear in the
 * catalog without appearing on the page, the page can never keep advertising
 * a tool that was removed, and every tool has to say what it does.
 * @param {CatalogTool[]} catalog
 */
function assertLayoutMatchesCatalog(catalog) {
  const catalogNames = new Set(catalog.map((tool) => tool.name));
  const layoutNames = new Set(LAYOUT.map((node) => node.tool));

  const missing = [...catalogNames].filter((name) => !layoutNames.has(name)).sort();
  const stale = [...layoutNames].filter((name) => !catalogNames.has(name)).sort();
  const unsummarised = catalog.filter((tool) => !tool.summary?.trim()).map((tool) => tool.name);

  const problems = [];
  if (missing.length) problems.push(`missing from the page LAYOUT: ${missing.join(", ")}`);
  if (stale.length) problems.push(`in the page LAYOUT but not in the tool catalog: ${stale.join(", ")}`);
  if (unsummarised.length) problems.push(`no summary in src/lib/mcp.js for: ${unsummarised.join(", ")}`);
  for (const node of LAYOUT) {
    if (!PHASES.some((phase) => phase.id === node.phase)) problems.push(`layout node ${node.id} names unknown phase ${node.phase}`);
  }
  if (problems.length) {
    throw new Error(`scripts/how-it-works/content.js is out of sync with the MCP tool catalog — ${problems.join("; ")}`);
  }
}

/** Every walkthrough step must focus a card that exists. */
function assertStepsResolve() {
  const ids = new Set([...LAYOUT.map((node) => node.id), ...SURFACES.map((surface) => surface.id)]);
  const dangling = STEPS.filter((step) => !ids.has(step.node)).map((step) => step.node);
  if (dangling.length) throw new Error(`walkthrough steps focus cards that do not exist: ${dangling.join(", ")}`);
}

function loadPrettierConfig() {
  const configPath = path.join(repoRoot, ".prettierrc.json");
  if (!fs.existsSync(configPath)) return {};
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

/** @param {string} value */
function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** @param {string} phaseId */
function phaseFor(phaseId) {
  const phase = PHASES.find((entry) => entry.id === phaseId);
  if (!phase) throw new Error(`unknown phase: ${phaseId}`);
  return phase;
}

/**
 * The catalog command is a full invocation with placeholders; the chip wants
 * the readable head of it (`otito gate`), not the flag soup.
 * @param {string} command
 */
function cliChip(command) {
  if (!command.startsWith("otito ")) return "";
  const words = command.split(" ");
  return words[1] === "mcp" ? "" : `otito ${words[1]}`;
}

/**
 * @param {CatalogTool[]} catalog
 * @returns {string}
 */
function render(catalog) {
  const byName = new Map(catalog.map((tool) => [tool.name, tool]));
  const mcpTools = catalog.map((tool) => tool.name);
  const mcpBlurb =
    `stdio MCP server exposing ${mcpTools.length} tools: ${mcpTools.join(", ")}. ` +
    `Published in the MCP Registry as io.github.BASHBOP/otito and listed on mcpservers.org and Glama. Cursor, VS Code, Claude Desktop, Claude Code, Codex and Gemini all speak to it the same way.`;
  const surfaces = SURFACES.map((surface) => (surface.id === "mcp" ? { ...surface, blurb: mcpBlurb } : surface));
  const first = surfaces.find((surface) => surface.id === STEPS[0].node) ?? surfaces[0];

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "    <title>How Otito works</title>",
    '    <meta name="description" content="Models generate the change. Otito proves whether it is safe to merge: context before the edit, evidence before the merge, an attestation after it." />',
    `    <meta name="otito:version" content="${escapeHtml(packageVersion)}" />`,
    "    <!-- Generated by scripts/generate-how-it-works.mjs. Do not edit by hand: run `npm run docs:diagram`. -->",
    '    <link rel="preconnect" href="https://fonts.googleapis.com" />',
    '    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />',
    `    <link rel="stylesheet" href="${FONTS_HREF}" />`,
    `    <style>${STYLE}</style>`,
    "  </head>",
    "  <body>",
    '    <header class="masthead wrap">',
    '      <p class="eyebrow">Òtítọ́ · how it works</p>',
    "      <h1>Models generate the change. <em>Otito proves whether it is safe to merge.</em></h1>",
    '      <p class="lede">',
    "        A local-first, deterministic trust layer that runs beside Claude Code, Codex, Cursor and Gemini. It builds context before the agent edits,",
    "        measures how far the change reached, gates the exact staged tree, and leaves a record after the merge. No server, no account, and no code",
    "        leaves the machine.",
    "      </p>",
    '      <ul class="facts">',
    `        <li><i></i>${mcpTools.length} MCP tools, each also a CLI command</li>`,
    "        <li><i></i>every command takes <code>--json</code></li>",
    "        <li><i></i>same inputs, same output</li>",
    "        <li><i></i>no model inside the gate</li>",
    "      </ul>",
    "    </header>",
    "",
    ...renderStrip("entry", surfaces, "Three ways in", "Pick one; the evidence is identical."),
    "",
    '    <div class="layout wrap">',
    '      <ol class="timeline" id="timeline" aria-label="The loop">',
    ...PHASES.flatMap((phase) => renderPhase(phase, byName, surfaces)),
    "      </ol>",
    "",
    '      <aside class="rail">',
    '        <section class="panel" aria-labelledby="walkthrough-title">',
    '          <div class="panel-head">',
    '            <h2 class="section-title" id="walkthrough-title">The loop</h2>',
    '            <button class="play" id="play-toggle" type="button" aria-pressed="true">Pause</button>',
    "          </div>",
    '          <ol class="steps">',
    ...STEPS.flatMap((step, index) => {
      const card = LAYOUT.find((node) => node.id === step.node) ?? surfaces.find((surface) => surface.id === step.node);
      const phaseId = card && "phase" in card ? card.phase : sectionPhase(card && "section" in card ? card.section : "");
      const color = phaseId ? phaseFor(phaseId).color : "var(--teal)";
      return [
        "            <li>",
        `              <button class="step${index === 0 ? " is-active" : ""}" type="button" data-node="${step.node}" style="--c: ${color}">`,
        `                <span class="step-num">${index + 1}</span>`,
        `                <strong>${escapeHtml(step.title)}</strong>`,
        `                <span>${escapeHtml(step.text)}</span>`,
        "              </button>",
        "            </li>",
      ];
    }),
    "          </ol>",
    "        </section>",
    "",
    '        <section class="panel detail" aria-live="polite">',
    `          <p class="detail-kind" id="detail-kind">Surface</p>`,
    `          <h3 id="detail-title" class="plain">${escapeHtml(first.title)}</h3>`,
    `          <p id="detail-body">${escapeHtml(first.blurb)}</p>`,
    '          <div class="chips" id="detail-chips">',
    ...first.chips.map((chip) => `            <span class="chip">${escapeHtml(chip)}</span>`),
    "          </div>",
    "        </section>",
    "      </aside>",
    "    </div>",
    "",
    ...renderStrip("output", surfaces, "What comes out", "Durable, recomputable, and readable without otito installed."),
    "",
    '    <section class="guarantees wrap" aria-labelledby="guarantees-title">',
    '      <h2 class="section-title" id="guarantees-title">What never happens</h2>',
    '      <div class="grid">',
    ...GUARANTEES.flatMap((item) => [
      `        <div class="guarantee" style="--c: ${item.color}">`,
      `          <h3>${escapeHtml(item.title)}</h3>`,
      `          <p>${escapeHtml(item.text)}</p>`,
      "        </div>",
    ]),
    "      </div>",
    "    </section>",
    "",
    "    <footer>",
    '      <div class="wrap">',
    `        <span>otito v${escapeHtml(packageVersion)} · generated from the shipped tool catalog · ${mcpTools.length} tools</span>`,
    '        <a href="https://bashbop.github.io/otito/">Documentation</a>',
    '        <a href="https://github.com/BASHBOP/otito">GitHub</a>',
    '        <a href="https://www.npmjs.com/package/@bashbop/otito">npm</a>',
    "      </div>",
    "    </footer>",
    "",
    `    <script>${SCRIPT}</script>`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

/**
 * Surfaces outside the loop are grouped under the phase whose colour they
 * borrow; entry and output surfaces belong to no phase.
 * @param {string} section
 */
function sectionPhase(section) {
  return PHASES.some((phase) => phase.id === section) ? section : "";
}

/**
 * @param {string} section
 * @param {typeof SURFACES} surfaces
 * @param {string} title
 * @param {string} note
 */
function renderStrip(section, surfaces, title, note) {
  const lines = [
    `    <section class="strip wrap" aria-labelledby="strip-${section}">`,
    '      <div class="strip-head">',
    `        <h2 id="strip-${section}">${escapeHtml(title)}</h2>`,
    `        <p>${escapeHtml(note)}</p>`,
    "      </div>",
    '      <div class="grid">',
  ];
  const color = section === "output" ? "var(--amber)" : "var(--teal)";
  for (const surface of surfaces.filter((entry) => entry.section === section)) {
    lines.push(...renderSurfaceCard(surface, section, color));
  }
  lines.push("      </div>", "    </section>");
  return lines;
}

/**
 * @param {(typeof SURFACES)[number]} surface
 * @param {string} phaseId
 * @param {string} color
 */
function renderSurfaceCard(surface, phaseId, color) {
  const attrs = [
    `class="card surface"`,
    `type="button"`,
    `data-id="${surface.id}"`,
    `data-phase="${phaseId}"`,
    `data-kind="${surface.kind}"`,
    "command" in surface && surface.command ? `data-command="${surface.command}"` : "",
    `data-title="${escapeHtml(surface.title)}"`,
    `data-desc="${escapeHtml(surface.blurb)}"`,
    `data-chips="${escapeHtml(surface.chips.join("|"))}"`,
    `style="--c: ${color}"`,
  ].filter(Boolean);
  const lines = [
    `        <button ${attrs.join(" ")}>`,
    `          <span class="card-name">${escapeHtml(surface.title)}</span>`,
    `          <span class="card-sub">${escapeHtml(surface.sub)}</span>`,
  ];
  if ("hosts" in surface && surface.hosts) {
    lines.push('          <span class="card-hosts">', ...surface.hosts.map((host) => `            <span>${escapeHtml(host)}</span>`), "          </span>");
  }
  lines.push("        </button>");
  return lines;
}

/**
 * @param {(typeof PHASES)[number]} phase
 * @param {Map<string, CatalogTool>} byName
 * @param {typeof SURFACES} surfaces
 */
function renderPhase(phase, byName, surfaces) {
  const tools = LAYOUT.filter((node) => node.phase === phase.id);
  const extras = surfaces.filter((surface) => surface.section === phase.id);
  const lines = [
    `        <li class="phase${phase.id === "edit" ? " model" : ""}" data-phase="${phase.id}" style="--c: ${phase.color}">`,
    '          <div class="phase-head">',
    `            <span class="phase-index">${phase.index}</span>`,
    `            <h2>${escapeHtml(phase.title)}</h2>`,
    `            <p class="phase-actor">${escapeHtml(phase.actor)}</p>`,
    `            <p class="phase-sub">${escapeHtml(phase.sub)}</p>`,
    "          </div>",
    '          <div class="grid">',
  ];
  for (const node of tools) {
    const tool = byName.get(node.tool);
    if (!tool) throw new Error(`layout node ${node.id} references unknown tool ${node.tool}`);
    const cli = cliChip(tool.command);
    const command = cli ? cli.slice("otito ".length) : "";
    const desc = `${tool.summary ?? ""} CLI: ${cli || "otito mcp"}.`;
    const chips = [node.tool, cli].filter(Boolean);
    const attrs = [
      `class="card tool"`,
      `type="button"`,
      `data-id="${node.id}"`,
      `data-phase="${phase.id}"`,
      `data-kind="tool"`,
      command ? `data-command="${command}"` : "",
      `data-title="${escapeHtml(tool.name)}"`,
      `data-desc="${escapeHtml(desc)}"`,
      `data-chips="${escapeHtml(chips.join("|"))}"`,
    ].filter(Boolean);
    lines.push(
      `        <button ${attrs.join(" ")}>`,
      `          <span class="card-name">${escapeHtml(tool.name)}</span>`,
      `          <span class="card-sub">${escapeHtml(node.sub)}</span>`,
      ...(cli ? [`          <span class="card-cli">${escapeHtml(cli)}</span>`] : []),
      "        </button>",
    );
  }
  for (const surface of extras) {
    lines.push(...renderSurfaceCard(surface, phase.id, phase.color));
  }
  lines.push("          </div>", "        </li>");
  return lines;
}

await main();
