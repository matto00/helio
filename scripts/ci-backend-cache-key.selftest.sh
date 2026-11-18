#!/usr/bin/env bash
# HEL-1758 D1 selftest for scripts/ci-backend-cache-key.sh. Runs against a throwaway `git init` repo (this
# worktree's git admin dir is never touched). Usage: ci-backend-cache-key.selftest.sh [script-under-test]
# The optional argument lets the broken variants be fed in to prove this test goes red against them.
set -u
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_PREFIX
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SUT="${1:-$ROOT/scripts/ci-backend-cache-key.sh}"
T="$(mktemp -d "${TMPDIR:-/tmp}/ci-backend-cache-key-selftest.XXXXXX")" || exit 1
trap 'rm -rf "$T"' EXIT
fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
check() { if [ "$2" = 0 ]; then ok "$1"; else bad "$1"; fi; }

R="$T/repo"
mkdir -p "$R/backend/src/main/scala" "$R/backend/project" "$R/docs" "$R/nested"
git init -q "$R"
git -C "$R" config user.email t@example.invalid
git -C "$R" config user.name t
echo a > "$R/backend/src/main/scala/A.scala"
echo b > "$R/backend/build.sbt"
echo c > "$R/backend/project/P.scala"
echo d > "$R/backend/project/plugins.sbt"
echo e > "$R/backend/project/build.properties"
echo f > "$R/docs/readme.md"
git -C "$R" add -A
git -C "$R" commit -q -m base

get() { # $1 = compile|deps
  bash "$SUT" "$R" 2>/dev/null | sed -n "s/^$1=//p"
}
mutate() { # $1 = file, then commit
  echo "change-$RANDOM-$RANDOM" >> "$R/$1"
  git -C "$R" add -A
  git -C "$R" commit -q -m "touch $1"
}

c0="$(get compile)"; d0="$(get deps)"

printf '%s' "$c0" | grep -Eq '^[0-9a-f]{64}$'; check "compile value is 64 lowercase hex" $?
printf '%s' "$d0" | grep -Eq '^[0-9a-f]{64}$'; check "deps value is 64 lowercase hex" $?

mutate docs/readme.md
{ [ "$(get compile)" = "$c0" ] && [ "$(get deps)" = "$d0" ]; }; check "only a non-backend file changed: both keys unchanged" $?

mutate backend/src/main/scala/A.scala
c1="$(get compile)"
[ "$c1" != "$c0" ]; check "backend/src change: compile key changes" $?
[ "$(get deps)" = "$d0" ]; check "backend/src change: deps key unchanged" $?

mutate backend/project/P.scala
c2="$(get compile)"
[ "$c2" != "$c1" ]; check "backend/project/*.scala change: compile key changes" $?

mutate backend/project/plugins.sbt
c3="$(get compile)"
[ "$c3" != "$c2" ]; check "backend/project/*.sbt change: compile key changes" $?

mutate backend/project/build.properties
c3b="$(get compile)"
[ "$c3b" != "$c3" ]; check "backend/project/build.properties change: compile key changes" $?

mutate backend/build.sbt
c4="$(get compile)"; d4="$(get deps)"
[ "$c4" != "$c3b" ]; check "backend/build.sbt change: compile key changes" $?
[ "$d4" != "$d0" ]; check "backend/build.sbt change: deps key changes" $?

# A nested build.sbt is part of the deps key, as hashFiles('**/build.sbt') had it.
echo n > "$R/nested/build.sbt"; git -C "$R" add -A; git -C "$R" commit -q -m nested
[ "$(get deps)" != "$d4" ]; check "a nested build.sbt change moves the deps key" $?

# $GITHUB_OUTPUT gets both lines.
GO="$T/gh-output"; : > "$GO"
GITHUB_OUTPUT="$GO" bash "$SUT" "$R" > /dev/null 2>&1
{ grep -Eq '^compile=[0-9a-f]{64}$' "$GO" && grep -Eq '^deps=[0-9a-f]{64}$' "$GO"; }; check "writes compile= and deps= to GITHUB_OUTPUT" $?

# Empty input sets fail non-zero.
E="$T/empty"; mkdir -p "$E/backend"; git init -q "$E"
echo x > "$E/backend/other.txt"; git -C "$E" add -A
git -C "$E" -c user.email=t@example.invalid -c user.name=t commit -q -m e
bash "$SUT" "$E" > "$T/empty.out" 2> "$T/empty.err"; rc=$?
{ [ "$rc" != 0 ] && [ ! -s "$T/empty.out" ]; }; check "an empty input set exits non-zero and prints no key" $?

echo
if [ "$fails" = 0 ]; then echo "ci-backend-cache-key selftest: all passed"; else echo "ci-backend-cache-key selftest: $fails FAILED"; exit 1; fi
