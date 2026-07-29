import test from "node:test";
import assert from "node:assert/strict";
import { createRenderer, shouldUseEmoji } from "../src/lib/render/fancy.js";

test("shouldUseEmoji respects explicit options first", () => {
  assert.equal(shouldUseEmoji({}, { emoji: true }), true);
  assert.equal(shouldUseEmoji({}, { emoji: false }), false);
});

test("shouldUseEmoji disables when NO_EMOJI=1 or CI=true", () => {
  assert.equal(shouldUseEmoji({ NO_EMOJI: "1" }), false);
  assert.equal(shouldUseEmoji({ CI: "true" }), false);
  assert.equal(shouldUseEmoji({}), true);
});

test("header uses Unicode box drawing and includes title text", () => {
  const r = createRenderer({ emoji: true, width: 60 });
  const out = r.header({ text: "otito doctor", glyph: "📋" });
  assert.match(out, /^╭/);
  assert.match(out, /╯$/);
  assert.match(out, /otito doctor/);
  assert.match(out, /📋/);
});

test("header in plain mode strips glyphs and uses ASCII box", () => {
  const r = createRenderer({ emoji: false, width: 60 });
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
  assert.equal(hc.emoji, true);
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
