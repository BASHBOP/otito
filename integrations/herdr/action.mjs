#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import {
  buildOtitoArgs,
  formatModelRoute,
  parseInvocationContext,
  requestFromContext,
  resolveBase,
  resolveRepoRoot,
  routeModelTier,
  runOtito,
} from "./runtime.mjs";

export function runAction(action, options = {}) {
  const context = options.context ?? parseInvocationContext();
  if (action === "doctor") {
    return runOtito(buildOtitoArgs(action, {}));
  }

  const repo = options.repo ?? resolveRepoRoot(context);
  const request = requestFromContext(action, context, options.request);
  const base = options.base ?? resolveBase(repo);
  process.stdout.write(`Otito · ${action}\nRepository: ${repo}\nRequest: ${request}\n\n`);

  if (action === "model-route") {
    const result = runOtito(buildOtitoArgs(action, { repo, request, base }), {
      cwd: repo,
      capture: true,
    });
    if (result.error) return result;
    if ((result.status ?? 1) !== 0) {
      process.stderr.write(result.stderr || result.stdout || "otito ax failed\n");
      return result;
    }

    let report;
    try {
      report = JSON.parse(String(result.stdout || "{}"));
    } catch {
      process.stderr.write("Otito AX JSON parse failed; showing raw output.\n");
      process.stdout.write(result.stdout || "");
      return result;
    }

    const ax = report.ax ?? report.score ?? report.data?.ax ?? report.data?.score ?? null;
    const containment =
      report.subScores?.containment ?? report.subscores?.containment ?? report.data?.subScores?.containment ?? report.data?.subscores?.containment ?? null;
    const drivers = report.drivers ?? report.data?.drivers ?? {};
    const riskBump = Boolean(drivers.riskFlags?.length || drivers.risks?.length || /auth|payment|migrat|security|pii/i.test(request));
    const tier = routeModelTier(ax, { containment, riskBump });
    const reasonParts = [];
    if (Number.isFinite(Number(containment))) {
      reasonParts.push(`containment ${Math.round(Number(containment))}`);
    }
    if (riskBump) reasonParts.push("risk bump");
    process.stdout.write(
      formatModelRoute(tier, {
        ax,
        reason: reasonParts.join(", ") || "AX map",
        request,
      }),
    );
    return { status: 0 };
  }

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
