import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";

test("server exposes routes", () => {
  assert.ok(createServer().routes.includes("/health"));
});
