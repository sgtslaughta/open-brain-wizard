#!/usr/bin/env bash
# Bump VERSION file, docker/package.json, and add a new CHANGELOG section.
# Usage: bump-version.sh <new-version>   e.g. bump-version.sh 1.1.0
#    or: bump-version.sh patch|minor|major   to derive new version from VERSION.
# Run from repo root. Commits nothing; you commit the changes.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

VERSION_FILE="$ROOT_DIR/VERSION"
PACKAGE_JSON="$ROOT_DIR/docker/package.json"
CHANGELOG="$ROOT_DIR/CHANGELOG.md"

# Read current version (strip whitespace)
current() { cat "$VERSION_FILE" | tr -d '[:space:]'; }

# Parse semver and bump
bump_patch() {
  local v; v="$(current)"
  local minor patch; IFS='.' read -r _ minor patch <<< "$v"
  echo "${v%%.*}.$minor.$((patch + 1))"
}
bump_minor() {
  local v; v="$(current)"
  local major minor; IFS='.' read -r major minor _ <<< "$v"
  echo "$major.$((minor + 1)).0"
}
bump_major() {
  local v; v="$(current)"
  local major; IFS='.' read -r major _ _ <<< "$v"
  echo "$((major + 1)).0.0"
}

NEW_VERSION=""
case "$1" in
  patch) NEW_VERSION="$(bump_patch)" ;;
  minor) NEW_VERSION="$(bump_minor)" ;;
  major) NEW_VERSION="$(bump_major)" ;;
  *)    NEW_VERSION="$1" ;;
esac

if [ -z "$NEW_VERSION" ] || ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Usage: bump-version.sh <new-version> | patch | minor | major" >&2
  echo "Example: bump-version.sh 1.1.0" >&2
  exit 1
fi

CUR="$(current)"
echo "Bumping $CUR -> $NEW_VERSION"

# VERSION file
echo "$NEW_VERSION" > "$VERSION_FILE"

# docker/package.json
if [ -f "$PACKAGE_JSON" ]; then
  if command -v jq >/dev/null 2>&1; then
    jq --arg v "$NEW_VERSION" '.version = $v' "$PACKAGE_JSON" > "$PACKAGE_JSON.tmp" && mv "$PACKAGE_JSON.tmp" "$PACKAGE_JSON"
  else
    sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$PACKAGE_JSON" && rm -f "$PACKAGE_JSON.bak"
  fi
fi

# CHANGELOG: add new section under [Unreleased], date = today (YYYY-MM-DD)
DATE="$(date +%Y-%m-%d)"
if [ -f "$CHANGELOG" ]; then
  # Insert "## [X.Y.Z] - DATE" and empty "### Added" after "## [Unreleased]"
  if grep -q "## \[Unreleased\]" "$CHANGELOG"; then
    awk -v ver="$NEW_VERSION" -v d="$DATE" '
      /^## \[Unreleased\]/ {
        print
        print ""
        print "## [" ver "] - " d
        print ""
        print "### Added"
        print ""
        next
      }
      { print }
    ' "$CHANGELOG" > "$CHANGELOG.tmp" && mv "$CHANGELOG.tmp" "$CHANGELOG"
  else
    # No [Unreleased]; prepend new section at top after title/format lines
    {
      head -n 5 "$CHANGELOG"
      echo ""
      echo "## [$NEW_VERSION] - $DATE"
      echo ""
      echo "### Added"
      echo ""
      tail -n +6 "$CHANGELOG"
    } > "$CHANGELOG.tmp" && mv "$CHANGELOG.tmp" "$CHANGELOG"
  fi
fi

echo "Updated VERSION, docker/package.json, and CHANGELOG. Commit and tag with:"
echo "  git tag $NEW_VERSION"
echo "  git push origin $NEW_VERSION"
