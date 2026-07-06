#!/usr/bin/env bash
# Shared helpers for the Helio agent shell scripts (Phase 4).
#
# These wrappers are the shell-parity twin of the helio-mcp tools: thin curl+jq
# calls to the SAME REST endpoints, authenticated with a Personal Access Token.
# They double as living, runnable API documentation — read a script to see the
# exact request shape an endpoint expects.
#
# Config (env):
#   HELIO_API_BASE_URL   base URL of a running backend (default http://localhost:8080)
#   HELIO_PAT            a helio_pat_… token minted via POST /api/tokens (required)
#
# Dependencies: bash, curl, jq. Nothing else.

set -euo pipefail

: "${HELIO_API_BASE_URL:=http://localhost:8080}"
HELIO_API_BASE_URL="${HELIO_API_BASE_URL%/}"

_need() { command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is required" >&2; exit 1; }; }
_need curl
_need jq

if [ -z "${HELIO_PAT:-}" ]; then
  echo "error: HELIO_PAT is not set. Mint one with POST /api/tokens (see scripts/agent/README.md)." >&2
  exit 1
fi

# helio_curl METHOD PATH [JSON_BODY]
# Emits the response body on success; on a non-2xx status prints the status +
# error body to stderr and exits non-zero so callers fail fast.
helio_curl() {
  local method="$1" path="$2" body="${3:-}"
  local url="${HELIO_API_BASE_URL}${path}"
  local tmp status
  tmp="$(mktemp)"
  if [ -n "$body" ]; then
    status="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$url" \
      -H "Authorization: Bearer ${HELIO_PAT}" \
      -H 'Content-Type: application/json' \
      -d "$body")"
  else
    status="$(curl -sS -o "$tmp" -w '%{http_code}' -X "$method" "$url" \
      -H "Authorization: Bearer ${HELIO_PAT}" \
      -H 'Accept: application/json')"
  fi
  if [ "$status" -lt 200 ] || [ "$status" -ge 300 ]; then
    echo "error: ${method} ${path} -> HTTP ${status}" >&2
    cat "$tmp" >&2; echo >&2
    rm -f "$tmp"
    return 1
  fi
  cat "$tmp"
  rm -f "$tmp"
}

helio_get()   { helio_curl GET   "$1"; }
helio_post()  { helio_curl POST  "$1" "$2"; }
helio_patch() { helio_curl PATCH "$1" "$2"; }
