#!/usr/bin/env node
// Generate docs/assets/otito-how-it-works.html from the canonical tool catalog.
//
// The page is linked from the docs home page as *the* visual explanation of
// how otito works. It was once hand-maintained and drifted for eighteen
// releases, still advertising a `repo_catalog` tool that no longer existed and
// omitting `agent_experience` and `convergence_score` entirely.
//
// Tool names and CLI invocations come from `getAgentTools()`, the same catalog
// the MCP server and `otito agent-tools` are derived from. The tables below own
// only what a catalog cannot know: which phase of the loop a tool belongs to,
// a one-line sub-label, and a blurb short enough for the detail panel.
//
// The generator fails when LAYOUT and the catalog disagree in either direction,
// so adding or removing an MCP tool forces the page to be updated in the same
// change. `--check` re-renders and diffs against the committed file; it runs in
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
import { FONTS_HREF, SCRIPT, STYLE } from "./how-it-works/presentation.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(repoRoot, "docs", "assets", "otito-how-it-works.html");

/**
 * The loop, top to bottom. `actor` says who does the work in that phase; the
 * point of the page is that otito is absent from exactly one of them.
 */
const PHASES = [
  {
    id: "know",
    index: "01",
    title: "Know the repository",
    actor: "otito · reads the checkout",
    color: "var(--cyan)",
    sub: "Shape, symbols, commands and ownership, from the code rather than from a rules file. Cached per user; the repository itself is never written to.",
  },
  {
    id: "before",
    index: "02",
    title: "Before the edit",
    actor: "otito · deterministic, with one optional advisory read",
    color: "var(--teal)",
    sub: "What the request actually touches, what it will cost an agent, and how much model it deserves. All of it is computed before a token is spent on the change.",
  },
  {
    id: "edit",
    index: "03",
    title: "The edit",
    actor: "the model · through its own harness",
    color: "var(--violet)",
    sub: "Otito does not generate code. The agent writes the change in Claude Code, Codex, Cursor, Gemini or any MCP host, calling the tools above through MCP or the CLI.",
  },
  {
    id: "merge",
    index: "04",
    title: "Before the merge",
    actor: "otito · from the diff and the repository, never from the model",
    color: "var(--green)",
    sub: "Did the intent happen, did only the intent happen, and is the exact staged tree safe to merge? The verdict recomputes to the same value on any checkout.",
  },
  {
    id: "after",
    index: "05",
    title: "After the merge",
    actor: "CI · otito attest",
    color: "var(--amber)",
    sub: "Every merge to main leaves a hash-chained record of what shipped and under which verdict, in your own repository, verifiable by anyone.",
  },
  {
    id: "time",
    index: "06",
    title: "Over time",
    actor: "otito · graded against the repository's own history",
    color: "var(--slate)",
    sub: "The risk flags and the router are measured against what this repository actually needed to fix, and decline to answer when the sample is too small.",
  },
];

/**
 * Placement and blurb for every MCP tool. `tool` keys into the catalog: the
 * card's title and its CLI chip are read from there, never written here.
 */
const LAYOUT = [
  {
    id: "inspect",
    tool: "repo_inspect",
    phase: "know",
    sub: "repo facts",
    blurb: "Repository facts: languages, scripts, package managers, entrypoints and git state.",
  },
  {
    id: "map",
    tool: "repo_map",
    phase: "know",
    sub: "AST code map",
    blurb: "AST-backed JSON code map: imports, exports, routes, domains and data access across TS/JS, Go, C#, Python, Java, Ruby and Rust.",
  },
  {
    id: "index",
    tool: "repo_index",
    phase: "know",
    sub: "per-user catalog",
    blurb:
      "Index local repositories into a per-user catalog; dryRun discovers read-only. Markdown is indexed too, so skills and docs pages rank alongside code. The inspected repository is never modified.",
  },
  {
    id: "search",
    tool: "repo_search",
    phase: "know",
    sub: "symbols & routes",
    blurb: "Search indexed repositories by path, domain, kind, route, imports, exports and symbols. Omit the query to list the catalog.",
  },
  {
    id: "harness",
    tool: "repo_harness",
    phase: "know",
    sub: "commands",
    blurb: "Setup, validation and runtime commands inferred from the repository: the first artifact an agent or CI job should read.",
  },
  {
    id: "workspace",
    tool: "workspace_report",
    phase: "know",
    sub: "multi-repo",
    blurb: "One report across related repositories for cross-service work. workspace-gate gates them together.",
  },

  {
    id: "context",
    tool: "context_pack",
    phase: "before",
    sub: "task pack",
    blurb:
      "Task-aware packet: primary and related files, hotspots, tests, validation commands and token estimates, with git state read live. --online lets a model read demote files it judges irrelevant; it is off unless asked. Run before planning or editing.",
  },
  {
    id: "impact",
    tool: "change_impact",
    phase: "before",
    sub: "blast radius",
    blurb:
      "Ranks the files most likely to own a plain-English change request, with risk flags and suggested tests. A diff base adds exact changed-file evidence beside the heuristic.",
  },
  {
    id: "ax",
    tool: "agent_experience",
    phase: "before",
    sub: "AX 0–100",
    blurb:
      "Agent Experience: how cheap and safe it is for an agent to make this change here. Changeability, Containment, Guardrails and Clarity, with concrete recommendations for raising the score.",
  },
  {
    id: "route",
    tool: "model_route",
    phase: "before",
    sub: "model tier",
    blurb:
      "Recommends a model tier (cheap, mid or premium) before work starts. otito answers the repository half deterministically; TypeSafe's Jev reads the request when TYPESAFE_API_KEY is set, otherwise the read is a labelled offline estimate. Advisory: it never feeds the gate.",
  },

  {
    id: "converge",
    tool: "convergence_score",
    phase: "merge",
    sub: "intent vs diff",
    blurb:
      "0–100 distance between the stated task and the actual diff: Coverage, Scope and Risk alignment. --head scores exactly base..head; --staged binds to the index tree. Emits a timestamp-free receipt anyone can recompute, which a model cannot award itself.",
  },
  {
    id: "gate",
    tool: "review_gate",
    phase: "merge",
    sub: "PASS · WARN · FAIL",
    blurb:
      "The merge gate, from repository state alone: changed files, secret safety, risk paths, release discipline, validation, dependency audit, policy profile and a convergence floor. With pr, adds review decision, CODEOWNERS, branch protection and checks through your own gh login.",
  },
  {
    id: "reviewctx",
    tool: "review_context",
    phase: "merge",
    sub: "reviewer pack",
    blurb: "Diff-aware review context for a human: changed domains, risk flags and review targets, optionally with GitHub comments. No verdict.",
  },
  {
    id: "verdict",
    tool: "review_verdict",
    phase: "merge",
    sub: "composite",
    blurb:
      "change_impact plus review_context plus review_gate in one call, with a derived confidence score and a schemaVersion the attestation ledger records.",
  },
];

/**
 * Entry surfaces, the edit itself, CLI-only stages and outputs are not catalog
 * tools, so they are declared whole. A `cli` surface names the CLI command it
 * stands for; the test checks that command still exists.
 */
const SURFACES = [
  {
    id: "cli",
    section: "entry",
    kind: "surface",
    title: "CLI",
    sub: "otito <command> --json",
    blurb: "Human and script entrypoint. Every command takes --json, prints the same evidence a tool returns, and runs without a server or an account.",
    chips: ["npm install -g @bashbop/otito", "otito doctor", "otito context", "otito gate"],
  },
  {
    id: "mcp",
    section: "entry",
    kind: "surface",
    title: "MCP server",
    sub: "otito mcp · stdio",
    blurb: "",
    chips: ["otito mcp", "context_pack", "review_gate", "io.github.BASHBOP/otito"],
  },
  {
    id: "ci",
    section: "entry",
    kind: "surface",
    title: "CI, hooks and skills",
    sub: "otito init",
    blurb:
      "otito init writes otito-ci.yml, a pre-commit hook and .otito/ assets into a target repository. A UserPromptSubmit hook routes every request before work starts, and the model-router skill teaches an agent to call otito first.",
    chips: ["otito init .", "otito-ci.yml", "attest.yml", "model-router skill"],
  },

  {
    id: "edit",
    section: "edit",
    kind: "surface",
    title: "The edit",
    sub: "the model writes the change",
    blurb:
      "The agent generates the change in its own harness. Otito never writes code and is handed only the request text and the checkout. What it produced before the edit is context; what it produces after is evidence about the diff that appeared.",
    chips: ["Claude Code", "Codex", "Cursor", "Gemini", "VS Code", "any MCP host"],
    hosts: ["Claude Code", "Codex", "Cursor", "Gemini", "VS Code", "any MCP host"],
  },

  {
    id: "attest",
    section: "after",
    kind: "cli",
    command: "attest",
    title: "otito attest",
    sub: "hash-chained record",
    blurb:
      "After a merge to main, CI appends a record of the merge commit, its verdict and their hashes to a ledger branch in your own repository. Never the diff or the source. A reusable workflow does it with one uses: line.",
    chips: ["otito attest --verdict … --merge <sha>", ".github/workflows/attest.yml", "audit-pilot/ledger.jsonl"],
  },
  {
    id: "verify",
    section: "after",
    kind: "cli",
    command: "attest",
    title: "otito attest --verify",
    sub: "recompute the chain",
    blurb:
      "Walks the ledger, recomputes every hash and exits 1 if any record was altered or any merge is missing. Open JSON Lines with a schemaVersion on every record; the export is the file itself.",
    chips: ["otito attest --verify", "schemaVersion: 1"],
  },

  {
    id: "calibrate",
    section: "time",
    kind: "cli",
    command: "calibrate",
    title: "otito calibrate",
    sub: "risk flags vs history",
    blurb:
      "Grades the gate's risk flags against this repository's own history, joining fix commits to the commits they repaired by line overlap rather than by filename. Below the minimum sample it declines to answer, which is the honest result.",
    chips: ["otito calibrate <repo>", "--window 30", "--min-sample"],
  },
  {
    id: "regret",
    section: "time",
    kind: "cli",
    command: "regret",
    title: "otito regret",
    sub: "router tiers vs history",
    blurb:
      "Grades the router's tiers the same way, three variants side by side: the deterministic half alone, the offline heuristic, and the model read. --rescore regrades a saved run on frozen answers with no checkout and no model call. Never a saving: otito does not know which model a host used.",
    chips: ["otito regret <repo>", "otito regret --rescore run.json"],
  },

  {
    id: "artifacts",
    section: "output",
    kind: "surface",
    title: ".otito/ artifacts",
    sub: "Markdown and JSON",
    blurb:
      "Durable evidence a reviewer can read: context-pack.md, pr-review.md, harness.md, workspace.md. Gitignored by init; kept under .otito/runs/ when you want it to survive.",
    chips: [".otito/pr-review.md", ".otito/harness.md", ".otito/runs/"],
  },
  {
    id: "receipt",
    section: "output",
    kind: "surface",
    title: "Convergence receipt",
    sub: "bound to the tree",
    blurb:
      "A timestamp-free hash binding the score to the exact base, parent and staged tree or commit it measured. Anyone with the checkout recomputes it; a receipt whose subject does not match what the gate measured fails with the mode to rerun in.",
    chips: ["rcpt_…", "otito converge --staged", "otito gate --receipt <hash>"],
  },
  {
    id: "verdictout",
    section: "output",
    kind: "surface",
    title: "PASS / WARN / FAIL",
    sub: "the merge verdict",
    blurb:
      "Merge-readiness for humans, agents and CI. WARN surfaces risk that needs an explicit reviewer; FAIL blocks the merge. A passing local gate is evidence, never an approval.",
    chips: ["PASS", "WARN", "FAIL"],
  },
  {
    id: "ledger",
    section: "output",
    kind: "surface",
    title: "Ledger record",
    sub: "one per merge",
    blurb:
      "One JSON line per merged commit: commit identity, verdict, and the hash of the record before it. Optional hosted copy per organisation for teams with SOC 2, ISO 27001 or regulated audits.",
    chips: ["audit-pilot/ledger.jsonl", "audit-ledger branch"],
  },
];

/** The animated walkthrough. Each step focuses one card. */
const STEPS = [
  { node: "mcp", title: "Connect", text: "Install the CLI or wire the MCP server into any host; init scaffolds CI and hooks." },
  { node: "map", title: "Know the repository", text: "Inspect, map, index and search the checkout; infer its commands." },
  { node: "context", title: "Before the edit", text: "Build the task pack, rank what the request touches, score AX, pick a tier." },
  { node: "edit", title: "The edit", text: "The model writes the change in its own harness. Otito waits." },
  { node: "gate", title: "Before the merge", text: "Score intent against the diff, then gate the exact staged tree." },
  { node: "attest", title: "After the merge", text: "CI appends a hash-chained record; anyone can verify the chain." },
  { node: "calibrate", title: "Over time", text: "Grade the flags and the router against what the repository actually had to fix." },
];

/** The four things the page exists to say. */
const GUARANTEES = [
  {
    color: "var(--green)",
    title: "The gate never consults a model",
    text: "PASS, WARN and FAIL are computed from repository state. The one model read otito can make, for a tier or a context pack, is advisory and has no path into the verdict.",
  },
  {
    color: "var(--teal)",
    title: "Nothing leaves the machine by default",
    text: "The core commands and every MCP tool open no socket. --pr reads GitHub through your own gh login; route sends the request text to Jev only on your own key.",
  },
  {
    color: "var(--cyan)",
    title: "Same inputs, same output",
    text: "Run anything twice and get the same answer. Receipts and ledger records are timestamp-free hashes anyone can regenerate from the same checkout.",
  },
  {
    color: "var(--amber)",
    title: "Evidence, not approval",
    text: "A passing local gate is never an automatic merge. Hosted CI, GitHub review, CODEOWNERS and the human release decision remain separate authorities.",
  },
];

async function main() {
  const check = process.argv.includes("--check");
  const catalog = getAgentTools().tools;
  assertLayoutMatchesCatalog(catalog);
  assertStepsResolve();

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
 * catalog without appearing on the page, and the page can never keep
 * advertising a tool that was removed.
 * @param {{ name: string }[]} catalog
 */
function assertLayoutMatchesCatalog(catalog) {
  const catalogNames = new Set(catalog.map((tool) => tool.name));
  const layoutNames = new Set(LAYOUT.map((node) => node.tool));

  const missing = [...catalogNames].filter((name) => !layoutNames.has(name)).sort();
  const stale = [...layoutNames].filter((name) => !catalogNames.has(name)).sort();

  const problems = [];
  if (missing.length) problems.push(`missing from the page LAYOUT: ${missing.join(", ")}`);
  if (stale.length) problems.push(`in the page LAYOUT but not in the tool catalog: ${stale.join(", ")}`);
  for (const node of LAYOUT) {
    if (!PHASES.some((phase) => phase.id === node.phase)) problems.push(`layout node ${node.id} names unknown phase ${node.phase}`);
  }
  if (problems.length) {
    throw new Error(`scripts/generate-how-it-works.mjs is out of sync with the MCP tool catalog — ${problems.join("; ")}`);
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
 * @param {{ name: string, command: string }[]} catalog
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
    `        <span>Generated from the shipped tool catalog · ${mcpTools.length} tools</span>`,
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
    surface.kind === "cli" && "command" in surface ? `data-command="${surface.command}"` : "",
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
 * @param {Map<string, { name: string, command: string }>} byName
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
    const desc = `${node.blurb} CLI: ${cli || "otito mcp"}.`;
    const chips = [node.tool, cli].filter(Boolean);
    lines.push(
      `        <button class="card tool" type="button" data-id="${node.id}" data-phase="${phase.id}" data-kind="tool" data-title="${escapeHtml(tool.name)}" data-desc="${escapeHtml(desc)}" data-chips="${escapeHtml(chips.join("|"))}">`,
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
