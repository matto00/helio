#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# setup-worktree.sh — canonical worktree setup for the ticket-delivery flow.
#
# Replaces the prose in linear-orchestrator.md "Setup" so the procedure is
# deterministic and cannot be hallucinated. Idempotent: re-running for an
# existing worktree reuses it.
#
# Usage:
#   scripts/orchestrator/setup-worktree.sh <TICKET_ID> <BRANCH>
#
# Example:
#   scripts/orchestrator/setup-worktree.sh HEL-55 feature/panel-dup/HEL-55
#
# On success prints machine-parseable READY lines (stable contract — the
# orchestrator parses these):
#   READY worktree=<absolute path>
#   READY branch=<branch>
#   READY dev_port=<n>
#   READY backend_port=<n>
# Exits non-zero with "FAIL <reason>" on any error.
# ===========================================================================

TICKET_ID="${1:?usage: setup-worktree.sh <TICKET_ID> <BRANCH>}"
BRANCH="${2:?usage: setup-worktree.sh <TICKET_ID> <BRANCH>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

# Derive stable ports from the ticket number so parallel orchestrators never
# collide. HEL-55 -> dev 5228, backend 8135.
TICKET_NUM="${TICKET_ID##*-}"
if ! [[ "$TICKET_NUM" =~ ^[0-9]+$ ]]; then
  echo "FAIL could not derive numeric ticket id from '$TICKET_ID'" >&2
  exit 1
fi
DEV_PORT=$((5173 + TICKET_NUM))
BACKEND_PORT=$((8080 + TICKET_NUM))

WORKTREE_REL=".claude/worktrees/${BRANCH}"
WORKTREE_PATH="${REPO_ROOT}/${WORKTREE_REL}"

# Create the worktree (reuse if it already exists for this branch).
if git worktree list --porcelain | grep -qx "worktree ${WORKTREE_PATH}"; then
  echo "note: worktree already present, reusing ${WORKTREE_PATH}" >&2
elif git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  # Branch exists but no worktree — attach without -b.
  git worktree add "$WORKTREE_PATH" "$BRANCH"
else
  git worktree add "$WORKTREE_PATH" -b "$BRANCH"
fi

# Make backend/.env available in the worktree. The backend reads it on boot;
# without it Phase-3 login (and the whole dev server) fails. This step is the
# one the old prose left implicit.
if [ -f "${REPO_ROOT}/backend/.env" ]; then
  cp -n "${REPO_ROOT}/backend/.env" "${WORKTREE_PATH}/backend/.env" 2>/dev/null || true
else
  echo "note: ${REPO_ROOT}/backend/.env not found — backend may need env vars set another way" >&2
fi

# Husky resolves hooks against a real .git dir; in a worktree .git is a file,
# which can break hooks. Best-effort install so commits don't fail spuriously.
( cd "$WORKTREE_PATH" && npx husky install >/dev/null 2>&1 ) || true

echo "READY worktree=${WORKTREE_PATH}"
echo "READY branch=${BRANCH}"
echo "READY dev_port=${DEV_PORT}"
echo "READY backend_port=${BACKEND_PORT}"
