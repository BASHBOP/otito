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
  largeFileDiff: "large file diff",
  secret: "secret risk",
  releaseDiscipline: "release discipline",
};

// Path/keyword groups for each canonical flag. Lowercased substrings — match
// any path containing the substring. Each flag may match by path tokens or by
// the code-map `kind` field.
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
    pathParts: ["package.json", "lock", "docker", "next.config", "vite.config", "tsconfig", "env", ".github/workflows", "config", "dockerfile", "go.sum"],
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

// Threshold used by `classifyPath` when a file's additions+deletions are passed
// in. Keeps the 300-line boundary used by the existing pr-review heuristic.
export const LARGE_DIFF_LINES = 300;

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
  [RISK_FLAGS.largeFileDiff]: "📦",
  [RISK_FLAGS.secret]: "🚨",
  [RISK_FLAGS.releaseDiscipline]: "🏷️",
};

export function glyphFor(flag) {
  return RISK_GLYPHS[flag] ?? "";
}

// Classify a file path into canonical risk flags. Accepts optional `kind` from
// the code-map and optional diff sizes so the same function powers both
// task-context scoring and PR review.
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
  const rawTokens = new Set();
  const singularTokens = new Set();
  for (const token of path.split(/[^a-z0-9]+/).filter(Boolean)) {
    rawTokens.add(token);
    singularTokens.add(singularizeToken(token));
  }
  const kind = options.kind ?? "";
  const additions = options.additions ?? 0;
  const deletions = options.deletions ?? 0;
  const flags = new Set();

  for (const pattern of RISK_PATTERNS) {
    if (pattern.kinds.includes(kind)) {
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
export function isDocPath(filePath) {
  const path = String(filePath ?? "")
    .toLowerCase()
    .replaceAll("\\", "/");
  const dot = path.lastIndexOf(".");
  if (dot >= 0 && DOC_EXTENSIONS.has(path.slice(dot))) return true;
  return path.split("/").some((segment) => DOC_SEGMENTS.has(segment));
}

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

export function matchSecretPaths(paths) {
  return (paths ?? []).filter((path) => isSecretPath(path));
}

// True when a path is risk-sensitive AND should gate a merge — i.e. it is not a
// test file and not documentation. The classifier itself still reports concepts
// for ranking; this gate-facing predicate filters the noise the gates care
// about (a `checkout.spec.ts` test or a `git-checkout-guide.md` doc must not
// trip the money-flow risk gate).
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
export function matchRiskPaths(paths, options = {}) {
  const predicate = options.gate ? isGateRiskPath : (path) => classifyPath(path).length > 0;
  return (paths ?? []).filter(predicate);
}

// Extract canonical risk flags implied by a free-text query. The same
// vocabulary lets the impact scorer say "this request talks about Apple
// sign-in → boost auth/security paths." Matching is whole-token (and, for
// multi-word keywords, an ordered whole-token phrase) so substring accidents
// like "fix payload parsing" → money flow (via "pay") cannot happen.
export function conceptsFromQuery(query) {
  const tokens = tokenizeQuery(query);
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
function tokenizeQuery(query) {
  const text = String(query ?? "").toLowerCase();
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
function matchesConcept(keyword, tokens) {
  const words = keyword.split(/[\s-]+/).filter(Boolean);
  if (words.length <= 1) {
    return tokens.includes(keyword) || tokens.some((token) => singularizeToken(token) === keyword);
  }
  return containsPhrase(tokens, words);
}

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
