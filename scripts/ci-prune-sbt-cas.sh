#!/usr/bin/env bash
# HEL-1299 D2: bound the backend compile cache. sbt 2 keeps a content-addressed store (v2/cas) plus a task action
# cache (v2/ac) under ~/.cache/sbt; each main run restores the previous entry, adds its blobs and saves the union,
# so the entry only grows. `prune` keeps only the CAS blobs that the compile output (symlinks under OUT_DIR)
# references, and only the `ac` entries whose every named output blob survives. `report` changes nothing.
# v2/proc, coursier and ivy paths are never touched.
#
# Usage: ci-prune-sbt-cas.sh report|prune
# Env:   SBT_CACHE_DIR (default ~/.cache/sbt)   OUT_DIR (default <repo>/backend/target/out)
#
# Name forms: a CAS file is `sha256-<hex>-<size>`; an `ac` entry names its blobs as `...>sha256-<hex>/<size>`.
set -euo pipefail

mode="${1:-}"
case "$mode" in report | prune) ;; *)
  echo "usage: $0 report|prune" >&2
  exit 2
  ;;
esac
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cache="${SBT_CACHE_DIR:-$HOME/.cache/sbt}"
out="${OUT_DIR:-$repo/backend/target/out}"
cas="$cache/v2/cas"
ac="$cache/v2/ac"
start=$SECONDS

[ -d "$cas" ] || { echo "prune-sbt-cas: no CAS at $cas -- nothing to do"; exit 0; }
[ -d "$out" ] || { echo "prune-sbt-cas: no compile output at $out -- refusing to prune" >&2; exit 1; }
[ -d "$ac" ] || ac=""

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

size() { du -sk "$1" 2>/dev/null | cut -f1; }
cas_before=$(size "$cas")
ac_before=0
[ -n "$ac" ] && ac_before=$(size "$ac")

# 1. Blobs referenced by the compile output: absolute (or resolvable) symlinks pointing into the CAS.
cas_real="$(readlink -f -- "$cas")"
find "$out" -type l -print0 | while IFS= read -r -d '' l; do
  t="$(readlink -f -- "$l" 2>/dev/null || true)"
  # An if, not `[ ] && cmd`: a non-CAS link must be skipped, not leave the loop (and, via pipefail, the script) failing.
  if [ -n "$t" ] && [ "$(dirname -- "$t")" = "$cas_real" ]; then
    basename -- "$t"
  fi
done | sort -u >"$work/linked"
# Only well-formed names ever become deletion candidates or keep entries.
grep -E '^sha256-[0-9a-f]+-[0-9]+$' "$work/linked" >"$work/keep" || true
[ -s "$work/keep" ] || { echo "prune-sbt-cas: compile output references no CAS blob -- refusing to prune" >&2; exit 1; }

find "$cas" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | grep -E '^sha256-[0-9a-f]+-[0-9]+$' | sort >"$work/all" || true
comm -23 "$work/all" "$work/keep" >"$work/cas_drop"
cas_total=$(wc -l <"$work/all")
cas_drop=$(wc -l <"$work/cas_drop")
# Dangling = linked but absent from the CAS (reported; a prune never makes it worse).
dangling=$(comm -13 "$work/all" "$work/keep" | wc -l)

# 2. ac entries: keep only if every blob they name (normalised sha256-<hex>/<size> -> sha256-<hex>-<size>) is kept.
ac_total=0 ac_drop=0
if [ -n "$ac" ]; then
  find "$ac" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | sort >"$work/ac_all"
  ac_total=$(wc -l <"$work/ac_all")
  (cd "$ac" && grep -roH '>sha256-[0-9a-f]\+/[0-9]\+' . || true) |
    awk -F: '{ f=$1; sub(/^\.\//,"",f); b=$2; sub(/^>/,"",b); sub(/\//,"-",b); print f, b }' >"$work/ac_refs"
  awk 'NR==FNR { keep[$1]=1; next } !($2 in keep) { bad[$1]=1 } END { for (f in bad) print f }' \
    "$work/keep" "$work/ac_refs" | sort >"$work/ac_drop"
  ac_drop=$(wc -l <"$work/ac_drop")
fi

if [ "$mode" = prune ]; then
  (cd "$cas" && xargs -d '\n' -r rm -f -- <"$work/cas_drop")
  [ -n "$ac" ] && (cd "$ac" && xargs -d '\n' -r rm -f -- <"$work/ac_drop")
fi

cas_after=$(size "$cas")
ac_after=0
[ -n "$ac" ] && ac_after=$(size "$ac")
echo "prune-sbt-cas mode=$mode"
echo "  cas: total=$cas_total kept=$((cas_total - cas_drop)) dropped=$cas_drop dangling_links=$dangling size_kb before=$cas_before after=$cas_after"
echo "  ac:  total=$ac_total kept=$((ac_total - ac_drop)) dropped=$ac_drop size_kb before=$ac_before after=$ac_after"
echo "  seconds=$((SECONDS - start))"
