#!/usr/bin/env bash
# Cut a release: create release/v<M.m> at <M.m>.0, or fast-forward it and
# tag <M.m>.<n+1>. Pushing the TAG is what deploys.
#
# Set DRY_RUN=1 to print the plan and changelog and exit 0 without running
# any of the git push / git tag / gh release create commands, and without
# prompting for confirmation.
#
# Set RELEASE_HEADLINE to prepend hand-written prose above the generated
# changelog (a title line, then any explanatory paragraphs). Use this when a
# release needs narrative -- a diagnostic build, an incident fix, a milestone.
# It exists so there is never a reason to hand-roll `git tag -a -m`: doing that
# skips the release-branch fast-forward and the GitHub Release, which is how
# v0.7.8-v0.7.11 ended up tagged and deployed but absent from the Releases
# page with release/v0.7 left 26 commits behind main.
set -euo pipefail

# Every network call is announced and bounded. A blackholed connection to
# GitHub is otherwise indistinguishable from work in progress: `git fetch -q`
# prints nothing and waits forever, which reads as a hung script.
step() { printf '==> %s\n' "$*" >&2; }

# Fail a stalled transfer instead of hanging: abort if throughput stays under
# 1 KiB/s for 30s. Applies to every git network op below, fetch and push alike.
export GIT_HTTP_LOW_SPEED_LIMIT="${GIT_HTTP_LOW_SPEED_LIMIT:-1024}"
export GIT_HTTP_LOW_SPEED_TIME="${GIT_HTTP_LOW_SPEED_TIME:-30}"

MM="${1:-}"
[[ "$MM" =~ ^[0-9]+\.[0-9]+$ ]] || { echo "usage: cut-release.sh <major.minor>  e.g. 0.8" >&2; exit 1; }

BRANCH="release/v${MM}"
step "fetching refs and tags from origin"
git fetch --all --tags --prune --progress

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
  if [ -n "${RELEASE_HEADLINE:-}" ]; then
    printf '%s\n' "$RELEASE_HEADLINE"
    echo
  fi
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

step "pushing $BRANCH -> $SHA8"
git push --progress origin "${TARGET}:refs/heads/${BRANCH}"
step "creating tag $NEXT"
git tag -a "$NEXT" -F "$NOTES" "$TARGET"
step "pushing tag $NEXT (this triggers the deploy)"
git push --progress origin "$NEXT"
step "publishing GitHub Release $NEXT"
gh release create "$NEXT" --title "$NEXT" --notes-file "$NOTES" --verify-tag
rm -f "$NOTES"
echo "Released $NEXT. Deploy triggered by the tag push."
