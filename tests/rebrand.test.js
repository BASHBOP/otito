import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { applyRebrand, isKept, mapCase, planRebrand, rewritePath, rewriteText, validateConfig } from "../scripts/rebrand.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "rebrand.mjs");

// Neutral names so this file never holds the real old name and survives the rename itself.
const cfg = validateConfig({ from: "acme", to: "zenith", aliases: { Ácmé: "Zenith" }, keep: ["HISTORY.md", "frozen/"] });

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout;
}

/**
 * @param {Record<string, string | Buffer>} files
 */
function fixtureRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebrand-"));
  git(dir, ["init", "-q"]);
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  git(dir, ["add", "-A"]);
  git(dir, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "fixture"]);
  return dir;
}

/**
 * @param {string} dir
 */
function snapshot(dir) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const f of git(dir, ["ls-files"]).split("\n").filter(Boolean)) out[f] = fs.readFileSync(path.join(dir, f), "latin1");
  return out;
}

test("validateConfig rejects a target that contains the source", () => {
  assert.throws(() => validateConfig({ from: "acme", to: "acmeplus" }), /never converge/);
  assert.throws(() => validateConfig({ from: "two words", to: "x" }), /plain word/);
  assert.throws(() => validateConfig(null), /object/);
});

test("mapCase keeps lower, Capitalised and UPPER forms and refuses mixed case", () => {
  assert.equal(mapCase("acme", "zenith"), "zenith");
  assert.equal(mapCase("Acme", "zenith"), "Zenith");
  assert.equal(mapCase("ACME", "zenith"), "ZENITH");
  assert.equal(mapCase("aCmE", "zenith"), null);
});

test("rewriteText covers identifiers, env vars, dotfiles, scoped packages and aliases", () => {
  const input = [
    "const acmeTokens = buildAcme(AcmeArgs);",
    "process.env.ACME_TELEMETRY",
    "read .acmerc.json and .acme/runs",
    "npx @org/acme mcp; tools mcp__acme__context_pack",
    "Ácmé: the tool",
    "Ácmé".normalize("NFD") + " decomposed",
  ].join("\n");
  const { text, count, unhandled } = rewriteText(input, cfg);
  assert.equal(
    text,
    [
      "const zenithTokens = buildZenith(ZenithArgs);",
      "process.env.ZENITH_TELEMETRY",
      "read .zenithrc.json and .zenith/runs",
      "npx @org/zenith mcp; tools mcp__zenith__context_pack",
      "Zenith: the tool",
      "Zenith decomposed",
    ].join("\n"),
  );
  assert.equal(count, 10);
  assert.deepEqual(unhandled, []);
});

test("rewriteText leaves marked lines and reports mixed case", () => {
  const { text, count, unhandled } = rewriteText("formerly acme <!-- rebrand-keep -->\nweird aCmE here", cfg);
  assert.equal(text, "formerly acme <!-- rebrand-keep -->\nweird aCmE here");
  assert.equal(count, 0);
  assert.deepEqual(unhandled, [{ line: 2, text: "weird aCmE here" }]);
});

test("rewriteText keeps preserved strings, longest first, and renames the rest of the line", () => {
  const withPreserve = validateConfig({ from: "acme", to: "zenith", preserve: ["npm.test/acme/v/", "npm.test/acme"] });
  const { text, count } = rewriteText("[acme v1](https://npm.test/acme/v/1.0.0) · [latest](https://npm.test/acme) · acme", withPreserve);
  assert.equal(text, "[zenith v1](https://npm.test/acme/v/1.0.0) · [latest](https://npm.test/acme) · zenith");
  assert.equal(count, 2);
});

test("rewritePath renames every segment and isKept honours files and folders", () => {
  assert.equal(rewritePath("skills/acme-review/acme.yml", cfg), "skills/zenith-review/zenith.yml");
  assert.equal(isKept("HISTORY.md", cfg), true);
  assert.equal(isKept("frozen/run.json", cfg), true);
  assert.equal(isKept(".rebrandrc.json", cfg), true);
  assert.equal(isKept("src/acme.js", cfg), false);
});

test("plan writes nothing; apply rewrites and git-moves; a second apply is a no-op", () => {
  const dir = fixtureRepo({
    ".acmerc.json": '{ "name": "acme" }\n',
    "src/acme.js": "export const ACME = 'Acme';\n",
    "skills/acme-review/SKILL.md": "# acme review\n",
    "HISTORY.md": "acme 1.0\n",
    "frozen/run.json": '{"tool":"acme"}\n',
    "logo-acme.gif": Buffer.from([0x47, 0x49, 0x46, 0x00, 0x61, 0x63, 0x6d, 0x65]),
  });
  const before = snapshot(dir);
  const plan = planRebrand(dir, cfg);
  assert.deepEqual(snapshot(dir), before);
  assert.deepEqual(plan.edits.map((e) => e.file).sort(), [".acmerc.json", "skills/acme-review/SKILL.md", "src/acme.js"]);

  applyRebrand(dir, plan);
  const after = snapshot(dir);
  assert.deepEqual(Object.keys(after).sort(), [
    ".zenithrc.json",
    "HISTORY.md",
    "frozen/run.json",
    "logo-zenith.gif",
    "skills/zenith-review/SKILL.md",
    "src/zenith.js",
  ]);
  assert.equal(after["src/zenith.js"], "export const ZENITH = 'Zenith';\n");
  assert.equal(after["HISTORY.md"], "acme 1.0\n");
  assert.equal(after["frozen/run.json"], '{"tool":"acme"}\n');
  assert.equal(after["logo-zenith.gif"], before["logo-acme.gif"], "binary content is moved, never rewritten");
  assert.equal(fs.existsSync(path.join(dir, "skills", "acme-review")), false, "emptied folders are removed");

  const again = planRebrand(dir, cfg);
  assert.deepEqual([again.edits, again.renames, again.unhandled], [[], [], []]);
});

test("apply refuses to overwrite an existing target path and writes nothing first", () => {
  const dir = fixtureRepo({ "acme.md": "a\n", "zenith.md": "b\n", "notes.md": "acme notes\n" });
  const before = snapshot(dir);
  assert.throws(() => applyRebrand(dir, planRebrand(dir, cfg)), /already exists/);
  assert.deepEqual(snapshot(dir), before, "a collision leaves every file as it was");
});

test("apply refuses two renames that differ only in case", () => {
  const dir = fixtureRepo({ "acme.md": "a\n", "sub/readme.md": "b\n" });
  const plan = planRebrand(dir, cfg);
  plan.renames.push({ from: "sub/readme.md", to: "ZENITH.md" });
  assert.throws(() => applyRebrand(dir, plan), /cannot rename both acme\.md and sub\/readme\.md/);
});

test("a symlink is renamed but its target is never read or written", () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "rebrand-outside-"));
  fs.writeFileSync(path.join(outside, "target.md"), "acme outside the repo\n");
  const dir = fixtureRepo({ "README.md": "acme\n" });
  fs.symlinkSync(path.join(outside, "target.md"), path.join(dir, "acme-link.md"));
  git(dir, ["add", "acme-link.md"]);
  const plan = planRebrand(dir, cfg);
  assert.deepEqual(
    plan.edits.map((e) => e.file),
    ["README.md"],
  );
  applyRebrand(dir, plan);
  assert.equal(fs.readFileSync(path.join(outside, "target.md"), "utf8"), "acme outside the repo\n");
  assert.equal(fs.lstatSync(path.join(dir, "zenith-link.md")).isSymbolicLink(), true);
});

test("the CLI check fails while the old name remains and passes after apply", () => {
  const dir = fixtureRepo({
    ".rebrandrc.json": JSON.stringify({ from: "acme", to: "zenith" }),
    "README.md": "acme\n",
  });
  const run = (/** @type {string[]} */ args) => spawnSync(process.execPath, [SCRIPT, ...args, "--path", dir], { encoding: "utf8" });

  const check = run(["check"]);
  assert.equal(check.status, 1);
  assert.match(check.stdout, /still present/);

  const manifestPath = path.join(dir, "out", "manifest.json");
  assert.equal(run(["plan", "--manifest", manifestPath]).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(manifestPath, "utf8")).totals.replacements, 1);
  assert.equal(fs.readFileSync(path.join(dir, "README.md"), "utf8"), "acme\n");

  assert.equal(run(["apply"]).status, 0);
  const passed = run(["check"]);
  assert.equal(passed.status, 0, passed.stdout);
  assert.equal(run(["nope"]).status, 2);
});
