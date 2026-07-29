#!/usr/bin/env node
// Post-install environment check. Runs `otito doctor` after a *global* install
// so a first-time user immediately sees whether their runtime and the optional
// accelerator tools (git, gh, rg, opensrc, code-structure) are present.
//
// Deliberately conservative — a postinstall hook must never be noisy or fatal:
//   - global installs only (npm sets npm_config_global=true for `-g`); this skips
//     transitive-dependency installs, local project installs, and the repo's own
//     `npm install` / `npm ci` during development and CI.
//   - skipped in CI and when OTITO_SKIP_POSTINSTALL is set.
//   - always exits 0; any error is swallowed so it can never break an install.
//   - honors `--ignore-scripts` implicitly (npm won't run this at all then).

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

async function run() {
  const isGlobal = process.env.npm_config_global === "true";
  const inCI = Boolean(process.env.CI);
  const optedOut = Boolean(process.env.OTITO_SKIP_POSTINSTALL);

  if (!isGlobal || inCI || optedOut) {
    return;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const { getDoctorReport, formatDoctorReport } = await import(join(here, "..", "src", "lib", "doctor.js"));
  const report = getDoctorReport();

  // Doctor output is informational; print to stderr so it never pollutes any
  // stdout a wrapping installer might capture.
  process.stderr.write("\notito installed. Environment check:\n\n");
  process.stderr.write(formatDoctorReport(report) + "\n");
  process.stderr.write("\nRun `otito doctor` anytime to re-check. Set OTITO_SKIP_POSTINSTALL=1 to silence this.\n");
}

run().catch(() => {
  // Never fail an install because of the environment check.
});
