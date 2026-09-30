import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { formatTerminalSummary, verifyWrittenFiles } from "../src/lib/output.js";

const input = {
  title: "solumbe init · trust harness setup",
  glyph: "🛠️",
  subtitle: "/tmp/repo",
  facts: /** @type {[string, string | number][]} */ ([
    ["Gates", "harness-driven quality job added to CI"],
    ["Files", 3],
  ]),
  sections: [
    { title: "Created", glyph: "✅", items: [".solumbe/README.md", ".githooks/pre-commit"], kind: /** @type {const} */ ("tree") },
    { title: "Skipped", glyph: "⏭️", items: [] },
    { title: "Next steps", glyph: "📝", items: ["Review the generated workflow before opening a PR."] },
  ],
};

test("a summary is a header, the facts as a table, sections as lists or trees, and the closing line last", () => {
  const unicode = formatTerminalSummary({ ...input, close: { status: "verified" }, options: { glyphs: "unicode", color: false, width: 60 } });
  assert.deepEqual(unicode.split("\n"), [
    "╭──────────────────────────────────────────────────────────╮",
    "│  solumbe init · trust harness setup                        │",
    "│  /tmp/repo                                               │",
    "╰──────────────────────────────────────────────────────────╯",
    "",
    "▾ At a glance",
    "  Gates  harness-driven quality job added to CI",
    "  Files  3",
    "",
    "▾ Created",
    "  ├── .solumbe/README.md",
    "  └── .githooks/pre-commit",
    "",
    "▾ Skipped",
    "  - none",
    "",
    "▾ Next steps",
    "  - Review the generated workflow before opening a PR.",
    "",
    "Verified.",
  ]);

  const ascii = formatTerminalSummary({
    ...input,
    close: { status: "not-verified", detail: ".gitignore did not re-read after writing" },
    options: { emoji: false, color: false, width: 60 },
  });
  // eslint-disable-next-line no-control-regex
  assert.match(ascii.replace("·", "."), /^[\x00-\x7f]*$/, "ascii mode adds no glyph of its own");
  assert.ok(ascii.includes("  |-- .solumbe/README.md\n  `-- .githooks/pre-commit"));
  assert.equal(ascii.split("\n").at(-1), "Not verified - manual check needed: .gitignore did not re-read after writing.");
});

test("the emoji set keeps its section glyphs and bullets", () => {
  const emoji = formatTerminalSummary({ ...input, options: { emoji: true, color: false, width: 60 } });
  for (const mark of ["🛠️  solumbe init", "💬  /tmp/repo", "▾ 📌 At a glance", "▾ ✅ Created", "▾ 📝 Next steps", "  • none"]) {
    assert.ok(emoji.includes(mark), `emoji summary lost ${JSON.stringify(mark)}`);
  }
  assert.doesNotMatch(emoji, /Verified\.|Runs without errors\./, "no closing line unless the caller passes one");
});

test("a long fact wraps under its own column and stays inside the terminal", () => {
  const long = "hook scaffolded (run `git config core.hooksPath .githooks` to enable) and a few more words";
  const out = formatTerminalSummary({ title: "t", facts: [["Pre-commit", long]], options: { glyphs: "unicode", color: false, width: 60 } });
  const facts = out.split("\n").slice(5);
  assert.ok(facts.length >= 2, out);
  assert.match(facts[1], /^ {14}\S/, "continuation lines start under the value column");
  for (const line of facts) assert.ok(line.length <= 60, `over 60 columns: ${line}`);
  assert.equal(facts.join(" ").replace(/\s+/g, " ").trim(), `Pre-commit ${long}`);
});

test("verifyWrittenFiles re-reads every file a writer reports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "solumbe-output-"));
  fs.mkdirSync(path.join(root, "nested"));
  fs.writeFileSync(path.join(root, "a.md"), "a\n");
  fs.writeFileSync(path.join(root, "nested", "b.md"), "b\n");
  fs.writeFileSync(path.join(root, "empty.md"), "");

  assert.deepEqual(verifyWrittenFiles(root, ["a.md", "nested/b.md"]), { status: "verified" });
  assert.deepEqual(verifyWrittenFiles(root, []), { status: "verified" });
  assert.deepEqual(verifyWrittenFiles(root, ["a.md", "missing.md"]), { status: "not-verified", detail: "missing.md did not re-read after writing" });
  assert.deepEqual(verifyWrittenFiles(root, ["empty.md"]), { status: "not-verified", detail: "empty.md did not re-read after writing" });
});
