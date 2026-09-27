import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cases as goldenCases, renderAll } from "./golden/render-fancy.mjs";
import { createRenderer, padRight, resolveGlyphMode, shouldUseColor, shouldUseEmoji, visualWidth, wrap, wrapBoxed } from "../src/lib/render/fancy.js";

test("shouldUseEmoji respects explicit options first", () => {
  assert.equal(shouldUseEmoji({}, { emoji: true }), true);
  assert.equal(shouldUseEmoji({}, { emoji: false }), false);
});

test("shouldUseEmoji disables when NO_EMOJI=1 or CI=true", () => {
  assert.equal(shouldUseEmoji({ NO_EMOJI: "1" }), false);
  assert.equal(shouldUseEmoji({ CI: "true" }), false);
  assert.equal(shouldUseEmoji({}), true);
});

test("explicit color options keep renderer tests stable when color is forced", () => {
  const env = { FORCE_COLOR: "1" };
  assert.equal(shouldUseColor(env), true);
  assert.equal(shouldUseColor(env, { color: false }), false);
  assert.equal(shouldUseColor(env, { color: true }), true);
});

test("header uses Unicode box drawing and includes title text", () => {
  // The assertions describe visible box geometry, not terminal escape bytes.
  const r = createRenderer({ emoji: true, color: false, width: 60 });
  const out = r.header({ text: "otito doctor", glyph: "📋" });
  assert.match(out, /^╭/);
  assert.match(out, /╯$/);
  assert.match(out, /otito doctor/);
  assert.match(out, /📋/);
});

test("header in plain mode strips glyphs and uses ASCII box", () => {
  const r = createRenderer({ emoji: false, color: false, width: 60 });
  const out = r.header({ text: "otito doctor", glyph: "📋" });
  assert.match(out, /^\+/);
  assert.match(out, /\+$/);
  assert.match(out, /otito doctor/);
  assert.ok(!out.includes("📋"), "plain mode should drop the title glyph");
});

test("statusLine renders fancy status glyphs and details", () => {
  const r = createRenderer({ emoji: true, width: 78 });
  const out = r.statusLine("pass", "node", "v22.12.0");
  assert.match(out, /✅/);
  assert.match(out, /node/);
  assert.match(out, /v22\.12\.0/);
});

test("statusLine in plain mode uses bracketed tokens and renders details", () => {
  const r = createRenderer({ emoji: false, width: 78 });
  const out = r.statusLine("warn", "rg", "not installed", ["Install ripgrep for faster searches."]);
  assert.match(out, /\[WARN\]/);
  assert.match(out, /not installed/);
  assert.match(out, /Install ripgrep/);
});

test("verdict block surfaces verdict and blocked-by", () => {
  const r = createRenderer({ emoji: false, width: 60 });
  const out = r.verdict({ verdict: "FAIL", blockedBy: "Review state", nextStep: "request review" });
  assert.match(out, /\[FAIL\]/);
  assert.match(out, /Review state/);
  assert.match(out, /request review/);
});

test("tip and bullet stay legible in plain mode", () => {
  const r = createRenderer({ emoji: false, width: 78 });
  assert.match(r.tip("optional accelerators"), /\[i\]/);
  assert.match(r.tip("optional accelerators"), /optional accelerators/);
  assert.match(r.bullet("first item"), /\* first item/);
});

test("named themes survive the CLI's always-present undefined emoji/color options", () => {
  // The CLI always passes emoji/color explicitly; they are undefined when no
  // flag is set. Those undefined keys must NOT clobber the theme's defaults.
  const minimal = createRenderer({ emoji: undefined, color: undefined, theme: "minimal" });
  assert.equal(minimal.emoji, false);
  assert.equal(minimal.color, false);

  const colorTheme = createRenderer({ emoji: undefined, color: undefined, theme: "color" });
  assert.equal(colorTheme.color, true);

  const hc = createRenderer({ emoji: undefined, color: undefined, theme: "high-contrast" });
  // high-contrast keeps its bright palette and no longer forces emoji.
  assert.equal(hc.emoji, false);
  assert.equal(hc.color, true);
});

test("explicit emoji/color options still override the selected theme", () => {
  // minimal forces both off, but an explicit flag must win.
  assert.equal(createRenderer({ theme: "minimal", emoji: true }).emoji, true);
  assert.equal(createRenderer({ theme: "color", color: false }).color, false);
});

test("renderer width clamps to a sensible terminal size", () => {
  assert.equal(createRenderer({ width: 30 }).width, 60);
  assert.equal(createRenderer({ width: 999 }).width, 120);
  assert.equal(createRenderer({ width: 90 }).width, 90);
});

// ---------------------------------------------------------------------------
// Glyph modes, display width and the Vibe primitives.

const ESC = String.fromCharCode(27);
// eslint-disable-next-line no-control-regex
const strip = (/** @type {string} */ text) => text.replace(/\x1b\[[0-9;]*m/g, "");
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

/**
 * Run `fn` with process.env patched, then restore it. `undefined` deletes a key.
 * @param {Record<string, string | undefined>} patch
 * @param {() => void} fn
 */
function withEnv(patch, fn) {
  const saved = {};
  for (const key of Object.keys(patch)) {
    saved[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

const quietEnv = { CI: undefined, NO_EMOJI: undefined, NO_COLOR: undefined, FORCE_COLOR: undefined, CLICOLOR: undefined };

test("glyph mode resolves from env and flags: unicode by default, ascii for logs, emoji on request", () => {
  // Nothing set: the interactive default.
  assert.equal(resolveGlyphMode({}, {}), "unicode");
  assert.equal(resolveGlyphMode({ TERM: "xterm-256color" }, {}), "unicode");
  // Logs and terminals that cannot draw get ascii.
  assert.equal(resolveGlyphMode({ CI: "1" }, {}), "ascii");
  assert.equal(resolveGlyphMode({ CI: "true" }, {}), "ascii");
  assert.equal(resolveGlyphMode({ NO_EMOJI: "1" }, {}), "ascii");
  assert.equal(resolveGlyphMode({ NO_EMOJI: "true" }, {}), "ascii");
  assert.equal(resolveGlyphMode({ TERM: "dumb" }, {}), "ascii");
  // Explicit flags beat the environment both ways.
  assert.equal(resolveGlyphMode({}, { emoji: false }), "ascii");
  assert.equal(resolveGlyphMode({}, { emoji: true }), "emoji");
  assert.equal(resolveGlyphMode({ CI: "1" }, { emoji: true }), "emoji");
  assert.equal(resolveGlyphMode({ TERM: "dumb", NO_EMOJI: "1" }, { emoji: true }), "emoji");
  // An explicit glyph set wins over everything.
  assert.equal(resolveGlyphMode({ CI: "1", NO_EMOJI: "1", TERM: "dumb" }, { glyphs: "unicode" }), "unicode");
  assert.equal(resolveGlyphMode({}, { glyphs: "unicode", emoji: true }), "unicode");
  assert.equal(resolveGlyphMode({}, { glyphs: "ascii", emoji: true }), "ascii");
  assert.equal(resolveGlyphMode({}, { glyphs: "emoji", emoji: false }), "emoji");
  // An unknown glyph set falls back to the environment.
  assert.equal(resolveGlyphMode({ CI: "1" }, { glyphs: /** @type {any} */ ("neon") }), "ascii");
  assert.equal(resolveGlyphMode({}, { glyphs: /** @type {any} */ ("neon") }), "unicode");
});

test("createRenderer resolves the glyph mode across env, flags and themes", () => {
  const quiet = { ...quietEnv, TERM: undefined };
  withEnv(quiet, () => {
    assert.equal(createRenderer({}).glyphMode, "unicode");
    assert.equal(createRenderer({ theme: "default" }).glyphMode, "unicode");
    assert.equal(createRenderer({ theme: "color" }).glyphMode, "unicode");
    assert.equal(createRenderer({ theme: "minimal" }).glyphMode, "ascii");
    assert.equal(createRenderer({ theme: "high-contrast" }).glyphMode, "unicode");
    // The CLI's always-present undefined keys must not disturb the theme.
    assert.equal(createRenderer({ emoji: undefined, color: undefined, theme: "minimal" }).glyphMode, "ascii");
    // Explicit options beat the theme.
    assert.equal(createRenderer({ theme: "minimal", emoji: true }).glyphMode, "emoji");
    assert.equal(createRenderer({ theme: "high-contrast", emoji: true }).glyphMode, "emoji");
    assert.equal(createRenderer({ theme: "high-contrast", emoji: false }).glyphMode, "ascii");
    assert.equal(createRenderer({ theme: "minimal", glyphs: "unicode" }).glyphMode, "unicode");
  });
  for (const patchEnv of [{ CI: "1" }, { NO_EMOJI: "1" }, { TERM: "dumb" }]) {
    withEnv({ ...quiet, ...patchEnv }, () => {
      const label = JSON.stringify(patchEnv);
      assert.equal(createRenderer({}).glyphMode, "ascii", label);
      assert.equal(createRenderer({ theme: "high-contrast" }).glyphMode, "ascii", `${label}: the theme no longer forces emoji`);
      assert.equal(createRenderer({ emoji: true }).glyphMode, "emoji", label);
      assert.equal(createRenderer({ glyphs: "unicode" }).glyphMode, "unicode", label);
    });
  }
});

test("the high-contrast theme keeps its bright palette in every glyph mode", () => {
  const hc = createRenderer({ theme: "high-contrast", glyphs: "unicode" });
  assert.equal(hc.color, true);
  assert.equal(hc.paint("x", "green"), `${ESC}[92mx${ESC}[0m`);
});

test("renderer.emoji and renderer.glyphs follow the resolved mode", () => {
  for (const mode of /** @type {const} */ (["unicode", "ascii", "emoji"])) {
    const r = createRenderer({ glyphs: mode, color: false });
    assert.equal(r.glyphMode, mode);
    assert.equal(r.emoji, mode === "emoji");
    for (const key of ["status", "verdict", "box", "tree", "marks", "arrow", "bullet", "section", "tip", "dash", "listDash"]) {
      assert.ok(key in r.glyphs, `${mode} glyph set is missing ${key}`);
    }
    assert.deepEqual(Object.keys(r.glyphs.tree).sort(), ["branch", "last", "pipe"]);
    assert.deepEqual(Object.keys(r.glyphs.status).sort(), ["fail", "info", "pass", "warn"]);
  }
  assert.deepEqual(createRenderer({ glyphs: "unicode" }).glyphs.status, { pass: "✓", warn: "!", fail: "✗", info: "·" });
  assert.deepEqual(createRenderer({ glyphs: "ascii" }).glyphs.tree, { branch: "|--", last: "`--", pipe: "|" });
  assert.equal(createRenderer({ glyphs: "ascii" }).glyphs.arrow, "->");
  assert.equal(createRenderer({ glyphs: "unicode" }).glyphs.arrow, "→");
  assert.equal(createRenderer({ glyphs: "emoji" }).glyphs.tip, "💡");
});

test("visualWidth measures box drawing, arrows and ticks as one cell", () => {
  assert.equal(visualWidth("╭─╮"), 3);
  assert.equal(visualWidth("│  x  │"), 7);
  assert.equal(visualWidth("├── a"), 5);
  assert.equal(visualWidth("└── b"), 5);
  assert.equal(visualWidth("→"), 1);
  assert.equal(visualWidth("Scan → Questions"), 16);
  assert.equal(visualWidth("✓"), 1);
  assert.equal(visualWidth("✗"), 1);
  assert.equal(visualWidth("•"), 1);
  assert.equal(visualWidth("▾"), 1);
  assert.equal(visualWidth("❯"), 1);
  assert.equal(visualWidth("—"), 1);
});

test("visualWidth measures CJK and emoji as two cells", () => {
  assert.equal(visualWidth("日本語"), 6);
  assert.equal(visualWidth("한글"), 4);
  assert.equal(visualWidth("ｆｕｌｌ"), 8);
  assert.equal(visualWidth("🚦"), 2);
  assert.equal(visualWidth("✅"), 2);
  assert.equal(visualWidth("❌"), 2);
  assert.equal(visualWidth("⛔"), 2);
  assert.equal(visualWidth("📝"), 2);
  assert.equal(visualWidth("🧪 EVAL"), 7);
  // The emoji presentation selector makes a narrow base draw as a wide emoji.
  assert.equal(visualWidth("⚠️ "), 3);
  assert.equal(visualWidth("ℹ️ "), 3);
  assert.equal(visualWidth("⚠"), 1);
});

test("visualWidth ignores ANSI escapes, combining marks and zero-width joiners", () => {
  assert.equal(visualWidth(`${ESC}[32mok${ESC}[0m`), 2);
  assert.equal(visualWidth(`${ESC}[1m${ESC}[33m✓ done${ESC}[0m`), 6);
  assert.equal(visualWidth("é"), 1);
  assert.equal(visualWidth("a‍b"), 2);
  assert.equal(visualWidth(""), 0);
});

test("padRight pads to the display width, so lines with box drawing line up", () => {
  assert.equal(visualWidth(padRight("╭─╮", 6)), 6);
  assert.equal(padRight("→ go", 6), "→ go  ");
  assert.equal(padRight("日本", 6), "日本  ");
  assert.equal(padRight("too wide", 3), "too wide");
});

test("every line of a box has the same display width", () => {
  // O13: content lines used to be padded to width - 4 inside a six-cell frame,
  // so they came out two cells wider than the borders. Arrows, ticks and CJK
  // were also mis-measured (O1), which moved the right border again.
  const long = "a reason that keeps going well past the box so the line has to wrap onto another line";
  for (const mode of /** @type {const} */ (["unicode", "ascii", "emoji"])) {
    for (const width of [60, 78, 120]) {
      const r = createRenderer({ glyphs: mode, color: false, width });
      const boxes = [
        r.header("Scan → Questions ✓", ["日本語 subtitle", "plain ascii line"]),
        r.header({ text: "otito repo · repository overview", glyph: "📦" }, [{ text: long, glyph: "💬" }]),
        r.verdict({ verdict: "PASS" }),
        r.verdict({ verdict: "WARN", nextStep: "run the validation plan" }),
        r.verdict({ verdict: "FAIL", blockedBy: long, nextStep: "/a/path/with/no/spaces/that/is/longer/than/the/box/is/wide/by/quite/a/lot/really/it/is.ts" }),
      ];
      for (const box of boxes) {
        const widths = new Set(box.split("\n").map(visualWidth));
        assert.deepEqual([...widths], [width], `${mode}@${width}: ${JSON.stringify(box.split("\n"))}`);
      }
    }
  }
});

test("wrap breaks on display width and never splits a word", () => {
  assert.deepEqual(wrap("a bb ccc", 4), ["a bb", "ccc"]);
  assert.deepEqual(wrap("short", 40), ["short"]);
  assert.deepEqual(wrap("", 10), [""]);
  assert.deepEqual(wrap("supercalifragilistic is long", 10), ["supercalifragilistic", "is long"]);
  assert.deepEqual(wrap("日本語 日本語 日本語", 13), ["日本語 日本語", "日本語"]);
});

/**
 * Render every primitive once with the given renderer.
 * @param {ReturnType<typeof createRenderer>} r
 */
function renderEverything(r) {
  return [
    r.header({ text: "otito setup", glyph: "🛠️" }, [{ text: "a subtitle", glyph: "💬" }, "plain line"]),
    r.statusLine("pass", "node", "v22"),
    r.statusLine("warn", "rg", "missing", ["install it"]),
    r.statusLine("fail", "git", "missing"),
    r.statusLine("info", "note", "fyi"),
    r.verdict({ verdict: "PASS" }),
    r.verdict({ verdict: "WARN", blockedBy: "review", nextStep: "ask" }),
    r.verdict({ verdict: "FAIL", blockedBy: "secret", nextStep: "rotate" }),
    r.bullet("item"),
    r.bullet("item with glyph", "🔥"),
    r.tip("a tip"),
    r.section("Section", ["one", "two"]),
    r.rule(),
    r.table(
      [
        ["Stack", "Node 22, npm"],
        ["CI", ".github/workflows/ci.yml"],
      ],
      { head: ["Check", "Found"] },
    ),
    r.tree(["a", { label: "b", children: ["c", { label: "d", children: ["e"] }] }, "f"]),
    r.flow(["Scan", "Questions", "Preview"], "Questions"),
    r.code("npm test"),
    r.ref("src/cli.js", 42),
    r.list([
      ["otito gate", "runs the gate"],
      ["otito context", "builds a context pack"],
    ]),
    r.phase("scan"),
    r.phase("questions", { done: true }),
    r.close({ status: "verified" }),
    r.close({ status: "tests-pass" }),
    r.close({ status: "runs" }),
    r.close({ status: "not-verified", detail: "the hook" }),
  ].join("\n");
}

test("unicode mode never emits an Extended_Pictographic character", () => {
  const r = createRenderer({ glyphs: "unicode", color: false, width: 80 });
  const out = renderEverything(r);
  assert.ok(!PICTOGRAPHIC.test(out), `found ${out.match(PICTOGRAPHIC)?.[0]} in unicode output`);
  const leaves = JSON.stringify(r.glyphs);
  assert.ok(!PICTOGRAPHIC.test(leaves), "the unicode glyph table itself carries a pictographic mark");
  // The header glyph and bullet glyph passed by callers are emoji; unicode drops them.
  assert.ok(!out.includes("🛠"));
  assert.ok(!out.includes("🔥"));
  assert.ok(out.includes("otito setup"));
});

test("ascii mode output is pure ASCII", () => {
  const out = renderEverything(createRenderer({ glyphs: "ascii", color: false, width: 80 }));
  // eslint-disable-next-line no-control-regex
  assert.match(out, /^[\x00-\x7f]*$/, `non-ASCII in ascii mode: ${out.match(/[^\x00-\x7f]/)?.[0]}`);
});

test("emoji mode keeps today's marks", () => {
  const out = renderEverything(createRenderer({ glyphs: "emoji", color: false, width: 80 }));
  for (const mark of ["🛠️", "💬", "✅", "⚠️", "❌", "🚦", "⛔", "📝", "🔥", "💡", "▾", "╭", "╯"]) {
    assert.ok(out.includes(mark), `emoji output lost ${mark}`);
  }
});

test("colour only adds escapes: stripping them gives the colour-off rendering", () => {
  for (const mode of /** @type {const} */ (["unicode", "ascii", "emoji"])) {
    for (const width of [60, 120]) {
      const off = renderEverything(createRenderer({ glyphs: mode, color: false, width }));
      const on = renderEverything(createRenderer({ glyphs: mode, color: true, width }));
      assert.ok(on.includes(ESC), `${mode}@${width}: colour on should paint something`);
      assert.ok(!off.includes(ESC), `${mode}@${width}: colour off must not paint`);
      assert.equal(strip(on), off, `${mode}@${width}: colour must not change the text`);
    }
  }
});

test("no primitive leaves trailing whitespace at 60 or 120 columns", () => {
  for (const mode of /** @type {const} */ (["unicode", "ascii", "emoji"])) {
    for (const width of [60, 120]) {
      const r = createRenderer({ glyphs: mode, color: false, width });
      const out = [
        r.table([["a", "b"]], { head: ["x", "y"] }),
        r.tree(["a"]),
        r.flow(["A", "B"], 0),
        r.list([["c", "d"]]),
        r.phase("x"),
        r.close({ status: "runs" }),
      ].join("\n");
      for (const line of out.split("\n")) {
        assert.equal(line, line.replace(/\s+$/, ""), `${mode}@${width}: trailing whitespace on ${JSON.stringify(line)}`);
      }
    }
  }
});

test("table is borderless, left-aligned, measured in cells, with a dim rule under the head", () => {
  const r = createRenderer({ glyphs: "unicode", color: false, width: 80 });
  const out = r.table(
    [
      ["Stack", "Node 22, npm"],
      ["日本語", "wide label"],
      ["CI", ".github/workflows/ci.yml"],
    ],
    { head: ["Check", "Found"] },
  );
  const lines = out.split("\n");
  assert.equal(lines[0], "Check   Found");
  assert.equal(lines[1], "──────  ────────────────────────");
  assert.equal(lines[2], "Stack   Node 22, npm");
  assert.equal(lines[3], "日本語  wide label");
  assert.equal(lines[4], "CI      .github/workflows/ci.yml");
  // Every second column starts in the same cell.
  const seconds = ["Found", "─".repeat(24), "Node 22, npm", "wide label", ".github/workflows/ci.yml"];
  const starts = new Set(lines.map((line, index) => visualWidth(line) - visualWidth(seconds[index])));
  assert.deepEqual([...starts], [8]);

  const ascii = createRenderer({ glyphs: "ascii", color: false, width: 80 }).table([["a", "b"]], { head: ["h1", "h2"] });
  assert.equal(ascii, "h1  h2\n--  --\na   b");

  const coloured = createRenderer({ glyphs: "unicode", color: true, width: 80 }).table([["a", "b"]], { head: ["h1", "h2"] });
  assert.ok(coloured.split("\n")[0].includes(`${ESC}[1m`), "head row is bold");
  assert.ok(coloured.split("\n")[1].includes(`${ESC}[2m`), "rule is dim");

  assert.equal(r.table([]), "");
  assert.equal(r.table([["only"]]), "only");
});

test("table wraps its last column to the renderer width", () => {
  const long = "a long description that keeps going well past sixty columns so it has to wrap onto a second line";
  const narrow = createRenderer({ glyphs: "unicode", color: false, width: 60 }).table([["Key", long]], { head: ["Name", "What"] });
  const narrowLines = narrow.split("\n");
  assert.ok(narrowLines.length > 3, "the long cell should wrap at 60 columns");
  for (const line of narrowLines) assert.ok(visualWidth(line) <= 60, `over 60 cells: ${line}`);
  assert.equal(narrowLines[3].slice(0, 5), "     ", "continuation lines are indented to the column start");
  assert.equal(narrow.replace(/\s+/g, " ").includes(long), true, "no words are lost");

  const wide = createRenderer({ glyphs: "unicode", color: false, width: 120 }).table([["Key", long]], { head: ["Name", "What"] });
  assert.equal(wide.split("\n").length, 3, "at 120 columns the cell fits on one line");
});

test("tree draws branch, last and pipe marks per glyph set", () => {
  const items = ["a", { label: "b", children: ["c", { label: "d", children: ["e"] }] }, "f"];
  assert.equal(
    createRenderer({ glyphs: "unicode", color: false }).tree(items),
    ["├── a", "├── b", "│   ├── c", "│   └── d", "│       └── e", "└── f"].join("\n"),
  );
  assert.equal(
    createRenderer({ glyphs: "ascii", color: false }).tree(items),
    ["|-- a", "|-- b", "|   |-- c", "|   `-- d", "|       `-- e", "`-- f"].join("\n"),
  );
  assert.equal(createRenderer({ glyphs: "unicode", color: false }).tree([]), "");
});

test("flow joins steps with the arrow and bolds the current one when colour is on", () => {
  const steps = ["Scan", "Questions", "Preview"];
  assert.equal(createRenderer({ glyphs: "unicode", color: false }).flow(steps, "Questions"), "Scan → Questions → Preview");
  assert.equal(createRenderer({ glyphs: "ascii", color: false }).flow(steps, 1), "Scan -> Questions -> Preview");
  const on = createRenderer({ glyphs: "unicode", color: true }).flow(steps, 1);
  assert.equal(on, `Scan → ${ESC}[1mQuestions${ESC}[0m → Preview`);
  assert.equal(createRenderer({ glyphs: "unicode", color: true }).flow(steps), "Scan → Questions → Preview", "no current step, nothing bold");
});

test("code and ref render backticked text, cyan when colour is on", () => {
  const off = createRenderer({ glyphs: "unicode", color: false });
  assert.equal(off.code("npm test"), "`npm test`");
  assert.equal(off.ref("src/cli.js", 42), "`src/cli.js:42`");
  assert.equal(off.ref("src/cli.js"), "`src/cli.js`");
  const on = createRenderer({ glyphs: "unicode", color: true });
  assert.equal(on.code("npm test"), `${ESC}[36m\`npm test\`${ESC}[0m`);
  assert.equal(createRenderer({ glyphs: "unicode", color: true, bright: true }).code("x"), `${ESC}[96m\`x\`${ESC}[0m`);
});

test("list renders one command per line with what it does", () => {
  const items = /** @type {[string, string][]} */ ([
    ["otito gate", "runs the gate"],
    ["otito context", "builds a context pack"],
  ]);
  assert.equal(createRenderer({ glyphs: "unicode", color: false }).list(items), "- `otito gate` – runs the gate\n- `otito context` – builds a context pack");
  assert.equal(createRenderer({ glyphs: "ascii", color: false }).list(items), "- `otito gate` - runs the gate\n- `otito context` - builds a context pack");
  assert.equal(createRenderer({ glyphs: "unicode", color: false }).list([]), "");
});

test("phase signals read as full sentences", () => {
  const r = createRenderer({ glyphs: "unicode", color: false });
  assert.equal(r.phase("scan"), "Starting scan.");
  assert.equal(r.phase("questions", { done: true }), "Phase done. Moving to questions.");
  assert.equal(createRenderer({ glyphs: "unicode", color: true }).phase("scan"), `${ESC}[1mStarting scan.${ESC}[0m`);
});

test("close renders exactly one of the four closing lines", () => {
  const r = createRenderer({ glyphs: "unicode", color: false });
  assert.equal(r.close({ status: "verified" }), "Verified.");
  assert.equal(r.close({ status: "tests-pass" }), "Tests pass.");
  assert.equal(r.close({ status: "runs" }), "Runs without errors.");
  assert.equal(r.close({ status: "not-verified", detail: "the pre-commit hook" }), "Not verified — manual check needed: the pre-commit hook.");
  assert.equal(r.close({ status: "not-verified", detail: "ends with a period." }), "Not verified — manual check needed: ends with a period.");
  assert.equal(r.close({ status: "not-verified" }), "Not verified — manual check needed.");
  assert.equal(
    createRenderer({ glyphs: "ascii", color: false }).close({ status: "not-verified", detail: "the hook" }),
    "Not verified - manual check needed: the hook.",
  );
  assert.equal(createRenderer({ glyphs: "emoji", color: false }).close({ status: "not-verified", detail: "x" }), "Not verified — manual check needed: x.");
  const on = createRenderer({ glyphs: "unicode", color: true });
  assert.equal(on.close({ status: "verified" }), `${ESC}[32mVerified.${ESC}[0m`);
  assert.equal(on.close({ status: "not-verified", detail: "x" }), `${ESC}[33mNot verified — manual check needed: x.${ESC}[0m`);
});

test("paint names palette colours, including the new magenta and blue", () => {
  const on = createRenderer({ color: true });
  assert.equal(on.paint("x", "magenta"), `${ESC}[35mx${ESC}[0m`);
  assert.equal(on.paint("x", "blue"), `${ESC}[34mx${ESC}[0m`);
  assert.equal(on.paint("x", "bold", "green"), `${ESC}[1m${ESC}[32mx${ESC}[0m`);
  assert.equal(on.paint("x", "not-a-colour"), "x");
  const bright = createRenderer({ color: true, bright: true });
  assert.equal(bright.paint("x", "magenta"), `${ESC}[95mx${ESC}[0m`);
  assert.equal(bright.paint("x", "blue"), `${ESC}[94mx${ESC}[0m`);
  assert.equal(createRenderer({ color: false }).paint("x", "magenta"), "x");
});

// ---------------------------------------------------------------------------
// Today's output, byte for byte, and wrapping for content that does not fit.

test("header, verdict, statusLine and the small marks match the golden fixture in every mode", () => {
  // tests/fixtures/render-fancy-golden.json pins the renderer's output per glyph
  // mode, colour and width. It was first recorded from the renderer as it was
  // before glyph modes existed, and regenerated in phase 3 for the box width
  // fix; tests/golden/generate-render-fancy.mjs regenerates it on purpose.
  const golden = JSON.parse(fs.readFileSync(new URL("./fixtures/render-fancy-golden.json", import.meta.url), "utf8"));
  assert.deepEqual(
    golden.cases.map((/** @type {{ id: string }} */ entry) => entry.id),
    goldenCases().map((entry) => entry.id),
  );
  for (const { id, options, outputs } of golden.cases) {
    const actual = renderAll(options);
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(outputs).sort(), `${id}: the golden file covers a different set of calls`);
    for (const [key, expected] of Object.entries(outputs)) {
      assert.equal(actual[key], expected, `${id} ${key} changed`);
    }
  }
});

/**
 * The lines between a box's top and bottom border, ANSI stripped.
 * @param {string} box
 */
function middleLines(box) {
  return box.split("\n").slice(1, -1).map(strip);
}

test("boxed content wraps at 60 columns instead of breaking the right border", () => {
  const blockedBy = "CODEOWNERS approval is missing for src/payment/stripe.webhook.ts and src/payment/refund.service.ts";
  const nextStep = "/Users/someone/dev/a/very/deeply/nested/repository/path/that/never/contains/a/single/space.ts";
  for (const mode of /** @type {const} */ (["unicode", "ascii", "emoji"])) {
    for (const color of [false, true]) {
      const r = createRenderer({ glyphs: mode, color, width: 60 });
      const reference = visualWidth(middleLines(r.verdict({ verdict: "PASS" }))[0]);

      const verdict = r.verdict({ verdict: "FAIL", blockedBy, nextStep });
      const lines = middleLines(verdict);
      assert.ok(lines.length > 3, `${mode}: long content should wrap onto extra lines`);
      for (const line of lines) assert.equal(visualWidth(line), reference, `${mode}/${color}: ${JSON.stringify(line)}`);
      const flat = lines.join("\n").replace(/[│|]/g, "").replace(/\s+/g, " ");
      for (const word of blockedBy.split(" ")) assert.ok(flat.includes(word), `${mode}: lost ${word}`);
      assert.ok(flat.replace(/\s+/g, "").includes(nextStep), `${mode}: the path must survive a hard split`);
      // Continuation lines sit under the content column, not under the label.
      const continuation = lines.find((line) => /^[│|] {6,}\S/.test(line));
      assert.ok(continuation, `${mode}: expected an indented continuation line`);

      const header = r.header({ text: "otito repo · repository overview of a repository with a much longer name than fits", glyph: "📦" }, [
        { text: nextStep, glyph: "💬" },
      ]);
      const headerLines = middleLines(header);
      assert.ok(headerLines.length > 2, `${mode}: the header should wrap`);
      for (const line of headerLines) assert.equal(visualWidth(line), reference, `${mode}/${color}: ${JSON.stringify(line)}`);
      assert.ok(
        headerLines
          .join("")
          .replace(/[│|\s]/g, "")
          .includes(nextStep.replace(/\s/g, "")),
      );
    }
  }
});

test("a subtitle painted once keeps its colour on every wrapped line", () => {
  // renderDocument dims the subtitle before handing it to header().
  const r = createRenderer({ glyphs: "emoji", color: true, width: 60 });
  const subtitle = `${ESC}[2m${"a long dim subtitle that keeps going ".repeat(3).trim()}${ESC}[0m`;
  const lines = r.header("T", [subtitle]).split("\n").slice(2, -1);
  assert.ok(lines.length >= 2);
  for (const line of lines) {
    assert.match(
      line,
      new RegExp(`${ESC.replace("\u001b", "\\u001b")}\\[2m.*${ESC.replace("\u001b", "\\u001b")}\\[0m`),
      `not repainted: ${JSON.stringify(line)}`,
    );
  }
  assert.equal(visualWidth(lines[0]), visualWidth(lines[1]));
});

test("wrapBoxed leaves fitting content untouched and never drops a character", () => {
  assert.deepEqual(wrapBoxed("short  text   with runs", 40), ["short  text   with runs"]);
  assert.deepEqual(wrapBoxed("", 40), [""]);
  assert.deepEqual(wrapBoxed("aaa bbb ccc", 7), ["aaa bbb", "ccc"]);
  assert.deepEqual(wrapBoxed("aaa bbb ccc", 7, 2), ["aaa bbb", "  ccc"]);
  assert.deepEqual(wrapBoxed("abcdefghij", 4), ["abcd", "efgh", "ij"]);
  assert.deepEqual(wrapBoxed("日本語日本語", 5), ["日本", "語日", "本語"]);
  assert.deepEqual(wrapBoxed("ééé", 2), ["éé", "é"]);
  // A large indent still leaves room to write.
  const lines = wrapBoxed("word ".repeat(20).trim(), 30, 28);
  assert.ok(lines.every((line) => visualWidth(line) <= 30));
  assert.ok(lines.length >= 2);
});

test("pick returns the mark for the resolved glyph mode and falls back to ascii", () => {
  const marks = { emoji: "🔥", ascii: ">", unicode: "" };
  assert.equal(createRenderer({ glyphs: "emoji" }).pick(marks), "🔥");
  assert.equal(createRenderer({ glyphs: "ascii" }).pick(marks), ">");
  assert.equal(createRenderer({ glyphs: "unicode" }).pick(marks), "");
  // A mode without its own mark takes the ascii one; nothing prints undefined.
  assert.equal(createRenderer({ glyphs: "unicode" }).pick({ emoji: "🔥", ascii: ">" }), ">");
  assert.equal(createRenderer({ glyphs: "emoji" }).pick({ ascii: ">" }), ">");
  assert.equal(createRenderer({ glyphs: "emoji" }).pick({}), "");
});

test("glyphs.item is the marker formatters put in front of their own list items", () => {
  assert.equal(createRenderer({ glyphs: "emoji" }).glyphs.item, "•");
  assert.equal(createRenderer({ glyphs: "ascii" }).glyphs.item, "-");
  assert.equal(createRenderer({ glyphs: "unicode" }).glyphs.item, "-");
});

test("no formatter reads renderer.emoji any more; marks come from glyphs and pick", () => {
  // O7: the box, status and verdict sets are chosen by glyph mode, and every
  // formatter takes its marks from renderer.glyphs or renderer.pick, so the
  // unicode default can flip without a formatter falling back to emoji.
  const root = new URL("../src/lib/", import.meta.url);
  const offenders = [];
  const walk = (/** @type {URL} */ dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".js") || full.pathname.endsWith("/render/fancy.js")) continue;
      fs.readFileSync(full, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (/\brenderer\.emoji\b/.test(line)) offenders.push(`${full.pathname.slice(root.pathname.length)}:${index + 1}`);
        });
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});
