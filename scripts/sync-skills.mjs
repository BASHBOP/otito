// Sync the canonical skills in codex/skills/ out to the host directories that
// already carry them.
//
// The skills live in four places: here, and under ~/.claude, ~/.cursor and
// ~/.codex. They drifted. `model-router` lost 589 words in this repo while the
// installed copies kept them, so the file claiming to be canonical was the
// stalest of the four, and nothing noticed for weeks.
//
// What this can and cannot enforce is worth being exact about. A repository's
// CI cannot police files in a developer's home directory — on a CI runner
// those directories do not exist, and `--check` exits 0 there by design rather
// than pretending to have verified something. This is a LOCAL check. It makes
// drift a one-command question instead of an archaeology exercise.
//
// Only skills a host already has are written. Syncing does not install new
// skills onto a host that never had them; that is a choice, not a sync.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "codex", "skills");
const HOSTS = [".claude", ".cursor", ".codex"];

const check = process.argv.includes("--check");

/** @returns {string[]} */
function skillNames() {
  try {
    return fs
      .readdirSync(source, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/** Every file inside a skill directory, relative to it. */
function filesIn(dir) {
  /** @type {string[]} */
  const found = [];
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      const rel = prefix ? path.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) walk(next, rel);
      else found.push(rel);
    }
  };
  walk(dir, "");
  return found.sort();
}

const drift = [];
const written = [];
let targetsSeen = 0;

for (const skill of skillNames()) {
  const from = path.join(source, skill);
  for (const host of HOSTS) {
    const to = path.join(os.homedir(), host, "skills", skill);
    // Only a host that already carries this skill is a sync target.
    if (!fs.existsSync(to)) continue;
    targetsSeen += 1;

    for (const file of filesIn(from)) {
      const sourceFile = path.join(from, file);
      const targetFile = path.join(to, file);
      const wanted = fs.readFileSync(sourceFile);
      let current = null;
      try {
        current = fs.readFileSync(targetFile);
      } catch {
        // absent counts as drift
      }
      if (current && current.equals(wanted)) continue;

      if (check) {
        drift.push(`${host}/skills/${skill}/${file}`);
        continue;
      }
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      fs.writeFileSync(targetFile, wanted);
      written.push(`${host}/skills/${skill}/${file}`);
    }
  }
}

if (!targetsSeen) {
  // A CI runner, or a machine that has never installed these skills. There is
  // nothing to compare against, and saying so beats a green tick that checked
  // nothing.
  process.stdout.write("sync-skills: no host skill directories on this machine; nothing to check\n");
  process.exit(0);
}

if (check) {
  if (!drift.length) {
    process.stdout.write(`sync-skills: ${targetsSeen} installed skill(s) match codex/skills\n`);
    process.exit(0);
  }
  process.stderr.write(`sync-skills: ${drift.length} file(s) drifted from codex/skills:\n`);
  for (const file of drift) process.stderr.write(`  ${file}\n`);
  process.stderr.write("Run `npm run skills:sync` to overwrite the installed copies from this repo.\n");
  process.exit(1);
}

process.stdout.write(
  written.length ? `sync-skills: wrote ${written.length} file(s)\n${written.map((f) => `  ${f}`).join("\n")}\n` : "sync-skills: already in sync\n",
);
