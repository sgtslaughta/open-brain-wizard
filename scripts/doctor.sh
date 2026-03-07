#!/usr/bin/env bash
# open-brain-wizard: Doctor - check CLI, link, and secret names (Linux / Mac)
# Does not print secret values. Use Supabase dashboard for invocations/logs.

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

section "open-brain-wizard: Doctor"

# CLI
if command -v supabase >/dev/null 2>&1; then
  ok "Supabase CLI: $(supabase --version 2>/dev/null || true)"
else
  fail "Supabase CLI not found. Run scripts/install.sh"
fi

# Link
LINK_REF_FILE="$ROOT_DIR/.supabase/project-ref"
[ -f "$LINK_REF_FILE" ] || LINK_REF_FILE="$ROOT_DIR/supabase/.supabase/project-ref"
if [ -f "$LINK_REF_FILE" ] 2>/dev/null; then
  REF="$(cat "$LINK_REF_FILE" 2>/dev/null || true)"
  if [ -n "$REF" ]; then
    ok "Linked project ref: $REF"
  else
    warn "Linked but project ref file empty. Run scripts/link.sh"
  fi
else
  warn "Not linked. Run scripts/link.sh with your project ref"
fi

# Secret names only
echo ""
section "Secrets (names only)"
if supabase secrets list 2>/dev/null | head -20; then
  : # output already shown
else
  warn "Could not list secrets (not linked or no secrets). Set via: supabase secrets set KEY=value"
fi

section "Debugging tips"
echo "  - Supabase dashboard: Edge Functions -> Logs / Invocations to see when Slack hits ingest-thought"
echo "  - Ensure Slack app bot is in your private channel: /invite @YourAppName"
echo "  - Event Subscriptions: enable both message.channels and message.groups"
echo ""
