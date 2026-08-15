#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(packageRoot, "src", "cli.js");
const iterations = readPositiveIntegerFlag("--iterations", 5);
const json = process.argv.includes("--json");
const configHome = fs.mkdtempSync(path.join(os.tmpdir(), "otito-benchmark-config-"));
const cases = [
  { name: "version", args: ["--version"] },
  { name: "help", args: ["help"] },
  {
    name: "context",
    args: ["context", "benchmark CLI startup and repository analysis", "--path", packageRoot, "--json"],
  },
];

try {
  const results = cases.map(runCase);
  const report = {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    iterations,
    results,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`Otito CLI benchmark (${iterations} measured run${iterations === 1 ? "" : "s"} per command)\n`);
    process.stdout.write(`Node ${process.version} · ${process.platform}-${process.arch}\n\n`);
    process.stdout.write("command       median     p95       min       max\n");
    for (const result of results) {
      process.stdout.write(
        `${result.name.padEnd(12)} ${formatMs(result.medianMs).padStart(8)} ${formatMs(result.p95Ms).padStart(8)} ${formatMs(result.minMs).padStart(8)} ${formatMs(result.maxMs).padStart(8)}\n`,
      );
    }
    process.stdout.write("\nTimings include Node startup and command execution; compare runs on the same machine and checkout.\n");
  }
} finally {
  fs.rmSync(configHome, { recursive: true, force: true });
}

function runCase(benchmarkCase) {
  runCli(benchmarkCase.args);
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    runCli(benchmarkCase.args);
    samples.push(performance.now() - startedAt);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  return {
    name: benchmarkCase.name,
    args: benchmarkCase.args,
    medianMs: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    minMs: round(sorted[0]),
    maxMs: round(sorted.at(-1)),
  };
}

function runCli(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "1",
      OTITO_TELEMETRY: "0",
      OTITO_TELEMETRY_SHARE: "0",
      XDG_CONFIG_HOME: configHome,
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`benchmark command failed (${args.join(" ")}): ${result.stderr || result.stdout}`);
  }
}

function readPositiveIntegerFlag(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} requires a positive integer`);
  }
  return value;
}

function percentile(sorted, value) {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1);
  return sorted[index];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function formatMs(value) {
  return `${value.toFixed(1)}ms`;
}
