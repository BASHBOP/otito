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
  const out = r.header({ text: "repoctx doctor", glyph: "📋" });
  assert.match(out, /^╭/);
  assert.match(out, /╯$/);
  assert.match(out, /repoctx doctor/);
  assert.match(out, /📋/);
});

test("header in plain mode strips glyphs and uses ASCII box", () => {
  const r = createRenderer({ emoji: false, width: 60 });
  const out = r.header({ text: "repoctx doctor", glyph: "📋" });
  assert.match(out, /^\+/);
  assert.match(out, /\+$/);
  assert.match(out, /repoctx doctor/);
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

test("renderer width clamps to a sensible terminal size", () => {
  assert.equal(createRenderer({ width: 30 }).width, 60);
  assert.equal(createRenderer({ width: 999 }).width, 120);
  assert.equal(createRenderer({ width: 90 }).width, 90);
});
