import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { MODES, render } from "./golden/formatters.mjs";

// Every terminal formatter, rendered from stored input under every renderer
// mode, compared byte for byte with the output recorded in the fixture. The
// glyph migration and the renderer refactors must leave all of it untouched;
// a phase that means to change a formatter's look regenerates the fixture
// with tests/golden/generate-formatters.mjs and reviews the diff.
const golden = JSON.parse(fs.readFileSync(new URL("./fixtures/formatters-golden.json", import.meta.url), "utf8"));

const EXPECTED_FORMATTERS = [
  "context",
  "impact",
  "pass",
  "pass-pr",
  "review",
  "route",
  "doctor",
  "report",
  "summary",
  "discover",
  "index",
  "catalog",
  "search",
  "init",
  "install",
];

test("the golden fixture covers every terminal formatter in every mode", () => {
  const formatters = new Set(golden.cases.map((entry) => entry.formatter));
  for (const formatter of EXPECTED_FORMATTERS) assert.ok(formatters.has(formatter), `no golden case renders ${formatter}`);
  assert.deepEqual(Object.keys(golden.modes).sort(), Object.keys(MODES).sort(), "the fixture was generated with a different set of modes");
  for (const entry of golden.cases) assert.deepEqual(Object.keys(entry.outputs).sort(), Object.keys(MODES).sort(), `${entry.name} is missing a mode`);
});

for (const entry of golden.cases) {
  test(`${entry.name} renders byte-identical to its golden output in every mode`, () => {
    for (const [mode, options] of Object.entries(MODES)) {
      assert.equal(render(entry.formatter, entry.data, options), entry.outputs[mode], `${entry.name} [${mode}] changed`);
    }
  });
}
