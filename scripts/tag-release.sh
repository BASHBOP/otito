#!/usr/bin/env bash
# Tag the version a main commit carries, once CI has passed on it.
#
# The release decision is the merge that brings a version bump to main; the
# tag follows from package.json rather than from someone remembering to push
# it. A version that is already tagged, which is every main push that is not
# a release, exits 0 and tags nothing. A version that is not newer than the
# latest vX.Y.Z tag, or that CHANGELOG.md has no section for, is refused with
# exit 1: either would publish a release nobody prepared.
#
# Expects a checkout with every tag fetched (actions/checkout fetch-depth: 0).
# OTITO_TAG_SHA names the commit (default HEAD). OTITO_TAG_DRY_RUN=1 reports
# the tag it would push and pushes nothing. In Actions the pushed tag is
# written to $GITHUB_OUTPUT as `tag` for the step that starts the Release
# workflow; see .github/workflows/tag-release.yml.
set -euo pipefail

cd "$(dirname "$0")/.."

SHA="$(git rev-parse --verify "${OTITO_TAG_SHA:-HEAD}^{commit}")"
VERSION="$(git show "$SHA:package.json" | node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(0, "utf8")).version)')"
TAG="v$VERSION"

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "$TAG is already tagged at $(git rev-list -n 1 "$TAG"); nothing to release."
  exit 0
fi

# Release tags only: a pre-release tag must not make its own release look old.
LATEST="$(git tag --list 'v[0-9]*' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1 || true)"
if [ -n "$LATEST" ] && [ "$(printf '%s\n%s\n' "$LATEST" "$TAG" | sort -V | tail -n 1)" != "$TAG" ]; then
  echo "package.json at $SHA says $VERSION, which is not newer than $LATEST; refusing to tag it." >&2
  exit 1
fi

# The same match release.yml uses to extract the release notes.
if ! git show "$SHA:CHANGELOG.md" | awk -v ver="$VERSION" '$1 == "##" && $2 == "[" ver "]" { found = 1 } END { exit !found }'; then
  echo "CHANGELOG.md at $SHA has no [$VERSION] section; refusing to tag a release without notes." >&2
  exit 1
fi

if [ "${OTITO_TAG_DRY_RUN:-0}" = "1" ]; then
  echo "would tag $SHA as $TAG"
  exit 0
fi

git tag -a "$TAG" -m "$TAG" "$SHA"
git push origin "refs/tags/$TAG"
echo "Tagged $SHA as $TAG."
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "tag=$TAG" >>"$GITHUB_OUTPUT"
fi
