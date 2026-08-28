#!/usr/bin/env bash
# Reconstructs one annotated tag + changelog per historical deploy, from the
# manifest derived from Artifact Registry push records. Creates tags LOCALLY
# only — pushing is a separate, reviewed step.
#
# Tag objects are backdated via GIT_COMMITTER_DATE/GIT_AUTHOR_DATE. That stamps
# the TAG object's tagger date; the commit it points at is not modified.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
MANIFEST="$REPO_ROOT/docs/superpowers/specs/2026-08-28-release-tag-manifest.tsv"
OUT=/tmp/helio-backfill
rm -rf "$OUT"; mkdir -p "$OUT/notes"

: > "$OUT/REVIEW.md"
{
  echo "# Backfill review"
  echo
  echo "| tag | commit | original push | commits |"
  echo "|---|---|---|---|"
} >> "$OUT/REVIEW.md"

while IFS=$'\t' read -r TAG SHA TS RANGE COUNT; do
  [ -n "$TAG" ] || continue

  git rev-parse -q --verify "${SHA}^{commit}" >/dev/null \
    || { echo "FATAL: $TAG -> $SHA does not resolve" >&2; exit 1; }

  # Normalize the registry's naive-UTC timestamps; leave offset-bearing ones be.
  case "$TS" in
    *Z|*+*|*-??:??) STAMP="$TS" ;;
    *) STAMP="${TS}Z" ;;
  esac

  NOTES="$OUT/notes/${TAG}.md"
  {
    echo "## ${TAG}"
    echo
    echo "Deployed ${STAMP} from \`${SHA}\`."
    echo
    echo "### Changes"
    echo
    git log --format='- %s' "$RANGE" 2>/dev/null || git log --format='- %s' -1 "$SHA"
  } > "$NOTES"

  GIT_COMMITTER_DATE="$STAMP" GIT_AUTHOR_DATE="$STAMP" \
    git tag -a "$TAG" -F "$NOTES" "$SHA" -f

  printf '| %s | `%s` | %s | %s |\n' "$TAG" "$SHA" "$STAMP" "$COUNT" >> "$OUT/REVIEW.md"
done < "$MANIFEST"

echo "Generated $(git tag -l 'v0.*' | wc -l) tags into the local repo."
echo "Review: $OUT/REVIEW.md and $OUT/notes/"
