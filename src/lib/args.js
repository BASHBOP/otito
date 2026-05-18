export function parseArgv(argv) {
  const result = {
    command: undefined,
    positionals: [],
    flags: {}
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

function assignFlag(flags, key, value) {
  if (key === "exclude") {
    flags.exclude = Array.isArray(flags.exclude) ? [...flags.exclude, value] : [value];
    return;
  }
  flags[key] = value;
}

function normalizeFlagName(flag) {
  const aliases = {
    o: "out",
    e: "exclude",
    h: "help",
    q: "query",
    j: "json"
  };
  return aliases[flag] ?? flag.replaceAll("-", "_");
}

function expandShortFlag(short) {
  return normalizeFlagName(short);
}

function shortFlagTakesValue(short) {
  return ["e", "o", "q"].includes(short);
}
