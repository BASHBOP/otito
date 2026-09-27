// One presentation for every command that emits a Markdown report.
//
// Commands like `ax`, `calibrate` and `harness` each build their own Markdown
// and printed it raw, so they looked nothing like `review` or `impact`. Rather
// than hand-write a bespoke renderer per command, this gives them all the same
// treatment: otito's header box, headings that read as headings, quiet
// structure around tables and lists, aligned table columns, and the closing
// line last.
//
// It changes presentation only. Every character of the source Markdown still
// reaches the terminal, so anything that greps otito's output keeps working,
// and `--json` and `--out` never come through here at all.

import { visualWidth } from "./fancy.js";

const ESC = String.fromCharCode(27);

/**
 * @param {string} markdown the report a command already produced
 * @param {{ title?: string, glyph?: string, subtitle?: string, close?: { status: "verified" | "tests-pass" | "runs" | "not-verified", detail?: string } }} meta
 * @param {any} renderer createRenderer() result
 * @returns {string}
 */
export function renderDocument(markdown, meta, renderer) {
  const paint = (/** @type {string} */ text, /** @type {string} */ code) => (renderer.color && code ? `${ESC}[${code}m${text}${ESC}[0m` : text);

  const lines = alignTables(String(markdown ?? "").split("\n"));
  const out = [];

  if (meta.title) {
    const headlines = meta.subtitle ? [paint(meta.subtitle, "2")] : [];
    out.push(renderer.header({ text: meta.title, glyph: meta.glyph }, headlines));
    out.push("");
  }

  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      out.push(paint(line, "2"));
      continue;
    }
    if (inFence) {
      out.push(paint(line, "2"));
      continue;
    }

    // A top-level heading is content, not decoration: dropping it loses the
    // report's own name, which is often more specific than the header box
    // title. Keep it, and skip it only when the box already says the same
    // thing, so "Code Map" under a "CODE MAP" box does not read twice.
    const h1 = line.match(/^#\s+(.*)$/);
    if (h1) {
      const normalize = (/** @type {string} */ text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");
      const heading = normalize(h1[1]);
      const boxed = normalize(meta.title ?? "");
      if (!(heading && boxed.includes(heading))) out.push(paint(h1[1], "1"));
      continue;
    }

    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      out.push("");
      out.push(renderer.section(h2[1], ""));
      continue;
    }

    const h3 = line.match(/^###\s+(.*)$/);
    if (h3) {
      out.push(`  ${paint(h3[1], "1")}`);
      continue;
    }

    // Blockquotes carry the caveats these reports lean on, so keep them quiet
    // but visible rather than letting them read as body text.
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      out.push(`  ${paint("|", "2")} ${paint(quote[1], "2")}`);
      continue;
    }

    // Table rules are structure, not content: dim them so the figures lead.
    if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) {
      out.push(paint(line, "2"));
      continue;
    }

    out.push(line);
  }

  // The closing line is always last: exactly one, after everything else.
  if (meta.close) {
    out.push("");
    out.push(renderer.close(meta.close));
  }

  // `section` renders a title plus an (empty) body, which leaves a line of
  // trailing spaces. Strip those, then collapse the blank runs the heading
  // rewrite introduces.
  return out
    .join("\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "");
}

/**
 * Pad the cells of each Markdown table so its columns line up. A table is a
 * run of consecutive lines that start and end with a pipe, outside a fence.
 * It is aligned only when every row splits into the same number of cells,
 * after honouring `\|` and code spans; otherwise it is left untouched. Only
 * spaces (or, in the rule row, dashes) are added; nothing is removed.
 * @param {string[]} lines
 * @returns {string[]}
 */
export function alignTables(lines) {
  const out = [...lines];
  let inFence = false;
  let start = -1;
  const flush = (/** @type {number} */ end) => {
    if (start !== -1 && end - start >= 2) alignBlock(out, start, end);
    start = -1;
  };
  out.forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      flush(index);
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    if (/^\s*\|.*\|\s*$/.test(line)) {
      if (start === -1) start = index;
      return;
    }
    flush(index);
  });
  flush(out.length);
  return out;
}

/**
 * @param {string[]} out
 * @param {number} start
 * @param {number} end
 */
function alignBlock(out, start, end) {
  /** @type {NonNullable<ReturnType<typeof splitRow>>[]} */
  const rows = [];
  for (let index = start; index < end; index += 1) {
    const row = splitRow(out[index]);
    if (!row) return;
    rows.push(row);
  }
  const columns = rows[0].cells.length;
  if (!rows.every((row) => row.cells.length === columns)) return;

  const widths = Array.from({ length: columns }, (_, column) => Math.max(...rows.map((row) => visualWidth(row.cells[column]))));
  rows.forEach((row, offset) => {
    const cells = row.cells.map((cell, column) => (row.rule ? padRule(cell, widths[column]) : padCell(cell, widths[column])));
    out[start + offset] = `${row.indent}|${cells.join("|")}|${row.trailing}`;
  });
}

/**
 * Split one table row into its verbatim cells. A pipe inside a code span or
 * escaped as `\|` is content, not a separator. Returns null when the row
 * cannot be read safely (an unclosed code span), so it stays untouched.
 * @param {string} line
 * @returns {{ indent: string, cells: string[], trailing: string, rule: boolean } | null}
 */
function splitRow(line) {
  const indent = line.match(/^\s*/)?.[0] ?? "";
  const trailing = line.match(/\s*$/)?.[0] ?? "";
  const inner = line.slice(indent.length, line.length - trailing.length);
  if (!inner.startsWith("|") || !inner.endsWith("|") || inner.length < 2) return null;
  const body = inner.slice(1, -1);

  const cells = [];
  let cell = "";
  let inCode = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === "\\" && body[index + 1] === "|") {
      cell += "\\|";
      index += 1;
      continue;
    }
    if (char === "`") inCode = !inCode;
    if (char === "|" && !inCode) {
      cells.push(cell);
      cell = "";
      continue;
    }
    cell += char;
  }
  if (inCode) return null;
  cells.push(cell);
  const rule = cells.every((entry) => /^\s*:?-+:?\s*$/.test(entry));
  return { indent, cells, trailing, rule };
}

/**
 * @param {string} cell
 * @param {number} width
 */
function padCell(cell, width) {
  return `${cell}${" ".repeat(Math.max(0, width - visualWidth(cell)))}`;
}

/**
 * Extend a rule cell's dashes, keeping its alignment colons where they are.
 * @param {string} cell
 * @param {number} width
 */
function padRule(cell, width) {
  const match = cell.match(/^(\s*:?)(-+)(:?\s*)$/);
  if (!match) return padCell(cell, width);
  return `${match[1]}${match[2]}${"-".repeat(Math.max(0, width - visualWidth(cell)))}${match[3]}`;
}
