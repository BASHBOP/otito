#!/usr/bin/env node
/**
 * Score a live otito context pack against expected primary paths / hotspot symbols.
 * Exit 0 when all expectations are met; exit 1 on gap.
 *
 * Usage:
 *   node score-gap.mjs --query "…" --path /repo --expect-primary "a.ts" --expect-hotspot "foo" [--json]
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const contextEngineUrl = pathToFileURL(path.join(repoRoot, "src/lib/context-engine.js")).href;

function parseArgs(argv) {
  /** @type {{ query?: string, path?: string, expectPrimary: string[], expectHotspot: string[], json: boolean, limit: number }} */
  const out = { expectPrimary: [], expectHotspot: [], json: false, limit: 10 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--query" && next) {
      out.query = next;
      i += 1;
    } else if (arg === "--path" && next) {
      out.path = next;
      i += 1;
    } else if (arg === "--expect-primary" && next) {
      out.expectPrimary.push(next);
      i += 1;
    } else if (arg === "--expect-hotspot" && next) {
      out.expectHotspot.push(next);
      i += 1;
    } else if (arg === "--limit" && next) {
      out.limit = Number(next) || 10;
      i += 1;
    } else if (arg === "--json") {
      out.json = true;
    }
  }
  return out;
}

function normalizePath(value) {
  return String(value || "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
}

const args = parseArgs(process.argv.slice(2));
if (!args.query || !args.path) {
  console.error("Required: --query <text> --path <repo> [--expect-primary p] [--expect-hotspot s] [--json]");
  process.exit(2);
}

const { generateContextPack } = await import(contextEngineUrl);
const pack = generateContextPack(args.query, { path: args.path, limit: args.limit });
const primaryPaths = (pack.data.primaryFiles || []).map((file) => normalizePath(file.path));
const relatedPaths = (pack.data.relatedFiles || []).map((file) => normalizePath(file.path));
const hotspotSymbols = (pack.data.hotspots || []).map((item) => item.symbol);
const missingPrimary = args.expectPrimary.filter((expected) => !primaryPaths.includes(normalizePath(expected)));
const missingHotspot = args.expectHotspot.filter((expected) => !hotspotSymbols.includes(expected));
const ok = missingPrimary.length === 0 && missingHotspot.length === 0;

const report = {
  ok,
  query: args.query,
  path: path.resolve(args.path),
  contextEngineVersion: pack.data.contextEngineVersion,
  primaryPaths,
  relatedPaths,
  hotspotSymbols,
  missingPrimary,
  missingHotspot,
  hotspots: pack.data.hotspots || [],
};

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(ok ? "PASS" : "GAP");
  console.log(`engine=${report.contextEngineVersion}`);
  console.log(`primary=${primaryPaths.join(", ") || "(none)"}`);
  console.log(`hotspots=${hotspotSymbols.join(", ") || "(none)"}`);
  if (missingPrimary.length) console.log(`missingPrimary=${missingPrimary.join(", ")}`);
  if (missingHotspot.length) console.log(`missingHotspot=${missingHotspot.join(", ")}`);
}

process.exit(ok ? 0 : 1);
