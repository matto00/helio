#!/usr/bin/env bash
# HEL-1758 D1: the backend CI cache keys, computed from git's index instead of the runner's `hashFiles`.
#
# Why: `hashFiles(...)` is evaluated by the runner's own node subprocess under a fixed 120 s limit. It stalled for
# exactly 120 s three times (runs 44226053854, 44244750573 att. 1, 44244673956) over a ~1,700-file glob that normally
# takes under a second, and `hashFiles('**/build.sbt')` walks the WHOLE workspace. `git ls-files -s` lists
# `<mode> <blob-id> <stage> <path>` straight from the index (no file content read, no workspace walk), so the key is a
# pure function of the committed content that a plain checkout produces.
#
# Usage: ci-backend-cache-key.sh [repo-dir]      (default: the repo containing the current directory)
# Prints `compile=<64 hex>` and `deps=<64 hex>`; also appends both to $GITHUB_OUTPUT when that is set.
# Exits non-zero, naming the key, when an input set is empty (a constant key must never ship) or a value is not
# 64 lowercase hex characters.
#
# NEVER use `git ls-tree` with these pathspecs: it does not expand globs and prints nothing (design-gate round 1).
set -euo pipefail

ROOT="${1:-$(git rev-parse --show-toplevel)}"

key_for() {
  # $1 = key name, rest = pathspecs
  local name="$1" listing
  shift
  listing="$(git -C "$ROOT" ls-files -s -- "$@")"
  if [ -z "$listing" ]; then
    echo "ci-backend-cache-key: the $name key's input set is empty (pathspecs: $*); refusing to emit a constant key" >&2
    return 1
  fi
  printf '%s\n' "$listing" | sha256sum | cut -d' ' -f1
}

# The exact set the former hashFiles('backend/src/**', 'backend/build.sbt', 'backend/project/*.scala',
# 'backend/project/*.sbt', 'backend/project/build.properties') named. `:(glob)` keeps `*` to one path segment, as
# hashFiles' `*` is; a plain pathspec `*` would also cross `/`.
compile="$(key_for compile \
  'backend/src' 'backend/build.sbt' \
  ':(glob)backend/project/*.scala' ':(glob)backend/project/*.sbt' 'backend/project/build.properties')"
# The former hashFiles('**/build.sbt'): every tracked build.sbt at any depth, including the top level.
deps="$(key_for deps ':(glob)**/build.sbt')"

for pair in "compile=$compile" "deps=$deps"; do
  if ! printf '%s' "${pair#*=}" | grep -Eq '^[0-9a-f]{64}$'; then
    echo "ci-backend-cache-key: ${pair%%=*} is not 64 lowercase hex characters: '${pair#*=}'" >&2
    exit 1
  fi
done

printf 'compile=%s\ndeps=%s\n' "$compile" "$deps"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  printf 'compile=%s\ndeps=%s\n' "$compile" "$deps" >> "$GITHUB_OUTPUT"
fi
