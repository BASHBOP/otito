// Shared risk + concept vocabulary used by impact scoring, PR review, and the
// merge-readiness gate. Single source of truth: any tool that flags a "money
// flow" or "auth/security" risk reads it from here.

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

// Substrings that almost certainly indicate a secret or credential file.
// Matched anywhere in the path (case-insensitive).
export const SECRET_PATH_PARTS = [".env", "secret", "secrets", "credentials", "private-key", "id_rsa", ".pem"];

// Threshold used by `classifyPath` when a file's additions+deletions are passed
// in. Keeps the 300-line boundary used by the existing pr-review heuristic.
export const LARGE_DIFF_LINES = 300;

// Concept synonyms: when one of these words appears in a free-text query, the
// associated canonical flag should be considered relevant. Used by the impact
// scorer so "add Apple sign-in" boosts auth/security paths even though the
// word "auth" never appears in the request.
export const CONCEPT_SYNONYMS = {
  [RISK_FLAGS.authSecurity]: [
    "apple",
    "google",
    "oauth",
    "sso",
    "login",
    "logout",
    "signin",
    "sign-in",
    "signup",
    "sign-up",
    "session",
    "jwt",
    "otp",
    "2fa",
    "mfa",
    "password",
    "token",
    "permission",
    "role",
    "auth",
  ],
  [RISK_FLAGS.moneyFlow]: ["stripe", "payment", "pay", "billing", "checkout", "refund", "chargeback", "invoice", "subscription", "webhook", "money", "cart"],
  [RISK_FLAGS.dataModel]: ["prisma", "migration", "schema", "database", "db", "sql", "model"],
  [RISK_FLAGS.requestSurface]: ["route", "endpoint", "controller", "api", "dto", "handler"],
  [RISK_FLAGS.configuration]: ["config", "env", "docker", "deploy", "ci", "pipeline", "workflow"],
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
  const tokens = new Set(path.split(/[^a-z0-9]+/).filter(Boolean));
  const kind = options.kind ?? "";
  const additions = options.additions ?? 0;
  const deletions = options.deletions ?? 0;
  const flags = new Set();

  for (const pattern of RISK_PATTERNS) {
    if (pattern.kinds.includes(kind)) {
      flags.add(pattern.flag);
      continue;
    }
    if (pattern.pathParts.some((part) => matchesPathPart(part, tokens, path))) {
      flags.add(pattern.flag);
    }
  }

  if (additions + deletions >= LARGE_DIFF_LINES) {
    flags.add(RISK_FLAGS.largeFileDiff);
  }

  return [...flags];
}

// Match a path-part either as a whole path-component token (when the part is
// a pure word, so "sso" cannot match inside "processors") or as a literal
// substring (when the part contains punctuation, e.g. "package.json" or
// ".github/workflows"). Avoids substring false positives observed in
// field-test: "processors" → "sso" → auth/security.
function matchesPathPart(part, tokens, path) {
  if (/^[a-z0-9]+$/.test(part)) {
    return tokens.has(part);
  }
  return path.includes(part);
}

export function isSecretPath(filePath) {
  const path = String(filePath ?? "").toLowerCase();
  return SECRET_PATH_PARTS.some((part) => path.includes(part));
}

export function matchSecretPaths(paths) {
  return (paths ?? []).filter((path) => isSecretPath(path));
}

export function matchRiskPaths(paths) {
  return (paths ?? []).filter((path) => classifyPath(path).length > 0);
}

// Extract canonical risk flags implied by a free-text query. The same
// vocabulary lets the impact scorer say "this request talks about Apple
// sign-in → boost auth/security paths."
export function conceptsFromQuery(query) {
  const text = String(query ?? "").toLowerCase();
  const flags = new Set();
  for (const [flag, words] of Object.entries(CONCEPT_SYNONYMS)) {
    for (const word of words) {
      if (text.includes(word)) {
        flags.add(flag);
        break;
      }
    }
  }
  return [...flags];
}
