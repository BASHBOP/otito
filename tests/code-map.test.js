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
