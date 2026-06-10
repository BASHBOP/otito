import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { discoverRepositories, indexRepositories, listCatalog, searchCatalog } from "./catalog.js";
import { generateContextPack } from "./context-engine.js";
import { generateImpact } from "./impact.js";
import { evaluateLocal } from "./pass-local.js";
import { evaluatePR } from "./pass-pr.js";
import { generateReview } from "./review.js";
import { generateHarness } from "./harness.js";
import { getCachedCodeMap } from "./index-cache.js";
import { inspectRepo, gateInspectScripts } from "./repo.js";
import { generatePrReview } from "./pr-review.js";
import { generateWorkspaceReport } from "./workspace.js";

/**
 * A JSON-schema fragment describing one MCP tool input.
 * @typedef {object} McpInputSchema
 * @property {string} [type]
 * @property {McpInputSchema} [items]
 * @property {Record<string, McpInputSchema & { description?: string }>} [properties]
 * @property {string[]} [required]
 */

/**
 * One MCP tool definition as advertised over tools/list.
 * @typedef {object} McpTool
 * @property {string} name
 * @property {string} title
 * @property {string} description
 * @property {{ readOnlyHint?: boolean }} annotations
 * @property {McpInputSchema} inputSchema
 */

/**
 * Loosely-typed tool-call arguments. Tool handlers read a heterogeneous set of
 * optional fields off this bag, so it is intentionally permissive.
 * @typedef {Record<string, any>} ToolArgs
 */

/**
 * A parsed JSON-RPC request/notification.
 * @typedef {{ jsonrpc?: string, id?: string | number | null, method?: string, params?: any }} JsonRpcMessage
 */

const latestProtocolVersion = "2025-06-18";
// This server's surface (initialize, ping, tools/list, tools/call) is
// identical across these protocol revisions, so we can echo whichever the
// client asks for instead of forcing our latest and triggering a disconnect.
const supportedProtocolVersions = new Set(["2024-11-05", "2025-03-26", latestProtocolVersion]);

/**
 * @param {unknown} requested
 * @returns {string}
 */
function negotiateProtocolVersion(requested) {
  return typeof requested === "string" && supportedProtocolVersions.has(requested) ? requested : latestProtocolVersion;
}
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));

/** @type {McpTool[]} */
export const tools = [
  {
    name: "repo_inspect",
    title: "Inspect Repository",
    description:
      "Inspect repository shape, languages, package managers, script names, entrypoints, and git metadata. Returns up to 200 representative file paths; pass includeScripts:true to get full script command bodies instead of just names.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository path. Defaults to current working directory." },
        includeScripts: { type: "boolean", description: "Include full package.json script command bodies, not just their names. Defaults to false." },
      },
    },
  },
  {
    name: "repo_map",
    title: "Map Repository",
    description:
      "Map a repository into a compact JSON code map, optionally narrowed by domain, file kind, or controller route. Pass domain to find files for a feature, kind to find files of a type (route, controller, service, apiClient, component, test), or route to match Nest controller routes by substring/regex. Replaces the old find_domain, find_file_kind, find_backend_route, and find_frontend_api_client tools. Writes a local .dev-context/index.json cache into the target repo; the call is idempotent and does not change source files.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository path. Defaults to current working directory." },
        domain: { type: "string", description: "Optional domain filter such as booking, payment, email, events." },
        kind: { type: "string", description: "Optional file kind filter such as route, controller, service, apiClient, component, test." },
        route: {
          type: "string",
          description:
            "Optional route filter. Substring or regex matched against each controller's combined route (controllerBasePath + httpMethods paths) and file path.",
        },
        includeFiles: { type: "boolean", description: "Include matching files in the response. Defaults to false." },
        limit: { type: "number", description: "Maximum files to include. Defaults to 100." },
      },
    },
  },
  {
    name: "repo_index",
    title: "Index Repositories",
    description:
      "Index local repositories: generate .dev-context indexes and add them to the local catalog. Pass discover:true to find repository roots under the given paths first. Pass dryRun:true to discover and report without writing any indexes or catalog (read-only); this replaces the old repo_discover tool. Without dryRun this mutates the persistent local catalog, so it is not a pure read.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "Repository paths, or roots when discover is true." },
        path: { type: "string", description: "Single repository path." },
        discover: { type: "boolean", description: "Discover repositories under the provided paths before indexing." },
        dryRun: {
          type: "boolean",
          description: "Discover and report repositories without writing indexes or mutating the catalog. Read-only. Defaults to false.",
        },
        catalog: { type: "string", description: "Optional catalog JSON path." },
        depth: { type: "number", description: "Maximum discovery depth." },
        limit: { type: "number", description: "Maximum discovered repositories." },
      },
    },
  },
  {
    name: "repo_search",
    title: "Search Repository Catalog",
    description:
      "Search indexed local repositories by path, domain, kind, route, imports, exports, and symbols. Omit query to list the local repository catalog instead (the catalog listing the old repo_catalog tool returned). Only searches repositories already in the local catalog — if the catalog is empty this returns no matches, so call repo_index on the target repositories first.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query. Omit to return the catalog listing instead of search matches." },
        catalog: { type: "string", description: "Optional catalog JSON path." },
        limit: { type: "number", description: "Maximum matches. Defaults to 25." },
        offline: { type: "boolean", description: "Use stored index files without refreshing fingerprints." },
      },
    },
  },
  {
    name: "context_pack",
    title: "Context Pack",
    description:
      "Generate a task-aware local context packet with primary files, related files, tests, patterns, and validation commands. Writes a local .dev-context/index.json cache into the target repo; the call is idempotent and does not change source files.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Task or question to gather context for." },
        path: { type: "string", description: "Repository path. Defaults to current working directory." },
        paths: { type: "array", items: { type: "string" }, description: "Repository paths for a multi-repo context packet." },
        limit: { type: "number", description: "Maximum primary, related, and test files per section. Defaults to 8." },
        includeEvidence: {
          type: "boolean",
          description: "Include per-file imports, exports, and symbol slices as source evidence. Defaults to false to keep the packet compact.",
        },
        includeMarkdown: {
          type: "boolean",
          description: "Return a compact human-readable markdown report instead of the full JSON packet. Defaults to false.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "change_impact",
    title: "Change Impact",
    description:
      "Given a plain-English change request, rank the files most likely to own the change, with risk flags, suggested tests, and an implementation plan. Optional diff base validates predictions against actual changed files. Writes a local .dev-context/index.json cache into the target repo; the call is idempotent and does not change source files.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Plain-English change request." },
        path: { type: "string", description: "Repository path. Defaults to current working directory." },
        top: { type: "number", description: "Number of files to return. Defaults to 10." },
        diffBase: { type: "string", description: "Optional git ref to validate predictions against (e.g. origin/main, HEAD)." },
        includeMarkdown: { type: "boolean", description: "Return a compact human-readable markdown report instead of the full JSON. Defaults to false." },
      },
      required: ["query"],
    },
  },
  {
    name: "review_gate",
    title: "Review Gate",
    description:
      "Gate a change for merge and return a PASS / WARN / FAIL verdict. Omit pr to run the local, no-GitHub gate against a base ref (changed files, secret safety, risk-sensitive paths, release discipline, validation commands, dependency audit, policy profile). Set pr to gate an open GitHub PR via `gh` (PR state, review decision, CODEOWNERS approvals, unresolved conversations, branch protection, status checks). Merges the old merge_readiness and pr_merge_readiness tools. Use review_verdict instead when you want the full impact + review + gate composite, or review_context when you want diff/comment context with no verdict.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        pr: { type: "string", description: "Optional PR selector (number, URL, or branch). When set, runs the GitHub gate; when absent, runs the local gate." },
        path: { type: "string", description: "Repository path. Defaults to current working directory." },
        base: { type: "string", description: "Base ref for the local gate. Defaults to origin/main, then HEAD. Ignored in PR mode." },
        policy: { type: "string", description: "Policy profile: standard (default), company, or high-risk." },
        governance: { type: "string", description: "Governance: team (default) or solo." },
        request: { type: "string", description: "Optional change request for context evidence output." },
      },
    },
  },
  {
    name: "review_verdict",
    title: "Review Verdict",
    description:
      "Run the full review pipeline in one shot: change_impact plus review_context plus review_gate, returning a unified verdict with a derived confidence score. Use review_verdict when you want the complete picture of a change in a single call. Use review_context instead for diff metadata only (no verdict), or review_gate for the gate verdict alone.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository path. Defaults to current working directory." },
        request: { type: "string", description: "Plain-English change request for impact scoring." },
        base: { type: "string", description: "Base ref for local diff. Defaults to origin/main, then HEAD." },
        pr: { type: "string", description: "Optional PR selector. When set, pass-pr runs against GitHub instead of local mode." },
        policy: { type: "string", description: "Policy profile: standard (default), company, or high-risk." },
        governance: { type: "string", description: "Governance: team (default) or solo." },
        impactTop: { type: "number", description: "Number of impact files. Defaults to 8." },
      },
    },
  },
  {
    name: "workspace_report",
    title: "Workspace Report",
    description: "Generate a product-level report across multiple related repositories.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Repository paths to inspect together.",
        },
        includeMarkdown: { type: "boolean", description: "Return a compact human-readable markdown report instead of the full JSON. Defaults to false." },
      },
      required: ["paths"],
    },
  },
  {
    name: "review_context",
    title: "Review Context",
    description:
      "Produce PR review context from local git diff metadata, optionally enriched with GitHub PR comments. Use review_context when you want the raw diff/comment context for a change, not a verdict. Use review_verdict instead for the full impact + review + gate composite, or review_gate for the gate verdict alone.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository path. Defaults to current working directory." },
        number: { type: "number", description: "Optional GitHub PR number for gh enrichment." },
        github: { type: "boolean", description: "Ask gh to infer the current branch PR." },
        comment: { type: "boolean", description: "Create or update a sticky GitHub PR comment using gh. This writes to GitHub." },
        base: { type: "string", description: "Base ref. Defaults to PR base, upstream, origin/main, or main." },
        head: { type: "string", description: "Head ref. Defaults to HEAD." },
        includeMarkdown: { type: "boolean", description: "Return a compact human-readable markdown report instead of the full JSON. Defaults to false." },
      },
    },
  },
  {
    name: "repo_harness",
    title: "Repository Harness",
    description: "Generate setup, validation, runtime, and context commands for an agent or CI harness.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository path. Defaults to current working directory." },
        includeMarkdown: { type: "boolean", description: "Return a compact human-readable markdown report instead of the full JSON. Defaults to false." },
      },
    },
  },
];

// Legacy MCP tool names remain callable through tools/call even though they no
// longer appear in tools/list. Each entry maps an old name to its canonical
// successor plus a pure arguments translator. Renames forward 1:1; folded tools
// translate params (e.g. find_backend_route's query → repo_map.route). This
// guarantee holds until repoctx 3.0; see docs/MIGRATION-2.0.md.
/**
 * @typedef {{ tool: string, mapArgs: (args?: ToolArgs) => (ToolArgs | undefined) }} LegacyAlias
 * @type {Record<string, LegacyAlias>}
 */
export const LEGACY_TOOL_ALIASES = {
  // Renames — same schema, new name.
  pr_review: { tool: "review_context", mapArgs: (args) => args },
  review_pr: { tool: "review_verdict", mapArgs: (args) => args },
  // merge_readiness is the local gate (no pr); pr_merge_readiness is the GitHub
  // gate — map its `selector` onto review_gate's `pr`.
  merge_readiness: { tool: "review_gate", mapArgs: ({ selector: _selector, ...rest } = {}) => rest },
  pr_merge_readiness: {
    tool: "review_gate",
    mapArgs: ({ selector, ...rest } = {}) => ({ ...rest, pr: selector ?? rest.pr ?? "" }),
  },
  // repo_catalog → repo_search with no query returns the catalog listing.
  repo_catalog: { tool: "repo_search", mapArgs: ({ query: _query, ...rest } = {}) => rest },
  // repo_discover → repo_index in read-only discover mode.
  repo_discover: { tool: "repo_index", mapArgs: (args = {}) => ({ ...args, discover: true, dryRun: true }) },
  // The four find_* tools fold into repo_map's domain/kind/route/includeFiles params.
  find_domain: {
    tool: "repo_map",
    mapArgs: ({ domain, path, paths, limit } = {}) => ({ domain, path: path ?? paths?.[0], limit, includeFiles: true }),
  },
  find_file_kind: {
    tool: "repo_map",
    mapArgs: ({ kind, path, paths, limit } = {}) => ({ kind, path: path ?? paths?.[0], limit, includeFiles: true }),
  },
  find_backend_route: {
    tool: "repo_map",
    mapArgs: ({ query, path, paths, limit } = {}) => ({ kind: "controller", route: query, path: path ?? paths?.[0], limit, includeFiles: true }),
  },
  find_frontend_api_client: {
    tool: "repo_map",
    mapArgs: ({ query, domain, path, paths, limit } = {}) => ({
      kind: "apiClient",
      route: query ?? domain,
      path: path ?? paths?.[0],
      limit,
      includeFiles: true,
    }),
  },
};

/**
 * @param {{ input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream }} [options]
 * @returns {Promise<void>}
 */
export async function startMcpServer({ input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    /** @type {JsonRpcMessage} */
    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (error) {
      writeMessage(output, errorResponse(null, -32700, `Parse error: ${error instanceof Error ? error.message : String(error)}`));
      continue;
    }

    const response = await handleMessage(message);
    if (response) {
      writeMessage(output, response);
    }
  }
}

/**
 * @param {JsonRpcMessage | null} message
 * @returns {Promise<object | undefined>}
 */
async function handleMessage(message) {
  // JSON-RPC notifications (no id member) must never receive a response —
  // not even an error for unknown methods. Real MCP clients routinely send
  // notifications/cancelled and notifications/roots/list_changed.
  const isNotification = message !== null && typeof message === "object" && !Array.isArray(message) && !("id" in message);
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    if (isNotification) {
      return undefined;
    }
    return errorResponse(message?.id ?? null, -32600, "Invalid JSON-RPC request");
  }
  if (isNotification) {
    return undefined;
  }

  try {
    switch (message.method) {
      case "initialize":
        return successResponse(message.id, {
          protocolVersion: negotiateProtocolVersion(message.params?.protocolVersion),
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: packageJson.name,
            version: packageJson.version,
          },
        });
      case "ping":
        return successResponse(message.id, {});
      case "tools/list":
        return successResponse(message.id, { tools });
      case "tools/call":
        return successResponse(message.id, await callTool(message.params));
      default:
        return errorResponse(message.id, -32601, `Method not found: ${message.method}`);
    }
  } catch (error) {
    const code = error instanceof McpProtocolError ? error.code : -32603;
    return errorResponse(message.id, code, error instanceof Error ? error.message : String(error));
  }
}

/**
 * @param {any} [params]
 * @returns {Promise<{ content: { type: string, text: string }[], isError: boolean }>}
 */
async function callTool(params = {}) {
  if (!params || typeof params !== "object") {
    throw new McpProtocolError(-32602, "Tool call params must be an object");
  }

  const name = params.name;
  if (typeof name !== "string" || !name.trim()) {
    throw new McpProtocolError(-32602, "Tool name is required");
  }

  const args = params.arguments ?? {};
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new McpProtocolError(-32602, "Tool arguments must be an object");
  }

  let result;
  try {
    result = await dispatchTool(name, args);
  } catch (error) {
    if (error instanceof McpProtocolError) {
      throw error;
    }

    return {
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error),
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: toolResultText(result),
      },
    ],
    isError: false,
  };
}

// Render a dispatched tool result as the single text payload. When a tool was
// asked for its markdown report (includeMarkdown:true) the dispatcher returns a
// { data, markdown } pair — surface the human-readable markdown directly instead
// of nesting it inside the full JSON, which is far smaller on the wire. Every
// other result is serialized as compact (non-pretty) JSON. We deliberately do
// not emit structuredContent: no tool declares an outputSchema, so no client
// relies on it, and duplicating the payload doubled transport weight.
/**
 * @param {unknown} result
 * @returns {string}
 */
function toolResultText(result) {
  if (result && typeof result === "object" && "markdown" in result && typeof (/** @type {{ markdown?: unknown }} */ (result).markdown) === "string") {
    return /** @type {{ markdown: string }} */ (result).markdown;
  }
  return JSON.stringify(result);
}

/**
 * @param {string} name
 * @param {ToolArgs} args
 * @returns {Promise<any>}
 */
async function dispatchTool(name, args) {
  const alias = LEGACY_TOOL_ALIASES[name];
  if (alias) {
    return dispatchTool(alias.tool, alias.mapArgs(args) ?? {});
  }

  switch (name) {
    case "repo_inspect":
      return gateInspectScripts(inspectRepo(args.path ?? "."), args.includeScripts);
    case "repo_map":
      return compactCodeMap(getCachedCodeMap(args.path ?? "."), args);
    case "repo_index":
      // dryRun discovers and reports without writing indexes or mutating the
      // catalog, preserving the read-only semantics of the old repo_discover tool.
      if (args.dryRun) {
        return { ...discoverRepositories(args.paths ?? [args.path ?? "."], args), dryRun: true };
      }
      return indexRepositories(args.paths ?? [args.path ?? "."], args);
    case "repo_search":
      // No query → return the catalog listing (what repo_catalog returned).
      if (typeof args.query !== "string" || !args.query.trim()) {
        return listCatalog(args);
      }
      return withSearchRemediation(searchCatalog(args.query, args));
    case "context_pack": {
      const result = generateContextPack(requiredString(args.query, "query"), args);
      return args.includeMarkdown ? result : result.data;
    }
    case "change_impact": {
      const result = generateImpact(requiredString(args.query, "query"), {
        path: args.path ?? ".",
        top: args.top,
        diffBase: args.diffBase,
      });
      return args.includeMarkdown ? result : result.data;
    }
    case "review_gate": {
      // pr set → GitHub gate (evaluatePR); pr absent → local gate (evaluateLocal).
      // This is exactly what the old pr_merge_readiness and merge_readiness did.
      const hasPr = typeof args.pr === "string" && args.pr.trim();
      if (hasPr) {
        return evaluatePR(args.path ?? ".", args.pr, {
          policy: args.policy,
          governance: args.governance,
          request: args.request,
        });
      }
      return evaluateLocal(args.path ?? ".", {
        base: args.base,
        policy: args.policy,
        governance: args.governance,
        request: args.request,
      });
    }
    case "review_verdict": {
      const { data } = await generateReview(args.path ?? ".", {
        request: args.request,
        base: args.base,
        prSelector: args.pr,
        policy: args.policy,
        governance: args.governance,
        impactTop: args.impactTop,
      });
      return data;
    }
    case "workspace_report": {
      const paths = requirePaths(args);
      const result = generateWorkspaceReport(paths);
      return args.includeMarkdown ? result : result.data;
    }
    case "review_context": {
      const result = generatePrReview(args.path ?? ".", args);
      return args.includeMarkdown ? result : result.data;
    }
    case "repo_harness": {
      const result = generateHarness(args.path ?? ".", args);
      return args.includeMarkdown ? result : result.data;
    }
    default:
      throw new McpProtocolError(-32602, `Unknown tool: ${name}`);
  }
}

// repo_search only sees repositories already in the local catalog. When the
// catalog is empty (or holds no repositories), the agent gets an empty match
// list with no clue why — so attach an explicit next step pointing at repo_index.
/**
 * @param {any} result
 * @returns {any}
 */
function withSearchRemediation(result) {
  if (result && typeof result === "object" && !result.repositoryCount) {
    return {
      ...result,
      remediation: "No repositories are in the local catalog yet. Call repo_index on the repositories you want to search, then retry repo_search.",
    };
  }
  return result;
}

/**
 * @param {any} map
 * @param {ToolArgs} [args]
 * @returns {object}
 */
function compactCodeMap(map, args = {}) {
  const limit = normalizeLimit(args.limit, 100);
  const filtered = args.domain || args.kind || args.route;
  const files = filterFiles(map.files, args).slice(0, limit).map(summarizeFile);
  return {
    ok: true,
    repo: map.repo,
    cache: map.cache,
    summary: map.summary,
    domains: map.domains.slice(0, 30),
    files: args.includeFiles || filtered ? files : undefined,
    notableFiles: args.includeFiles || filtered ? undefined : map.files.filter(isNotableFile).slice(0, limit).map(summarizeFile),
  };
}

// The domain/kind/route filters fold in the behavior of the retired find_domain,
// find_file_kind, find_backend_route, and find_frontend_api_client tools. The
// route filter replicates findBackendRoute's matching: it checks every controller
// route built from controllerBasePath + each httpMethod path (and the file path),
// so kind:"controller" + route reproduces the backend-route lookup, while
// kind:"apiClient" + route reproduces the frontend-api-client query.
/**
 * @param {any[]} files
 * @param {ToolArgs} [args]
 * @returns {any[]}
 */
function filterFiles(files, args = {}) {
  return files
    .filter((file) => !args.domain || matches(domainSearchText(file), args.domain))
    .filter((file) => !args.kind || file.kind === args.kind)
    .filter((file) => !args.route || matchesRoute(file, args.route));
}

/**
 * @param {any} file
 * @param {string} route
 * @returns {boolean}
 */
function matchesRoute(file, route) {
  const haystacks = [file.path, file.route, file.controllerBasePath, domainSearchText(file), ...(file.imports ?? []), ...(file.exports ?? [])];
  for (const method of file.httpMethods ?? []) {
    haystacks.push(combineRoute(file.controllerBasePath, method.path), method.path, method.method);
  }
  return haystacks.some((value) => matchesPattern(value, route));
}

// Route filter matches as a regex when the value is a valid pattern, otherwise
// falls back to case-insensitive substring matching (findBackendRoute's behavior).
/**
 * @param {unknown} value
 * @param {string} pattern
 * @returns {boolean}
 */
function matchesPattern(value, pattern) {
  const text = String(value ?? "");
  if (!text) {
    return false;
  }
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return matches(text, pattern);
  }
}

/**
 * @param {any} file
 * @returns {string}
 */
function domainSearchText(file) {
  const tags = file.domains?.length ? file.domains : [file.domain];
  return tags.filter(Boolean).join(" ");
}

/**
 * @param {any} file
 * @returns {object}
 */
function summarizeFile(file) {
  return {
    path: file.path,
    kind: file.kind,
    domain: file.domain,
    domains: file.domains ?? (file.domain ? [file.domain] : []),
    route: file.route,
    controllerBasePath: file.controllerBasePath,
    httpMethods: file.httpMethods,
    imports: file.imports.slice(0, 20),
    exports: file.exports.slice(0, 20),
    symbols: file.symbols.slice(0, 20),
  };
}

/**
 * @param {any} file
 * @returns {boolean}
 */
function isNotableFile(file) {
  return ["route", "apiRoute", "controller", "service", "module", "apiClient"].includes(file.kind);
}

/**
 * @param {ToolArgs} [args]
 * @returns {string[]}
 */
function requirePaths(args = {}) {
  if (!Array.isArray(args.paths) || args.paths.length < 2) {
    throw new McpProtocolError(-32602, "paths must contain at least two repository paths");
  }
  return args.paths;
}

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {string}
 */
function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new McpProtocolError(-32602, `${name} is required`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function normalizeLimit(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(number), 500);
}

/**
 * @param {unknown} value
 * @param {unknown} query
 * @returns {boolean}
 */
function matches(value, query) {
  return String(value ?? "")
    .toLowerCase()
    .includes(String(query ?? "").toLowerCase());
}

/**
 * @param {unknown} basePath
 * @param {unknown} methodPath
 * @returns {string}
 */
function combineRoute(basePath, methodPath) {
  const base = normalizeRoutePart(basePath);
  const child = normalizeRoutePart(methodPath);
  return `/${[base, child].filter(Boolean).join("/")}`.replace(/\/+/g, "/");
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeRoutePart(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/^:$/, "");
}

/**
 * @param {string | number | null | undefined} id
 * @param {object} result
 * @returns {object}
 */
function successResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

/**
 * @param {string | number | null | undefined} id
 * @param {number} code
 * @param {string} message
 * @returns {object}
 */
function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/**
 * @param {NodeJS.WritableStream} output
 * @param {object} message
 * @returns {void}
 */
function writeMessage(output, message) {
  output.write(`${JSON.stringify(message)}\n`);
}

class McpProtocolError extends Error {
  /**
   * @param {number} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    /** @type {number} */
    this.code = code;
  }
}
