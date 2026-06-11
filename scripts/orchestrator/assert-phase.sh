#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# assert-phase.sh — postcondition gate for each orchestrator phase.
#
# The autonomous equivalent of a human glancing and confirming "yep, that
# worked." The orchestrator runs this before leaving a phase; a non-zero exit
# means the phase did NOT actually complete and the orchestrator must not
# advance (re-run the procedure or escalate).
#
# Usage:
#   assert-phase.sh setup    <WORKTREE_PATH>
#   assert-phase.sh servers  <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>
#   assert-phase.sh delivery <WORKTREE_PATH> <BRANCH>
#   assert-phase.sh cleanup  <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>
#
# Prints "PASS <phase>" on success, "FAIL <reason>" (one per line) + non-zero
# exit on failure.
# ===========================================================================

PHASE="${1:?usage: assert-phase.sh <phase> <worktree> [args]}"
WORKTREE_PATH="${2:?missing WORKTREE_PATH}"

fail() { echo "FAIL $*" >&2; FAILED=1; }
FAILED=0

case "$PHASE" in
  setup)
    [ -d "$WORKTREE_PATH" ]                 || fail "worktree dir missing: $WORKTREE_PATH"
    [ -d "$WORKTREE_PATH/.git" ] || [ -f "$WORKTREE_PATH/.git" ] \
                                            || fail "worktree not a git work tree: $WORKTREE_PATH"
    [ -f "$WORKTREE_PATH/backend/.env" ]    || fail "backend/.env not present in worktree (servers will fail)"
    ;;

  servers)
    DEV_PORT="${3:?servers assert needs <DEV_PORT> <BACKEND_PORT>}"
    BACKEND_PORT="${4:?servers assert needs <DEV_PORT> <BACKEND_PORT>}"
    curl -sf "http://localhost:${BACKEND_PORT}/health" >/dev/null 2>&1 \
        || fail "backend not healthy on ${BACKEND_PORT}"
    curl -sf "http://localhost:${DEV_PORT}" >/dev/null 2>&1 \
        || fail "frontend not serving on ${DEV_PORT}"
    ;;

  delivery)
    BRANCH="${3:?delivery assert needs <BRANCH>}"
    git -C "$WORKTREE_PATH" rev-parse --verify --quiet "refs/remotes/origin/${BRANCH}" >/dev/null \
        || fail "branch ${BRANCH} not pushed to origin"
    # No uncommitted work left behind.
    [ -z "$(git -C "$WORKTREE_PATH" status --porcelain)" ] \
        || fail "worktree has uncommitted changes"
    ;;

  cleanup)
    DEV_PORT="${3:-}"
    BACKEND_PORT="${4:-}"
    if [ -n "$DEV_PORT" ]; then
      curl -sf "http://localhost:${DEV_PORT}" >/dev/null 2>&1 \
          && fail "frontend still serving on ${DEV_PORT}" || true
    fi
    if [ -n "$BACKEND_PORT" ]; then
      curl -sf "http://localhost:${BACKEND_PORT}/health" >/dev/null 2>&1 \
          && fail "backend still healthy on ${BACKEND_PORT}" || true
    fi
    [ ! -d "$WORKTREE_PATH" ] || fail "worktree dir still present: $WORKTREE_PATH"
    ;;

  *)
    echo "FAIL unknown phase '$PHASE' (expected: setup|servers|delivery|cleanup)" >&2
    exit 2
    ;;
esac

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
echo "PASS $PHASE"
