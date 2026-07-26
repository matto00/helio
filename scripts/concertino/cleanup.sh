#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# cleanup.sh — canonical Phase-4 (post-merge) teardown for the ticket-delivery flow.
#
# Stops the dev servers bound to this ticket's ports and removes the worktree.
# Safe to re-run.
#
# DESTRUCTIVE — Phase-4 only. This script removes the live worktree and kills
# the dev servers. It must run ONLY as the orchestrator's post-merge teardown,
# never mid-review. To guard against a stray invocation it refuses to do any
# work unless an explicit Phase-4 opt-in is present:
#   - the first argument is `--phase4`, OR
#   - the environment sentinel `CONCERTINO_PHASE4=1` is set.
# Without the opt-in it prints a refusal to stderr and exits 0 (safe no-op).
#
# Usage: cleanup.sh --phase4 <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>
#    or: CONCERTINO_PHASE4=1 cleanup.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>
#
# Prints "READY cleaned worktree=<path>" on success.
# ===========================================================================

# Phase-4 guard: proceed with the destructive steps only on explicit opt-in.
if [ "${1:-}" = "--phase4" ]; then
  shift
elif [ "${CONCERTINO_PHASE4:-}" != "1" ]; then
  echo "cleanup.sh: refusing to run — this is a Phase-4 (post-merge) teardown that" >&2
  echo "removes the live worktree and kills the dev servers. It is invoked only by" >&2
  echo "the orchestrator after merge. Pass --phase4 as the first argument (or set" >&2
  echo "CONCERTINO_PHASE4=1) to proceed. No-op; nothing changed." >&2
  exit 0
fi

WORKTREE_PATH="${1:?usage: cleanup.sh --phase4 <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>}"
DEV_PORT="${2:-}"
BACKEND_PORT="${3:-}"

REPO_ROOT="$(git rev-parse --show-toplevel)"

# ---------------------------------------------------------------------------
# Merged-precondition guard (HEL-371 follow-up, 2026-07-26).
#
# The `--phase4` opt-in above only stops a *bare* invocation. Twice now a review
# agent has destroyed a LIVE worktree mid-review by passing `--phase4` anyway
# (HEL-323, then HEL-371), despite explicit instructions not to run this script.
# Prose guards have not held, so enforce the actual Phase-4 precondition
# mechanically: cleanup is post-MERGE, so the worktree's code must already be
# in origin/main.
#
# Squash-merges mean branch commits are never ancestors of main, so
# `git branch --merged` is useless here — compare the TREES instead. If any
# tracked code path still differs from origin/main, the work is unmerged and
# this is not Phase 4. Refuse loudly (exit 1, not a silent no-op) so a stray
# mid-review call surfaces as an error instead of passing for success.
#
# Override with CONCERTINO_SKIP_MERGE_CHECK=1 for the genuine abandon-a-branch
# case (deliberately discarding unmerged work).
# ---------------------------------------------------------------------------
if [ "${CONCERTINO_SKIP_MERGE_CHECK:-}" != "1" ] && [ -d "$WORKTREE_PATH" ]; then
  git -C "$REPO_ROOT" fetch origin --quiet 2>/dev/null || true
  if ! git -C "$WORKTREE_PATH" diff --quiet origin/main HEAD -- \
      backend frontend schemas helio-mcp scripts infra 2>/dev/null; then
    echo "cleanup.sh: REFUSING to remove '$WORKTREE_PATH' — its code does not match" >&2
    echo "origin/main, so this work is NOT merged and this is NOT Phase 4." >&2
    echo "" >&2
    echo "If you are an evaluator or skeptic: you should not be running this script" >&2
    echo "at all. It is the orchestrator's post-merge teardown. Stop here." >&2
    echo "" >&2
    echo "Differing paths:" >&2
    git -C "$WORKTREE_PATH" diff --stat origin/main HEAD -- \
      backend frontend schemas helio-mcp scripts infra >&2 || true
    echo "" >&2
    echo "To discard unmerged work deliberately: CONCERTINO_SKIP_MERGE_CHECK=1" >&2
    exit 1
  fi
fi

# Stop dev servers on this ticket's ports (no-op if already down).
[ -n "$DEV_PORT" ]     && fuser -k "${DEV_PORT}/tcp"     2>/dev/null || true
[ -n "$BACKEND_PORT" ] && fuser -k "${BACKEND_PORT}/tcp" 2>/dev/null || true

# Remove the worktree (force: discards the now-merged working tree).
if [ -d "$WORKTREE_PATH" ]; then
  git -C "$REPO_ROOT" worktree remove "$WORKTREE_PATH" --force
fi
git -C "$REPO_ROOT" worktree prune

echo "READY cleaned worktree=${WORKTREE_PATH}"
