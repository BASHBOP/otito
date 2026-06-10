const vendorLibPrefixes = [
  "jquery",
  "angular",
  "vue",
  "react",
  "preact",
  "bootstrap",
  "lodash",
  "moment",
  "underscore",
  "backbone",
  "ember",
  "alpine",
  "htmx",
  "chart",
  "d3",
];
const vendorPathSegments = new Set(["node_modules", "bower_components", "vendor", "third_party", "third-party", "dist", "build"]);
const vendorFileSuffixes = [".min.js", ".min.css", ".min.mjs", ".bundle.js", ".bundle.min.js", ".chunk.js"];

/**
 * @param {string} relativePath
 * @param {string} [text]
 * @returns {boolean}
 */
export function isVendorFile(relativePath, text) {
  const lower = relativePath.toLowerCase();
  const segments = lower.split(/[/\\]/);
  if (segments.some((seg) => vendorPathSegments.has(seg))) return true;
  if (vendorFileSuffixes.some((s) => lower.endsWith(s))) return true;

  const filename = segments[segments.length - 1];
  for (const prefix of vendorLibPrefixes) {
    if (filename.startsWith(prefix) && /\.(js|mjs|cjs|css)$/.test(filename)) {
      return true;
    }
  }

  if (typeof text === "string" && text.length > 50_000 && /\.(js|mjs|cjs|css)$/.test(filename)) {
    let longest = 0;
    const sample = text.slice(0, 8192);
    for (const line of sample.split("\n")) {
      if (line.length > longest) longest = line.length;
      if (longest > 500) return true;
    }
  }

  return false;
}
