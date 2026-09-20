// One presentation for every command that emits a Markdown report.
//
// Commands like `ax`, `calibrate` and `harness` each build their own Markdown
// and printed it raw, so they looked nothing like `review` or `impact`. Rather
// than hand-write a bespoke renderer per command, this gives them all the same
// treatment: otito's header box, headings that read as headings, and quiet
// structure around tables and lists.
//
// It changes presentation only. Every character of the source Markdown still
// reaches the terminal, so anything that greps otito's output keeps working,
// and `--json` and `--out` never come through here at all.

const ESC = String.fromCharCode(27);

/**
 * @param {string} markdown the report a command already produced
 * @param {{ title?: string, glyph?: string, subtitle?: string }} meta
 * @param {any} renderer createRenderer() result
 * @returns {string}
 */
export function renderDocument(markdown, meta, renderer) {
  const paint = (/** @type {string} */ text, /** @type {string} */ code) => (renderer.color && code ? `${ESC}[${code}m${text}${ESC}[0m` : text);

  const lines = String(markdown ?? "").split("\n");
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
