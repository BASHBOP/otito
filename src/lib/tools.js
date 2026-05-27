import { spawnSync } from "node:child_process";

export function commandExists(command) {
  const result = spawnSync("/bin/sh", ["-lc", `command -v ${quote(command)}`], {
    encoding: "utf8",
  });
  return {
    available: result.status === 0,
    path: result.stdout.trim() || undefined,
  };
}

export function commandVersion(command, args = ["--version"]) {
  const exists = commandExists(command);
  if (!exists.available) {
    return undefined;
  }

  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 5000,
  });
  const output = `${result.stdout}${result.stderr}`.trim();
  return output.split("\n")[0] || undefined;
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeout ?? 120000,
    maxBuffer: options.maxBuffer ?? 1024 * 1024 * 20,
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

export function runShellCommand(commandLine, options = {}) {
  const result = spawnSync("/bin/sh", ["-lc", commandLine], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeout ?? 120000,
    maxBuffer: options.maxBuffer ?? 1024 * 1024 * 20,
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

export function quote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
