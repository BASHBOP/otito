#!/usr/bin/env node
/**
 * Packed-tarball smoke test.
 *
 * The unit suite imports main() in-process and the CLI smoke runs
 * `node src/cli.js` directly — neither crosses the npm bin-shim seam, which is
 * how v1.4.0–1.4.2 shipped with a silently broken `repoctx` executable
 * (entrypoint guard never fired through the bin symlink). This script packs
 * the real tarball, installs it into a temp project, and runs the installed
 * bin the way npx / npm i -g users do.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "repoctx-tarball-smoke-"));

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", ...options });
}

try {
  const packOutput = run("npm", ["pack", "--silent", "--pack-destination", workDir], {
    cwd: packageRoot,
  });
  const tarball = path.join(workDir, packOutput.trim().split("\n").pop());

  const projectDir = path.join(workDir, "consumer");
  fs.mkdirSync(projectDir);
  fs.writeFileSync(path.join(projectDir, "package.json"), JSON.stringify({ name: "smoke", private: true }));
  run("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline", tarball], { cwd: projectDir });

  const bin = path.join(projectDir, "node_modules", ".bin", "repoctx");
  const helpOutput = run(bin, ["help"], { cwd: projectDir });
  if (!helpOutput.includes("repoctx")) {
    throw new Error(`installed bin produced unexpected help output: ${JSON.stringify(helpOutput.slice(0, 200))}`);
  }

  const repoOutput = run(bin, ["repo", packageRoot, "--json"], { cwd: projectDir });
  const parsed = JSON.parse(repoOutput);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("installed bin returned non-JSON repo output");
  }

  console.log(`tarball smoke OK: installed bin produced ${helpOutput.length} bytes of help and valid repo JSON`);
} finally {
  fs.rmSync(workDir, { recursive: true, force: true });
}
