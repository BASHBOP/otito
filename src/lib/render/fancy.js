// Fancy terminal renderer used by otito commands that produce a verdict or
// ranked list. Returns strings (no I/O) so it stays testable.
//
// Every mark the renderer prints comes from one glyph set, chosen once per
// renderer:
//   - `emoji`   today's look: emoji status marks and a decorative header glyph.
//   - `ascii`   bracketed tokens and ASCII box drawing, so CI logs stay legible.
//   - `unicode` plain Unicode marks (✓ ! ✗, box drawing, arrows) and no emoji
//               at all; nothing in it matches \p{Extended_Pictographic}.
// `emoji` is still the interactive default and `ascii` still follows
// `emoji: false`, NO_EMOJI and CI; `unicode` is reached only through the
// explicit `glyphs: "unicode"` renderer option.

/**
 * @typedef {"unicode" | "ascii" | "emoji"} GlyphMode
 */

/**
 * @typedef {object} GlyphSet
 * @property {Record<string, string>} status   pass / warn / fail / info marks for statusLine
 * @property {Record<string, string>} verdict  PASS / WARN / FAIL marks for the verdict box
 * @property {{ topLeft: string, topRight: string, bottomLeft: string, bottomRight: string, horizontal: string, vertical: string, bullet: string, arrow: string }} box
 * @property {{ branch: string, last: string, pipe: string }} tree
 * @property {{ verdict: string, blocked: string, next: string }} marks  the three verdict-box row markers
 * @property {string} arrow    step separator in a flow
 * @property {string} bullet   list marker
 * @property {string} section  section heading marker
 * @property {string} tip      tip line marker
 * @property {string} dash     em dash for prose ("Not verified — ...")
 * @property {string} listDash en dash between a command and what it does
 * @property {string} item     marker in front of an item a formatter lists itself
 */

/** @type {Record<GlyphMode, GlyphSet>} */
const GLYPH_SETS = {
  emoji: {
    status: { pass: "✅", warn: "⚠️ ", fail: "❌", info: "ℹ️ " },
    verdict: { PASS: "✅", WARN: "⚠️ ", FAIL: "❌" },
    box: { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯", horizontal: "─", vertical: "│", bullet: "•", arrow: "└─" },
    tree: { branch: "├──", last: "└──", pipe: "│" },
    marks: { verdict: "🚦", blocked: "⛔", next: "📝" },
    arrow: "→",
    bullet: "•",
    section: "▾",
    tip: "💡",
    dash: "—",
    listDash: "–",
    item: "•",
  },
  ascii: {
    status: { pass: "[OK]  ", warn: "[WARN]", fail: "[FAIL]", info: "[INFO]" },
    verdict: { PASS: "[PASS]", WARN: "[WARN]", FAIL: "[FAIL]" },
    box: { topLeft: "+", topRight: "+", bottomLeft: "+", bottomRight: "+", horizontal: "-", vertical: "|", bullet: "*", arrow: "|-" },
    tree: { branch: "|--", last: "`--", pipe: "|" },
    marks: { verdict: "[?]", blocked: "[!]", next: "[>]" },
    arrow: "->",
    bullet: "*",
    section: ">",
    tip: "[i]",
    dash: "-",
    listDash: "-",
    item: "-",
  },
  unicode: {
    status: { pass: "✓", warn: "!", fail: "✗", info: "·" },
    verdict: { PASS: "✓", WARN: "!", FAIL: "✗" },
    box: { topLeft: "╭", topRight: "╮", bottomLeft: "╰", bottomRight: "╯", horizontal: "─", vertical: "│", bullet: "•", arrow: "└─" },
    tree: { branch: "├──", last: "└──", pipe: "│" },
    marks: { verdict: "❯", blocked: "✗", next: "→" },
    arrow: "→",
    bullet: "•",
    section: "▾",
    tip: "›",
    dash: "—",
    listDash: "–",
    item: "•",
  },
};

/** @type {Record<string, string>} */
// ANSI escape sequences. Stripped before visual-width measurement so box
// alignment is not thrown off by invisible escape bytes.
const ANSI = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

/** @type {Record<string, string>} */
// High-visibility variants (bright palette) used by the high-contrast theme.
const ANSI_BRIGHT = {
  green: "\x1b[92m",
  yellow: "\x1b[93m",
  red: "\x1b[91m",
  cyan: "\x1b[96m",
  magenta: "\x1b[95m",
  blue: "\x1b[94m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

/** @type {Record<string, string>} */
const STATUS_PALETTE = { pass: "green", warn: "yellow", fail: "red", info: "cyan" };

/** @type {Record<string, string>} */
const VERDICT_PALETTE = { PASS: "green", WARN: "yellow", FAIL: "red" };

/** @type {Record<string, RendererOptions>} */
// Built-in named themes. Each entry sets default emoji/color options that the
// caller's explicit RendererOptions can still override.
const THEMES = {
  default: {},
  color: { color: true },
  minimal: { emoji: false, color: false },
  "high-contrast": { emoji: true, color: true, bright: true },
};

/**
 * @typedef {object} RendererOptions
 * @property {boolean} [emoji] Force fancy glyphs on (true) or off (false). When unset, auto-detected from env.
 * @property {boolean} [color] Force ANSI color on (true) or off (false). When unset, auto-detected from env/TTY.
 * @property {string}  [theme] Named theme: "default" | "color" | "minimal" | "high-contrast".
 * @property {boolean} [bright] Use bright ANSI palette (set automatically by the high-contrast theme).
 * @property {number}  [width] Box width in columns; clamped to 60..120.
 * @property {GlyphMode} [glyphs] Glyph set to use. When unset, `emoji` resolves it to "emoji" or "ascii".
 */

/**
 * A headline cell: either a plain string or a glyph-prefixed label.
 * @typedef {string | { text?: string, glyph?: string }} Headline
 */

/**
 * A tree node: a label, or a label with children.
 * @typedef {string | { label: string, children?: TreeItem[] }} TreeItem
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {RendererOptions} [options]
 * @returns {boolean}
 */
export function shouldUseEmoji(env = process.env, options = {}) {
  if (options.emoji === true) return true;
  if (options.emoji === false) return false;
  if (env.NO_EMOJI === "1" || env.NO_EMOJI === "true") return false;
  if (env.CI === "true" || env.CI === "1") return false;
  return true;
}

/**
 * Follows the NO_COLOR spec (https://no-color.org) and checks isTTY so that
 * piped output and test runners never receive ANSI codes unless FORCE_COLOR is set.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {RendererOptions} [options]
 * @returns {boolean}
 */
export function shouldUseColor(env = process.env, options = {}) {
  if (options.color === true) return true;
  if (options.color === false) return false;
  // NO_COLOR spec: any value (even empty string) disables color.
  if (env.NO_COLOR !== undefined) return false;
  // CLICOLOR=0 opts out explicitly.
  if (env.CLICOLOR === "0") return false;
  // FORCE_COLOR overrides TTY check and CI guard.
  if (env.FORCE_COLOR === "1" || env.FORCE_COLOR === "true") return true;
  if (env.CI === "true" || env.CI === "1") return false;
  // Only color when stdout is an interactive terminal so piped output stays clean.
  if (!process.stdout.isTTY) return false;
  return true;
}

/**
 * Which glyph set a renderer prints with. An explicit `glyphs` option wins;
 * otherwise the emoji decision (option, theme, NO_EMOJI, CI) picks "emoji" or
 * "ascii", exactly as it did before "unicode" existed.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {RendererOptions} [options] theme defaults already merged in
 * @returns {GlyphMode}
 */
export function resolveGlyphMode(env = process.env, options = {}) {
  if (options.glyphs && options.glyphs in GLYPH_SETS) return options.glyphs;
  return (options.emoji ?? shouldUseEmoji(env, options)) ? "emoji" : "ascii";
}

/**
 * @param {RendererOptions} [options]
 */
export function createRenderer(options = {}) {
  // Theme defaults are applied first; explicit options then override them.
  // Drop keys whose value is undefined so callers that always pass an explicit
  // `emoji: undefined` / `color: undefined` (e.g. the CLI when no flag is set)
  // do not clobber the theme's own defaults.
  const theme = THEMES[/** @type {string} */ (options.theme)] ?? {};
  const defined = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
  const merged = { ...theme, ...defined };

  const glyphMode = resolveGlyphMode(process.env, merged);
  const glyphs = GLYPH_SETS[glyphMode];
  const emoji = glyphMode === "emoji";
  const color = merged.color ?? shouldUseColor(process.env, merged);
  const palette = merged.bright ? ANSI_BRIGHT : ANSI;
  const width = clamp(merged.width ?? defaultWidth(), 60, 120);
  const box = glyphs.box;
  const statusGlyphs = glyphs.status;
  const verdictGlyphs = glyphs.verdict;

  // Wrap text with ANSI codes. No-ops when color is off or all codes are falsy.
  /**
   * @param {string} text
   * @param {...(string | undefined)} codes
   * @returns {string}
   */
  function c(text, ...codes) {
    if (!color) return text;
    const active = codes.filter(Boolean);
    if (!active.length) return text;
    return `${active.join("")}${text}${palette.reset}`;
  }

  /**
   * Colour text by palette name ("green", "bold", "dim", ...). Unknown names
   * are ignored, so a formatter can name a colour without checking the theme.
   * @param {string} text
   * @param {...string} names
   * @returns {string}
   */
  function paint(text, ...names) {
    return c(text, ...names.map((name) => palette[name]));
  }

  /**
   * The mark for the current glyph mode, for a decoration only one formatter
   * uses (a section's emoji, a bar cell). A mode without its own mark falls
   * back to the ascii one, so nothing can print undefined.
   * @param {{ emoji?: string, ascii?: string, unicode?: string }} marks
   * @returns {string}
   */
  function pick(marks) {
    return marks[glyphMode] ?? marks.ascii ?? "";
  }

  /**
   * @param {Headline} title
   * @param {Headline[]} [lines]
   * @returns {string}
   */
  function header(title, lines = []) {
    const innerWidth = width - 4;
    const rendered = [title, ...lines]
      .flatMap((value) => wrapBoxed(renderHeadline(value), innerWidth, headlineIndent(value)))
      .map((line) => padRight(line, innerWidth));
    const top = c(`${box.topLeft}${box.horizontal.repeat(width - 2)}${box.topRight}`, palette.dim);
    const bottom = c(`${box.bottomLeft}${box.horizontal.repeat(width - 2)}${box.bottomRight}`, palette.dim);
    const vert = c(box.vertical, palette.dim);
    const middle = rendered.map((line) => `${vert}  ${line}  ${vert}`);
    return [top, ...middle, bottom].join("\n");
  }

  /**
   * @param {Headline} value
   * @returns {string}
   */
  function renderHeadline(value) {
    if (typeof value === "string") return value;
    const { text, glyph } = value ?? {};
    // Header glyphs are emoji supplied by the caller; only the emoji set shows them.
    if (emoji && glyph) return `${glyph}  ${text ?? ""}`;
    return text ?? "";
  }

  /**
   * Cells a wrapped headline's continuation lines are indented by: past the
   * glyph when one is shown, so the text stays in one column.
   * @param {Headline} value
   * @returns {number}
   */
  function headlineIndent(value) {
    if (typeof value === "string") return 0;
    const glyph = value?.glyph;
    return emoji && glyph ? visualWidth(`${glyph}  `) : 0;
  }

  /**
   * @param {string} status
   * @param {string} name
   * @param {string} summary
   * @param {string[]} [details]
   * @returns {string}
   */
  function statusLine(status, name, summary, details = []) {
    const glyph = statusGlyphs[status] ?? statusGlyphs.info;
    const paddedName = padRight(name, 22);
    const prefix = c(`${glyph}  ${paddedName}`, palette[STATUS_PALETTE[status] ?? "cyan"]);
    const head = `  ${prefix} ${summary}`;
    const tail = details.map((detail) => `     ${box.arrow} ${detail}`);
    return [head, ...tail].join("\n");
  }

  /**
   * @param {{ verdict?: string, blockedBy?: string, nextStep?: string }} [input]
   * @returns {string}
   */
  function verdict({ verdict: result, blockedBy, nextStep } = {}) {
    const innerWidth = width - 4;
    const glyph = verdictGlyphs[/** @type {string} */ (result)] ?? "";
    const verdictPrefix = `${glyphs.marks.verdict}  VERDICT     ${glyph}  `;
    const verdictColor = palette[VERDICT_PALETTE[/** @type {string} */ (result)] ?? ""];
    // Long content wraps inside the box and continues under its own column;
    // content that fits renders exactly as it always has.
    const lines = wrapBoxed(`${verdictPrefix}${result ?? "UNKNOWN"}`, innerWidth, visualWidth(verdictPrefix)).map((line) =>
      padRight(c(line, palette.bold, verdictColor), innerWidth),
    );
    if (blockedBy) {
      const prefix = `${glyphs.marks.blocked}  blocked by  `;
      lines.push(...wrapBoxed(`${prefix}${blockedBy}`, innerWidth, visualWidth(prefix)).map((line) => padRight(line, innerWidth)));
    }
    if (nextStep) {
      const prefix = `${glyphs.marks.next}  next step   `;
      lines.push(...wrapBoxed(`${prefix}${nextStep}`, innerWidth, visualWidth(prefix)).map((line) => padRight(line, innerWidth)));
    }
    const top = c(`${box.topLeft}${box.horizontal.repeat(width - 2)}${box.topRight}`, palette.dim);
    const bottom = c(`${box.bottomLeft}${box.horizontal.repeat(width - 2)}${box.bottomRight}`, palette.dim);
    const vert = c(box.vertical, palette.dim);
    const middle = lines.map((line) => `${vert}  ${line}  ${vert}`);
    return [top, ...middle, bottom].join("\n");
  }

  /**
   * @param {string} text
   * @param {string} [glyph]
   * @returns {string}
   */
  function bullet(text, glyph) {
    // A caller-supplied glyph is an emoji; the other sets fall back to their own bullet.
    const marker = glyph && emoji ? glyph : glyphs.bullet;
    return `  ${marker} ${text}`;
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  function tip(text) {
    return c(`  ${glyphs.tip}  ${text}`, palette.cyan);
  }

  /**
   * @param {string} title
   * @param {string | string[]} body
   * @returns {string}
   */
  function section(title, body) {
    const head = c(`${glyphs.section} ${title}`, palette.bold);
    const lines = Array.isArray(body) ? body : [body];
    return [head, ...lines.map((line) => `  ${line}`)].join("\n");
  }

  function rule() {
    return c(box.horizontal.repeat(width), palette.dim);
  }

  /**
   * A borderless, left-aligned table measured in display cells, with a dim
   * rule under the head row. The last column wraps to the renderer width so
   * a long "what it does" cell never pushes past the terminal edge.
   * @param {(string | number | null | undefined)[][]} rows
   * @param {{ head?: string[] }} [options]
   * @returns {string}
   */
  function table(rows, { head } = {}) {
    const gap = "  ";
    /** @param {(string | number | null | undefined)[]} cells */
    const cellsOf = (cells) => cells.map((cell) => String(cell ?? ""));
    const body = (rows ?? []).map(cellsOf);
    const headCells = head ? cellsOf(head) : null;
    const all = headCells ? [headCells, ...body] : body;
    if (!all.length) return "";
    const columns = Math.max(...all.map((cells) => cells.length));
    if (!columns) return "";

    const widths = Array.from({ length: columns }, () => 0);
    for (const cells of all) {
      for (let index = 0; index < columns - 1; index += 1) {
        widths[index] = Math.max(widths[index], visualWidth(cells[index] ?? ""));
      }
    }
    const lead = widths.slice(0, -1).reduce((total, columnWidth) => total + columnWidth + gap.length, 0);
    const lastWidth = Math.max(width - lead, 20);

    /** @param {string[]} cells */
    const wrapLast = (cells) => wrap(cells[columns - 1] ?? "", lastWidth);
    const wrappedAll = all.map(wrapLast);
    widths[columns - 1] = Math.max(0, ...wrappedAll.flat().map(visualWidth));

    /**
     * @param {string[]} cells
     * @param {string[]} lastLines
     * @param {(text: string) => string} style
     */
    const renderRow = (cells, lastLines, style) => {
      const fixed = widths.slice(0, -1).map((columnWidth, index) => padRight(style(cells[index] ?? ""), columnWidth));
      const first = [...fixed, style(lastLines[0] ?? "")].join(gap).replace(/\s+$/, "");
      const indent = " ".repeat(lead);
      return [first, ...lastLines.slice(1).map((line) => `${indent}${style(line)}`)].join("\n");
    };

    const out = [];
    if (headCells) {
      out.push(renderRow(headCells, wrappedAll[0], (text) => c(text, palette.bold)));
      out.push(c(widths.map((columnWidth) => box.horizontal.repeat(columnWidth)).join(gap), palette.dim));
    }
    body.forEach((cells, index) => {
      out.push(renderRow(cells, wrappedAll[headCells ? index + 1 : index], (text) => text));
    });
    return out.join("\n");
  }

  /**
   * A file or outline tree drawn with the glyph set's branch marks.
   * @param {TreeItem[]} items
   * @returns {string}
   */
  function tree(items) {
    /** @type {string[]} */
    const out = [];
    /**
     * @param {TreeItem[]} nodes
     * @param {string} prefix
     */
    const walk = (nodes, prefix) => {
      nodes.forEach((node, index) => {
        const last = index === nodes.length - 1;
        const label = typeof node === "string" ? node : node.label;
        const children = typeof node === "string" ? [] : (node.children ?? []);
        out.push(`${prefix}${last ? glyphs.tree.last : glyphs.tree.branch} ${label}`);
        if (children.length) walk(children, `${prefix}${last ? " " : glyphs.tree.pipe}   `);
      });
    };
    walk(items ?? [], "");
    return out.join("\n");
  }

  /**
   * A pipeline such as `Scan → Questions → Preview`, with the current step in
   * bold when colour is on. `current` is a step name or index.
   * @param {string[]} steps
   * @param {string | number} [current]
   * @returns {string}
   */
  function flow(steps, current) {
    const currentIndex = typeof current === "number" ? current : steps.indexOf(/** @type {string} */ (current));
    return steps.map((step, index) => (index === currentIndex ? c(step, palette.bold) : step)).join(` ${glyphs.arrow} `);
  }

  /**
   * A command or path in backticks, cyan when colour is on.
   * @param {string} text
   * @returns {string}
   */
  function code(text) {
    return c(`\`${text}\``, palette.cyan);
  }

  /**
   * A `path:line` reference, rendered like code.
   * @param {string} path
   * @param {number | string} [line]
   * @returns {string}
   */
  function ref(path, line) {
    return code(line === undefined || line === null || line === "" ? path : `${path}:${line}`);
  }

  /**
   * A list of commands and what each one does: "- `cmd` – what".
   * @param {[string, string][]} items
   * @returns {string}
   */
  function list(items) {
    return (items ?? []).map(([cmd, what]) => `- ${code(cmd)} ${glyphs.listDash} ${what}`).join("\n");
  }

  /**
   * A phase signal for commands that work in visible steps.
   * @param {string} step
   * @param {{ done?: boolean }} [options] `done` reports the previous phase and names the next one
   * @returns {string}
   */
  function phase(step, { done = false } = {}) {
    return c(done ? `Phase done. Moving to ${step}.` : `Starting ${step}.`, palette.bold);
  }

  /**
   * The closing line: exactly one of "Verified.", "Tests pass.", "Runs without
   * errors." or "Not verified — manual check needed: <detail>."
   * @param {{ status: "verified" | "tests-pass" | "runs" | "not-verified", detail?: string }} input
   * @returns {string}
   */
  function close({ status, detail }) {
    if (status === "verified") return c("Verified.", palette.green);
    if (status === "tests-pass") return c("Tests pass.", palette.green);
    if (status === "runs") return c("Runs without errors.", palette.green);
    const what = String(detail ?? "")
      .trim()
      .replace(/\.$/, "");
    return c(`Not verified ${glyphs.dash} manual check needed${what ? `: ${what}` : ""}.`, palette.yellow);
  }

  return {
    header,
    statusLine,
    verdict,
    bullet,
    tip,
    section,
    rule,
    table,
    tree,
    flow,
    code,
    ref,
    list,
    phase,
    close,
    paint,
    pick,
    glyphs,
    glyphMode,
    emoji,
    color,
    width,
  };
}

function defaultWidth() {
  const cols = process?.stdout?.columns;
  return typeof cols === "number" && cols >= 60 ? cols : 78;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Code points that take two terminal cells: the East Asian wide and fullwidth
 * blocks, plus emoji. Box drawing, arrows and ✓ live below these ranges and
 * are one cell, which is why the ranges are listed rather than "anything above U+1100".
 * @param {number} code
 * @returns {boolean}
 */
function isWide(code) {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK radicals, kangxi, ideographic punctuation
    (code >= 0x3041 && code <= 0x33ff) || // kana, bopomofo, hangul compatibility jamo, CJK compatibility
    (code >= 0x3400 && code <= 0x4dbf) || // CJK extension A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK unified ideographs
    (code >= 0xa000 && code <= 0xa4cf) || // Yi
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
    (code >= 0xfe30 && code <= 0xfe4f) || // CJK compatibility forms
    (code >= 0xff00 && code <= 0xff60) || // fullwidth forms
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) || // emoji blocks in the supplementary plane
    (code >= 0x20000 && code <= 0x3fffd) // CJK extensions B and beyond
  );
}

const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u;

// Visual width of a string in terminal cells. ANSI escape sequences are
// stripped first so colorized text pads correctly; combining marks, variation
// selectors and zero-width joiners add nothing; wide ranges and emoji count two.
/**
 * @param {string} text
 * @returns {number}
 */
export function visualWidth(text) {
  // eslint-disable-next-line no-control-regex
  const stripped = String(text).replace(/\x1b\[[0-9;]*m/g, "");
  const codes = Array.from(stripped, (char) => /** @type {number} */ (char.codePointAt(0)));
  let width = 0;
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index];
    if ((code >= 0x0300 && code <= 0x036f) || code === 0xfe0e || code === 0xfe0f || (code >= 0x200b && code <= 0x200d)) continue;
    if (code < 0x80) {
      width += 1;
      continue;
    }
    // U+FE0F asks for emoji presentation, which terminals draw two cells wide
    // even when the base character (⚠, ℹ) is narrow on its own.
    const emojiPresentation = codes[index + 1] === 0xfe0f || EMOJI_PRESENTATION.test(String.fromCodePoint(code));
    width += isWide(code) || emojiPresentation ? 2 : 1;
  }
  return width;
}

/**
 * @param {string} text
 * @param {number} target
 * @returns {string}
 */
export function padRight(text, target) {
  const current = visualWidth(text);
  if (current >= target) return text;
  return `${text}${" ".repeat(target - current)}`;
}

// eslint-disable-next-line no-control-regex
const ANSI_SEQUENCE = /\x1b\[[0-9;]*m/g;
// A string painted once: opening codes, plain text, closing resets.
// eslint-disable-next-line no-control-regex
const PAINTED_ONCE = /^((?:\x1b\[[0-9;]*m)+)([^\x1b]*)((?:\x1b\[0m)+)$/;

/**
 * Fit one line of boxed content to the inner width. Content that fits is
 * returned untouched, so a box around short content never changes. Longer
 * content wraps on spaces, an unbroken run such as a path is split by cell,
 * and continuation lines are indented to `indent` so the text keeps its
 * column. A string painted once keeps its colour on every line; text with
 * mixed styling is wrapped unpainted rather than left with dangling escapes.
 * @param {string} text
 * @param {number} width inner width in cells
 * @param {number} [indent] cells to indent continuation lines by
 * @returns {string[]}
 */
export function wrapBoxed(text, width, indent = 0) {
  const value = String(text ?? "");
  if (visualWidth(value) <= width) return [value];
  const painted = value.match(PAINTED_ONCE);
  const plain = painted ? painted[2] : value.replace(ANSI_SEQUENCE, "");
  // Keep at least 16 cells (or half a narrow width) for the text itself.
  const lead = Math.min(Math.max(0, indent), Math.max(0, width - Math.min(16, Math.floor(width / 2))));
  const paint = painted ? (/** @type {string} */ line) => `${painted[1]}${line}${painted[3]}` : (/** @type {string} */ line) => line;
  return hardWrap(plain, width, lead).map((line, index) => (index === 0 ? paint(line) : `${" ".repeat(lead)}${paint(line)}`));
}

/**
 * Greedy wrap on single spaces, measured in cells, that splits any run wider
 * than a line instead of letting it overflow. Continuation lines get
 * `width - lead` cells; the caller adds the indent.
 * @param {string} text
 * @param {number} width
 * @param {number} lead
 * @returns {string[]}
 */
function hardWrap(text, width, lead) {
  /** @type {string[]} */
  const lines = [];
  let line = "";
  const available = () => (lines.length ? width - lead : width);
  for (const word of text.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (visualWidth(candidate) <= available()) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    for (const chunk of splitCells(word, available())) {
      if (line) lines.push(line);
      line = chunk;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Split text into pieces of at most `width` cells, keeping zero-width marks
 * with the character they modify.
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
function splitCells(text, width) {
  if (visualWidth(text) <= width) return [text];
  /** @type {string[]} */
  const pieces = [];
  let piece = "";
  for (const char of text) {
    if (piece && visualWidth(char) > 0 && visualWidth(piece) + visualWidth(char) > width) {
      pieces.push(piece);
      piece = "";
    }
    piece += char;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/**
 * Word-wrap text to a display width. A word longer than the width stands on
 * its own line rather than being split.
 * @param {string} text
 * @param {number} target
 * @returns {string[]}
 */
export function wrap(text, target) {
  const words = String(text ?? "")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [""];
  /** @type {string[]} */
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
      continue;
    }
    if (visualWidth(line) + 1 + visualWidth(word) <= target) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}
