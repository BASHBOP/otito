export function getAgentTools() {
  return {
    ok: true,
    protocol: "repoctx-agent-tools/v0",
    tools: [
      {
        name: "repo_inspect",
        command: "repoctx repo <path> --json",
        description: "Inspect repository shape, languages, package managers, scripts, entrypoints, and git metadata.",
        input: {
          path: "string",
        },
      },
      {
        name: "dependency_search",
        command: "repoctx deps <package> --query <query> --json",
        description: "Resolve package source through opensrc and search within it.",
        input: {
          package: "string",
          query: "string",
          limit: "number?",
        },
      },
      {
        name: "repo_map",
        command: "repoctx map <path> --json",
        description:
          "Generate a JSON-first AST-backed code map with routes, controllers, services, modules, components, hooks, API clients, DTOs, schemas, imports, exports, symbols, and token estimates.",
        input: {
          path: "string",
        },
      },
      {
        name: "repo_discover",
        command: "repoctx discover <root...> --json",
        description: "Discover repository roots under one or more local directories without indexing them.",
        input: {
          paths: "string[]?",
          depth: "number?",
          limit: "number?",
        },
      },
      {
        name: "repo_index",
        command: "repoctx index <repo...> --json",
        description: "Generate local .dev-context indexes and add repositories to the local catalog.",
        input: {
          paths: "string[]",
          discover: "boolean?",
          catalog: "string?",
        },
      },
      {
        name: "repo_catalog",
        command: "repoctx catalog --json",
        description: "List repositories currently available in the local repoctx catalog.",
        input: {
          catalog: "string?",
        },
      },
      {
        name: "repo_search",
        command: "repoctx search <query> --json",
        description: "Search indexed local repositories by path, domain, kind, route, imports, exports, and symbols.",
        input: {
          query: "string",
          catalog: "string?",
          limit: "number?",
          offline: "boolean?",
        },
      },
      {
        name: "context_pack",
        command: "repoctx context <query> --path <repo> --json",
        description: "Generate a task-aware context packet with primary files, related files, tests, patterns, validation commands, and source evidence.",
        input: {
          query: "string",
          path: "string?",
          limit: "number?",
        },
      },
      {
        name: "repo_harness",
        command: "repoctx harness <path> --json",
        description: "Generate setup, validation, runtime, and context commands for an agent or CI harness, including estimated context tokens.",
        input: {
          path: "string",
        },
      },
      {
        name: "structure_generate",
        command: "repoctx structure <path> --out <file> --json",
        description: "Generate TypeScript structure HTML through code-structure.",
        input: {
          path: "string",
          pattern: "string[]?",
          out: "string?",
        },
      },
      {
        name: "report_generate",
        command: "repoctx report <path> --json",
        description: "Generate a developer-context report with repo facts, tool availability, and adoption guidance.",
        input: {
          path: "string",
        },
      },
      {
        name: "workspace_report_generate",
        command: "repoctx workspace <repo...> --json",
        description: "Generate a product-level report across multiple related repositories.",
        input: {
          paths: "string[]",
        },
      },
    ],
  };
}
