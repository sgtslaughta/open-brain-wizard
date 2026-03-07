#!/usr/bin/env bash
# open-brain-wizard: Set Supabase secrets from credentials.yaml (Linux / Mac)
# Reads credentials.yaml in repo root and runs supabase secrets set for each key.
# Run after: scripts/link.sh. Never commit credentials.yaml.

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

# Read key from simple YAML (key: value or key: "value"). Returns first match.
get_yaml_value() {
  local key="$1"
  local file="$2"
  if [ ! -f "$file" ]; then return 1; fi
  awk -v key="$key" '
    $0 ~ "^[[:space:]]*" key "[[:space:]]*:" {
      sub(/^[^:]*:[[:space:]]*/, "");
      gsub(/^["'\'']|["'\'']$/, "");
      print;
      exit
    }
  ' "$file"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
if [ -f "$ROOT_DIR/supabase/config.toml" ]; then
  cd "$ROOT_DIR"
else
  cd "$SCRIPT_DIR"
  ROOT_DIR="$(pwd)"
fi

CRED_PATH="$ROOT_DIR/credentials.yaml"
if [ ! -f "$CRED_PATH" ]; then
  fail "credentials.yaml not found. Copy credentials.yaml.template to credentials.yaml and fill in."
  echo "  Path: $CRED_PATH"
fi

section "open-brain-wizard: Set secrets from credentials.yaml"

set_one() {
  local name="$1"
  local yaml_key="$2"
  local val
  val="$(get_yaml_value "$yaml_key" "$CRED_PATH")"
  if [ -z "$val" ] || [ "$val" = "YOUR_PROJECT_REF" ] || [ "$val" = "sk-or-v1-..." ] || \
     [ "$val" = "xoxb-..." ] || [ "$val" = "C0..." ]; then
    warn "Skipping $name (empty or placeholder in credentials.yaml)"
    return 0
  fi
  echo "  Setting $name..."
  if ! supabase secrets set "${name}=${val}"; then
    fail "Failed to set $name. Ensure project is linked (run scripts/link.sh)."
  fi
  ok "Set $name"
}

set_one "OPENROUTER_API_KEY"     "openrouter_api_key"
set_one "SLACK_BOT_TOKEN"        "slack_bot_token"
set_one "SLACK_CAPTURE_CHANNEL"  "slack_capture_channel"
set_one "MCP_ACCESS_KEY"         "mcp_access_key"

section "Done"
echo "  Run scripts/deploy.sh to deploy Edge Functions."
echo ""
