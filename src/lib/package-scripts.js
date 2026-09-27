// Package script names are free text, and the harness, the PR review and
// `otito init` each read them on their own. A repository whose type check is
// `tsc:check` fell through all three: the harness never listed it, the review
// listed it and could not say why, and the pre-commit hook left it out. The
// rules live here so the three cannot drift apart again.

// Matched against the name's segments joined by "-", so `tsc` has to be a whole
// segment: `tsconfig:sync` and `prototype` are not type checks.
const typeCheckName = /(^|-)(tsc|typechecks?|types?-checks?|checks?-types?)(-|$)/;

// A name that says watch never finishes and one that says build writes files.
// Neither is a check an agent, a hook or a CI job can run.
const notACheckName = /(^|-)(watch|build)(-|$)/;

// `--watch` anywhere, or `-w` handed to tsc. A bare `-w` is left alone because
// npm reads it as `--workspace`.
const watchFlag = /(^|\s)--watch\b|\btsc\b[^&|;]*\s-w\b/;

/**
 * Lower-case segments of a script name, split on separators and camelCase:
 * `tsc:check`, `tsc-check` and `tscCheck` all give `["tsc", "check"]`.
 * @param {string} name
 * @returns {string[]}
 */
export function scriptSegments(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isTypeCheckScript(name) {
  const normalized = scriptSegments(name).join("-");
  return typeCheckName.test(normalized) && !notACheckName.test(normalized);
}

/**
 * The headless sibling of an end-to-end script, when the package defines one:
 * `test:e2e` gives `test:e2e:headless`. A headed run opens browser windows,
 * which an agent or a CI runner has no display for.
 * @param {Record<string, unknown>} scripts
 * @param {string} name
 * @returns {string | undefined}
 */
export function headlessVariant(scripts, name) {
  const segments = scriptSegments(name);
  if (!segments.includes("e2e") || segments.includes("headless")) {
    return undefined;
  }
  const wanted = [...segments, "headless"].join("-");
  return Object.keys(scripts).find((candidate) => scripts[candidate] && scriptSegments(candidate).join("-") === wanted);
}

/**
 * Resolve an ordered list of preferred script names against the scripts a
 * package defines. Names the package lacks are dropped and the order of the
 * rest is kept. When the package has none of the type checks the list names,
 * every type check it does have follows the list's last type-check name, so a
 * repository that already had one listed gets no second run of tsc. An
 * end-to-end script gives way to its headless sibling.
 * @param {Record<string, unknown>} scripts
 * @param {string[]} preferred
 * @returns {string[]}
 */
export function selectScripts(scripts = {}, preferred) {
  const lastTypeCheck = preferred.map(isTypeCheckScript).lastIndexOf(true);
  /** @type {string[]} */
  const selected = [];
  preferred.forEach((name, index) => {
    const resolved = headlessVariant(scripts, name) ?? name;
    if (isRunnable(scripts, resolved)) {
      selected.push(resolved);
    }
    if (index === lastTypeCheck && !selected.some(isTypeCheckScript)) {
      selected.push(
        ...Object.keys(scripts)
          .filter((candidate) => isTypeCheckScript(candidate) && isRunnable(scripts, candidate))
          .sort(),
      );
    }
  });
  return [...new Set(selected)];
}

/**
 * @param {Record<string, unknown>} scripts
 * @param {string} name
 * @returns {boolean}
 */
function isRunnable(scripts, name) {
  const body = scripts[name];
  if (!body) {
    return false;
  }
  return !(isTypeCheckScript(name) && typeof body === "string" && watchFlag.test(body));
}
