/// <reference types="node" />

import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { evaluateLocal } from "./pass-local.js";

const workspaceGateEngineVersion = 1;

/**
 * Run the local staged gate across a product workspace and bind every child
 * gate result to one parent receipt. The child gates remain authoritative for
 * their own repositories; this layer only makes the product change readable
 * and tamper-evident as one unit.
 *
 * @param {string[]} repoPaths
 * @param {{ base?: string, policy?: unknown, governance?: unknown, request?: string, minConvergence?: number | string, runValidation?: boolean }} [options]
 */
export function evaluateWorkspaceGate(repoPaths, options = {}) {
  const roots = uniqueRoots(repoPaths);
  if (roots.length < 2) throw new Error("workspace-gate requires at least two repository paths.");

  /** @type {Array<{ identity: string, gate: Record<string, any> }>} */
  const repositories = roots.map((root) => {
    const gate = evaluateLocal(root, {
      base: options.base,
      policy: options.policy,
      governance: options.governance,
      request: options.request,
      minConvergence: options.minConvergence,
      staged: true,
      runValidation: options.runValidation,
    });
    return { identity: repositoryIdentity(root), gate };
  });
  const completeSubjects = repositories.every((entry) => entry.gate.subject?.kind === "git-index" && entry.gate.changedFiles?.length > 0);
  const verdict = aggregateVerdict(repositories.map((entry) => String(entry.gate.verdict)));
  /** @type {Record<string, any>} */
  const data = {
    ok: true,
    generatedAt: new Date().toISOString(),
    workspaceGateEngineVersion,
    scope: "workspace-staged",
    request: String(options.request ?? ""),
    policy: options.policy ?? "standard",
    governance: options.governance ?? "team",
    verdict,
    repositories,
  };
  if (completeSubjects) data.receipt = makeWorkspaceGateReceipt(data);
  else {
    data.verdict = "FAIL";
    data.receiptError = "A workspace receipt requires an exact staged Git-tree subject and at least one staged change from every repository.";
  }
  return data;
}

/**
 * Deterministic parent receipt. It binds the exact child Git subjects, every
 * child check, and any validation receipt emitted by the child gate. It does
 * not include local paths or timestamps, so the same product change can be
 * recomputed from another checkout with the same repository remotes.
 * @param {Record<string, any>} data
 */
export function makeWorkspaceGateReceipt(data) {
  /** @type {Array<{ identity: string, gate: Record<string, any> }>} */
  const childRepositories = data.repositories;
  const repositories = childRepositories
    .map((entry) => ({
      repository: entry.identity,
      subject: normalizeSubject(entry.gate.subject),
      verdict: entry.gate.verdict,
      changedFiles: [...(entry.gate.changedFiles ?? [])].sort(),
      checks: (entry.gate.checks ?? []).map(normalizeCheck),
      validationReceipt: entry.gate.validationEvidence?.receipt?.inputsHash ?? null,
    }))
    .sort((a, b) => a.repository.localeCompare(b.repository));
  const canonical = {
    receiptVersion: 1,
    engine: workspaceGateEngineVersion,
    request: String(data.request ?? ""),
    policy: String(data.policy ?? "standard"),
    governance: String(data.governance ?? "team"),
    repositories,
  };
  const inputsHash = sha256(JSON.stringify(canonical));
  return {
    id: `wrcpt_${inputsHash.slice(0, 12)}`,
    algorithm: "sha256",
    receiptVersion: 1,
    inputsHash,
    repositories: repositories.map((entry) => ({ repository: entry.repository, subject: entry.subject })),
  };
}

/** @param {Record<string, any>} data */
export function formatWorkspaceGateMarkdown(data) {
  /** @type {Array<{ identity: string, gate: Record<string, any> }>} */
  const repositories = data.repositories;
  const lines = [
    "# Otito Workspace Gate",
    "",
    `Verdict: **${data.verdict}**`,
    `Scope: ${data.scope}`,
    `Task: ${data.request || "not supplied"}`,
    ...(data.receipt
      ? [`Parent receipt: \`${data.receipt.id}\``, `Inputs hash: \`${data.receipt.inputsHash}\``]
      : [`Receipt: unavailable — ${data.receiptError ?? "unknown error"}`]),
    "",
    "| Repository | Verdict | Staged tree | Validation receipt |",
    "|---|---|---|---|",
  ];
  for (const entry of repositories) {
    const subject = entry.gate.subject;
    lines.push(
      `| ${entry.identity} | ${entry.gate.verdict} | ${subject?.treeSha ? `\`${subject.treeSha}\`` : "unavailable"} | ${entry.gate.validationEvidence?.receipt?.id ? `\`${entry.gate.validationEvidence.receipt.id}\`` : "not run"} |`,
    );
  }
  for (const entry of repositories) {
    lines.push(
      "",
      `## ${entry.identity}`,
      "",
      `Changed files: ${(entry.gate.changedFiles ?? []).map((/** @type {any} */ file) => `\`${file}\``).join(", ") || "none"}`,
      "",
    );
    lines.push("| Check | Status | Evidence |", "|---|---|---|");
    for (const check of entry.gate.checks ?? []) {
      const evidence = [check.summary, ...(check.details ?? [])].map((detail) => String(detail).replaceAll("|", "\\|")).join("<br>");
      lines.push(`| ${check.name} | ${check.status} | ${evidence} |`);
    }
  }
  return lines.join("\n");
}

/** @param {string[]} repoPaths */
function uniqueRoots(repoPaths) {
  return [...new Set(repoPaths.map(gitRoot))].sort();
}

/** @param {string} root */
function repositoryIdentity(root) {
  const result = spawnSync("git", ["config", "--get", "remote.origin.url"], { cwd: root, encoding: "utf8" });
  const remote = String(result.stdout ?? "").trim();
  return canonicalRepositoryIdentity(remote) || path.basename(root);
}

/** @param {string} repoPath */
function gitRoot(repoPath) {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: path.resolve(repoPath), encoding: "utf8" });
  const root = String(result.stdout ?? "").trim();
  if (result.status !== 0 || !root) throw new Error(`workspace-gate requires Git repository paths: ${repoPath}`);
  return path.resolve(root);
}

/** Remove remote userinfo and transport syntax before evidence is retained. @param {string} remote */
function canonicalRepositoryIdentity(remote) {
  if (!remote) return "";
  try {
    const url = new URL(remote);
    return `${url.host}${url.pathname}`.replace(/\/$/, "");
  } catch {
    const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(remote);
    if (scp) return `${scp[1]}/${scp[2]}`.replace(/\/$/, "");
    return remote.replace(/^[^@/]+@/, "");
  }
}

/** @param {Record<string, any>} subject */
function normalizeSubject(subject) {
  if (!subject || subject.kind !== "git-index") throw new Error("workspace receipt requires a staged Git-index subject");
  return {
    kind: "git-index",
    baseSha: String(subject.baseSha).toLowerCase(),
    parentSha: String(subject.parentSha).toLowerCase(),
    treeSha: String(subject.treeSha).toLowerCase(),
  };
}

/** @param {Record<string, any>} check */
function normalizeCheck(check) {
  return {
    name: String(check.name ?? ""),
    status: String(check.status ?? ""),
    summary: String(check.summary ?? ""),
    details: [...(check.details ?? [])].map(String).sort(),
  };
}

/** @param {string[]} verdicts */
function aggregateVerdict(verdicts) {
  if (verdicts.includes("FAIL")) return "FAIL";
  if (verdicts.includes("WARN")) return "WARN";
  return "PASS";
}

/** @param {string} value */
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
