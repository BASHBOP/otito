import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { codeMapCapabilityProbes, codeMapCapabilitySignature } from "../src/lib/code-map/capabilities.js";

const probeFor = (probePath) => codeMapCapabilityProbes().find((probe) => probe.path === probePath);

test("the signature is stable across calls", () => {
  assert.equal(codeMapCapabilitySignature(), codeMapCapabilitySignature());
  assert.match(codeMapCapabilitySignature(), /^cap1:[0-9a-f]{16}$/);
});

test("the signature is a pure function of the probe answers", () => {
  // Recomputing it from the probes proves the coupling: nothing can change a
  // probe's answer without changing the signature, which is the whole point.
  const expected = crypto
    .createHash("sha256")
    .update(
      codeMapCapabilityProbes()
        .map((probe) => `${probe.path}=${probe.indexed ? probe.kind : "-"}`)
        .join("\n"),
    )
    .digest("hex");
  assert.equal(codeMapCapabilitySignature(), `cap1:${expected.slice(0, 16)}`);
});

// The corpus is only useful if it actually observes the capability that went
// missing. These pin the #175 file class into the signature's input.
test("the corpus observes markdown eligibility and its kinds", () => {
  assert.deepEqual(probeFor("docs/guide.md"), { path: "docs/guide.md", indexed: true, kind: "doc" });
  assert.deepEqual(probeFor("skills/model-router/SKILL.md"), { path: "skills/model-router/SKILL.md", indexed: true, kind: "skill" });
  assert.deepEqual(probeFor("CHANGELOG.md"), { path: "CHANGELOG.md", indexed: true, kind: "changelog" });
  assert.deepEqual(probeFor("README.md"), { path: "README.md", indexed: true, kind: "doc" });
});

test("the corpus observes what is deliberately not indexed", () => {
  for (const probePath of ["package.json", "tsconfig.json", "package-lock.json", "src/styles.css", "assets/logo.png", "Makefile"]) {
    assert.deepEqual(probeFor(probePath), { path: probePath, indexed: false, kind: null }, `${probePath} must stay out of the index`);
  }
});

test("every probe path is distinct", () => {
  const paths = codeMapCapabilityProbes().map((probe) => probe.path);
  assert.equal(new Set(paths).size, paths.length, "a duplicated probe adds nothing and makes the corpus harder to read");
});
