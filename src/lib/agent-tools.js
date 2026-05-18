export function getAgentTools() {
  return {
    ok: true,
    protocol: "dev-context-agent-tools/v0",
    tools: [
      {
        name: "repo_inspect",
        command: "dev-context repo <path> --json",
        description: "Inspect repository shape, languages, package managers, scripts, entrypoints, and git metadata.",
        input: {
          path: "string"
        }
      },
      {
        name: "dependency_search",
        command: "dev-context deps <package> --query <query> --json",
        description: "Resolve package source through opensrc and search within it.",
        input: {
          package: "string",
          query: "string",
          limit: "number?"
        }
      },
      {
        name: "structure_generate",
        command: "dev-context structure <path> --out <file> --json",
        description: "Generate TypeScript structure HTML through code-structure.",
        input: {
          path: "string",
          out: "string?"
        }
      },
      {
        name: "report_generate",
        command: "dev-context report <path> --json",
        description: "Generate a developer-context report with repo facts, tool availability, and adoption guidance.",
        input: {
          path: "string"
        }
      }
    ]
  };
}
