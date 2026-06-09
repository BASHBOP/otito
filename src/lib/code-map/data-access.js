import { lineNumberAt } from "./text.js";

const sqlVerbAlternation =
  "SELECT|INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?|ALTER\\s+TABLE|DROP\\s+TABLE(?:\\s+IF\\s+EXISTS)?|MERGE\\s+INTO|TRUNCATE(?:\\s+TABLE)?|WITH";
const prismaOpRegex =
  /\b(?:prisma|db|tx|ctx\.db|this\.db)\.([a-z][a-zA-Z0-9_]*)\.(findUnique|findUniqueOrThrow|findFirst|findFirstOrThrow|findMany|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\b/g;

export function extractDataAccess(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const out = [];
  const seen = new Set();

  const stringRegex = /"""([\s\S]*?)"""|@"((?:[^"]|"")*)"|"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  const sqlStructureRegex = /\b(FROM|INTO|SET|VALUES|WHERE|JOIN|TABLE|GROUP\s+BY|ORDER\s+BY)\b/i;
  const verbRegex = new RegExp(`^(${sqlVerbAlternation})\\b`, "i");

  for (const match of text.matchAll(stringRegex)) {
    const content = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
    if (!content) continue;
    const trimmed = content.trim();
    const verbMatch = trimmed.match(verbRegex);
    if (!verbMatch) continue;
    if (!sqlStructureRegex.test(trimmed)) continue;
    const op = verbMatch[1].toUpperCase().split(/\s+/)[0];
    const table = inferSqlTable(trimmed, op);
    const line = lineNumberAt(text, match.index ?? 0);
    const key = `sql:${op}:${table ?? "?"}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source: "sql",
      op,
      table,
      line,
      snippet: trimmed.replace(/\s+/g, " ").slice(0, 100),
    });
  }

  for (const match of text.matchAll(prismaOpRegex)) {
    const line = lineNumberAt(text, match.index ?? 0);
    const key = `prisma:${match[2]}:${match[1]}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source: "prisma",
      op: match[2],
      table: match[1],
      line,
      snippet: match[0].slice(0, 100),
    });
  }

  return out;
}

function inferSqlTable(query, op) {
  let match;
  if (op === "SELECT" || op === "DELETE") {
    match = query.match(/\bFROM\s+([A-Za-z_][\w.]*)/i);
    if (match) return match[1];
  }
  if (op === "INSERT") {
    match = query.match(/\bINSERT\s+INTO\s+([A-Za-z_][\w.]*)/i);
    if (match) return match[1];
  }
  if (op === "UPDATE") {
    match = query.match(/\bUPDATE\s+([A-Za-z_][\w.]*)/i);
    if (match) return match[1];
  }
  if (op === "CREATE" || op === "DROP" || op === "ALTER" || op === "TRUNCATE") {
    match = query.match(/\b(?:TABLE\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?)?([A-Za-z_][\w.]*)/i);
    if (match) return match[1];
  }
  if (op === "MERGE") {
    match = query.match(/\bINTO\s+([A-Za-z_][\w.]*)/i);
    if (match) return match[1];
  }
  return undefined;
}
