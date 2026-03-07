#!/usr/bin/env bash
# open-brain-wizard: Link local project to Supabase (Linux / Mac)
# Run from repo root (parent of open-brain-dist) or from open-brain-dist if that is your repo root.

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

section() { echo -e "\n${CYAN}=== $1 ===${NC}"; }
ok()     { echo -e "  ${GREEN}[OK]${NC} $1"; }
warn()   { echo -e "  ${YELLOW}[WARN]${NC} $1"; }
fail()   { echo -e "  ${RED}[FAIL]${NC} $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
if [ -f "$ROOT_DIR/supabase/config.toml" ]; then
  cd "$ROOT_DIR"
else
  cd "$SCRIPT_DIR"
  ROOT_DIR="$(pwd)"
fi

section "open-brain-wizard: Link to Supabase"

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  warn "SUPABASE_ACCESS_TOKEN is not set."
  echo "  If 'supabase link' hangs, set it:"
  echo "    1. Create a token at: https://supabase.com/dashboard/account/tokens"
  echo "    2. export SUPABASE_ACCESS_TOKEN='your-token'"
  echo ""
fi

REF="${SUPABASE_PROJECT_REF:-}"
if [ -z "$REF" ] && [ -f "$ROOT_DIR/credentials.yaml" ]; then
  REF="$(awk -v key="project_ref" '$0 ~ "^[[:space:]]*" key "[[:space:]]*:" { sub(/^[^:]*:[[:space:]]*/, ""); gsub(/^["'\'']|["'\'']$/, ""); print; exit }' "$ROOT_DIR/credentials.yaml")"
fi
if [ -z "$REF" ] || [ "$REF" = "YOUR_PROJECT_REF" ]; then
  echo -n "  Enter your Supabase project ref (from dashboard URL: .../project/THIS_PART): "
  read -r REF
fi
if [ -z "$REF" ]; then
  fail "Project ref required."
fi

echo "  Linking to project ref: $REF"
if ! supabase link --project-ref "$REF"; then
  fail "Link failed. If it hung, set SUPABASE_ACCESS_TOKEN and try again."
fi
ok "Linked successfully"
