import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateCodeMap, isVendorFile } from "../src/lib/code-map.js";

test("generateCodeMap classifies Next routes and symbols", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-map-web-"));
  fs.mkdirSync(path.join(root, "app", "events"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0" } }));
  fs.writeFileSync(path.join(root, "app", "events", "page.tsx"), "export default function EventsPage() { return null; }\nexport const count = 1;\n");

  const result = generateCodeMap(root);
  assert.equal(result.ok, true);
  assert.equal(result.summary.routes, 1);
  assert.ok(result.files[0].symbols.some((symbol) => symbol.name === "count"));
});

test("generateCodeMap classifies Nest controllers and methods", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-map-api-"));
  fs.mkdirSync(path.join(root, "src", "events"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ main: "dist/main" }));
  fs.writeFileSync(
    path.join(root, "src", "events", "events.controller.ts"),
    "import { Controller, Get } from '@nestjs/common';\n@Controller('events')\nexport class EventsController {\n  @Get(':id')\n  findOne() {}\n}\n",
  );

  const result = generateCodeMap(root);
  assert.equal(result.summary.controllers, 1);
  assert.equal(result.files[0].controllerBasePath, "events");
  assert.deepEqual(result.files[0].httpMethods, [{ method: "GET", path: ":id" }]);
});

test("generateCodeMap ignores code-like strings in fixtures", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-map-fixture-"));
  fs.mkdirSync(path.join(root, "tests"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "tests", "fixture.test.ts"),
    [
      "const fixture = \"import { Controller, Get } from '@nestjs/common';\\n@Controller('fake')\\nexport class FakeController { @Get(':id') find() {} }\";",
      "export const realFixture = true;",
      "",
    ].join("\n"),
  );

  const result = generateCodeMap(root);
  assert.equal(result.summary.controllers, 0);
  assert.equal(result.files[0].controllerBasePath, undefined);
  assert.deepEqual(result.files[0].httpMethods, []);
  assert.deepEqual(result.files[0].imports, []);
  assert.ok(result.files[0].symbols.some((symbol) => symbol.name === "realFixture"));
  assert.ok(!result.files[0].symbols.some((symbol) => symbol.name === "FakeController"));
});

test("generateCodeMap classifies Go source and test files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-map-go-"));
  fs.mkdirSync(path.join(root, "internal", "githubpr"), { recursive: true });
  fs.writeFileSync(path.join(root, "go.mod"), "module example.com/pullpass\n\ngo 1.22\n");
  fs.writeFileSync(
    path.join(root, "internal", "githubpr", "evaluate.go"),
    [
      "package githubpr",
      "",
      'import "context"',
      "",
      "type Report struct{}",
      "",
      "func Evaluate(ctx context.Context) Report {",
      "  return Report{}",
      "}",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "internal", "githubpr", "evaluate_test.go"),
    ["package githubpr", "", 'import "testing"', "", "func TestEvaluate(t *testing.T) {", "  _ = Evaluate", "}", ""].join("\n"),
  );

  const result = generateCodeMap(root);
  const sourceFile = result.files.find((file) => file.path === "internal/githubpr/evaluate.go");
  const testFile = result.files.find((file) => file.path === "internal/githubpr/evaluate_test.go");

  assert.equal(result.summary.tests, 1);
  assert.ok(sourceFile);
  assert.ok(testFile);
  assert.equal(sourceFile.kind, "source");
  assert.equal(testFile.kind, "test");
  assert.deepEqual(testFile.imports, ["testing"]);
  assert.ok(testFile.symbols.some((symbol) => symbol.name === "TestEvaluate"));
});

test("generateCodeMap extracts C# namespace, class, interface, enum, methods, and using-directives", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-map-cs-"));
  fs.writeFileSync(
    path.join(root, "booking.aspx.cs"),
    [
      "using System;",
      "using System.Data;",
      "using System.Data.SqlClient;",
      "",
      "namespace WebProject",
      "{",
      "    public partial class booking : System.Web.UI.Page",
      "    {",
      "        protected void Page_Load(object sender, EventArgs e)",
      "        {",
      "            if (!IsPostBack) { LoadOwner(); }",
      "        }",
      "",
      "        protected void bookBtn_Click(object sender, EventArgs e) { }",
      "",
      "        private void LoadOwner() { }",
      "    }",
      "",
      "    internal interface IBookingService { void Book(int ownerId); }",
      "",
      "    public enum BookingStatus { InProgress, Completed, Cancelled }",
      "}",
      "",
    ].join("\n"),
  );

  const result = generateCodeMap(root);
  const file = result.files.find((f) => f.path === "booking.aspx.cs");
  assert.ok(file, "C# code-behind should be in the map");
  assert.ok(file.imports.includes("System.Data.SqlClient"), "should extract using directives");
  assert.ok(file.exports.includes("booking"), "public class is exported");
  assert.ok(file.exports.includes("BookingStatus"), "public enum is exported");
  assert.ok(!file.exports.includes("IBookingService"), "internal interface is not exported");
  assert.ok(file.symbols.some((s) => s.type === "namespace" && s.name === "WebProject"));
  assert.ok(file.symbols.some((s) => s.type === "class" && s.name === "booking"));
  assert.ok(file.symbols.some((s) => s.type === "interface" && s.name === "IBookingService"));
  assert.ok(file.symbols.some((s) => s.type === "enum" && s.name === "BookingStatus"));
  assert.ok(file.symbols.some((s) => s.type === "method" && s.name === "bookBtn_Click"));
  assert.ok(file.symbols.some((s) => s.type === "method" && s.name === "LoadOwner"));
});

test("generateCodeMap extracts Python classes, functions, imports, with comments/strings ignored", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-map-py-"));
  fs.writeFileSync(
    path.join(root, "service.py"),
    [
      '"""Module docstring with class Foo and def bar inside that should not match."""',
      "import os",
      "import sys as system",
      "import json, csv",
      "from fastapi import APIRouter, Depends",
      "from .auth import current_user",
      "from ..db import get_db",
      "",
      "# A comment with class FakeClass should be ignored",
      'COMMENT_LIKE = "class NotAClass:"',
      "",
      "class BookingService:",
      '    """def inside_string is not a function."""',
      "    def __init__(self, db):",
      "        self._db = db",
      "    async def create(self, body):",
      "        return await self._db.booking.create(data=body)",
      "    def _private_helper(self):",
      "        return None",
      "",
      "def helper_function(x):",
      "    return x * 2",
      "",
      "async def background_job():",
      "    pass",
      "",
      "class _Private:",
      "    pass",
      "",
    ].join("\n"),
  );

  const result = generateCodeMap(root);
  const file = result.files.find((f) => f.path === "service.py");
  assert.ok(file, "Python file should be in the map");

  assert.ok(file.imports.includes("os"));
  assert.ok(file.imports.includes("sys"), "alias should be stripped (sys as system → sys)");
  assert.ok(file.imports.includes("json") && file.imports.includes("csv"), "comma-separated imports both captured");
  assert.ok(file.imports.includes("fastapi"));
  assert.ok(file.imports.includes(".auth"), "relative imports preserved");
  assert.ok(file.imports.includes("..db"));

  assert.ok(file.symbols.some((s) => s.type === "class" && s.name === "BookingService"));
  assert.ok(file.symbols.some((s) => s.type === "class" && s.name === "_Private"));
  assert.ok(file.symbols.some((s) => s.type === "function" && s.name === "helper_function"));
  assert.ok(
    file.symbols.some((s) => s.type === "function" && s.name === "background_job"),
    "async def captured",
  );

  assert.ok(!file.symbols.some((s) => s.name === "Foo"), "class in docstring not matched");
  assert.ok(!file.symbols.some((s) => s.name === "FakeClass"), "class in comment not matched");
  assert.ok(!file.symbols.some((s) => s.name === "NotAClass"), "class in string literal not matched");
  assert.ok(!file.symbols.some((s) => s.type === "function" && s.name === "bar"), "def in docstring not matched");

  assert.ok(file.exports.includes("BookingService"));
  assert.ok(file.exports.includes("helper_function"));
  assert.ok(!file.exports.includes("_Private"), "underscore-prefixed names excluded from exports");
  assert.ok(!file.exports.includes("_private_helper"));
  assert.ok(!file.exports.includes("__init__"));
});

test("isVendorFile detects minified, library-named, and vendor-pathed files", () => {
  assert.equal(isVendorFile("js/jquery.min.js", ""), true, ".min.js suffix");
  assert.equal(isVendorFile("js/app.bundle.js", ""), true, ".bundle.js suffix");
  assert.equal(isVendorFile("vendor/anything.js", ""), true, "vendor/ path");
  assert.equal(isVendorFile("node_modules/foo/index.js", ""), true, "node_modules/ path");
  assert.equal(isVendorFile("bower_components/foo.js", ""), true, "bower_components/ path");
  assert.equal(isVendorFile("dist/bundle.js", ""), true, "dist/ path");
  assert.equal(isVendorFile("js/Bootstrap.js", ""), true, "library prefix (bootstrap, case-insensitive)");
  assert.equal(isVendorFile("js/jqueryv2.1.4.min.js", ""), true, "jquery prefix");
  assert.equal(isVendorFile("js/angular.min.js", ""), true, "angular prefix");

  assert.equal(isVendorFile("js/app.js", ""), false, "app.js is not vendor");
  assert.equal(isVendorFile("js/autocomplete.js", ""), false, "autocomplete.js is not vendor");
  assert.equal(isVendorFile("src/lib/foo.ts", ""), false, "normal source file");
  assert.equal(isVendorFile("src/components/Button.tsx", ""), false, "component file");

  const longLineBlob = "x".repeat(2000) + "\n" + "y\n".repeat(30000);
  assert.equal(isVendorFile("js/something.js", longLineBlob), true, "large file with very long lines (minified heuristic)");
});

test("generateCodeMap flags vendor files via isVendor and downstream filters them in context_pack", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dev-context-map-vendor-"));
  fs.mkdirSync(path.join(root, "js"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "js", "jquery.min.js"), "// fake jquery\n");
  fs.writeFileSync(path.join(root, "js", "Bootstrap.js"), "// fake bootstrap\n");
  fs.writeFileSync(path.join(root, "js", "app.js"), "const x = 1;\n");
  fs.writeFileSync(path.join(root, "src", "main.ts"), "export function bookingHandler() { return 42; }\n");

  const result = generateCodeMap(root);
  const byPath = Object.fromEntries(result.files.map((f) => [f.path, f]));
  assert.equal(byPath["js/jquery.min.js"].isVendor, true);
  assert.equal(byPath["js/Bootstrap.js"].isVendor, true);
  assert.equal(byPath["js/app.js"].isVendor, false);
  assert.equal(byPath["src/main.ts"].isVendor, false);
});
