// The renderer calls pinned by tests/fixtures/render-fancy-golden.json. Shared
// by the generator (tests/golden/generate-render-fancy.mjs) and the test
// (tests/render-fancy.test.js) so both make exactly the same calls.
import { createRenderer } from "../../src/lib/render/fancy.js";

const ESC = String.fromCharCode(27);

/**
 * Every renderer option set the fixture is taken with. Glyph mode, colour and
 * width are all explicit, so neither the terminal nor CI leaks into it.
 * @returns {{ id: string, options: { glyphs: "unicode" | "ascii" | "emoji", color: boolean, width: number } }[]}
 */
export function cases() {
  const out = [];
  for (const glyphs of /** @type {const} */ (["unicode", "ascii", "emoji"])) {
    for (const color of [false, true]) {
      for (const width of [60, 78]) {
        out.push({ id: `${glyphs}-${color ? "color" : "plain"}-${width}`, options: { glyphs, color, width } });
      }
    }
  }
  return out;
}

/**
 * @param {{ glyphs: "unicode" | "ascii" | "emoji", color: boolean, width: number }} options
 * @returns {Record<string, string>}
 */
export function renderAll(options) {
  const r = createRenderer(options);
  return {
    "header:string": r.header("solumbe doctor"),
    "header:glyph": r.header({ text: "solumbe repo · repository overview", glyph: "📦" }, [{ text: "/tmp/repo", glyph: "💬" }, "plain line"]),
    "header:dim-subtitle": r.header({ text: "CODE MAP   fixture", glyph: "\u{1F5FA}" }, [`${ESC}[2mreason for the report${ESC}[0m`]),
    "verdict:PASS": r.verdict({ verdict: "PASS" }),
    "verdict:WARN": r.verdict({ verdict: "WARN", nextStep: "run the validation plan" }),
    "verdict:FAIL": r.verdict({ verdict: "FAIL", blockedBy: "Review state", nextStep: "request review" }),
    "verdict:UNKNOWN": r.verdict({}),
    "statusLine:pass": r.statusLine("pass", "node", "v22.12.0"),
    "statusLine:warn": r.statusLine("warn", "rg", "not installed", ["Install ripgrep for faster searches."]),
    "statusLine:fail": r.statusLine("fail", "git", "missing"),
    "statusLine:info": r.statusLine("info", "note", "fyi", ["a", "b"]),
    "statusLine:unknown": r.statusLine("other", "x", "y"),
    bullet: r.bullet("first item"),
    "bullet:glyph": r.bullet("hot", "🔥"),
    tip: r.tip("optional accelerators"),
    section: r.section("Section", ["one", "two"]),
    "section:string": r.section("S", "body"),
    rule: r.rule(),
  };
}
