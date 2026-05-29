// Fancy terminal renderer used by repoctx commands that produce a verdict or
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

export function shouldUseEmoji(env = process.env, options = {}) {
  if (options.emoji === true) return true;
  if (options.emoji === false) return false;
  if (env.NO_EMOJI === "1" || env.NO_EMOJI === "true") return false;
  if (env.CI === "true" || env.CI === "1") return false;
  return true;
}

export function createRenderer(options = {}) {
  const emoji = options.emoji ?? shouldUseEmoji(process.env, options);
  const width = clamp(options.width ?? defaultWidth(), 60, 120);
  const box = emoji ? BOX_FANCY : BOX_PLAIN;
  const statusGlyphs = emoji ? STATUS_GLYPHS_FANCY : STATUS_GLYPHS_PLAIN;
  const verdictGlyphs = emoji ? VERDICT_GLYPHS_FANCY : VERDICT_GLYPHS_PLAIN;

  function header(title, lines = []) {
    const innerWidth = width - 4;
    const rendered = [renderHeadline(title), ...lines.map(renderHeadline)].map((line) => padRight(line, innerWidth));
    const top = `${box.topLeft}${box.horizontal.repeat(width - 2)}${box.topRight}`;
    const bottom = `${box.bottomLeft}${box.horizontal.repeat(width - 2)}${box.bottomRight}`;
    const middle = rendered.map((line) => `${box.vertical}  ${line}  ${box.vertical}`);
    return [top, ...middle, bottom].join("\n");
  }

  function renderHeadline(value) {
    if (typeof value === "string") return value;
    const { text, glyph } = value ?? {};
    if (emoji && glyph) return `${glyph}  ${text ?? ""}`;
    return text ?? "";
  }

  function statusLine(status, name, summary, details = []) {
    const glyph = statusGlyphs[status] ?? statusGlyphs.info;
    const head = `  ${glyph}  ${padRight(name, 22)} ${summary}`;
    const tail = details.map((detail) => `     ${box.arrow} ${detail}`);
    return [head, ...tail].join("\n");
  }

  function verdict({ verdict: result, blockedBy, nextStep } = {}) {
    const innerWidth = width - 4;
    const glyph = verdictGlyphs[result] ?? "";
    const lines = [padRight(`🚦  VERDICT     ${glyph}  ${result ?? "UNKNOWN"}`.replace("🚦", emoji ? "🚦" : "[?]"), innerWidth)];
    if (blockedBy) {
      lines.push(padRight(`${emoji ? "⛔" : "[!]"}  blocked by  ${blockedBy}`, innerWidth));
    }
    if (nextStep) {
      lines.push(padRight(`${emoji ? "📝" : "[>]"}  next step   ${nextStep}`, innerWidth));
    }
    const top = `${box.topLeft}${box.horizontal.repeat(width - 2)}${box.topRight}`;
    const bottom = `${box.bottomLeft}${box.horizontal.repeat(width - 2)}${box.bottomRight}`;
    const middle = lines.map((line) => `${box.vertical}  ${line}  ${box.vertical}`);
    return [top, ...middle, bottom].join("\n");
  }

  function bullet(text, glyph) {
    const marker = glyph ? (emoji ? glyph : box.bullet) : box.bullet;
    return `  ${marker} ${text}`;
  }

  function tip(text) {
    const marker = emoji ? "💡" : "[i]";
    return `  ${marker}  ${text}`;
  }

  function section(title, body) {
    const marker = emoji ? "▾" : ">";
    const head = `${marker} ${title}`;
    const lines = Array.isArray(body) ? body : [body];
    return [head, ...lines.map((line) => `  ${line}`)].join("\n");
  }

  function rule() {
    return box.horizontal.repeat(width);
  }

  return { header, statusLine, verdict, bullet, tip, section, rule, emoji, width };
}

function defaultWidth() {
  const cols = process?.stdout?.columns;
  return typeof cols === "number" && cols >= 60 ? cols : 78;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Visual width of a string, approximating East-Asian / emoji glyphs as two
// cells. Good enough for terminal alignment; not Unicode-spec exact.
function visualWidth(text) {
  let width = 0;
  for (const char of String(text)) {
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

function padRight(text, target) {
  const current = visualWidth(text);
  if (current >= target) return text;
  return `${text}${" ".repeat(target - current)}`;
}
