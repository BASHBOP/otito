#!/usr/bin/env node
// Generate docs/assets/otito-how-it-works.html from the canonical tool catalog.
//
// The diagram is linked from the docs home page as *the* visual explanation of
// how otito works, and it was hand-maintained: it drifted for eighteen releases
// while still advertising a `repo_catalog` tool that no longer exists and
// omitting `agent_experience` and `convergence_score` entirely.
//
// Tool names and CLI invocations now come from `getAgentTools()`, the same
// catalog the MCP server and `otito agent-tools` are derived from. The LAYOUT
// table below owns only what a catalog cannot know: which layer a tool belongs
// in, where it sits, and a one-line blurb short enough for a tooltip.
//
// The generator fails when LAYOUT and the catalog disagree in either direction,
// so adding or removing an MCP tool forces the diagram to be updated in the
// same change. `--check` re-renders and diffs against the committed file; it
// runs in `npm run quality`.
//
// Usage:
//   node scripts/generate-how-it-works.mjs            # write the file
//   node scripts/generate-how-it-works.mjs --check    # fail on drift

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prettier from "prettier";
import { getAgentTools } from "../src/lib/agent-tools.js";
import { SCRIPT_HEAD, SCRIPT_TAIL, STYLE } from "./how-it-works/presentation.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(repoRoot, "docs", "assets", "otito-how-it-works.html");

/** Layer bands, top to bottom. */
const LAYERS = [
  { id: "entry", label: "ENTRY", color: "#58a6ff", legend: "Entry surfaces", y: 38, height: 74 },
  { id: "discover", label: "DISCOVER", color: "#79c0ff", legend: "Discover & index", y: 154, height: 74 },
  { id: "map", label: "CONTEXT", color: "#d2a8ff", legend: "Context & maps", y: 275, height: 74 },
  { id: "change", label: "IMPACT", color: "#ffd866", legend: "Change impact", y: 390, height: 88 },
  { id: "review", label: "REVIEW", color: "#7ee787", legend: "Review & gates", y: 515, height: 82 },
  { id: "output", label: "OUTPUT", color: "#ffa657", legend: "Evidence", y: 645, height: 72 },
];

/**
 * Placement and blurb for every MCP tool. `tool` keys into the catalog: the
 * node's title and its CLI chip are read from there, never written here.
 */
const LAYOUT = [
  {
    id: "inspect",
    tool: "repo_inspect",
    layer: "discover",
    label: "inspect",
    sub: "repo facts",
    cx: 220,
    r: 34,
    blurb: "Repository facts: languages, scripts, package managers, entrypoints, git state.",
  },
  {
    id: "index",
    tool: "repo_index",
    layer: "discover",
    label: "index",
    sub: "catalog",
    cx: 550,
    r: 34,
    blurb: "Index local repositories into a per-user catalog. dryRun discovers read-only; the inspected repo is never modified.",
  },
  {
    id: "search",
    tool: "repo_search",
    layer: "discover",
    label: "search",
    sub: "symbols",
    cx: 880,
    r: 34,
    blurb: "Search indexed repos by path, domain, kind, route, imports, exports, and symbols. Omit the query to list the catalog.",
  },

  {
    id: "map",
    tool: "repo_map",
    layer: "map",
    label: "map",
    sub: "AST graph",
    cx: 165,
    r: 34,
    blurb: "AST-backed JSON code map: imports, exports, routes, domains across TS/JS/Go/C#/Python/Java/Ruby/Rust.",
  },
  {
    id: "context",
    tool: "context_pack",
    layer: "map",
    label: "context",
    sub: "task pack",
    cx: 415,
    r: 34,
    blurb: "Task-aware context packet: primary files, tests, patterns, validation commands, token estimates. Run before planning or editing.",
  },
  {
    id: "harness",
    tool: "repo_harness",
    layer: "map",
    label: "harness",
    sub: "scripts",
    cx: 685,
    r: 34,
    blurb: "Setup, validation, and runtime commands inferred from the repo. The first artifact an agent or CI job should read.",
  },
  {
    id: "workspace",
    tool: "workspace_report",
    layer: "map",
    label: "workspace",
    sub: "multi-repo",
    cx: 935,
    r: 34,
    blurb: "Product-level report across related repositories, for cross-service work.",
  },

  {
    id: "impact",
    tool: "change_impact",
    layer: "change",
    label: "impact",
    sub: "blast radius",
    cx: 415,
    r: 44,
    blurb:
      "Ranks the files most likely to own a plain-English change request, with risk flags and suggested tests. A diff base adds exact changed-file evidence.",
  },
  {
    id: "ax",
    tool: "agent_experience",
    layer: "change",
    label: "AX",
    sub: "0–100",
    cx: 685,
    r: 34,
    blurb: "Agent Experience: how cheap and safe it is for an agent to make this change here — changeability, containment, guardrails, clarity.",
  },

  {
    id: "reviewctx",
    tool: "review_context",
    layer: "review",
    label: "review ctx",
    sub: "diff pack",
    cx: 165,
    r: 34,
    blurb: "PR/commit review context from git diff metadata, optionally enriched with GitHub comments. No verdict.",
  },
  {
    id: "converge",
    tool: "convergence_score",
    layer: "review",
    label: "converge",
    sub: "intent vs diff",
    cx: 415,
    r: 34,
    blurb: "Distance between the stated task and the actual diff: coverage, scope, risk alignment. Emits a recomputable receipt as durable evidence.",
  },
  {
    id: "gate",
    tool: "review_gate",
    layer: "review",
    label: "gate",
    sub: "merge ready",
    cx: 685,
    r: 34,
    blurb:
      "PASS/WARN/FAIL merge gate: changed files, secret safety (path and content), risk paths, release discipline, validation, dependency audit, policy profile. With pr, adds GitHub review, CODEOWNERS, branch protection, and checks.",
  },
  {
    id: "verdict",
    tool: "review_verdict",
    layer: "review",
    label: "verdict",
    sub: "composite",
    cx: 935,
    r: 34,
    blurb: "Composite verdict: change impact plus review context plus the gate, with a derived confidence score.",
  },
];

/** Entry and output nodes are surfaces, not catalog tools, so they are declared whole. */
const SURFACES = [
  {
    id: "cli",
    layer: "entry",
    title: "CLI",
    label: "CLI",
    sub: "otito …",
    x: 155,
    blurb: "Human and script entrypoint. Every command takes --json.",
    chips: ["otito doctor", "otito context", "otito gate"],
  },
  { id: "mcp", layer: "entry", title: "MCP server", label: "MCP", sub: "otito mcp", x: 485, blurb: "", chips: ["otito mcp", "context_pack", "review_gate"] },
  {
    id: "ci",
    layer: "entry",
    title: "CI scaffold",
    label: "CI",
    sub: "init scaffold",
    x: 815,
    blurb: "otito init writes .github/workflows/otito-ci.yml, a pre-commit hook, and .otito/ assets into a target repository.",
    chips: ["otito init .", "otito-ci.yml"],
  },
  {
    id: "artifacts",
    layer: "output",
    title: ".otito/",
    label: ".otito",
    sub: "artifacts",
    x: 155,
    blurb: "Durable Markdown/JSON artifacts: pr-review.md, harness.md, workspace.md, context-pack.md. Gitignored by init.",
    chips: [".otito/pr-review.md", ".otito/harness.md"],
  },
  {
    id: "receipt",
    layer: "output",
    title: "Receipt",
    label: "receipt",
    sub: "staged tree",
    x: 485,
    blurb:
      "A convergence or workspace receipt binding the exact base, parent, and staged-tree identity — recomputable by anyone, and not something a model can award itself.",
    chips: ["otito converge", "otito gate --staged"],
  },
  {
    id: "verdictout",
    layer: "output",
    title: "PASS / WARN / FAIL",
    label: "verdict",
    sub: "PASS · WARN · FAIL",
    x: 815,
    blurb: "Merge-readiness signal for humans and agents. WARN surfaces risk; FAIL blocks merge. A passing local gate is evidence, never an approval.",
    chips: ["PASS", "WARN", "FAIL"],
  },
];

/** The animated walkthrough. Each step focuses one node. */
const STEPS = [
  { node: "mcp", layer: "entry", title: "Connect", text: "Install the CLI or wire an MCP host · optional init scaffold for CI and hooks" },
  { node: "inspect", layer: "discover", title: "Discover", text: "Inspect repo shape · index a catalog · search paths and symbols" },
  { node: "context", layer: "map", title: "Context", text: "Generate maps, task packs, and harness commands before the agent edits" },
  { node: "impact", layer: "change", title: "Impact", text: "Rank the files a change should touch · score how agent-friendly the repo is" },
  { node: "gate", layer: "review", title: "Review & gate", text: "Build PR context · score intent against the diff · run the merge gate" },
  { node: "receipt", layer: "output", title: "Evidence", text: "Artifacts, recomputable receipts, PR comments, and a CI verdict" },
];

const NODE_WIDTH = 130;
const NODE_HEIGHT = 52;
const CENTER_X = 550;

async function main() {
  const check = process.argv.includes("--check");
  const catalog = getAgentTools().tools;
  assertLayoutMatchesCatalog(catalog);

  const rendered = render(catalog);
  const formatted = await prettier.format(rendered, { ...loadPrettierConfig(), parser: "html" });

  if (!check) {
    fs.writeFileSync(outputPath, formatted);
    console.log(`wrote ${path.relative(repoRoot, outputPath)} (${catalog.length} tools)`);
    return;
  }

  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (current === formatted) {
    console.log(`ok: ${path.relative(repoRoot, outputPath)} matches the tool catalog (${catalog.length} tools)`);
    return;
  }
  console.error(`${path.relative(repoRoot, outputPath)} is out of date with the tool catalog.\n` + `Run \`npm run docs:diagram\` and commit the result.`);
  process.exitCode = 1;
}

/**
 * The whole point of generating this file: a tool can never appear in the
 * catalog without appearing in the diagram, and the diagram can never keep
 * advertising a tool that was removed.
 * @param {{ name: string }[]} catalog
 */
function assertLayoutMatchesCatalog(catalog) {
  const catalogNames = new Set(catalog.map((tool) => tool.name));
  const layoutNames = new Set(LAYOUT.map((node) => node.tool));

  const missing = [...catalogNames].filter((name) => !layoutNames.has(name)).sort();
  const stale = [...layoutNames].filter((name) => !catalogNames.has(name)).sort();

  const problems = [];
  if (missing.length) problems.push(`missing from the diagram LAYOUT: ${missing.join(", ")}`);
  if (stale.length) problems.push(`in the diagram LAYOUT but not in the tool catalog: ${stale.join(", ")}`);
  if (problems.length) {
    throw new Error(`scripts/generate-how-it-works.mjs is out of sync with the MCP tool catalog — ${problems.join("; ")}`);
  }
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

/** @param {string} layerId */
function layerFor(layerId) {
  const layer = LAYERS.find((entry) => entry.id === layerId);
  if (!layer) throw new Error(`unknown layer: ${layerId}`);
  return layer;
}

/**
 * @param {{ name: string, command: string, mcpOnly: boolean }[]} catalog
 * @returns {string}
 */
function render(catalog) {
  const byName = new Map(catalog.map((tool) => [tool.name, tool]));
  const mcpTools = catalog.map((tool) => tool.name);

  /** @type {Record<string, string[]>} */
  const chipMap = {};
  for (const surface of SURFACES) chipMap[surface.id] = surface.chips;
  for (const node of LAYOUT) {
    const tool = byName.get(node.tool);
    chipMap[node.id] = [node.tool, cliChip(tool?.command ?? "")].filter(Boolean);
  }

  const mcpBlurb = `stdio MCP server exposing ${mcpTools.length} tools: ${mcpTools.join(", ")}. ` + `Published in the MCP Registry as io.github.BASHBOP/otito.`;

  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "    <title>otito — How It Works</title>",
    "    <!-- Generated by scripts/generate-how-it-works.mjs. Do not edit by hand: run `npm run docs:diagram`. -->",
    `    <style>${STYLE}</style>`,
    "  </head>",
    "  <body>",
    "    <header>",
    "      <h1>otito — layered diagram</h1>",
    "      <p>",
    "        Local-first repository intelligence: discover code, build context for agents, rank change impact, and gate merges on",
    "        recomputable evidence — via CLI, MCP, or CI.",
    "      </p>",
    "    </header>",
    "",
    '    <div class="legend" aria-hidden="true">',
    ...LAYERS.map((layer) => `      <span><i class="dot" style="background: ${layer.color}"></i> ${escapeHtml(layer.legend)}</span>`),
    "    </div>",
    "",
    '    <div class="stage">',
    '      <svg class="mindmap" viewBox="0 0 1100 730" role="img" aria-label="otito layered diagram">',
    "        <!-- layer background bands -->",
    ...LAYERS.map((layer) => `        <rect x="90" y="${layer.y}" width="1005" height="${layer.height}" rx="8" fill="${layer.color}" opacity="0.04" />`),
    "",
    "        <!-- layer labels -->",
    ...LAYERS.map(
      (layer) =>
        `        <text x="45" y="${layer.y + Math.round(layer.height / 2) + 5}" text-anchor="middle" fill="${layer.color}" font-size="9" font-weight="700">${layer.label}</text>`,
    ),
    "",
    "        <!-- flow connectors (animated dashes show downward direction) -->",
    '        <g id="links">',
    ...LAYERS.slice(0, -1).map((layer, index) => {
      const next = LAYERS[index + 1];
      return `          <line class="link ${next.id}" data-group="${next.id}" x1="${CENTER_X}" y1="${layer.y + layer.height}" x2="${CENTER_X}" y2="${next.y}" />`;
    }),
    "        </g>",
    "",
    ...renderSurfaces("entry", mcpBlurb),
    ...renderToolLayer("discover", byName),
    ...renderToolLayer("map", byName),
    ...renderToolLayer("change", byName),
    ...renderToolLayer("review", byName),
    ...renderSurfaces("output", mcpBlurb),
    "      </svg>",
    "    </div>",
    "",
    '    <div class="panel">',
    '      <section class="card">',
    "        <h2>Animated workflow</h2>",
    '        <div class="steps" id="steps">',
    ...STEPS.flatMap((step, index) => {
      const layer = layerFor(step.layer);
      return [
        `          <div class="step${index === 0 ? " active" : ""}" data-step="${index}" data-node="${step.node}" data-group="${step.layer}">`,
        `            <div class="step-num" style="background: ${layer.color}">${index + 1}</div>`,
        `            <div><strong>${escapeHtml(step.title)}</strong><span>${escapeHtml(step.text)}</span></div>`,
        "          </div>",
      ];
    }),
    "        </div>",
    "      </section>",
    "",
    '      <section class="card detail" id="detail">',
    '        <h3 id="detail-title">MCP server</h3>',
    '        <p id="detail-body">',
    `          ${escapeHtml(mcpBlurb)}`,
    "        </p>",
    '        <div class="chips" id="detail-chips">',
    ...chipMap.mcp.map((chip) => `          <span class="chip">${escapeHtml(chip)}</span>`),
    "        </div>",
    "      </section>",
    "    </div>",
    "",
    "    <footer>",
    "      Open this file in any browser ·",
    '      <a href="https://bashbop.github.io/otito/">bashbop.github.io/otito</a>',
    "    </footer>",
    "",
    `    <script>${SCRIPT_HEAD}      const chipMap = ${JSON.stringify(chipMap, null, 8).replace(/\n/g, "\n      ")};\n${SCRIPT_TAIL}</script>`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
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
 * @param {string} layerId
 * @param {string} mcpBlurb
 */
function renderSurfaces(layerId, mcpBlurb) {
  const layer = layerFor(layerId);
  const y = layer.y + Math.round((layer.height - NODE_HEIGHT) / 2);
  const lines = [`        <!-- ${layer.label} -->`];
  for (const surface of SURFACES.filter((entry) => entry.layer === layerId)) {
    const blurb = surface.id === "mcp" ? mcpBlurb : surface.blurb;
    const cx = surface.x + NODE_WIDTH / 2;
    lines.push(
      `        <g class="node" data-id="${surface.id}" data-group="${layerId}" data-title="${escapeHtml(surface.title)}" data-desc="${escapeHtml(blurb)}">`,
      `          <rect x="${surface.x}" y="${y}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="10" fill="#161b22" stroke="${layer.color}" color="${layer.color}" />`,
      `          <text x="${cx}" y="${y + 24}" class="label">${escapeHtml(surface.label)}</text>`,
      `          <text x="${cx}" y="${y + 40}" class="sub">${escapeHtml(surface.sub)}</text>`,
      "        </g>",
    );
  }
  lines.push("");
  return lines;
}

/**
 * @param {string} layerId
 * @param {Map<string, { name: string, command: string }>} byName
 */
function renderToolLayer(layerId, byName) {
  const layer = layerFor(layerId);
  const cy = layer.y + Math.round(layer.height / 2);
  const lines = [`        <!-- ${layer.label} -->`];
  for (const node of LAYOUT.filter((entry) => entry.layer === layerId)) {
    const tool = byName.get(node.tool);
    if (!tool) throw new Error(`layout node ${node.id} references unknown tool ${node.tool}`);
    const desc = `${node.blurb} CLI: ${cliChip(tool.command) || "otito mcp"}.`;
    lines.push(
      `        <g class="node" data-id="${node.id}" data-group="${layerId}" data-title="${escapeHtml(tool.name)}" data-desc="${escapeHtml(desc)}">`,
      `          <circle cx="${node.cx}" cy="${cy}" r="${node.r}" fill="#161b22" stroke="${layer.color}" color="${layer.color}" />`,
      `          <text x="${node.cx}" y="${cy - 4}" class="label">${escapeHtml(node.label)}</text>`,
      `          <text x="${node.cx}" y="${cy + 12}" class="sub">${escapeHtml(node.sub)}</text>`,
      "        </g>",
    );
  }
  lines.push("");
  return lines;
}

await main();
