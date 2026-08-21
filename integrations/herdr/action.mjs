#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { buildOtitoArgs, parseInvocationContext, requestFromContext, resolveBase, resolveRepoRoot, runOtito } from "./runtime.mjs";

export function runAction(action, options = {}) {
  const context = options.context ?? parseInvocationContext();
  if (action === "doctor") {
    return runOtito(buildOtitoArgs(action, {}));
  }

  const repo = options.repo ?? resolveRepoRoot(context);
  const request = requestFromContext(action, context, options.request);
  const base = options.base ?? resolveBase(repo);
  process.stdout.write(`Otito · ${action}\nRepository: ${repo}\nRequest: ${request}\n\n`);
  return runOtito(buildOtitoArgs(action, { repo, request, base }), { cwd: repo });
}

export function main(argv = process.argv.slice(2)) {
  const action = argv[0];
  if (!action) throw new Error("Expected an Otito Herdr action name.");
  const result = runAction(action);
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Otito Herdr plugin: ${error.message ?? String(error)}\n`);
    process.exitCode = 1;
  }
}
