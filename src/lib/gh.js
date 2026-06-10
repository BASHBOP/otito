// Thin wrapper around the `gh` CLI used by pass-pr. Tests can pass a fake
// runner to `evaluatePR` instead of invoking the real `gh`, mirroring
// pullpass's Runner interface.

import { runCommand } from "./tools.js";

export function defaultGhRunner() {
  return {
    /**
     * @param {string | undefined} cwd
     * @param {string[]} args
     * @returns {string}
     */
    run(cwd, args) {
      const result = runCommand("gh", args, { cwd });
      if (!result.ok) {
        const text = (result.stderr || result.stdout || "").trim() || (result.error?.message ?? "command failed");
        const error = /** @type {Error & { stderr?: string, stdout?: string }} */ (new Error(`gh ${args.join(" ")}: ${text}`));
        error.stderr = result.stderr;
        error.stdout = result.stdout;
        throw error;
      }
      return result.stdout;
    },
  };
}

// Test helper: build a runner that returns canned responses keyed by the
// first few args. Each key is a space-separated argument prefix; the value
// is either a string (the stdout to return) or an Error (to throw).
/**
 * @param {Record<string, string | Error>} responses
 */
export function createFakeRunner(responses) {
  return {
    /**
     * @param {string | undefined} _cwd
     * @param {string[]} args
     * @returns {string}
     */
    run(_cwd, args) {
      for (let i = args.length; i > 0; i -= 1) {
        const key = args.slice(0, i).join(" ");
        if (key in responses) {
          const value = responses[key];
          if (value instanceof Error) throw value;
          return value;
        }
      }
      throw new Error(`fake gh runner: no canned response for "${args.join(" ")}"`);
    },
  };
}
