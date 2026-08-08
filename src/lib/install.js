import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatTerminalSummary } from "./output.js";
import { commandExists, runCommand } from "./tools.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const productName = "Òtítọ́";
const binaryName = "otito";
const repoUrl = "https://github.com/BASHBOP/otito";

/**
 * @typedef {object} InstallOptions
 * @property {boolean} [global]
 * @property {boolean} [link]
 */

/**
 * @param {InstallOptions} [options]
 * @returns {ReturnType<typeof getInstallPlan> & { mode?: string, applied?: boolean, command?: string, stdout?: string, stderr?: string, error?: string }}
 */
export function installOtito(options = {}) {
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
  return {
    ok: true,
    productName,
    binaryName,
    packageRoot,
    repository: repoUrl,
    installed: status.available,
    binaryPath: status.path,
    commands: {
      fromNpm: "npm install -g @bashbop/otito",
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
 * @param {ReturnType<typeof installOtito>} result
 * @param {{ emoji?: boolean, color?: boolean, theme?: string }} [options]
 * @returns {string}
 */
export function formatInstallSummary(result, options = {}) {
  const applied = result.mode && result.mode !== "plan";
  return formatTerminalSummary({
    title: `${result.productName} · installer`,
    glyph: "🚀",
    subtitle: result.installed ? `installed at ${result.binaryPath}` : "not installed yet",
    facts: /** @type {[string, string | number][]} */ ([
      ["Binary", result.binaryName],
      ["Repository", result.repository],
      ["Current checkout", result.packageRoot],
      ...(applied
        ? [
            ["Applied", result.applied ? "yes" : "no"],
            ["Command", result.command ?? "unknown"],
          ]
        : []),
    ]),
    sections: [
      {
        title: "Install commands",
        glyph: "📦",
        items: [
          `From npm: ${result.commands.fromNpm}`,
          `From this checkout: ${result.commands.fromCheckout}`,
          `Development link: ${result.commands.developmentLink}`,
          `Verify: ${result.commands.verify}`,
        ],
      },
      ...(result.stderr ? [{ title: "stderr", glyph: "⚠️", items: [result.stderr] }] : []),
      { title: "Next steps", glyph: "📝", items: result.nextSteps },
    ],
    options,
  });
}
