import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateCodeMap } from "../src/lib/code-map.js";

// These tests exercise the TypeScript-parser path in code-map/ast.js through the
// public generateCodeMap API for plain JavaScript (ScriptKind.JS) inputs — the
// path the README advertises as "the TypeScript parser for JS/TS code maps".
//
// NOTE: ast.js also has a regex-based fallback in its catch block, but
// ts.createSourceFile is error-tolerant and does not throw on malformed JS/TS
// (verified: deeply broken inputs still parse to an error-bearing AST). That
// fallback is therefore unreachable through generateCodeMap for .js/.ts inputs,
// and ast.js is owned by another agent, so it cannot be made injectable from
// here. See the agent notes for the recommended follow-up.

test("generateCodeMap parses CommonJS require() and module exports in a .js file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otito-ast-cjs-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "cjs-fixture" }));
  fs.writeFileSync(
    path.join(root, "service.js"),
    [
      'const express = require("express");',
      'const { Pool } = require("pg");',
      "",
      "function createServer() {",
      "  return express();",
      "}",
      "",
      "module.exports = { createServer };",
      "",
    ].join("\n"),
  );

  const result = generateCodeMap(root);
  const file = result.files.find((f) => f.path === "service.js");
  assert.ok(file, "the .js file is in the map");
  assert.ok(file.imports.includes("express"), "require('express') captured");
  assert.ok(file.imports.includes("pg"), "destructured require('pg') captured");
  assert.ok(
    file.symbols.some((s) => s.type === "function" && s.name === "createServer"),
    "top-level function symbol captured",
  );
});

test("generateCodeMap parses ESM import/export in a .mjs file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otito-ast-mjs-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "mjs-fixture" }));
  fs.writeFileSync(
    path.join(root, "util.mjs"),
    [
      'import { readFile } from "node:fs/promises";',
      "",
      "export const VERSION = 2;",
      "export function loadConfig() {",
      '  return readFile("config.json");',
      "}",
      "",
    ].join("\n"),
  );

  const result = generateCodeMap(root);
  const file = result.files.find((f) => f.path === "util.mjs");
  assert.ok(file, "the .mjs file is in the map");
  assert.ok(file.imports.includes("node:fs/promises"), "ESM import source captured");
  assert.ok(file.exports.includes("VERSION"), "exported const captured");
  assert.ok(file.exports.includes("loadConfig"), "exported function captured");
  assert.ok(file.symbols.some((s) => s.type === "const" && s.name === "VERSION"));
  assert.ok(file.symbols.some((s) => s.type === "function" && s.name === "loadConfig"));
});

test("generateCodeMap tolerates syntactically broken JS without throwing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otito-ast-broken-"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "broken-fixture" }));
  // Deliberately malformed: unbalanced braces and a dangling export.
  fs.writeFileSync(path.join(root, "broken.js"), "export const ok = true;\nfunction half( {\n  return\n");

  let result;
  assert.doesNotThrow(() => {
    result = generateCodeMap(root);
  });
  const file = result.files.find((f) => f.path === "broken.js");
  assert.ok(file, "broken file is still mapped, not dropped");
  // The error-tolerant parser still recovers the valid leading declaration.
  assert.ok(file.exports.includes("ok"), "valid leading export recovered despite later syntax errors");
});
