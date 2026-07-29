import test from "node:test";
import assert from "node:assert/strict";
import { getAgentTools } from "../src/lib/agent-tools.js";
import { tools } from "../src/lib/mcp.js";

test("getAgentTools derives its catalog from the MCP tools array", () => {
  const catalog = getAgentTools();
  assert.equal(catalog.ok, true);
  assert.equal(catalog.protocol, "otito-agent-tools/v1");
  assert.equal(catalog.tools.length, tools.length);

  const names = catalog.tools.map((tool) => tool.name).sort();
  const mcpNames = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, mcpNames);
});

test("the v2 surface is exactly 13 tools and drops the retired names", () => {
  const catalog = getAgentTools();
  const names = catalog.tools.map((tool) => tool.name);
  assert.equal(names.length, 13, `agent-tools must expose exactly 13 tools, got ${names.length}: ${names.join(", ")}`);
  for (const retired of [
    "repo_discover",
    "repo_catalog",
    "find_domain",
    "find_file_kind",
    "find_backend_route",
    "find_frontend_api_client",
    "pr_review",
    "review_pr",
    "merge_readiness",
    "pr_merge_readiness",
  ]) {
    assert.ok(!names.includes(retired), `retired tool must not appear: ${retired}`);
  }
  for (const canonical of ["review_context", "review_gate", "review_verdict", "agent_experience", "convergence_score"]) {
    assert.ok(names.includes(canonical), `missing canonical tool: ${canonical}`);
  }
});

test("derived input types reflect schema types and required-ness", () => {
  const catalog = getAgentTools();
  const workspace = catalog.tools.find((tool) => tool.name === "workspace_report");
  assert.equal(workspace.input.paths, "string[]", "required array schemas render as <type>[] with no ? suffix");
  assert.equal(workspace.input.includeMarkdown, "boolean?", "optional booleans get a ? suffix");

  const search = catalog.tools.find((tool) => tool.name === "repo_search");
  // query is now optional (no query → catalog listing).
  assert.equal(search.input.query, "string?", "repo_search query is optional in v2");
  assert.equal(search.input.limit, "number?", "optional number gets a ? suffix");
});

test("every v2 tool has a dedicated CLI command, so none are flagged mcpOnly", () => {
  const catalog = getAgentTools();
  for (const tool of catalog.tools) {
    assert.equal(tool.mcpOnly, false, `${tool.name} should map to a CLI command`);
    assert.match(tool.command, /^otito /, `${tool.name} command should be a otito invocation`);
  }
});
