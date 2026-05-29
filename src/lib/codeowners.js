// CODEOWNERS parser + matcher ported from pullpass/internal/codeowners.
// GitHub's CODEOWNERS format is a sparse glob spec — patterns are matched
// last-rule-wins, owners are split into direct users (@alice), teams
// (@org/team), and external mentions (email addresses, etc.).

import fs from "node:fs";
import path from "node:path";

const CANDIDATE_PATHS = [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"];

export function load(root) {
  for (const candidate of CANDIDATE_PATHS) {
    const absolute = path.join(root, candidate);
    try {
      const data = fs.readFileSync(absolute, "utf8");
      return { ok: true, ruleset: { path: candidate, rules: parse(data) } };
    } catch (error) {
      if (error.code === "ENOENT") continue;
      return { ok: false, error };
    }
  }
  return { ok: false, missing: true };
}

export function parse(text) {
  const rules = [];
  for (const rawLine of String(text ?? "").split(/\r?\n/)) {
    const trimmed = stripComment(rawLine).trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const pattern = parts[0].replace(/\\#/g, "#");
    rules.push({ pattern, owners: parts.slice(1) });
  }
  return rules;
}

export function ownedFiles(ruleset, files) {
  const owned = [];
  for (const file of files ?? []) {
    const match = matchFile(ruleset, file);
    if (match.owners.length > 0) owned.push(match);
  }
  return owned;
}

export function matchFile(ruleset, file) {
  let matched = { path: normalize(file), owners: [] };
  for (const rule of ruleset.rules ?? []) {
    if (matchPattern(rule.pattern, file)) {
      matched = { path: normalize(file), owners: rule.owners };
    }
  }
  return matched;
}

export function directUserOwners(owners) {
  return (owners ?? [])
    .map((owner) => String(owner).trim())
    .filter((owner) => owner.startsWith("@") && !owner.includes("/"))
    .map((owner) => owner.replace(/^@/, ""));
}

export function teamOwners(owners) {
  const teams = [];
  for (const raw of owners ?? []) {
    const owner = String(raw).trim();
    if (!owner.startsWith("@")) continue;
    const body = owner.slice(1);
    const slashIndex = body.indexOf("/");
    if (slashIndex <= 0) continue;
    const org = body.slice(0, slashIndex);
    const slug = body.slice(slashIndex + 1);
    if (!org || !slug) continue;
    teams.push({ owner, org, slug });
  }
  return teams;
}

export function hasExternalOwner(owners) {
  return (owners ?? []).some((owner) => {
    const trimmed = String(owner).trim();
    return trimmed !== "" && !trimmed.startsWith("@");
  });
}

export function hasTeamOrExternalOwner(owners) {
  return (owners ?? []).some((owner) => {
    const trimmed = String(owner).trim();
    if (!trimmed) return false;
    return !trimmed.startsWith("@") || trimmed.includes("/");
  });
}

function stripComment(line) {
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (char === "#" && !escaped) {
      return line.slice(0, i);
    }
    escaped = false;
  }
  return line;
}

function matchPattern(rawPattern, file) {
  const normalizedFile = normalize(file);
  let pattern = String(rawPattern ?? "")
    .trim()
    .replace(/\\/g, "/");
  const dirOnly = pattern.endsWith("/");
  pattern = normalize(pattern);
  if (!pattern) return false;

  const anchored = pattern.startsWith("/");
  if (anchored) pattern = pattern.slice(1);

  if (dirOnly) pattern += "/**";

  if (!pattern.includes("/")) {
    return regexMatch(`(^|.*/)${globRegex(pattern)}$`, normalizedFile);
  }
  const expr = anchored ? `^${globRegex(pattern)}$` : `(^|.*/)${globRegex(pattern)}$`;
  return regexMatch(expr, normalizedFile);
}

function globRegex(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i += 1;
        continue;
      }
      out += "[^/]*";
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      continue;
    }
    out += escapeRegex(char);
  }
  return out;
}

function escapeRegex(char) {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

function regexMatch(expr, value) {
  try {
    return new RegExp(expr).test(value);
  } catch {
    return false;
  }
}

function normalize(value) {
  let v = String(value ?? "")
    .trim()
    .replace(/\\/g, "/");
  v = pathClean(v);
  if (v === ".") return "";
  return v.replace(/^\.\//, "");
}

function pathClean(value) {
  const parts = value.split("/").filter((part) => part && part !== ".");
  const out = [];
  for (const part of parts) {
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else out.push("..");
    } else {
      out.push(part);
    }
  }
  if (out.length === 0) return value.startsWith("/") ? "/" : ".";
  return (value.startsWith("/") ? "/" : "") + out.join("/");
}
