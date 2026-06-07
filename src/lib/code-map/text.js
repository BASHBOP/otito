// Generic text-parsing utilities shared by the AST extractors and the
// route/decorator classifiers. Everything here is language-agnostic: we
// skip strings/comments and walk source character-by-character.

export function lineNumberAt(text, index) {
  return text.slice(0, index).split("\n").length;
}

export function stripNonCode(text) {
  const chars = [];
  let index = 0;
  while (index < text.length) {
    const next = skipNonCode(text, index);
    if (next !== index) {
      for (let cursor = index; cursor < next; cursor += 1) {
        chars.push(text[cursor] === "\n" ? "\n" : " ");
      }
      index = next;
      continue;
    }

    chars.push(text[index]);
    index += 1;
  }
  return chars.join("");
}

export function readDecoratorCalls(text, names) {
  const calls = [];
  let index = 0;
  while (index < text.length) {
    const next = skipNonCode(text, index);
    if (next !== index) {
      index = next;
      continue;
    }

    if (text[index] !== "@") {
      index += 1;
      continue;
    }

    const name = names.find((candidate) => text.startsWith(candidate, index + 1) && !isIdentifierChar(text[index + 1 + candidate.length]));
    if (!name) {
      index += 1;
      continue;
    }

    let cursor = skipWhitespace(text, index + 1 + name.length);
    let argument;
    if (text[cursor] === "(") {
      const parsed = parseFirstCallArgument(text, cursor);
      argument = parsed.value;
      cursor = parsed.end;
    }
    calls.push({ name, argument });
    index = Math.max(cursor, index + 1);
  }
  return calls;
}

export function readStringCallArguments(text, callee) {
  const args = [];
  let index = 0;
  while (index < text.length) {
    const next = skipNonCode(text, index);
    if (next !== index) {
      index = next;
      continue;
    }

    const before = text[index - 1];
    const after = text[index + callee.length];
    if (!text.startsWith(callee, index) || isIdentifierChar(before) || isIdentifierChar(after)) {
      index += 1;
      continue;
    }

    const openParen = skipWhitespace(text, index + callee.length);
    if (text[openParen] !== "(") {
      index += 1;
      continue;
    }

    const parsed = parseFirstCallArgument(text, openParen);
    if (parsed.value) {
      args.push(parsed.value);
    }
    index = Math.max(parsed.end, index + 1);
  }
  return args;
}

function parseFirstCallArgument(text, openParenIndex) {
  let cursor = skipWhitespace(text, openParenIndex + 1);
  if (text[cursor] === ")" || cursor >= text.length) {
    return { value: "", end: cursor + 1 };
  }

  if (isQuote(text[cursor])) {
    const parsed = parseStringLiteral(text, cursor);
    return { value: parsed.value, end: findClosingParen(text, parsed.end) };
  }

  return { value: undefined, end: findClosingParen(text, cursor) };
}

function findClosingParen(text, start) {
  let depth = 1;
  let index = start;
  while (index < text.length) {
    const next = skipNonCode(text, index);
    if (next !== index) {
      index = next;
      continue;
    }
    if (text[index] === "(") {
      depth += 1;
    } else if (text[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
    index += 1;
  }
  return text.length;
}

function skipNonCode(text, index) {
  if (text[index] === "/" && text[index + 1] === "/") {
    const newline = text.indexOf("\n", index + 2);
    return newline === -1 ? text.length : newline;
  }
  if (text[index] === "/" && text[index + 1] === "*") {
    const end = text.indexOf("*/", index + 2);
    return end === -1 ? text.length : end + 2;
  }
  if (isQuote(text[index])) {
    return parseStringLiteral(text, index).end;
  }
  return index;
}

function parseStringLiteral(text, start) {
  const quote = text[start];
  let value = "";
  let index = start + 1;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      if (index + 1 < text.length) {
        value += text[index + 1];
      }
      index += 2;
      continue;
    }
    if (char === quote) {
      return { value, end: index + 1 };
    }
    if (quote === "`" && char === "$" && text[index + 1] === "{") {
      return { value, end: skipTemplateLiteral(text, start) };
    }
    value += char;
    index += 1;
  }
  return { value, end: text.length };
}

function skipTemplateLiteral(text, start) {
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] === "`") {
      return index + 1;
    }
    index += 1;
  }
  return text.length;
}

function skipWhitespace(text, index) {
  let cursor = index;
  while (/\s/.test(text[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function isQuote(char) {
  return char === "'" || char === '"' || char === "`";
}

function isIdentifierChar(char) {
  return Boolean(char && /[A-Za-z0-9_$]/.test(char));
}
