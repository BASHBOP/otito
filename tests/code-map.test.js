import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateCodeMap } from "../src/lib/code-map.js";

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
