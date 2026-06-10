// Keeps server.json (MCP registry manifest) in lockstep with package.json.
// Wired into the `version` lifecycle script so `npm version` bumps both.
import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("server.json", "utf8"));

manifest.version = pkg.version;
for (const p of manifest.packages ?? []) {
  if (p.version) p.version = pkg.version;
}

fs.writeFileSync("server.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(`server.json synced to v${pkg.version}`);
