#!/usr/bin/env node
// Thin wrapper kept for the prototype invocation shipped in 1.12.0.
//
// The routing logic now lives in `src/lib/model-route.js` and is reachable as
// `otito route`, which computes the impact pass once instead of twice. Prefer:
//
//   otito route <repo> "<prompt>" [--json|--tier-only|--host <id>] [--offline]
//
// This file forwards to the same code so there is one implementation to reason
// about, and one place a defect can be fixed.

import { generateRoute, loadHosts } from "../src/lib/model-route.js";
import { formatRouteTerminal } from "../src/lib/render/route.js";
import { createRenderer } from "../src/lib/render/fancy.js";

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const valueOf = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const valueSlots = new Set(args.map((arg, index) => (arg === "--host" || arg === "--out" ? index + 1 : -1)).filter((index) => index !== -1));
const positional = args.filter((arg, index) => !arg.startsWith("--") && !valueSlots.has(index));
const [repo, prompt] = positional;

if (!repo || !prompt) {
  console.error('usage: node scripts/model-route.mjs <repo> "<prompt>" [--json|--tier-only|--host <id>] [--offline]');
  console.error("note: `otito route` is the supported entry point and runs the same code.");
  process.exit(2);
}

const data = await generateRoute(prompt, { path: repo, offline: flags.has("--offline") });

const host = valueOf("--host");
if (host) {
  const hosts = loadHosts(repo);
  if (!hosts[host]) {
    console.error(`no model map for host "${host}". Known: ${Object.keys(hosts).join(", ")}.`);
    process.exit(3);
  }
  data.hostModel = hosts[host][data.tier];
}

if (flags.has("--json")) {
  console.log(JSON.stringify(data, null, 2));
} else if (flags.has("--tier-only")) {
  console.log(data.tier);
} else if (data.hostModel) {
  console.log(data.hostModel);
} else {
  console.log(formatRouteTerminal(data, createRenderer({})));
}
