# Security Policy

## Supported Versions

Security fixes are made against the default branch and the latest published package line. Older versions may receive fixes when the issue is severe and the patch is low risk.

## Reporting a Vulnerability

Do not open public issues for suspected vulnerabilities. Use GitHub private vulnerability reporting for `BASHBOP/otito` when available, or contact the maintainers privately before sharing exploit details.

Please include:

- Affected version or commit.
- Reproduction steps.
- Expected and actual impact.
- Any logs, inputs, generated artifacts, or repository shapes needed to reproduce.

The project avoids secrets in generated `.dev-context/` artifacts, but users should still review artifacts before sharing them outside their organization.

## Security Expectations

- `npm run audit` must pass for production dependencies before release.
- Generated artifacts must stay under `.dev-context/` and out of published package contents.
- External command execution must use explicit argument arrays where possible.
- Changes that touch git, GitHub, filesystem writes, dependency lookup, or MCP dispatch require focused tests and reviewer attention.
