#!/usr/bin/env node
// Regenerate tests/fixtures/render-fancy-golden.json: the renderer's header,
// verdict, statusLine, bullet, tip, section and rule output in every glyph
// mode, with and without colour, at 60 and 78 columns.
//
//   node tests/golden/generate-render-fancy.mjs
//
// Run it only when the renderer's output is meant to change, and review the
// fixture diff in the same PR.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cases, renderAll } from "./render-fancy.mjs";

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "render-fancy-golden.json");
const out = {
  generatedFrom: "tests/golden/generate-render-fancy.mjs",
  note: "Pinned renderer output. Phase 1 recorded the emoji and ascii sets as they were before glyph modes existed; phase 3 regenerated the file for the box width fix (O13: content lines are as wide as the borders) and added the unicode set.",
  cases: cases().map(({ id, options }) => ({ id, options, outputs: renderAll(options) })),
};
fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
process.stderr.write(`${out.cases.length} cases -> ${path.relative(process.cwd(), target)}\n`);
