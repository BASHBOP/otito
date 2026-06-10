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

const latestProtocolVersion = "2025-06-18";
// This server's surface (initialize, ping, tools/list, tools/call) is
// identical across these protocol revisions, so we can echo whichever the
// client asks for instead of forcing our latest and triggering a disconnect.
const supportedProtocolVersions = new Set(["2024-11-05", "2025-03-26", latestProtocolVersion]);

function negotiateProtocolVersion(requested) {
  return supportedProtocolVersions.has(requested) ? requested : latestProtocolVersion;
}
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));

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
      "Generate a compact JSON code map for a repository. Writes a local .dev-context/index.json cache into the target repo; the call is idempotent and does not change source files.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository path. Defaults to current working directory." },
        domain: { type: "string", description: "Optional domain filter such as booking, payment, email, events." },
        kind: { type: "string", description: "Optional file kind filter such as route, controller, service, apiClient, component, test." },
        includeFiles: { type: "boolean", description: "Include matching files in the response. Defaults to false." },
        limit: { type: "number", description: "Maximum files to include. Defaults to 100." },
      },
    },
  },
  {
    name: "repo_discover",
    title: "Discover Repositories",
    description: "Discover repository roots under one or more local directories.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "Directories to scan. Defaults to current working directory." },
        depth: { type: "number", description: "Maximum directory depth. Defaults to 4." },
        limit: { type: "number", description: "Maximum repositories to return. Defaults to 100." },
      },
    },
  },
  {
    name: "repo_index",
    title: "Index Repositories",
    description:
      "Generate local .dev-context indexes and add repositories to the local catalog. Mutates the persistent local catalog, so it is not a pure read.",
    annotations: { readOnlyHint: false },
    inputSchema: {
      type: "object",
      properties: {
        paths: { type: "array", items: { type: "string" }, description: "Repository paths, or roots when discover is true." },
        path: { type: "string", description: "Single repository path." },
        discover: { type: "boolean", description: "Discover repositories under the provided paths before indexing." },
        catalog: { type: "string", description: "Optional catalog JSON path." },
        depth: { type: "number", description: "Maximum discovery depth." },
        limit: { type: "number", description: "Maximum discovered repositories." },
      },
    },
  },
  {
    name: "repo_catalog",
    title: "List Catalog",
    description: "List the local repoctx repository catalog.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        catalog: { type: "string", description: "Optional catalog JSON path." },
      },
    },
  },
  {
    name: "repo_search",
    title: "Search Repository Catalog",
    description:
      "Search indexed local repositories by path, domain, kind, route, imports, exports, and symbols. Only searches repositories already in the local catalog — if the catalog is empty this returns no matches, so call repo_index on the target repositories first.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query." },
        catalog: { type: "string", description: "Optional catalog JSON path." },
        limit: { type: "number", description: "Maximum matches. Defaults to 25." },
        offline: { type: "boolean", description: "Use stored index files without refreshing fingerprints." },
      },
      required: ["query"],
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
    name: "pr_merge_readiness",
    title: "PR Merge Readiness",
    description:
      "Gate an open GitHub pull request for merge. Uses `gh` to inspect PR state, review decision, CODEOWNERS approvals (with team-membership), unresolved conversations, branch protection, and status checks, then rolls up into a PASS / WARN / FAIL verdict. Use this when you have a PR on GitHub and need the remote merge-gate verdict. Not to be confused with merge_readiness (the local, no-GitHub gate) or review_pr (the full impact + review + gate composite).",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "PR selector (number, URL, or branch). Defaults to the current branch's PR." },
        path: { type: "string", description: "Repository path. Defaults to current working directory." },
        policy: { type: "string", description: "Policy profile: standard (default), company, or high-risk." },
        governance: { type: "string", description: "Governance: team (default) or solo." },
        request: { type: "string", description: "Optional change request for context evidence output." },
      },
    },
  },
  {
    name: "review_pr",
    title: "Review PR",
    description:
      "Run the full review pipeline in one shot: change_impact plus pr_review plus the merge gate, returning a unified verdict with a derived confidence score. Use this when you want the complete picture of a change in a single call. Not to be confused with pr_review (diff metadata only, no verdict) or merge_readiness / pr_merge_readiness (the gate verdicts alone).",
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
    name: "merge_readiness",
    title: "Merge Readiness",
    description:
      "Check a local working tree for merge readiness without GitHub. Runs deterministic checks (changed files, secret safety, risk-sensitive paths, release discipline, validation commands, dependency audit, policy profile) against a base ref and returns a PASS / WARN / FAIL verdict. Use this when there is no PR yet or no GitHub access. Not to be confused with pr_merge_readiness (the GitHub PR gate) or review_pr (the full impact + review + gate composite).",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repository path. Defaults to current working directory." },
        base: { type: "string", description: "Base ref to diff against. Defaults to origin/main, then HEAD." },
        policy: { type: "string", description: "Policy profile: standard (default), company, or high-risk." },
        governance: { type: "string", description: "Governance: team (default) or solo." },
        request: { type: "string", description: "Optional change request, for context evidence output." },
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
    name: "pr_review",
    title: "PR Review",
    description:
      "Produce PR review context from local git diff metadata, optionally enriched with GitHub PR comments. Use this when you want the raw diff/comment context for a change, not a verdict. Not to be confused with review_pr (the full impact + review + gate composite) or pr_merge_readiness / merge_readiness (the gate verdicts).",
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
  {
    name: "find_domain",
    title: "Find Domain",
    description:
      "Find files related to a domain across one or more repositories. Writes a local .dev-context/index.json cache into each target repo; the call is idempotent and does not change source files.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Single repository path." },
        paths: { type: "array", items: { type: "string" }, description: "Repository paths." },
        domain: { type: "string", description: "Domain to find, such as booking, payment, email, events." },
        limit: { type: "number", description: "Maximum files per repository. Defaults to 100." },
      },
      required: ["domain"],
    },
  },
  {
    name: "find_file_kind",
    title: "Find File Kind",
    description:
      "Find files of a kind across one or more repositories. Writes a local .dev-context/index.json cache into each target repo; the call is idempotent and does not change source files.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Single repository path." },
        paths: { type: "array", items: { type: "string" }, description: "Repository paths." },
        kind: {
          type: "string",
          description: "File kind: route, apiRoute, controller, service, module, component, hook, apiClient, dto, schema, test, source.",
        },
        limit: { type: "number", description: "Maximum files per repository. Defaults to 100." },
      },
      required: ["kind"],
    },
  },
  {
    name: "find_backend_route",
    title: "Find Backend Route",
    description:
      "Find Nest controller routes in a backend repository. Writes a local .dev-context/index.json cache into each target repo; the call is idempotent and does not change source files.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Backend repository path." },
        paths: { type: "array", items: { type: "string" }, description: "Repository paths." },
        query: { type: "string", description: "Optional route/controller query." },
        limit: { type: "number", description: "Maximum route entries. Defaults to 100." },
      },
    },
  },
  {
    name: "find_frontend_api_client",
    title: "Find Frontend API Client",
    description:
      "Find frontend API client files, optionally by domain. Writes a local .dev-context/index.json cache into each target repo; the call is idempotent and does not change source files.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Frontend repository path." },
        paths: { type: "array", items: { type: "string" }, description: "Repository paths." },
        domain: { type: "string", description: "Optional domain such as booking, payment, email." },
        query: { type: "string", description: "Optional file/import/export query." },
        limit: { type: "number", description: "Maximum files. Defaults to 100." },
      },
    },
  },
];

export async function startMcpServer({ input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (error) {
      writeMessage(output, errorResponse(null, -32700, `Parse error: ${error.message}`));
      continue;
    }

    const response = await handleMessage(message);
    if (response) {
      writeMessage(output, response);
    }
  }
}

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
function toolResultText(result) {
  if (result && typeof result === "object" && typeof result.markdown === "string") {
    return result.markdown;
  }
  return JSON.stringify(result);
}

async function dispatchTool(name, args) {
  switch (name) {
    case "repo_inspect":
      return gateInspectScripts(inspectRepo(args.path ?? "."), args.includeScripts);
    case "repo_map":
      return compactCodeMap(getCachedCodeMap(args.path ?? "."), args);
    case "repo_discover":
      return discoverRepositories(args.paths ?? [args.path ?? "."], args);
    case "repo_index":
      return indexRepositories(args.paths ?? [args.path ?? "."], args);
    case "repo_catalog":
      return listCatalog(args);
    case "repo_search":
      return withSearchRemediation(searchCatalog(requiredString(args.query, "query"), args));
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
    case "merge_readiness": {
      return evaluateLocal(args.path ?? ".", {
        base: args.base,
        policy: args.policy,
        governance: args.governance,
        request: args.request,
      });
    }
    case "pr_merge_readiness": {
      return evaluatePR(args.path ?? ".", args.selector ?? "", {
        policy: args.policy,
        governance: args.governance,
        request: args.request,
      });
    }
    case "review_pr": {
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
    case "pr_review": {
      const result = generatePrReview(args.path ?? ".", args);
      return args.includeMarkdown ? result : result.data;
    }
    case "repo_harness": {
      const result = generateHarness(args.path ?? ".", args);
      return args.includeMarkdown ? result : result.data;
    }
    case "find_domain":
      return findDomain(args);
    case "find_file_kind":
      return findFileKind(args);
    case "find_backend_route":
      return findBackendRoute(args);
    case "find_frontend_api_client":
      return findFrontendApiClient(args);
    default:
      throw new McpProtocolError(-32602, `Unknown tool: ${name}`);
  }
}

// repo_search only sees repositories already in the local catalog. When the
// catalog is empty (or holds no repositories), the agent gets an empty match
// list with no clue why — so attach an explicit next step pointing at repo_index.
function withSearchRemediation(result) {
  if (result && typeof result === "object" && !result.repositoryCount) {
    return {
      ...result,
      remediation: "No repositories are in the local catalog yet. Call repo_index on the repositories you want to search, then retry repo_search.",
    };
  }
  return result;
}

function compactCodeMap(map, args = {}) {
  const limit = normalizeLimit(args.limit, 100);
  const files = filterFiles(map.files, args).slice(0, limit).map(summarizeFile);
  return {
    ok: true,
    repo: map.repo,
    cache: map.cache,
    summary: map.summary,
    domains: map.domains.slice(0, 30),
    files: args.includeFiles || args.domain || args.kind ? files : undefined,
    notableFiles: args.includeFiles || args.domain || args.kind ? undefined : map.files.filter(isNotableFile).slice(0, limit).map(summarizeFile),
  };
}

function findDomain(args) {
  const domain = requiredString(args.domain, "domain");
  const limit = normalizeLimit(args.limit, 100);
  return {
    ok: true,
    domain,
    repos: pathList(args).map((repoPath) => {
      const map = getCachedCodeMap(repoPath);
      return {
        repo: map.repo,
        files: map.files
          .filter((file) => matches(domainSearchText(file), domain))
          .slice(0, limit)
          .map(summarizeFile),
      };
    }),
  };
}

function findFileKind(args) {
  const kind = requiredString(args.kind, "kind");
  const limit = normalizeLimit(args.limit, 100);
  return {
    ok: true,
    kind,
    repos: pathList(args).map((repoPath) => {
      const map = getCachedCodeMap(repoPath);
      return {
        repo: map.repo,
        files: map.files
          .filter((file) => file.kind === kind)
          .slice(0, limit)
          .map(summarizeFile),
      };
    }),
  };
}

function findBackendRoute(args) {
  const query = args.query;
  const limit = normalizeLimit(args.limit, 100);
  const routes = [];
  for (const repoPath of pathList(args)) {
    const map = getCachedCodeMap(repoPath);
    for (const file of map.files.filter((entry) => entry.kind === "controller")) {
      for (const method of file.httpMethods) {
        const route = combineRoute(file.controllerBasePath, method.path);
        const item = {
          repo: map.repo.name,
          file: file.path,
          controllerBasePath: file.controllerBasePath,
          method: method.method,
          route,
        };
        if (!query || matches(`${file.path} ${route} ${method.method}`, query)) {
          routes.push(item);
        }
      }
    }
  }
  return { ok: true, query, routes: routes.slice(0, limit) };
}

function findFrontendApiClient(args) {
  const limit = normalizeLimit(args.limit, 100);
  const query = args.query ?? args.domain;
  return {
    ok: true,
    query,
    repos: pathList(args).map((repoPath) => {
      const map = getCachedCodeMap(repoPath);
      return {
        repo: map.repo,
        files: map.files
          .filter((file) => file.kind === "apiClient")
          .filter((file) => !query || matches(`${file.path} ${domainSearchText(file)} ${file.imports.join(" ")} ${file.exports.join(" ")}`, query))
          .slice(0, limit)
          .map(summarizeFile),
      };
    }),
  };
}

function filterFiles(files, args = {}) {
  return files.filter((file) => !args.domain || matches(domainSearchText(file), args.domain)).filter((file) => !args.kind || file.kind === args.kind);
}

function domainSearchText(file) {
  const tags = file.domains?.length ? file.domains : [file.domain];
  return tags.filter(Boolean).join(" ");
}

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

function isNotableFile(file) {
  return ["route", "apiRoute", "controller", "service", "module", "apiClient"].includes(file.kind);
}

function pathList(args = {}) {
  if (Array.isArray(args.paths) && args.paths.length > 0) {
    return args.paths;
  }
  if (typeof args.path === "string" && args.path) {
    return [args.path];
  }
  return ["."];
}

function requirePaths(args = {}) {
  if (!Array.isArray(args.paths) || args.paths.length < 2) {
    throw new McpProtocolError(-32602, "paths must contain at least two repository paths");
  }
  return args.paths;
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new McpProtocolError(-32602, `${name} is required`);
  }
  return value;
}

function normalizeLimit(value, fallback) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(number), 500);
}

function matches(value, query) {
  return String(value ?? "")
    .toLowerCase()
    .includes(String(query ?? "").toLowerCase());
}

function combineRoute(basePath, methodPath) {
  const base = normalizeRoutePart(basePath);
  const child = normalizeRoutePart(methodPath);
  return `/${[base, child].filter(Boolean).join("/")}`.replace(/\/+/g, "/");
}

function normalizeRoutePart(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/^:$/, "");
}

function successResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function writeMessage(output, message) {
  output.write(`${JSON.stringify(message)}\n`);
}

class McpProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
