// Shared risk + concept vocabulary used by impact scoring, PR review, and the
// merge-readiness gate. Single source of truth: any tool that flags a "money
// flow" or "auth/security" risk reads it from here.

import { isTestFilePath } from "./code-map/classify.js";

export const RISK_FLAGS = {
  requestSurface: "request surface",
  contract: "frontend/backend contract",
  dataModel: "data model",
  authSecurity: "auth/security",
  moneyFlow: "money flow",
  configuration: "configuration",
  dependency: "dependency",
  largeFileDiff: "large file diff",
  secret: "secret risk",
  releaseDiscipline: "release discipline",
};

// Path/keyword groups for each canonical flag. Each flag may match by the
// code-map `kind` field or by the path. Path matchers come in two strengths:
//
//   pathParts          loose — a whole word token anywhere in the path, or a
//                      raw substring when the part contains punctuation.
//   basenames /        anchored — a whole basename, a basename pattern, or a
//   basenamePatterns / whole directory segment. Use these when the loose form
//   segments           would match ordinary source files that merely share a
//                      word with the concept.
//
// `excludeTestData` opts a flag out of classifying tests and fixture corpora.
/**
 * @typedef {object} RiskPattern
 * @property {string} flag canonical risk flag this pattern reports
 * @property {string[]} kinds code-map `kind` values that imply the flag
 * @property {string[]} pathParts loose word tokens or punctuated substrings
 * @property {string[]} [basenames] exact whole basenames
 * @property {RegExp[]} [basenamePatterns] basename families
 * @property {string[]} [segments] whole directory segments
 * @property {boolean} [excludeTestData] skip tests and fixture corpora
 */

/** @type {RiskPattern[]} */
export const RISK_PATTERNS = [
  {
    flag: RISK_FLAGS.requestSurface,
    kinds: ["route", "apiRoute", "controller"],
    pathParts: [],
  },
  {
    flag: RISK_FLAGS.contract,
    kinds: ["apiClient"],
    pathParts: [],
  },
  {
    flag: RISK_FLAGS.dataModel,
    kinds: ["schema"],
    pathParts: ["prisma", "migration", "schema", "schema.sql", ".sql"],
  },
  {
    flag: RISK_FLAGS.authSecurity,
    kinds: [],
    pathParts: ["auth", "session", "jwt", "permission", "role", "password", "token", "oauth", "sso"],
  },
  {
    flag: RISK_FLAGS.moneyFlow,
    kinds: [],
    pathParts: ["payment", "billing", "checkout", "webhook", "stripe", "refund", "invoice", "subscription", "chargeback"],
  },
  {
    flag: RISK_FLAGS.configuration,
    kinds: ["config"],
    // Path prefixes, plus the two word tokens that survive anchoring:
    // "docker" and "tsconfig" are unambiguous — measured across this repo and
    // a 2,303-commit service repo they produced no false positives, and they
    // reach build and ops scripts (`scripts/sync-dev-with-prod-docker.sh`,
    // `generate-tsconfig.mjs`) that no basename rule covers. "config", "lock"
    // and "env" are ordinary programming words and are anchored below.
    pathParts: [".github/workflows", ".circleci", "docker", "tsconfig"],
    // Basename families. `*.config.*` replaces the bare "config" word token,
    // which also matched source modules (`src/lib/config.js`) and their tests
    // (`tests/config.test.js`); `.env*` replaces the bare "env" token, which
    // matched any `env/` directory or `src/env/index.ts`. The compose pattern
    // carries the environment-suffixed forms (`docker-compose.dev.yml`) that
    // the bare "docker" token used to reach.
    basenamePatterns: [
      /^dockerfile(\.[^/]+)?$/,
      /^docker-compose(\.[^/]+)?\.ya?ml$/,
      /^tsconfig(\.[^/]+)?\.json$/,
      /^[^/]+\.config\.[cm]?[jt]sx?$/,
      /^\.env(\.[^/]+)?$/,
    ],
    // Whole directory segments. Replaces the bare "config" and "lock" word
    // tokens, which matched any path component — including `src/lib/lock.js`
    // and `src/lib/locks/advisory-lock.ts`.
    segments: ["config", "configs", "docker"],
    // Configuration describes how *this* repository is built and deployed, so
    // a config-shaped file that is test input rather than real configuration
    // must not flag. Opt-in per pattern: every other flag keeps classifying
    // tests and fixtures, and the merge gates keep filtering them downstream
    // via `isGateRiskPath`.
    excludeTestData: true,
  },
  {
    // Dependency manifests and lockfiles were part of `configuration` until a
    // line-overlap (SZZ) backtest over a 1,064-commit service repository
    // separated them: commits touching only a manifest were repaired at 0.39x
    // the base rate, while commits touching a real config file were repaired
    // at 2.25x — a 5.7x separation that held at every window from 7 to 90
    // days. Reported as its own flag so the evidence still surfaces, and
    // scored at zero in `inferRisk`, because a dependency bump is measurably
    // *safer* than an average change rather than riskier.
    flag: RISK_FLAGS.dependency,
    kinds: [],
    pathParts: [],
    basenames: [
      "package.json",
      "package-lock.json",
      "npm-shrinkwrap.json",
      "yarn.lock",
      "pnpm-lock.yaml",
      "cargo.lock",
      "gemfile.lock",
      "poetry.lock",
      "composer.lock",
      "go.sum",
    ],
    excludeTestData: true,
  },
];

// File-name patterns that almost certainly indicate a secret or credential
// file. Matched against the basename or a whole path segment, NOT as a raw
// substring — `dev.environments.ts` must not match via the ".env" substring
// and `secrets-management.md` (a doc) must not hard-fail the gate. Each entry
// is tested against the path's basename and, where noted, each path segment.
export const SECRET_BASENAME_PATTERNS = [
  /^\.env$/, // .env
  /^\.env\.[^/]+$/, // .env.local, .env.production
  /^[^/]*\.pem$/, // *.pem
  /^[^/]*\.key$/, // *.key (private keys)
  /^[^/]*\.p12$/, // *.p12 keystores
  /^[^/]*\.pfx$/, // *.pfx keystores
  /^id_rsa$/, // ssh private key
  /^id_rsa\.[^/]+$/, // id_rsa.pub etc.
  /^id_dsa$/,
  /^id_ed25519$/,
  /^credentials$/, // aws-style credentials file
  /^credentials\.json$/,
  /^credentials\.ya?ml$/,
  /^secrets?\.json$/, // secret.json / secrets.json
  /^secrets?\.ya?ml$/, // secret.yaml / secrets.yml
];

// Whole path segments (directories) that signal a credential store. Matched
// segment-wise so `secrets/aws.json` flags but `docs/secrets-management.md`
// (a documentation file) does not.
export const SECRET_SEGMENTS = new Set(["secret", "secrets", "credentials"]);

// Documentation extensions/segments that must never be treated as secret- or
// risk-sensitive by the merge gates, even if their name mentions a sensitive
// word (e.g. `docs/secrets-management.md`, `auth-guide.md`).
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".markdown", ".rst", ".txt", ".adoc"]);
const DOC_SEGMENTS = new Set(["docs", "doc", "documentation"]);

// Directories that hold test input rather than the repository's own code and
// configuration. A `package.json` or `Dockerfile` under one of these describes
// a fixture repository the evals run against, not how this repository ships.
const TEST_DATA_SEGMENTS = new Set(["fixtures", "__fixtures__", "testdata", "test-data", "evals", "eval"]);

// Threshold used by `classifyPath` when a file's additions+deletions are passed
// in. Keeps the 300-line boundary used by the existing pr-review heuristic.
export const LARGE_DIFF_LINES = 300;

// Score contribution per flag, summed by `inferRisk`. Exported so `otito
// calibrate` can report a measured lift beside the weight that flag actually
// carries, instead of keeping a second copy of these numbers in sync by hand.
// `dependency` is deliberately zero — see the pattern comment above.
export const RISK_SCORE_WEIGHTS = {
  [RISK_FLAGS.requestSurface]: 2,
  [RISK_FLAGS.contract]: 2,
  [RISK_FLAGS.dataModel]: 3,
  [RISK_FLAGS.authSecurity]: 3,
  [RISK_FLAGS.moneyFlow]: 3,
  [RISK_FLAGS.configuration]: 2,
  [RISK_FLAGS.dependency]: 0,
  [RISK_FLAGS.largeFileDiff]: 2,
};

// Concept synonyms: when one of these words appears in a free-text query, the
// associated canonical flag should be considered relevant. Used by the impact
// scorer so "add Apple sign-in" boosts auth/security paths even though the
// word "auth" never appears in the request.
export const CONCEPT_SYNONYMS = {
  [RISK_FLAGS.authSecurity]: [
    // Multi-word phrases first: "apple"/"google" alone are too ambiguous
    // ("add an apple emoji" must NOT imply auth), so they only count when
    // they appear next to a sign-in verb. Phrases are matched as ordered
    // whole-token sequences against the tokenized query.
    "apple sign in",
    "apple signin",
    "apple sign-in",
    "apple login",
    "sign in with apple",
    "google sign in",
    "google signin",
    "google sign-in",
    "google login",
    "sign in with google",
    "social login",
    "oauth",
    "sso",
    "login",
    "logout",
    "signin",
    "sign-in",
    "signup",
    "sign-up",
    "session",
    "sessions",
    "jwt",
    "otp",
    "2fa",
    "mfa",
    "password",
    "passwords",
    "token",
    "tokens",
    "permission",
    "permissions",
    "role",
    "roles",
    "auth",
  ],
  [RISK_FLAGS.moneyFlow]: [
    "stripe",
    "payment",
    "payments",
    "pay",
    "billing",
    "checkout",
    "refund",
    "refunds",
    "chargeback",
    "invoice",
    "subscription",
    "webhook",
    "money",
    "cart",
    "payout",
    "payouts",
  ],
  [RISK_FLAGS.dataModel]: ["prisma", "migration", "migrations", "schema", "database", "db", "sql", "model", "models"],
  [RISK_FLAGS.requestSurface]: ["route", "routes", "endpoint", "endpoints", "controller", "controllers", "api", "dto", "handler", "handlers"],
  [RISK_FLAGS.configuration]: ["config", "env", "docker", "deploy", "ci", "pipeline", "workflow", "workflows"],
};

// Emoji glyphs surfaced by the fancy renderer. Plain mode strips these.
export const RISK_GLYPHS = {
  [RISK_FLAGS.requestSurface]: "📡",
  [RISK_FLAGS.contract]: "🔗",
  [RISK_FLAGS.dataModel]: "🗄️",
  [RISK_FLAGS.authSecurity]: "🔐",
  [RISK_FLAGS.moneyFlow]: "💳",
  [RISK_FLAGS.configuration]: "⚙️",
  [RISK_FLAGS.dependency]: "⬆️",
  [RISK_FLAGS.largeFileDiff]: "📦",
  [RISK_FLAGS.secret]: "🚨",
  [RISK_FLAGS.releaseDiscipline]: "🏷️",
};

/**
 * @param {string} flag
 * @returns {string}
 */
export function glyphFor(flag) {
  return /** @type {Record<string, string>} */ (RISK_GLYPHS)[flag] ?? "";
}

// Classify a file path into canonical risk flags. Accepts optional `kind` from
// the code-map and optional diff sizes so the same function powers both
// task-context scoring and PR review.
/**
 * @param {string} filePath
 * @param {{ kind?: string, additions?: number, deletions?: number }} [options]
 * @returns {string[]}
 */
export function classifyPath(filePath, options = {}) {
  const path = String(filePath ?? "").toLowerCase();
  // Two token views of the path:
  //  - rawTokens: the literal path components.
  //  - singularTokens: each component folded to its singular form, so the
  //    singular concept vocabulary matches pluralized segments
  //    (`sessions.service.ts` → `session`, `roles.guard.ts` → `role`).
  // Most concept words match against either view. A small set of AMBIGUOUS
  // words (e.g. "token") only match the raw view, so a generic `tokens.js`
  // utility does NOT fold into the auth concept while `token.service.ts` still
  // does. The original word is also always kept so a plural pattern still hits.
  /** @type {Set<string>} */
  const rawTokens = new Set();
  /** @type {Set<string>} */
  const singularTokens = new Set();
  for (const token of path.split(/[^a-z0-9]+/).filter(Boolean)) {
    rawTokens.add(token);
    singularTokens.add(singularizeToken(token));
  }
  const kind = options.kind ?? "";
  const additions = options.additions ?? 0;
  const deletions = options.deletions ?? 0;
  /** @type {Set<string>} */
  const flags = new Set();

  const segments = path.replaceAll("\\", "/").split("/").filter(Boolean);
  const basename = segments[segments.length - 1] ?? "";
  const directories = new Set(segments.slice(0, -1));

  for (const pattern of RISK_PATTERNS) {
    if (pattern.excludeTestData && isTestDataPath(filePath)) {
      continue;
    }
    if (pattern.kinds.includes(kind)) {
      flags.add(pattern.flag);
      continue;
    }
    if (pattern.basenames?.includes(basename)) {
      flags.add(pattern.flag);
      continue;
    }
    if (pattern.basenamePatterns?.some((candidate) => candidate.test(basename))) {
      flags.add(pattern.flag);
      continue;
    }
    if (pattern.segments?.some((segment) => directories.has(segment))) {
      flags.add(pattern.flag);
      continue;
    }
    if (pattern.pathParts.some((part) => matchesPathPart(part, rawTokens, singularTokens, path))) {
      flags.add(pattern.flag);
    }
  }

  if (additions + deletions >= LARGE_DIFF_LINES) {
    flags.add(RISK_FLAGS.largeFileDiff);
  }

  return [...flags];
}

// Concept words whose singular form is too generic to safely match a
// pluralized filename. `tokens.js` (a tokenizer / token-counter / design
// tokens) must NOT classify as auth just because its singular is "token";
// `token.service.ts` (literal singular token) still does. These match the raw
// path token only — never a singular-folded plural.
const AMBIGUOUS_PATH_PARTS = new Set(["token"]);

// Match a path-part either as a whole path-component token (when the part is
// a pure word, so "sso" cannot match inside "processors") or as a literal
// substring (when the part contains punctuation, e.g. "package.json" or
// ".github/workflows"). Avoids substring false positives observed in
// field-test: "processors" → "sso" → auth/security.
/**
 * @param {string} part
 * @param {Set<string>} rawTokens
 * @param {Set<string>} singularTokens
 * @param {string} path
 * @returns {boolean}
 */
function matchesPathPart(part, rawTokens, singularTokens, path) {
  if (/^[a-z0-9]+$/.test(part)) {
    if (AMBIGUOUS_PATH_PARTS.has(part)) {
      // Exact raw token only — do not accept a singular-folded plural.
      return rawTokens.has(part);
    }
    const singularPart = singularizeToken(part);
    return rawTokens.has(part) || singularTokens.has(part) || rawTokens.has(singularPart) || singularTokens.has(singularPart);
  }
  return path.includes(part);
}

// Lightweight, shared English singularizer for whole path/query tokens. Kept
// deliberately conservative (short tokens and "-ss" endings are left alone) so
// it only ever turns an obvious plural into its singular concept word. Shared
// from here so impact.js, the gates, and pr-review all singularize the same
// way instead of each rolling their own copy.
/**
 * @param {string} term
 * @returns {string}
 */
export function singularizeToken(term) {
  if (term.length <= 3 || term.endsWith("ss")) return term;
  if (term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.endsWith("ses") || term.endsWith("xes") || term.endsWith("zes") || term.endsWith("ches") || term.endsWith("shes")) {
    return term.slice(0, -2);
  }
  if (term.endsWith("s")) return term.slice(0, -1);
  return term;
}

// True when the path is a documentation file (by extension or by living under
// a docs/ directory). The gates never treat docs as risk- or secret-sensitive.
/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function isDocPath(filePath) {
  const path = String(filePath ?? "")
    .toLowerCase()
    .replaceAll("\\", "/");
  const dot = path.lastIndexOf(".");
  if (dot >= 0 && DOC_EXTENSIONS.has(path.slice(dot))) return true;
  return path.split("/").some((segment) => DOC_SEGMENTS.has(segment));
}

// True when the path is a test file or lives in a fixture corpus. Used by
// patterns that opt in via `excludeTestData`, so a config-shaped fixture is
// not mistaken for this repository's own configuration. Note the evals run
// otito *inside* those fixture directories, where paths are fixture-relative
// (`package.json`, not `evals/fixtures/x/package.json`), so this never hides
// a fixture's configuration from the run it is a fixture for.
/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function isTestDataPath(filePath) {
  const path = String(filePath ?? "");
  if (!path.trim()) return false;
  if (isTestFilePath(path)) return true;
  return path
    .toLowerCase()
    .replaceAll("\\", "/")
    .split("/")
    .some((segment) => TEST_DATA_SEGMENTS.has(segment));
}

/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function isSecretPath(filePath) {
  const normalized = String(filePath ?? "")
    .toLowerCase()
    .replaceAll("\\", "/");
  // Documentation that merely talks about secrets is never a secret file.
  if (isDocPath(normalized)) return false;
  const segments = normalized.split("/").filter(Boolean);
  const basename = segments[segments.length - 1] ?? "";
  if (SECRET_BASENAME_PATTERNS.some((pattern) => pattern.test(basename))) return true;
  return segments.slice(0, -1).some((segment) => SECRET_SEGMENTS.has(segment));
}

/**
 * @param {string[]} paths
 * @returns {string[]}
 */
export function matchSecretPaths(paths) {
  return (paths ?? []).filter((path) => isSecretPath(path));
}

// True when a path is risk-sensitive AND should gate a merge — i.e. it is not a
// test file and not documentation. The classifier itself still reports concepts
// for ranking; this gate-facing predicate filters the noise the gates care
// about (a `checkout.spec.ts` test or a `git-checkout-guide.md` doc must not
// trip the money-flow risk gate).
/**
 * @param {string} filePath
 * @returns {boolean}
 */
export function isGateRiskPath(filePath) {
  const path = String(filePath ?? "");
  if (!path.trim()) return false;
  if (isTestFilePath(path)) return false;
  if (isDocPath(path)) return false;
  return classifyPath(path).length > 0;
}

// Default matcher reports any path the classifier flags — used where concept
// reporting (not gating) is wanted. Pass `{ gate: true }` to apply the
// test/doc filtering the merge gates require.
/**
 * @param {string[]} paths
 * @param {{ gate?: boolean }} [options]
 * @returns {string[]}
 */
export function matchRiskPaths(paths, options = {}) {
  const predicate = options.gate ? isGateRiskPath : (/** @type {string} */ path) => classifyPath(path).length > 0;
  return (paths ?? []).filter(predicate);
}

// Extract canonical risk flags implied by a free-text query. The same
// vocabulary lets the impact scorer say "this request talks about Apple
// sign-in → boost auth/security paths." Matching is whole-token (and, for
// multi-word keywords, an ordered whole-token phrase) so substring accidents
// like "fix payload parsing" → money flow (via "pay") cannot happen.
/**
 * @param {string} query
 * @returns {string[]}
 */
export function conceptsFromQuery(query) {
  const tokens = tokenizeQuery(query);
  /** @type {Set<string>} */
  const flags = new Set();
  for (const [flag, words] of Object.entries(CONCEPT_SYNONYMS)) {
    for (const word of words) {
      if (matchesConcept(word, tokens)) {
        flags.add(flag);
        break;
      }
    }
  }
  return [...flags];
}

// Tokenize a free-text query into lowercased whole-word tokens. Hyphenated
// forms are kept as a single token ("sign-in") AND split ("sign", "in") so a
// hyphenated synonym and its spaced phrase both have a chance to match.
/**
 * @param {string} query
 * @returns {string[]}
 */
function tokenizeQuery(query) {
  const text = String(query ?? "").toLowerCase();
  /** @type {string[]} */
  const tokens = [];
  for (const raw of text.split(/[^a-z0-9-]+/).filter(Boolean)) {
    tokens.push(raw);
    if (raw.includes("-")) {
      for (const part of raw.split("-").filter(Boolean)) tokens.push(part);
    }
  }
  return tokens;
}

// A concept keyword matches when it is present as a whole token, its singular
// form is, or — for multi-word keywords — its words appear as an ordered,
// contiguous run of whole tokens in the query.
/**
 * @param {string} keyword
 * @param {string[]} tokens
 * @returns {boolean}
 */
function matchesConcept(keyword, tokens) {
  const words = keyword.split(/[\s-]+/).filter(Boolean);
  if (words.length <= 1) {
    return tokens.includes(keyword) || tokens.some((token) => singularizeToken(token) === keyword);
  }
  return containsPhrase(tokens, words);
}

/**
 * @param {string[]} tokens
 * @param {string[]} words
 * @returns {boolean}
 */
function containsPhrase(tokens, words) {
  for (let i = 0; i + words.length <= tokens.length; i += 1) {
    let matched = true;
    for (let j = 0; j < words.length; j += 1) {
      if (tokens[i + j] !== words[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}
