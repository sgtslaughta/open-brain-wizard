#!/usr/bin/env bash
# open-brain-wizard: Install prerequisites (Linux / Mac)
# Installs Supabase CLI via Homebrew (Mac) or npm. Run from repo root or open-brain-dist.

set -e

# ANSI colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

section() { echo -e "\n${CYAN}=== $1 ===${NC}"; }
ok()     { echo -e "  ${GREEN}[OK]${NC} $1"; }
warn()   { echo -e "  ${YELLOW}[WARN]${NC} $1"; }
fail()   { echo -e "  ${RED}[FAIL]${NC} $1"; exit 1; }

section "open-brain-wizard: Install (Linux / Mac)"

# Detect OS
case "$(uname -s)" in
  Darwin)  OS=mac ;;
  Linux)   OS=linux ;;
  *)       OS=other ;;
esac

# Supabase CLI
if command -v supabase >/dev/null 2>&1; then
  ok "Supabase CLI already installed: $(supabase --version 2>/dev/null || true)"
else
  if [ "$OS" = "mac" ] && command -v brew >/dev/null 2>&1; then
    echo "  Installing Supabase CLI via Homebrew..."
    brew install supabase/tap/supabase
  elif command -v npm >/dev/null 2>&1; then
    echo "  Installing Supabase CLI via npm..."
    npm install -g supabase
  else
    fail "Need Homebrew (Mac) or npm (Linux). Install one and re-run, or install Supabase CLI manually."
  fi
  if ! command -v supabase >/dev/null 2>&1; then
    fail "Supabase CLI install failed."
  fi
  ok "Supabase CLI installed"
fi

# Optional: openssl for MCP key generation
if command -v openssl >/dev/null 2>&1; then
  ok "openssl available (for generating MCP access key)"
else
  warn "openssl not found; you can generate MCP key online or install openssl"
fi

section "Next steps"
echo "  1. Copy credentials.yaml.template to credentials.yaml and fill in the placeholders"
echo "  2. Run: ./scripts/link.sh   (uses project_ref from credentials.yaml if present)"
echo "  3. Run: ./scripts/set-secrets.sh   (pushes secrets from credentials.yaml to Supabase)"
echo "  4. Run: ./scripts/deploy.sh"
echo ""
