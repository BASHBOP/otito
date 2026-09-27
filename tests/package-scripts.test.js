import test from "node:test";
import assert from "node:assert/strict";
import { headlessVariant, isTypeCheckScript, scriptSegments, selectScripts } from "../src/lib/package-scripts.js";

const preferred = ["lint", "typecheck", "type-check", "check:type", "tsc", "test", "test:e2e", "build"];

test("scriptSegments splits on separators and camelCase", () => {
  assert.deepEqual(scriptSegments("tsc:check"), ["tsc", "check"]);
  assert.deepEqual(scriptSegments("tsc-check"), ["tsc", "check"]);
  assert.deepEqual(scriptSegments("tscCheck"), ["tsc", "check"]);
  assert.deepEqual(scriptSegments("test:e2e:headless"), ["test", "e2e", "headless"]);
});

test("isTypeCheckScript recognises a type check by a whole segment of its name", () => {
  const names = [
    "tsc",
    "tsc:check",
    "check:tsc",
    "tsc-check",
    "tsc_check",
    "tscCheck",
    "tsc:noEmit",
    "lint:tsc",
    "vue-tsc",
    "typecheck",
    "typeCheck",
    "type-check",
    "check:type",
    "check-types",
    "types:check",
  ];
  for (const name of names) {
    assert.equal(isTypeCheckScript(name), true, `${name} should be a type check`);
  }
});

test("isTypeCheckScript leaves names that only contain the letters", () => {
  const names = [
    "tsconfig:sync",
    "etsc",
    "tscan",
    "pretsc",
    "prototype",
    "typedoc",
    "type-coverage",
    "types:generate",
    "check:content-type",
    "lint",
    "test",
    "build",
  ];
  for (const name of names) {
    assert.equal(isTypeCheckScript(name), false, `${name} should not be a type check`);
  }
});

test("isTypeCheckScript leaves the watch and build variants of a type check", () => {
  for (const name of ["tsc:watch", "watch:tsc", "typecheck:watch", "tsc:build", "build:tsc", "build:types"]) {
    assert.equal(isTypeCheckScript(name), false, `${name} should not be a type check`);
  }
});

test("selectScripts keeps the preferred order and drops the names a package lacks", () => {
  const scripts = { build: "next build", test: "jest", tsc: "tsc --noEmit", lint: "eslint .", "type-check": "tsc --noEmit", deploy: "echo deploy" };
  assert.deepEqual(selectScripts(scripts, preferred), ["lint", "type-check", "tsc", "test", "build"]);
  assert.deepEqual(selectScripts({}, preferred), []);
  assert.deepEqual(selectScripts(undefined, preferred), []);
});

test("selectScripts lists every type check of a package that has none the preferred list names, where the list names them", () => {
  const scripts = { test: "jest", "tsc:web": "tsc -p web --noEmit", lint: "eslint .", "check:tsc": "tsc --noEmit" };
  assert.deepEqual(selectScripts(scripts, preferred), ["lint", "check:tsc", "tsc:web", "test"]);
});

test("selectScripts adds no type check to a package whose type check the preferred list already names", () => {
  const scripts = { lint: "eslint .", "tsc:web": "tsc -p web --noEmit", "check:tsc": "tsc --noEmit", typecheck: "tsc --noEmit", test: "jest" };
  assert.deepEqual(selectScripts(scripts, preferred), ["lint", "typecheck", "test"]);
});

test("selectScripts finds no type check for a list that names none", () => {
  const scripts = { dev: "next dev", "tsc:check": "tsc --noEmit", start: "next start" };
  assert.deepEqual(selectScripts(scripts, ["dev", "start", "preview"]), ["dev", "start"]);
});

test("selectScripts leaves a type check that runs in watch mode", () => {
  const scripts = {
    typecheck: "tsc --noEmit --watch",
    "tsc:check": "tsc --noEmit",
    "tsc:dev": "tsc -p tsconfig.json -w",
    "tsc:live": "tsc --noEmit --watch=true",
  };
  assert.deepEqual(selectScripts(scripts, preferred), ["tsc:check"]);
});

test("selectScripts keeps a type check whose -w names an npm workspace", () => {
  const scripts = { typecheck: "npm run typecheck -w packages/app" };
  assert.deepEqual(selectScripts(scripts, preferred), ["typecheck"]);
});

test("selectScripts prefers the headless sibling of an end-to-end script", () => {
  const scripts = {
    test: "jest",
    "test:e2e": "playwright test --headed",
    "test:e2e:headless": "playwright test --reporter=line",
    "test:e2e:ui": "playwright test --ui",
  };
  assert.deepEqual(selectScripts(scripts, preferred), ["test", "test:e2e:headless"]);
});

test("selectScripts lists a headless end-to-end script that has no headed sibling", () => {
  assert.deepEqual(selectScripts({ "test:e2e-headless": "playwright test" }, preferred), ["test:e2e-headless"]);
});

test("selectScripts keeps the end-to-end script of a package with no headless sibling", () => {
  assert.deepEqual(selectScripts({ "test:e2e": "playwright test" }, preferred), ["test:e2e"]);
});

test("headlessVariant only answers for end-to-end scripts", () => {
  const scripts = { test: "jest", "test:headless": "playwright test", "test:e2e": "playwright test --headed", "test:e2e:headless": "playwright test" };
  assert.equal(headlessVariant(scripts, "test"), undefined);
  assert.equal(headlessVariant(scripts, "test:e2e"), "test:e2e:headless");
  assert.equal(headlessVariant(scripts, "test:e2e:headless"), undefined);
  assert.deepEqual(selectScripts(scripts, preferred), ["test", "test:e2e:headless"]);
});
