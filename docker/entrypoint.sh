#!/bin/sh
# open-brain-wizard container entrypoint
# Handles UID/GID mapping and startup diagnostics

set -e

TARGET_UID="${PUID:-1000}"
TARGET_GID="${PGID:-1000}"
DATA_DIR="${DATA_DIR:-/data}"

echo "============================================"
echo "  open-brain-wizard"
echo "============================================"
echo "  UID/GID: ${TARGET_UID}:${TARGET_GID}"

# Create/modify the app group and user to match requested UID/GID
if [ "$(id -u)" = "0" ]; then
  # Running as root — adjust the obrain user to match PUID/PGID
  if getent group obrain > /dev/null 2>&1; then
    groupmod -o -g "$TARGET_GID" obrain
  else
    addgroup -g "$TARGET_GID" obrain 2>/dev/null || true
  fi

  if id obrain > /dev/null 2>&1; then
    usermod -o -u "$TARGET_UID" -g "$TARGET_GID" obrain 2>/dev/null || true
  else
    adduser -u "$TARGET_UID" -G obrain -s /bin/sh -D obrain 2>/dev/null || true
  fi

  # Fix ownership
  chown -R "${TARGET_UID}:${TARGET_GID}" /app /data 2>/dev/null || true

  # Credentials status at launch
  echo "  Data dir: ${DATA_DIR}"
  if [ -f "${DATA_DIR}/credentials.yaml" ]; then
    echo "  credentials.yaml: FOUND"
    # Show which keys are set (values masked)
    for key in supabase_access_token project_ref openrouter_api_key slack_bot_token slack_capture_channel mcp_access_key; do
      val=$(grep -E "^${key}:" "${DATA_DIR}/credentials.yaml" 2>/dev/null | sed 's/^[^:]*:[[:space:]]*//' | sed 's/^["'"'"']//;s/["'"'"']$//' || true)
      if [ -n "$val" ] && [ "$val" != "" ] && [ "$val" != "YOUR_PROJECT_REF" ] && [ "$val" != "sk-or-v1-..." ] && [ "$val" != "xoxb-..." ] && [ "$val" != "C0..." ]; then
        echo "    ${key}: SET"
      else
        echo "    ${key}: ---"
      fi
    done
  else
    echo "  credentials.yaml: NOT FOUND (will use wizard)"
  fi
  echo "  Port: ${PORT:-8080}"
  echo "============================================"

  # Drop privileges and exec
  exec su-exec "${TARGET_UID}:${TARGET_GID}" "$@"
else
  # Not running as root — just log and exec directly
  echo "  Data dir: ${DATA_DIR}"
  if [ -f "${DATA_DIR}/credentials.yaml" ]; then
    echo "  credentials.yaml: FOUND"
    for key in supabase_access_token project_ref openrouter_api_key slack_bot_token slack_capture_channel mcp_access_key; do
      val=$(grep -E "^${key}:" "${DATA_DIR}/credentials.yaml" 2>/dev/null | sed 's/^[^:]*:[[:space:]]*//' | sed 's/^["'"'"']//;s/["'"'"']$//' || true)
      if [ -n "$val" ] && [ "$val" != "" ] && [ "$val" != "YOUR_PROJECT_REF" ] && [ "$val" != "sk-or-v1-..." ] && [ "$val" != "xoxb-..." ] && [ "$val" != "C0..." ]; then
        echo "    ${key}: SET"
      else
        echo "    ${key}: ---"
      fi
    done
  else
    echo "  credentials.yaml: NOT FOUND (will use wizard)"
  fi
  echo "  Port: ${PORT:-8080}"
  echo "  NOTE: Running as UID $(id -u). Set PUID/PGID and run as root to auto-fix /data ownership."
  echo "============================================"

  exec "$@"
fi
