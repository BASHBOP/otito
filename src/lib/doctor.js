import { commandExists, commandVersion } from "./tools.js";

const toolDefinitions = [
  {
    name: "node",
    command: "node",
    versionArgs: ["--version"],
    installHint: "Install Node.js 18+."
  },
  {
    name: "git",
    command: "git",
    versionArgs: ["--version"],
    installHint: "Install git."
  },
  {
    name: "rg",
    command: "rg",
    versionArgs: ["--version"],
    installHint: "Install ripgrep for faster source searching."
  },
  {
    name: "npx",
    command: "npx",
    versionArgs: ["--version"],
    installHint: "Install npm/npx, or install optional tools globally."
  },
  {
    name: "opensrc",
    command: "opensrc",
    versionArgs: ["--version"],
    installHint: "Install with: npm install -g opensrc"
  },
  {
    name: "code-structure",
    command: "code-structure",
    versionArgs: ["--version"],
    installHint: "Install with: npm install -g code-structure for faster runs; structure can fall back to npx."
  }
];

export function getDoctorReport() {
  return {
    ok: true,
    tools: toolDefinitions.map((tool) => {
      const exists = commandExists(tool.command);
      return {
        name: tool.name,
        command: tool.command,
        available: exists.available,
        path: exists.path,
        version: exists.available ? commandVersion(tool.command, tool.versionArgs) : undefined,
        installHint: tool.installHint
      };
    })
  };
}
