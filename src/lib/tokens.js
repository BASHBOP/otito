const charsPerToken = 4;

/**
 * @param {unknown} value
 * @returns {number}
 */
export function estimateTokens(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return Math.ceil(text.length / charsPerToken);
}

/**
 * @param {{ name: string, value: unknown }[]} sections
 */
export function estimateTokenSections(sections) {
  const items = sections.map((section) => ({
    name: section.name,
    tokens: estimateTokens(section.value),
    characters: textLength(section.value),
  }));

  return {
    estimated: true,
    method: `ceil(characters / ${charsPerToken})`,
    total: items.reduce((sum, item) => sum + item.tokens, 0),
    sections: items,
  };
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function textLength(value) {
  return (typeof value === "string" ? value : JSON.stringify(value ?? "")).length;
}
