import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateHarness } from "../src/lib/harness.js";

test("generateHarness returns commands, focus areas, and token estimates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "otito-harness-"));
  fs.mkdirSync(path.join(root, "src", "events"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "events-api",
      scripts: {
        lint: "eslint .",
        typecheck: "tsc --noEmit",
        test: "node --test",
        dev: "node src/main.ts",
      },
    }),
  );
  fs.writeFileSync(
    path.join(root, "src", "events", "events.controller.ts"),
    [
      "import { Controller, Get } from '@nestjs/common';",
      "@Controller('events')",
      "export class EventsController {",
      "  @Get(':id')",
      "  findOne() {}",
      "}",
      "",
    ].join("\n"),
  );

  const result = generateHarness(root);
  assert.equal(result.data.ok, true);
  assert.equal(result.data.repo.name, "events-api");
  assert.ok(result.data.commands.setup.some((command) => command.command === "npm install"));
  assert.ok(result.data.commands.validate.some((command) => command.command === "npm test"));
  assert.ok(result.data.commands.runtime.some((command) => command.command === "npm run dev"));
  assert.ok(result.data.focusAreas.includes("backend request controllers"));
  assert.ok(result.data.tokenEstimate.fullJson > 0);
  assert.match(result.markdown, /# otito Harness: events-api/);
  assert.match(result.markdown, /## Token Budget/);
});
