# 🚀 Publishing an MCP Server to npm + the MCP Registry

This guide walks the full publish path for a stdio MCP server, using
`@bashbop/otito` as the worked example. Follow it once and your server
becomes installable by anyone via `npm install -g`, discoverable by any
registry-aware MCP host (Claude Desktop, Claude Code, Codex CLI, Cursor,
Goose), and verifiably owned by you.

The guide is written in the order you should execute it. Every step lists
exactly one decision or command. Three real publish errors are documented
inline so you skip the round-trips we hit.

---

## ✅ Prerequisites

- [Node.js 18.18 or newer](https://nodejs.org)
- [Homebrew](https://brew.sh) (macOS/Linux) or the `mcp-publisher` release tarball
- [npm](https://npmjs.com) account (free)
- [GitHub](https://github.com) account that owns the repository

---

## 1. 🎯 Decide your scope

The npm registry has a global namespace. Many sensible names are taken.
Two options:

| Option | Format | When to use |
| --- | --- | --- |
| Bare name | `otito` | Only if `npm view <name>` returns 404 |
| Scoped name | `@yourorg/otito` | **Recommended** — free, immediate, brand-consistent with your GitHub org |

Check availability before deciding:

```bash
npm view otito version          # 404 = free; any version number = taken
npm view @yourorg/otito version
```

For this guide we use `@bashbop/otito`.

---

## 2. 📋 Prepare `package.json` for publishing

Add or update these fields:

```json
{
  "name": "@bashbop/otito",
  "version": "1.0.2",
  "mcpName": "io.github.BASHBOP/otito",
  "bin": {
    "otito": "src/cli.js"
  },
  "files": [
    "src",
    "scripts",
    "README.md",
    "LICENSE",
    "CHANGELOG.md"
  ],
  "publishConfig": {
    "access": "public"
  },
  "engines": {
    "node": ">=18.18"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/BASHBOP/otito.git"
  },
  "homepage": "https://bashbop.github.io/otito/",
  "bugs": {
    "url": "https://github.com/BASHBOP/otito/issues"
  },
  "keywords": ["mcp", "mcp-server", "cli", "developer-tools"]
}
```

!!! warning "Don't forget `mcpName` and `publishConfig.access`"
    Scoped packages publish **private** by default. Without
    `publishConfig.access: "public"`, the publish will succeed but no one
    can install your package without an npm paid plan. And without
    `mcpName`, the MCP Registry publish will fail later with HTTP 400.

---

## 3. 🧪 Run a dry-run

Before authenticating to npm, see exactly what would ship:

```bash
npm publish --dry-run
```

Eyeball the file list. Your tarball should contain only what's in the
`files` array. **If you see `tests/`, `node_modules/`, `.otito/`, or
`coverage/` listed, stop and tighten your `files` array.**

A healthy CLI tarball is typically 50–200 kB.

---

## 4. 🔐 Authenticate to npm

```bash
npm login
```

For a brand-new scope you'll also need to create the matching
**organization** at <https://www.npmjs.com/org/create>:

- Name must exactly match the scope in `package.json` (lowercase)
- Choose the **Free** tier (unlimited public packages, $0/month)

!!! danger "Common error: `404 Scope not found`"
    If you skip the org creation step, `npm publish` fails with
    ```
    404 Not Found - PUT https://registry.npmjs.org/@yourorg%2fyourpackage
    Scope not found
    ```
    Create the org at the URL above, then re-run `npm publish`. No code
    changes needed.

---

## 5. 📦 First npm publish

```bash
npm publish
```

If 2FA is on your account, npm prompts for an OTP. After success you'll
see:

```
+ @bashbop/otito@1.0.0
```

Verify immediately:

```bash
npm view @bashbop/otito version       # → 1.0.0
npx -y @bashbop/otito --help          # after publication: downloads fresh and runs the CLI
```

!!! warning "npm versions are immutable"
    You **cannot** republish `1.0.0` after it's live. If you spot a typo,
    you ship the next patch release. You have a 72-hour window to `npm unpublish` a
    version; after that it's permanent. So always `npm publish --dry-run`
    immediately before the real publish.

---

## 6. 🧰 Install the MCP Publisher CLI

The MCP Registry uses its own publishing tool that handles GitHub OAuth
and manifest validation.

```bash
brew install mcp-publisher
```

Or download a binary release from
<https://github.com/modelcontextprotocol/registry/releases>.

---

## 7. 📝 Write `server.json`

The MCP Registry reads a manifest file named `server.json` at the root of
your repo (next to `package.json`). Minimal valid example:

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.BASHBOP/otito",
  "title": "otito",
  "description": "Local-first code context, impact analysis, and merge-readiness verdicts for AI agents.",
  "websiteUrl": "https://bashbop.github.io/otito/",
  "repository": {
    "url": "https://github.com/BASHBOP/otito",
    "source": "github",
    "id": "1242199320"
  },
  "version": "1.0.2",
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@bashbop/otito",
      "version": "1.0.2",
      "transport": {
        "type": "stdio"
      },
      "packageArguments": [
        {
          "type": "positional",
          "value": "mcp"
        }
      ]
    }
  ]
}
```

### Field reference

| Field | Rule | Notes |
| --- | --- | --- |
| `name` | Must match `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`, max 200 chars | For GitHub auth, the prefix MUST be `io.github.<your-username>/` |
| `title` | 1–100 chars | Human-readable display name shown in registry list views |
| `description` | **1–100 chars** | ⚠️ Hard cap. Trim early. |
| `websiteUrl` | URI | Canonical homepage — your docs site, not the GitHub repo |
| `repository.id` | string | GitHub repo numeric ID. Get it with `gh api repos/<owner>/<repo> --jq '.id'`. Prevents namespace-resurrection attacks. |
| `version` | SemVer, not "latest", not a range | Must match `packages[0].version` |
| `packages[0].registryType` | `npm` / `pypi` / `oci` / `nuget` / `mcpb` | |
| `packages[0].identifier` | npm package name | Must match what you published in step 5 |
| `packages[0].transport.type` | `stdio` / `streamable-http` / `sse` | `stdio` for CLI-based MCP servers |
| `packages[0].packageArguments` | array of arg specs | Required if your server entry point needs subcommand args. Each entry is `{"type":"positional","value":"<arg>"}` or `{"type":"positional","valueHint":"<hint>"}` |

!!! danger "Common error: description too long"
    First publish attempt for `@bashbop/otito` failed with:
    ```
    HTTP 422 Unprocessable Entity
    {"message":"expected length <= 100","location":"body.description"}
    ```
    The original description was 272 characters. Registry list views
    render descriptions inline; the 100-char cap is enforced.

---

## 8. 🔐 Authenticate `mcp-publisher` to GitHub

```bash
mcp-publisher login github
```

Device-code OAuth flow opens your browser. The GitHub account you log in
with **must own** the `<your-username>` namespace in `server.json.name`.
For `io.github.BASHBOP/otito` the GitHub organization must be `BASHBOP`; preserve the exact casing the registry grants to its GitHub OIDC publisher.

---

## 9. 🚀 First registry publish

```bash
mcp-publisher publish
```

The CLI reads `server.json` from the current directory and submits it.

!!! danger "Common error: `mcpName field missing`"
    Most common first-publish failure:
    ```
    HTTP 400 Bad Request
    NPM package '@bashbop/otito' is missing required 'mcpName' field.
    Add this to your package.json: "mcpName": "io.github.BASHBOP/otito"
    ```
    This is the registry's **ownership-proof** check: it downloads the
    `package.json` from the published npm tarball and looks for
    `mcpName` matching the registry name. If it's missing, the publish
    is rejected.

    **Fix:** add `mcpName` to `package.json`, bump the version (because
    npm tarballs are immutable, you cannot retro-fit `mcpName` into
    `1.0.0`), `npm publish` the new version, update
    `server.json.version` + `packages[0].version` to match, then re-run
    `mcp-publisher publish`.

Success looks like:

```
Publishing to https://registry.modelcontextprotocol.io...
✓ Successfully published
✓ Server io.github.BASHBOP/otito version 1.0.2
```

---

## 10. ✅ Verify the listing

Two ways to check:

```bash
# Curl the registry API directly
curl https://registry.modelcontextprotocol.io/v0/servers \
  | jq '.servers[] | select(.name == "io.github.yourname/yourserver")'
```

Or open the search UI:
<https://registry.modelcontextprotocol.io/?q=yourname>

Note: the search index has a short caching delay. The publish itself is
committed the moment `mcp-publisher` reports success; the search UI may
take a minute or two to refresh.

---

## 🔁 Publishing updates

In this repo, npm and the MCP Registry publish automatically when you push a
`vX.Y.Z` tag (see `.github/workflows/release.yml`). For every future version:

1. Bump `package.json` and `package-lock.json` versions
2. Bump `server.json.version` and `packages[0].version` to match
3. `npm run ci` — `version:check` fails the build if `server.json` is out of
   sync, so the npm package and the MCP manifest can never drift apart
4. Commit, then tag and push:

```bash
git tag v1.0.1
git push origin v1.0.1
```

Pushing the tag runs the `Release` workflow: it publishes to npm with
provenance, then logs in to the MCP Registry via GitHub OIDC and runs
`mcp-publisher publish`. To publish manually instead, run `npm publish`
followed by `mcp-publisher publish` from a clean checkout.

---

## 🐛 Troubleshooting summary

| Error | Cause | Fix |
| --- | --- | --- |
| `404 Scope not found` (npm) | npm org/scope doesn't exist yet | Create org at <https://npmjs.com/org/create> |
| `403 You cannot publish over the previously published versions` (npm) | Trying to republish an immutable version | Bump version in `package.json` |
| `402 Payment Required` (npm) | Scoped package without `publishConfig.access: "public"` | Add the field; or once-off `npm publish --access public` |
| `HTTP 422 expected length <= 100` (registry) | `server.json.description` too long | Trim to ≤100 chars |
| `HTTP 400 mcpName field missing` (registry) | Published npm tarball lacks `mcpName` | Add to `package.json`, version-bump, `npm publish`, retry registry publish |
| `404 Repository not found` (registry) | `repository.url` doesn't exist or is private | Make repo public; verify URL |
| GitHub OAuth fails | Authenticated user doesn't own the `io.github.<user>/` namespace | Log in as the correct GitHub account |

---

## 🎁 What "being on the MCP Registry" actually buys you

A discovery channel — nothing automatic beyond that:

- ✅ Registry-aware MCP hosts (Claude Desktop, Codex CLI, Cursor, Goose…) can find and install your server with one click
- ✅ Third-party catalogs (Glama, MCP.so, awesome lists) often syndicate from the registry
- ✅ Canonical name (`io.github.<you>/<server>`) survives package renames
- ✅ Verified ownership reduces typosquatting risk
- ❌ Does **not** auto-install for anyone, endorse the server, or feature it anywhere

The publishing work is the on-ramp. The adoption work is downstream of
the server actually being useful.
