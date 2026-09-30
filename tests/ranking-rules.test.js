import test from "node:test";
import assert from "node:assert/strict";
import { localeCatalogKey, isRunnableTestPath } from "../src/lib/code-map/classify.js";
import { collapseLocaleSiblings, isCopyRequest, requestLiterals, stripFileExtensions } from "../src/lib/ranking-rules.js";

test("localeCatalogKey groups the locales of one catalog and leaves other catalogs apart", () => {
  assert.equal(localeCatalogKey("messages/en-GB.json"), "messages/*.json");
  assert.equal(localeCatalogKey("messages/pcm-NG.json"), "messages/*.json");
  assert.equal(localeCatalogKey("locales/pt_BR/common.json"), "locales/*/common.json");
  assert.notEqual(localeCatalogKey("locales/en/common.json"), localeCatalogKey("locales/en/errors.json"));
  assert.equal(localeCatalogKey("config/locales/devise.en.yml"), "config/locales/devise.*.yml");
  // `ui` and `api` are not languages, so two catalogs named that way stay apart.
  assert.equal(localeCatalogKey("messages/ui.json"), null);
  assert.equal(localeCatalogKey("messages/api.json"), null);
});

test("collapseLocaleSiblings folds later locales into the first and never folds a pinned entry", () => {
  const entries = [
    { path: "messages/en-GB.json", kind: "translation" },
    { path: "src/app.ts", kind: "source" },
    { path: "messages/fr.json", kind: "translation" },
    { path: "messages/en-US.json", kind: "translation", pinned: true },
  ];
  const kept = collapseLocaleSiblings(
    entries,
    (entry) => entry,
    (entry) => Boolean(entry.pinned),
  );
  assert.deepEqual(
    kept.map((entry) => entry.path),
    ["messages/en-GB.json", "src/app.ts", "messages/en-US.json"],
  );
  assert.deepEqual(kept[0].siblings, ["messages/fr.json"]);
});

test("stripFileExtensions drops the extension of every named file and nothing else", () => {
  assert.equal(
    stripFileExtensions("event-service.ts only compares getHours; EditableDate.tsx blocks"),
    "event-service only compares getHours; EditableDate blocks",
  );
  assert.equal(stripFileExtensions("see utils/create-event.ts:49 and next.config.mjs"), "see utils/create-event:49 and next.config");
  assert.equal(stripFileExtensions("convert the helpers to ts"), "convert the helpers to ts");
});

test("requestLiterals reads named paths and identifier-shaped symbols, not prose", () => {
  const literals = requestLiterals("fix combineDateAndTime in (utils/create-event.ts:49). EditableDate.tsx and the date of birth field");
  assert.deepEqual(literals.paths, ["utils/create-event.ts", "EditableDate.tsx"]);
  // `EditableDate` inside `EditableDate.tsx` names the file, not a symbol.
  assert.deepEqual(literals.symbols, ["combineDateAndTime"]);
  assert.deepEqual(requestLiterals("open https://github.com/BASHBOP/solumbe/pull/12").paths, []);
});

test("isCopyRequest recognises requests about wording and translation only", () => {
  assert.equal(isCopyRequest(["fix", "wording", "banner"]), true);
  assert.equal(isCopyRequest(["i18n", "keys"]), true);
  assert.equal(isCopyRequest(["sync", "local", "main", "branch"]), false);
});

test("isRunnableTestPath excludes notes, snapshots and fixtures under test directories", () => {
  assert.equal(isRunnableTestPath("__tests__/utils/create-event.test.ts"), true);
  assert.equal(isRunnableTestPath("__tests__/README.md"), false);
  assert.equal(isRunnableTestPath("__tests__/__snapshots__/a.test.tsx.snap"), false);
  assert.equal(isRunnableTestPath("tests/fixtures/event.json"), false);
  assert.equal(isRunnableTestPath("src/lib/impact.js"), false);
});
