// Fancy terminal renderer used by otito commands that produce a verdict or
// ranked list. Returns strings (no I/O) so it stays testable. Plain mode
// (emoji = false) replaces glyphs with bracketed tokens and box-drawing
// characters with ASCII so output stays legible in CI logs.

const STATUS_GLYPHS_FANCY = {
  pass: "✅",
  warn: "⚠️ ",
  fail: "❌",
  info: "ℹ️ ",
};

const STATUS_GLYPHS_PLAIN = {
  pass: "[OK]  ",
  warn: "[WARN]",
  fail: "[FAIL]",
  info: "[INFO]",
};

const VERDICT_GLYPHS_FANCY = {
  PASS: "✅",
  WARN: "⚠️ ",
  FAIL: "❌",
};

const VERDICT_GLYPHS_PLAIN = {
  PASS: "[PASS]",
  WARN: "[WARN]",
  FAIL: "[FAIL]",
};

const BOX_FANCY = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
  bullet: "•",
  arrow: "└─",
};

const BOX_PLAIN = {
  topLeft: "+",
  topRight: "+",
  bottomLeft: "+",
  bottomRight: "+",
  horizontal: "-",
  vertical: "|",
  bullet: "*",
  arrow: "|-",
};

/** @type {Record<string, string>} */
// ANSI escape sequences. Stripped before visual-width measurement so box
// alignment is not thrown off by invisible escape bytes.
const ANSI = {
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
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
 */

/**
 * A headline cell: either a plain string or a glyph-prefixed label.
 * @typedef {string | { text?: string, glyph?: string }} Headline
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

  const emoji = merged.emoji ?? shouldUseEmoji(process.env, merged);
  const color = merged.color ?? shouldUseColor(process.env, merged);
  const palette = merged.bright ? ANSI_BRIGHT : ANSI;
  const width = clamp(merged.width ?? defaultWidth(), 60, 120);
  const box = emoji ? BOX_FANCY : BOX_PLAIN;
  const statusGlyphs = emoji ? STATUS_GLYPHS_FANCY : STATUS_GLYPHS_PLAIN;
  const verdictGlyphs = emoji ? VERDICT_GLYPHS_FANCY : VERDICT_GLYPHS_PLAIN;

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
   * @param {Headline} title
   * @param {Headline[]} [lines]
   * @returns {string}
   */
  function header(title, lines = []) {
    const innerWidth = width - 4;
    const rendered = [renderHeadline(title), ...lines.map(renderHeadline)].map((line) => padRight(line, innerWidth));
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
    if (emoji && glyph) return `${glyph}  ${text ?? ""}`;
    return text ?? "";
  }

  /**
   * @param {string} status
   * @param {string} name
   * @param {string} summary
   * @param {string[]} [details]
   * @returns {string}
   */
  function statusLine(status, name, summary, details = []) {
    const glyph = /** @type {Record<string, string>} */ (statusGlyphs)[status] ?? statusGlyphs.info;
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
    const glyph = /** @type {Record<string, string>} */ (verdictGlyphs)[/** @type {string} */ (result)] ?? "";
    const trafficLight = emoji ? "🚦" : "[?]";
    const verdictBase = `${trafficLight}  VERDICT     ${glyph}  ${result ?? "UNKNOWN"}`;
    const verdictLine = c(verdictBase, palette.bold, palette[VERDICT_PALETTE[/** @type {string} */ (result)] ?? ""]);
    const lines = [padRight(verdictLine, innerWidth)];
    if (blockedBy) {
      lines.push(padRight(`${emoji ? "⛔" : "[!]"}  blocked by  ${blockedBy}`, innerWidth));
    }
    if (nextStep) {
      lines.push(padRight(`${emoji ? "📝" : "[>]"}  next step   ${nextStep}`, innerWidth));
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
    const marker = glyph ? (emoji ? glyph : box.bullet) : box.bullet;
    return `  ${marker} ${text}`;
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  function tip(text) {
    const marker = emoji ? "💡" : "[i]";
    return c(`  ${marker}  ${text}`, palette.cyan);
  }

  /**
   * @param {string} title
   * @param {string | string[]} body
   * @returns {string}
   */
  function section(title, body) {
    const marker = emoji ? "▾" : ">";
    const head = c(`${marker} ${title}`, palette.bold);
    const lines = Array.isArray(body) ? body : [body];
    return [head, ...lines.map((line) => `  ${line}`)].join("\n");
  }

  function rule() {
    return c(box.horizontal.repeat(width), palette.dim);
  }

  return { header, statusLine, verdict, bullet, tip, section, rule, emoji, color, width };
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

// Visual width of a string, approximating East-Asian / emoji glyphs as two
// cells. ANSI escape sequences are stripped first so colorized text pads correctly.
/**
 * @param {string} text
 * @returns {number}
 */
function visualWidth(text) {
  // eslint-disable-next-line no-control-regex
  const stripped = String(text).replace(/\x1b\[[0-9;]*m/g, "");
  let width = 0;
  for (const char of stripped) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;
    // Combining and variation-selector marks add nothing visually.
    if ((code >= 0x0300 && code <= 0x036f) || code === 0xfe0f || code === 0x200d) continue;
    if (code < 0x80) {
      width += 1;
      continue;
    }
    // Treat anything in the supplementary planes (emoji, CJK) as 2 cells.
    width += code >= 0x1100 ? 2 : 1;
  }
  return width;
}

/**
 * @param {string} text
 * @param {number} target
 * @returns {string}
 */
function padRight(text, target) {
  const current = visualWidth(text);
  if (current >= target) return text;
  return `${text}${" ".repeat(target - current)}`;
}
