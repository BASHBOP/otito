import { tools } from "./mcp.js";

// CLI command that backs each MCP tool, when one exists. Tools without an entry
// here are surfaced over MCP only, so their invocation is reported as the mcp
// tools/call form instead of a bare command.
/** @type {Record<string, string>} */
const cliCommandByTool = {
  repo_inspect: "repoctx repo <path> --json",
  repo_map: "repoctx map <path> --json",
  repo_index: "repoctx index <repo...> --json",
  repo_search: "repoctx search <query> --json",
  context_pack: "repoctx context <query> --path <repo> --json",
  change_impact: "repoctx impact <query> --path <repo> --json",
  review_gate: "repoctx gate [--pr <selector>] --path <repo> --json",
  review_verdict: "repoctx review --path <repo> --json",
  workspace_report: "repoctx workspace <repo...> --json",
  review_context: "repoctx pr <path> --json",
  repo_harness: "repoctx harness <path> --json",
};

// The MCP tools array in mcp.js is the single source of truth for the tool
// surface. Derive the agent-tools catalog from it so the two never drift; a
// parity test guards that every MCP tool appears here with matching options.
export function getAgentTools() {
  return {
    ok: true,
    protocol: "repoctx-agent-tools/v0",
    tools: tools.map(deriveAgentTool),
  };
}

/**
 * @param {import('./mcp.js').McpTool} tool
 */
function deriveAgentTool(tool) {
  return {
    name: tool.name,
    command: cliCommandByTool[tool.name] ?? `repoctx mcp (tools/call ${tool.name})`,
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
