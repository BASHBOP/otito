import { tools } from "./mcp.js";

// CLI command that backs each MCP tool, when one exists. Tools without an entry
// here are surfaced over MCP only, so their invocation is reported as the mcp
// tools/call form instead of a bare command.
/** @type {Record<string, string>} */
const cliCommandByTool = {
  repo_inspect: "otito repo <path> --json",
  repo_map: "otito map <path> --json",
  repo_index: "otito index <repo...> --json",
  repo_search: "otito search <query> --json",
  context_pack: "otito context <query> --path <repo> --json",
  change_impact: "otito impact <query> --path <repo> --json",
  agent_experience: "otito ax <query> --path <repo> --json",
  convergence_score: "otito converge <query> --base <ref> --path <repo> --json",
  review_gate: "otito gate [--pr <selector>] --path <repo> --json",
  review_verdict: "otito review --path <repo> --json",
  workspace_report: "otito workspace <repo...> --json",
  review_context: "otito pr <path> --json",
  repo_harness: "otito harness <path> --json",
};

// The MCP tools array in mcp.js is the single source of truth for the tool
// surface. Derive the agent-tools catalog from it so the two never drift; a
// parity test guards that every MCP tool appears here with matching options.
export function getAgentTools() {
  return {
    ok: true,
    protocol: "otito-agent-tools/v1",
    tools: tools.map(deriveAgentTool),
  };
}

/**
 * @param {import('./mcp.js').McpTool} tool
 */
function deriveAgentTool(tool) {
  return {
    name: tool.name,
    command: cliCommandByTool[tool.name] ?? `otito mcp (tools/call ${tool.name})`,
    mcpOnly: !(tool.name in cliCommandByTool),
    description: tool.description,
    input: deriveInput(tool.inputSchema),
  };
}

/**
 * A minimal JSON-schema fragment as used by the MCP tool definitions.
 * @typedef {object} JsonSchemaNode
 * @property {string} [type]
 * @property {JsonSchemaNode} [items]
 * @property {Record<string, JsonSchemaNode>} [properties]
 * @property {string[]} [required]
 */

/**
 * @param {JsonSchemaNode | undefined} inputSchema
 * @returns {Record<string, string>}
 */
function deriveInput(inputSchema) {
  const properties = inputSchema?.properties ?? {};
  const required = new Set(inputSchema?.required ?? []);
  /** @type {Record<string, string>} */
  const input = {};
  for (const [name, schema] of Object.entries(properties)) {
    const optional = required.has(name) ? "" : "?";
    input[name] = `${schemaType(schema)}${optional}`;
  }
  return input;
}

/**
 * @param {JsonSchemaNode | undefined} schema
 * @returns {string}
 */
function schemaType(schema) {
  if (schema?.type === "array") {
    return `${schemaType(schema.items)}[]`;
  }
  return schema?.type ?? "string";
}
