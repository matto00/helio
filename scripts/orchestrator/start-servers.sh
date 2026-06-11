#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# start-servers.sh — canonical dev-server startup for the evaluator's Phase 3.
#
# Replaces the hand-rolled startup prose in linear-evaluator.md so the
# procedure (ports, CORS, health-waits) is deterministic. Idempotent: reuses a
# server that is already healthy on the target port.
#
# Usage:
#   scripts/orchestrator/start-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>
#
# On success prints:
#   READY backend=http://localhost:<BACKEND_PORT>
#   READY frontend=http://localhost:<DEV_PORT>
# On failure prints "FAIL <reason>" plus a log path and exits non-zero. A
# backend/frontend that never becomes healthy is an environmental BLOCKER.
# ===========================================================================

WORKTREE_PATH="${1:?usage: start-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>}"
DEV_PORT="${2:?usage: start-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>}"
BACKEND_PORT="${3:?usage: start-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>}"

BACKEND_LOG="${WORKTREE_PATH}/.orchestrator-backend.log"
FRONTEND_LOG="${WORKTREE_PATH}/.orchestrator-frontend.log"

# Safety net: the backend needs its .env. setup-worktree.sh normally copies it.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ ! -f "${WORKTREE_PATH}/backend/.env" ] && [ -f "${REPO_ROOT}/backend/.env" ]; then
  cp "${REPO_ROOT}/backend/.env" "${WORKTREE_PATH}/backend/.env"
fi

# --- Backend ---------------------------------------------------------------
if curl -sf "http://localhost:${BACKEND_PORT}/health" >/dev/null 2>&1; then
  echo "note: backend already healthy on ${BACKEND_PORT}, reusing" >&2
else
  # CORS must whitelist the frontend origin or the browser rejects every API
  # response and login fails. The backend defaults CORS to :5173 only.
  ( cd "${WORKTREE_PATH}/backend" \
    && PORT="$BACKEND_PORT" CORS_ALLOWED_ORIGINS="http://localhost:${DEV_PORT}" \
       nohup sbt run >"$BACKEND_LOG" 2>&1 & disown )
  if ! timeout 300 bash -c \
      "until curl -sf http://localhost:${BACKEND_PORT}/health >/dev/null 2>&1; do sleep 5; done"; then
    echo "FAIL backend did not become healthy on ${BACKEND_PORT} within 300s (log: ${BACKEND_LOG})" >&2
    exit 1
  fi
fi

# --- Frontend --------------------------------------------------------------
if curl -sf "http://localhost:${DEV_PORT}" >/dev/null 2>&1; then
  echo "note: frontend already serving on ${DEV_PORT}, reusing" >&2
else
  ( cd "${WORKTREE_PATH}/frontend" \
    && PORT="$DEV_PORT" BACKEND_PORT="$BACKEND_PORT" \
       nohup npm run dev >"$FRONTEND_LOG" 2>&1 & disown )
  if ! timeout 60 bash -c \
      "until curl -sf http://localhost:${DEV_PORT} >/dev/null 2>&1; do sleep 2; done"; then
    echo "FAIL frontend did not start on ${DEV_PORT} within 60s (log: ${FRONTEND_LOG})" >&2
    exit 1
  fi
fi

echo "READY backend=http://localhost:${BACKEND_PORT}"
echo "READY frontend=http://localhost:${DEV_PORT}"
