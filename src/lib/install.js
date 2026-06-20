import path from "node:path";
import { fileURLToPath } from "node:url";
import { designPrint } from "./brand.js";
import { commandExists, runCommand } from "./tools.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const productName = "repoctx";
const binaryName = "repoctx";
const legacyBinaryName = "dev-context";
const repoUrl = "https://github.com/nugehs/repoctx";

/**
 * @typedef {object} InstallOptions
 * @property {boolean} [global]
 * @property {boolean} [link]
 */

/**
 * @param {InstallOptions} [options]
 * @returns {ReturnType<typeof getInstallPlan> & { mode?: string, applied?: boolean, command?: string, stdout?: string, stderr?: string, error?: string }}
 */
export function installDevContext(options = {}) {
  // getInstallPlan() ignores its arguments; this passed `options` is dead and
  // has no effect at runtime. Suppressing the arity error rather than changing
  // the call (annotation-only pass). See suspected-bug report.
  // @ts-expect-error -- getInstallPlan takes no parameters; the argument is ignored.
  const plan = getInstallPlan(options);
  const mode = options.global ? "global" : options.link ? "link" : "plan";

  if (mode === "plan") {
    return plan;
  }

  const command =
    mode === "global" ? { command: "npm", args: ["install", "-g", "."], display: "npm install -g ." } : { command: "npm", args: ["link"], display: "npm link" };
  const result = runCommand(command.command, command.args, {
    cwd: packageRoot,
    timeout: 120000,
  });

  return {
    ...plan,
    mode,
    applied: result.ok,
    command: command.display,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    error: result.error?.message,
  };
}

export function getInstallPlan() {
  const status = commandExists(binaryName);
  const legacyStatus = commandExists(legacyBinaryName);
  return {
    ok: true,
    productName,
    binaryName,
    legacyBinaryName,
    packageRoot,
    repository: repoUrl,
    installed: status.available,
    binaryPath: status.path,
    legacyInstalled: legacyStatus.available,
    legacyBinaryPath: legacyStatus.path,
    commands: {
      fromGitHub: "npm install -g github:nugehs/repoctx",
      fromCheckout: "npm install -g .",
      developmentLink: "npm link",
      verify: `${binaryName} doctor`,
    },
    nextSteps: [
      `Run \`${binaryName} doctor\` to verify the install.`,
      `Run \`${binaryName} index ~/projects --discover\` to build a local catalog.`,
      `Run \`${binaryName} search "auth"\` to search indexed repositories.`,
    ],
  };
}

/**
 * @param {ReturnType<typeof installDevContext>} result
 * @returns {string}
 */
export function formatInstallSummary(result) {
  const lines = [
    designPrint,
    "",
    `${result.productName} installer`,
    "",
    `Binary: ${result.binaryName}`,
    `Legacy alias: ${result.legacyBinaryName} (deprecated, removed in v3.0.0)`,
    `Repository: ${result.repository}`,
    `Current checkout: ${result.packageRoot}`,
    `Installed: ${result.installed ? `yes (${result.binaryPath})` : "no"}`,
    `Legacy installed: ${result.legacyInstalled ? `yes (${result.legacyBinaryPath})` : "no"}`,
    "",
    "Install commands:",
    `- From GitHub: ${result.commands.fromGitHub}`,
    `- From this checkout: ${result.commands.fromCheckout}`,
    `- Development link: ${result.commands.developmentLink}`,
    "",
    `Verify: ${result.commands.verify}`,
  ];

  if (result.mode && result.mode !== "plan") {
    lines.push("", `Applied: ${result.applied ? "yes" : "no"}`, `Command: ${result.command}`);
    if (result.stderr) {
      lines.push(`stderr: ${result.stderr}`);
    }
  }

  lines.push("", "Next steps:");
  for (const step of result.nextSteps) {
    lines.push(`- ${step}`);
  }

  return lines.join("\n");
}
