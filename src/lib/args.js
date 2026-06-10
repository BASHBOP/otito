/**
 * A single parsed flag value. Flags may be booleans (presence), strings
 * (with a value), or arrays (repeatable flags like --exclude / --pattern).
 * @typedef {boolean | string | Array<string | boolean>} FlagValue
 */

/**
 * The result of parsing argv. This shape recurs across cli.js command handlers.
 * @typedef {object} ParsedArgs
 * @property {string | undefined} command
 * @property {string[]} positionals
 * @property {Record<string, FlagValue>} flags
 */

/**
 * @param {string[]} argv
 * @returns {ParsedArgs}
 */
export function parseArgv(argv) {
  /** @type {ParsedArgs} */
  const result = {
    command: undefined,
    positionals: [],
    flags: {},
  };

  const args = [...argv];
  result.command = args.shift();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      result.positionals.push(...args.slice(index + 1));
      break;
    }

    if (!arg.startsWith("-")) {
      result.positionals.push(arg);
      continue;
    }

    if (arg.startsWith("--")) {
      const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
      const key = normalizeFlagName(rawKey);
      const next = args[index + 1];
      const value = inlineValue ?? (next && !next.startsWith("-") ? args[++index] : true);
      assignFlag(result.flags, key, value);
      continue;
    }

    const shortFlags = arg.slice(1);
    if (shortFlags.length === 1 && shortFlagTakesValue(shortFlags)) {
      const next = args[index + 1];
      assignFlag(result.flags, expandShortFlag(shortFlags), next && !next.startsWith("-") ? args[++index] : true);
      continue;
    }

    for (const short of shortFlags) {
      assignFlag(result.flags, expandShortFlag(short), true);
    }
  }

  return result;
}

/**
 * @param {Record<string, FlagValue>} flags
 * @param {string} key
 * @param {string | boolean} value
 */
function assignFlag(flags, key, value) {
  if (["exclude", "pattern"].includes(key)) {
    const existing = flags[key];
    flags[key] = Array.isArray(existing) ? [...existing, value] : [value];
    return;
  }
  flags[key] = value;
}

/**
 * @param {string} flag
 * @returns {string}
 */
function normalizeFlagName(flag) {
  /** @type {Record<string, string>} */
  const aliases = {
    o: "out",
    e: "exclude",
    h: "help",
    q: "query",
    j: "json",
    p: "pattern",
    n: "number",
    b: "base",
  };
  return aliases[flag] ?? flag.replaceAll("-", "_");
}

/**
 * @param {string} short
 * @returns {string}
 */
function expandShortFlag(short) {
  return normalizeFlagName(short);
}

/**
 * @param {string} short
 * @returns {boolean}
 */
function shortFlagTakesValue(short) {
  return ["e", "o", "q", "p", "n", "b"].includes(short);
}
