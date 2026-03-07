#!/usr/bin/env bash
# open-brain-wizard: Deploy Edge Functions (Linux / Mac)
# Deploys ingest-thought and open-brain-mcp. Set secrets first (see SETUP.md).

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

section "open-brain-wizard: Deploy"

warn "Ensure these secrets are set: OPENROUTER_API_KEY, SLACK_BOT_TOKEN, SLACK_CAPTURE_CHANNEL, MCP_ACCESS_KEY"
echo "  If you use credentials.yaml: run scripts/set-secrets.sh first."
echo "  Or set manually: supabase secrets set KEY=value"
echo ""

for fn in ingest-thought open-brain-mcp; do
  echo "  Deploying $fn..."
  if ! supabase functions deploy "$fn" --no-verify-jwt; then
    fail "Deploy failed: $fn"
  fi
  ok "Deployed $fn"
done

section "Done"
echo "  ingest-thought:  https://YOUR_PROJECT_REF.supabase.co/functions/v1/ingest-thought"
echo "  open-brain-mcp:  https://YOUR_PROJECT_REF.supabase.co/functions/v1/open-brain-mcp?key=YOUR_MCP_ACCESS_KEY"
echo ""
