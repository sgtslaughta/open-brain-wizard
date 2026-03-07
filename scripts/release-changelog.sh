#!/usr/bin/env sh
# Extract the changelog section for a given version for GitLab release description.
# Usage: release-changelog.sh <version>
# Version can be 1.0.0 or v1.0.0. Outputs the matching ## [X.Y.Z] block to stdout.

set -e

if [ -z "$1" ]; then
  echo "Usage: release-changelog.sh <version>" >&2
  exit 1
fi
VERSION="$1"
# Normalize: strip leading v
NORM="${VERSION#v}"
CHANGELOG="${2:-CHANGELOG.md}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
FILE="$ROOT_DIR/$CHANGELOG"

if [ ! -f "$FILE" ]; then
  echo "Release $NORM"
  exit 0
fi

# Print from "## [X.Y.Z]" or "## [vX.Y.Z]" matching NORM to next "## [" or EOF.
awk -v ver="$NORM" '
  (index($0, "## [" ver "]") == 1) || (index($0, "## [v" ver "]") == 1) { found=1; print; next }
  found { if (/^## \[/) exit; print }
' "$FILE" || echo "Release $NORM"
