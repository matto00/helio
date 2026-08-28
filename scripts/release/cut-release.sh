#!/usr/bin/env bash
# Cut a release: create release/v<M.m> at <M.m>.0, or fast-forward it and
# tag <M.m>.<n+1>. Pushing the TAG is what deploys.
#
# Set DRY_RUN=1 to print the plan and changelog and exit 0 without running
# any of the git push / git tag / gh release create commands, and without
# prompting for confirmation.
set -euo pipefail

MM="${1:-}"
[[ "$MM" =~ ^[0-9]+\.[0-9]+$ ]] || { echo "usage: cut-release.sh <major.minor>  e.g. 0.8" >&2; exit 1; }

BRANCH="release/v${MM}"
git fetch --all --tags --prune -q

if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  LAST=$(git tag -l "v${MM}.*" --sort=-v:refname | head -1)
  [ -n "$LAST" ] || { echo "Branch $BRANCH exists but has no v${MM}.* tag; aborting." >&2; exit 1; }
  NEXT="v${MM}.$(( ${LAST##*.} + 1 ))"
  BASE="$LAST"
  MODE="patch"
else
  NEXT="v${MM}.0"
  PREV_MINOR=$(git branch -r --list 'origin/release/v*' \
    | sed 's|.*release/v||' | sort -V | tail -1)
  BASE=$([ -n "$PREV_MINOR" ] && echo "origin/release/v${PREV_MINOR}" || echo "")
  MODE="minor"
fi

TARGET=$(git rev-parse origin/main)
SHA8=$(git rev-parse --short=8 origin/main)
RANGE=$([ -n "$BASE" ] && echo "${BASE}..${TARGET}" || echo "$TARGET")

NOTES=$(mktemp)
{
  echo "## ${NEXT}"
  echo
  echo "Released from \`${SHA8}\`."
  echo
  echo "### Changes"
  echo
  git log --format='- %s' "$RANGE"
} > "$NOTES"

cat <<EOF

  mode:     $MODE
  branch:   $BRANCH $([ "$MODE" = minor ] && echo "(will be created)" || echo "(will fast-forward)")
  tag:      $NEXT
  target:   $SHA8
  range:    $RANGE
  commits:  $(git log --oneline "$RANGE" | wc -l)

EOF
cat "$NOTES"
echo

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN=1: would push $BRANCH and tag $NEXT (no changes made)."
  rm -f "$NOTES"
  exit 0
fi

read -r -p "Push $BRANCH and tag $NEXT? This DEPLOYS. [y/N] " ans
[ "$ans" = "y" ] || { echo "Aborted."; rm -f "$NOTES"; exit 0; }

git push origin "${TARGET}:refs/heads/${BRANCH}"
git tag -a "$NEXT" -F "$NOTES" "$TARGET"
git push origin "$NEXT"
gh release create "$NEXT" --title "$NEXT" --notes-file "$NOTES" --verify-tag
rm -f "$NOTES"
echo "Released $NEXT. Deploy triggered by the tag push."
