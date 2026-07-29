import assert from "node:assert/strict";
import test from "node:test";
import { add } from "../src/index.js";

test("add returns the sum", () => {
  assert.equal(add(20, 22), 42);
});
