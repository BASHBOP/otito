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
  for (const needle of ["Report Name", "A section", "a bullet with a number 42", "a caveat worth keeping"]) {
    assert.ok(rendered.includes(needle), `lost: ${needle}`);
  }
  // Table cells are padded so the columns line up; every cell is still there, in order.
  assert.ok(rendered.includes("| Col | Val |"));
  assert.ok(rendered.includes("| --- | --: |"));
  assert.ok(rendered.includes("| x   | 1   |"));
});

test("table columns are aligned by padding, and nothing is removed", () => {
  const markdown = ["| Tool | Role | Notes |", "|---|---|:-:|", "| rg | search | fast |", "| code-structure | structure HTML | 日本語 |"].join("\n");
  const rendered = renderDocument(markdown, {}, plain()).split("\n");
  assert.deepEqual(rendered, [
    "| Tool           | Role           | Notes  |",
    "|----------------|----------------|:------:|",
    "| rg             | search         | fast   |",
    "| code-structure | structure HTML | 日本語 |",
  ]);
  // Every source character survives, in order, once the padding is ignored.
  const squash = (/** @type {string} */ text) => text.replace(/[ -]+/g, "");
  assert.equal(squash(rendered.join("\n")), squash(markdown));
});

test("a table is left untouched when its rows disagree, or a pipe is content", () => {
  const ragged = ["| a | b |", "| --- | --- |", "| only one |"].join("\n");
  assert.equal(renderDocument(ragged, {}, plain()), ragged);

  // An escaped pipe and a pipe inside a code span are content, not separators.
  const piped = ["| Pattern | Meaning |", "| --- | --- |", "| `a|b` | either |", "| x \\| y | escaped |"].join("\n");
  assert.deepEqual(renderDocument(piped, {}, plain()).split("\n"), [
    "| Pattern | Meaning |",
    "| ------- | ------- |",
    "| `a|b`   | either  |",
    "| x \\| y  | escaped |",
  ]);

  // An unclosed code span cannot be split safely, so the whole table stays as written.
  const unclosed = ["| a | b |", "| --- | --- |", "| `oops | c |"].join("\n");
  assert.equal(renderDocument(unclosed, {}, plain()), unclosed);

  // A table inside a fence is code.
  const fenced = ["```", "| a | b |", "| --- | --- |", "| long cell | c |", "```"].join("\n");
  assert.equal(renderDocument(fenced, {}, plain()), fenced);
});

test("the closing line is appended last, exactly once", () => {
  const rendered = renderDocument("# T\n\n## Section\n\ntext", { title: "T", close: { status: "runs" } }, plain()).split("\n");
  assert.equal(rendered.at(-1), "Runs without errors.");
  assert.equal(rendered.at(-2), "");
  assert.equal(rendered.filter((line) => line === "Runs without errors.").length, 1);

  const failing = renderDocument("body", { close: { status: "not-verified", detail: "risk accuracy" } }, createRenderer({ color: false, glyphs: "unicode" }));
  assert.equal(failing.split("\n").at(-1), "Not verified — manual check needed: risk accuracy.");
  assert.equal(renderDocument("body", {}, plain()), "body", "no closing line unless the command passes one");
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
