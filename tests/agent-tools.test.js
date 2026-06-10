import test from "node:test";
import assert from "node:assert/strict";
import { getAgentTools } from "../src/lib/agent-tools.js";
import { tools } from "../src/lib/mcp.js";

test("getAgentTools derives its catalog from the MCP tools array", () => {
  const catalog = getAgentTools();
  assert.equal(catalog.ok, true);
  assert.equal(catalog.protocol, "repoctx-agent-tools/v0");
  assert.equal(catalog.tools.length, tools.length);

  const names = catalog.tools.map((tool) => tool.name).sort();
  const mcpNames = tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, mcpNames);
});

test("derived input types reflect schema types and required-ness", () => {
  const catalog = getAgentTools();
  const search = catalog.tools.find((tool) => tool.name === "repo_search");
  assert.equal(search.input.query, "string", "required query is not optional");
  assert.equal(search.input.limit, "number?", "optional number gets a ? suffix");

  const discover = catalog.tools.find((tool) => tool.name === "repo_discover");
  assert.equal(discover.input.paths, "string[]?", "array schemas render as <type>[]");
});

test("tools without a dedicated CLI command are flagged mcpOnly", () => {
  const catalog = getAgentTools();
  const findDomain = catalog.tools.find((tool) => tool.name === "find_domain");
  assert.equal(findDomain.mcpOnly, true);
  assert.match(findDomain.command, /tools\/call find_domain/);

  const repoInspect = catalog.tools.find((tool) => tool.name === "repo_inspect");
  assert.equal(repoInspect.mcpOnly, false);
  assert.match(repoInspect.command, /^repoctx /);
});
