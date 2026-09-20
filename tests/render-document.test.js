import test from "node:test";
import assert from "node:assert/strict";

import { renderDocument } from "../src/lib/render/document.js";
import { createRenderer } from "../src/lib/render/fancy.js";

const plain = () => createRenderer({ color: false, emoji: false });
const coloured = () => createRenderer({ color: true, emoji: false });

test("every line of the source report still reaches the terminal", () => {
  // The whole contract of this renderer is that it changes presentation and
  // never content, so anything that greps otito's output keeps working.
  const markdown = [
    "# Report Name",
    "",
    "## A section",
    "",
    "- a bullet with a number 42",
    "- another bullet",
    "",
    "| Col | Val |",
    "| --- | --: |",
    "| x | 1 |",
    "",
    "> a caveat worth keeping",
  ].join("\n");

  const rendered = renderDocument(markdown, { title: "SOMETHING ELSE" }, plain());
  for (const needle of ["Report Name", "A section", "a bullet with a number 42", "| x | 1 |", "a caveat worth keeping"]) {
    assert.ok(rendered.includes(needle), `lost: ${needle}`);
  }
});

test("a top-level heading survives unless the header box already says it", () => {
  const markdown = "# Code Map\n\n- Root: /tmp";

  // The box says the same thing, so the heading would read twice.
  const duplicated = renderDocument(markdown, { title: "CODE MAP   fixture" }, plain());
  assert.equal(duplicated.match(/Code Map/gi)?.length, 1);

  // The heading is more specific than the box, so it must be kept.
  const distinct = renderDocument("# Tool Evaluation Matrix\n\n| a | b |", { title: "TOOL MATRIX" }, plain());
  assert.ok(distinct.includes("Tool Evaluation Matrix"));
});

test("no line is left with trailing whitespace", () => {
  const rendered = renderDocument("# T\n\n## Section\n\ntext", { title: "T" }, plain());
  for (const line of rendered.split("\n")) {
    assert.equal(line, line.replace(/\s+$/, ""), `trailing whitespace on: ${JSON.stringify(line)}`);
  }
});

test("colour is opt-in, so piped output stays plain", () => {
  const markdown = "# T\n\n## Section\n\n> caveat\n\n```\ncode\n```";
  const off = renderDocument(markdown, { title: "T" }, plain());
  assert.equal(off.includes(String.fromCharCode(27)), false);

  const on = renderDocument(markdown, { title: "T" }, coloured());
  assert.ok(on.includes(String.fromCharCode(27)));
});

test("fenced code is passed through verbatim", () => {
  const markdown = ["## Commands", "", "```bash", "npm run quality && echo '# not a heading'", "```"].join("\n");
  const rendered = renderDocument(markdown, { title: "T" }, plain());
  // A `#` inside a fence is code, not a heading, and must not be rewritten.
  assert.ok(rendered.includes("npm run quality && echo '# not a heading'"));
});

test("an empty or missing report does not throw", () => {
  assert.equal(typeof renderDocument("", { title: "T" }, plain()), "string");
  assert.equal(typeof renderDocument(undefined, { title: "T" }, plain()), "string");
  assert.equal(typeof renderDocument("body only", {}, plain()), "string");
});
