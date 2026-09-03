#!/usr/bin/env bash
# Audit release bookkeeping: every release tag should have a matching GitHub
# Release, and every release/vM.m branch should sit at its newest tag.
#
# This exists because tagging by hand (`git tag -a -m ... && git push`) deploys
# perfectly well while silently skipping the two bookkeeping steps
# cut-release.sh performs. That is how v0.7.8-v0.7.11 shipped to production but
# never appeared on the Releases page, with release/v0.7 left 26 commits behind
# main. A deploy that works is not evidence that the release was cut correctly.
#
# Exits non-zero if anything is missing, so CI or a pre-release check can gate
# on it. Read-only: it never pushes, tags, or creates anything.
#
# usage: audit-releases.sh [major.minor]   # omit to audit every release line
set -euo pipefail

step() { printf '==> %s\n' "$*" >&2; }

export GIT_HTTP_LOW_SPEED_LIMIT="${GIT_HTTP_LOW_SPEED_LIMIT:-1024}"
export GIT_HTTP_LOW_SPEED_TIME="${GIT_HTTP_LOW_SPEED_TIME:-30}"

ONLY="${1:-}"
[ -z "$ONLY" ] || [[ "$ONLY" =~ ^[0-9]+\.[0-9]+$ ]] || {
  echo "usage: audit-releases.sh [major.minor]  e.g. 0.7" >&2; exit 1; }

step "fetching refs and tags from origin"
git fetch --all --tags --prune --quiet

# Only vM.m.p release tags. Anything else (beta/rc/test/dated tags) is
# deliberately out of scope -- those are not releases and must not be
# reported as missing one.
mapfile -t TAGS < <(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=v:refname \
  | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' || true)

mapfile -t RELEASES < <(gh release list --limit 200 --json tagName -q '.[].tagName' || true)
has_release() { local t="$1"; local r; for r in ${RELEASES[@]+"${RELEASES[@]}"}; do [ "$r" = "$t" ] && return 0; done; return 1; }

problems=0

step "checking every release tag has a GitHub Release"
for t in ${TAGS[@]+"${TAGS[@]}"}; do
  mm="${t#v}"; mm="${mm%.*}"
  [ -z "$ONLY" ] || [ "$mm" = "$ONLY" ] || continue
  if has_release "$t"; then
    printf '  ok      %s\n' "$t"
  else
    printf '  MISSING %s  (tag exists, no GitHub Release)\n' "$t"
    problems=$((problems + 1))
  fi
done

step "checking every release branch sits at its newest tag"
while read -r branch; do
  mm="${branch#refs/heads/release/v}"
  [ -z "$ONLY" ] || [ "$mm" = "$ONLY" ] || continue
  newest=$(git tag -l "v${mm}.*" --sort=-v:refname \
    | grep -E "^v${mm}\.[0-9]+$" | head -1 || true)
  [ -n "$newest" ] || { printf '  skip    release/v%s (no tags yet)\n' "$mm"; continue; }
  btip=$(git rev-parse "origin/release/v${mm}")
  ttip=$(git rev-parse "${newest}^{commit}")
  if [ "$btip" = "$ttip" ]; then
    printf '  ok      release/v%s at %s\n' "$mm" "$newest"
  else
    behind=$(git rev-list --count "${btip}..${ttip}" 2>/dev/null || echo '?')
    printf '  STALE   release/v%s is %s commit(s) behind %s\n' "$mm" "$behind" "$newest"
    problems=$((problems + 1))
  fi
done < <(git ls-remote --heads origin 'refs/heads/release/*' | awk '{print $2}')

echo
if [ "$problems" -eq 0 ]; then
  echo "Release bookkeeping is consistent."
else
  echo "$problems problem(s) found."
  echo "Fix a missing Release with:  gh release create <tag> --verify-tag --title <tag> --notes-file <notes>"
  echo "Fix a stale branch by cutting the next release through scripts/release/cut-release.sh,"
  echo "which fast-forwards the branch as its first step."
  exit 1
fi
