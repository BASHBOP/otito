import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = readJson(path.join(root, "package.json"));
const packageLock = readJson(path.join(root, "package-lock.json"), { optional: true });
const serverManifest = readJson(path.join(root, "server.json"), { optional: true });

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

if (!semverPattern.test(packageJson.version)) {
  fail(`package.json version must be valid SemVer, got ${JSON.stringify(packageJson.version)}`);
}

if (packageLock) {
  if (packageLock.version !== packageJson.version) {
    fail(`package-lock.json version ${packageLock.version} does not match package.json version ${packageJson.version}`);
  }

  const rootPackage = packageLock.packages?.[""];
  if (rootPackage?.version !== packageJson.version) {
    fail(`package-lock root package version ${rootPackage?.version} does not match package.json version ${packageJson.version}`);
  }
}

if (serverManifest) {
  if (serverManifest.version !== packageJson.version) {
    fail(`server.json version ${serverManifest.version} does not match package.json version ${packageJson.version}`);
  }

  for (const [index, pkg] of (serverManifest.packages ?? []).entries()) {
    if (pkg.version !== packageJson.version) {
      fail(`server.json packages[${index}] version ${pkg.version} does not match package.json version ${packageJson.version}`);
    }
  }
}

console.log(`ok: repoctx version ${packageJson.version} is SemVer`);

function readJson(filePath, { optional = false } = {}) {
  if (optional && !fs.existsSync(filePath)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`failed to read ${filePath}: ${error.message}`);
  }
}

function fail(message) {
  console.error(`version:check failed: ${message}`);
  process.exit(1);
}
