// Keeps server.json (MCP registry manifest) and pinned install-command
// versions in docs in lockstep with package.json. Wired into the `version`
// lifecycle script so `npm version` bumps all of them together.
import fs from "node:fs";
import { syncPinnedDocVersion } from "../src/lib/version-docs.js";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("server.json", "utf8"));

manifest.version = pkg.version;
for (const p of manifest.packages ?? []) {
  if (p.version) p.version = pkg.version;
}

fs.writeFileSync("server.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`server.json synced to v${pkg.version}`);

for (const file of ["docs/index.md", "RELEASE.md"]) {
  const original = fs.readFileSync(file, "utf8");
  const { content, changed } = syncPinnedDocVersion(original, pkg.version);
  if (changed) {
    fs.writeFileSync(file, content);
    console.log(`${file} synced to v${pkg.version}`);
  }
}
