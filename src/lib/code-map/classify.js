import path from "node:path";
import { readDecoratorCalls } from "./text.js";

export function classifyFile(file) {
  const base = path.basename(file);
  if (isTestFilePath(file)) return "test";
  if (/(^|\/)app\/api\/.*\/route\.[cm]?[jt]s$/.test(file)) return "apiRoute";
  if (base === "page.tsx" || base === "page.ts" || base === "layout.tsx" || base === "layout.ts") return "route";
  if (base.endsWith(".controller.ts")) return "controller";
  if (base.endsWith(".service.ts")) return "service";
  if (base.endsWith(".module.ts")) return "module";
  if (base.endsWith(".dto.ts")) return "dto";
  if (base.endsWith(".schema.ts") || file.includes("/schemas/")) return "schema";
  if (base.startsWith("use") && /\.(ts|tsx)$/.test(base)) return "hook";
  if (
    file.startsWith("redux/apis/") ||
    file.startsWith("src/redux/apis/") ||
    file.startsWith("services/") ||
    file.startsWith("src/services/") ||
    file === "lib/api-client.ts" ||
    file === "src/lib/api-client.ts" ||
    file === "utils/api-client.ts" ||
    file === "src/utils/api-client.ts"
  )
    return "apiClient";
  if (/^[A-Z]/.test(base) && /\.(tsx|jsx)$/.test(base)) return "component";
  return "source";
}

export function isTestFilePath(file) {
  const normalized = file.replaceAll("\\", "/");
  return /(^|\/)(__tests__|test|tests)(\/|$)/.test(normalized) || /\.(spec|test)\.[jt]sx?$/.test(normalized) || /(^|\/)[^/]+_test\.go$/.test(normalized);
}

export function isNotableFile(file) {
  return ["route", "apiRoute", "controller", "service", "module", "apiClient"].includes(file.kind);
}

// Returns both the primary domain (existing behavior, used for display/scoring)
// and the full set of domain tags this file should be discoverable under.
// Feature subdirs (components/livestream/*) get both "components" and "livestream"
// so domain searches don't miss them.
export function inferDomainInfo(file) {
  const normalized = file.replaceAll("\\", "/").replace(/^src\//, "");
  const parts = normalized.split("/");
  const all = new Set();
  const add = (value) => {
    const cleaned = cleanDomain(value);
    if (cleaned) all.add(cleaned);
  };

  // Treat parts[i] as a feature directory only if a deeper segment exists —
  // otherwise it's actually the file (e.g. components/Button.tsx → parts[1]
  // is the file, not a feature).
  const isDir = (i) => i < parts.length - 1;

  let primary;
  if (normalized.startsWith("app/api/") && parts[2]) {
    primary = cleanDomain(parts[2]);
    if (isDir(3)) add(parts[3]);
  } else if ((parts[0] === "app" || parts[0] === "pages") && parts[1]) {
    primary = cleanDomain(parts[1]);
    if (isDir(2)) add(parts[2]);
  } else if (normalized.startsWith("redux/apis/") && parts[2]) {
    primary = cleanDomain(parts[2].replace(/-api\.[jt]s$/, "").replace(/-apis\.[jt]s$/, ""));
  } else if (normalized.startsWith("services/") && parts[1]) {
    primary = cleanDomain(parts[1].replace(/-service\.[jt]s$/, ""));
  } else {
    const sharedRoots = new Set(["components", "lib", "utils", "schemas", "hooks", "types"]);
    if (sharedRoots.has(parts[0])) {
      primary = cleanDomain(parts[0]);
      if (isDir(1)) add(parts[1]);
    } else {
      const interestingRoots = new Set(["app", "src", "redux", "services"]);
      if (interestingRoots.has(parts[0]) && parts[1]) {
        primary = cleanDomain(parts[1]);
        if (isDir(2)) add(parts[2]);
      } else {
        primary = cleanDomain(parts[0] ?? "root");
      }
    }
  }

  add(primary);
  return { primary, all: [...all] };
}

function cleanDomain(value) {
  return (
    value
      .replace(/\.[cm]?[jt]sx?$/, "")
      .replace(/-api$/, "")
      .replace(/-apis$/, "")
      .replace(/-service$/, "")
      .replace(/[()[\]]/g, "")
      .replace(/^\.+$/, "root") || "root"
  );
}

export function inferNextRoute(file) {
  const normalized = file.replaceAll("\\", "/");
  if (!normalized.startsWith("app/") && !normalized.startsWith("src/app/") && !normalized.startsWith("pages/") && !normalized.startsWith("src/pages/")) {
    return undefined;
  }

  if (!/(page|layout|route)\.[cm]?[jt]sx?$/.test(path.basename(normalized))) {
    return undefined;
  }

  return (
    normalized
      .replace(/^src\//, "")
      .replace(/^app/, "")
      .replace(/^pages/, "")
      .replace(/\/(page|layout|route)\.[cm]?[jt]sx?$/, "")
      .replace(/\([^/]+\)\//g, "")
      .replace(/\[[^/]+\]/g, (segment) => `:${segment.slice(1, -1)}`) || "/"
  );
}

export function inferControllerBasePath(text) {
  return readDecoratorCalls(text, ["Controller"]).find((call) => call.argument !== undefined)?.argument;
}

export function extractHttpMethods(text) {
  return readDecoratorCalls(text, ["Get", "Post", "Put", "Patch", "Delete", "Options", "Head"]).map((call) => ({
    method: call.name.toUpperCase(),
    path: call.argument?.trim() || "/",
  }));
}
