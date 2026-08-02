import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { evaluateWorkspaceGate, formatWorkspaceGateMarkdown, makeWorkspaceGateReceipt } from "../src/lib/workspace-gate.js";

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" },
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function makeRepo(parent, name, value) {
  const root = path.join(parent, name);
  fs.mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "remote", "add", "origin", `git@example.test:product/${name}.git`);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name, version: "1.0.0", scripts: { test: "node --test" } }));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ name, version: "1.0.0", lockfileVersion: 3 }));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "value.js"), `export const value = '${value}';\n`);
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "init");
  fs.writeFileSync(path.join(root, "src", "value.js"), `export const value = '${value}-staged';\n`);
  git(root, "add", "src/value.js");
  return root;
}

test("workspace gate binds exact staged subjects from each repository into one deterministic parent receipt", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "otito-workspace-gate-"));
  const web = makeRepo(parent, "web", "web");
  const api = makeRepo(parent, "api", "api");

  const first = evaluateWorkspaceGate([web, api], { base: "HEAD", request: "ship organisation email preview" });
  const second = evaluateWorkspaceGate([api, web], { base: "HEAD", request: "ship organisation email preview" });

  assert.equal(first.scope, "workspace-staged");
  assert.equal(first.verdict, "PASS");
  assert.equal(first.receipt.receiptVersion, 1);
  assert.equal(first.receipt.inputsHash, second.receipt.inputsHash, "repository input ordering must not change the parent receipt");
  assert.equal(first.repositories.length, 2);
  assert.equal(first.receipt.repositories[0].subject.kind, "git-index");
  assert.equal(first.receipt.repositories[1].subject.kind, "git-index");
  assert.equal(makeWorkspaceGateReceipt(first).inputsHash, first.receipt.inputsHash);
  assert.match(formatWorkspaceGateMarkdown(first), /Otito Workspace Gate/);
  assert.match(formatWorkspaceGateMarkdown(first), /example.test\/product\/web.git/);
  assert.match(formatWorkspaceGateMarkdown(first), /Changed-file scope and convergence evidence/);
});

test("workspace gate canonicalizes remotes without credentials and deduplicates Git roots", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "otito-workspace-gate-identity-"));
  const web = makeRepo(parent, "web", "web");
  const api = makeRepo(parent, "api", "api");
  git(web, "remote", "set-url", "origin", "https://ci-user:top-secret@example.test/product/web.git");

  const result = evaluateWorkspaceGate([web, api], { base: "HEAD" });
  const rendered = formatWorkspaceGateMarkdown(result);

  assert.ok(result.receipt.repositories.some((entry) => entry.repository === "example.test/product/web.git"));
  assert.ok(!JSON.stringify(result).includes("top-secret"));
  assert.ok(!rendered.includes("ci-user"));
  assert.throws(() => evaluateWorkspaceGate([web, path.join(web, "src")], { base: "HEAD" }), /at least two repository paths/);
});

test("workspace gate refuses a parent receipt when any repository has no staged subject", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "otito-workspace-gate-missing-"));
  const web = makeRepo(parent, "web", "web");
  const api = makeRepo(parent, "api", "api");
  git(api, "reset", "--hard", "HEAD");

  const result = evaluateWorkspaceGate([web, api], { base: "HEAD" });

  assert.equal(result.verdict, "FAIL");
  assert.equal(result.receipt, undefined);
  assert.match(result.receiptError, /exact staged Git-tree subject/);
});
