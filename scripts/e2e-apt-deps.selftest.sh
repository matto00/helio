#!/usr/bin/env bash
# HEL-1700 selftest for scripts/e2e-apt-deps.sh. Hermetic: stub `apt-get`, `timeout`, `dpkg-query`, `npx` and `sudo`-less
# privilege (E2E_APT_SUDO="") on PATH, a fixture sources dir and a throwaway HOME. Nothing here touches the real apt state.
# E2E_APT_DEPS_SCRIPT points the run at another copy of the script (used to mutation-check this test).
set -u
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_PREFIX
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SCRIPT="${E2E_APT_DEPS_SCRIPT:-$ROOT/scripts/e2e-apt-deps.sh}"
T="$(mktemp -d "${TMPDIR:-/tmp}/e2e-apt-deps-selftest.XXXXXX")" || exit 1
trap 'rm -rf "$T"' EXIT
fails=0
ok() { echo "ok   $1"; }
bad() {
  echo "FAIL $1"
  fails=$((fails + 1))
}
check() { if [ "$2" = 0 ]; then ok "$1"; else bad "$1"; fi; }
has() { grep -qF -- "$2" <<<"$1"; }

# ---- stubs --------------------------------------------------------------------------------------------------------
mkdir -p "$T/bin"
cat >"$T/bin/apt-get" <<'STUB'
#!/bin/bash
echo "apt-get $*" >>"$STUB_LOG"
arch=""
for a in "$@"; do case "$a" in Dir::Cache::Archives=*) arch="${a#*=}" ;; esac; done
if [[ " $* " == *" --download-only "* ]]; then
  for f in $STUB_DOWNLOAD; do : >"$arch/$f"; done
fi
exit 0
STUB
cat >"$T/bin/timeout" <<'STUB'
#!/bin/bash
# timeout -k GRACE DURATION cmd...  (simulates expiry for the attempts listed in STUB_TIMEOUT_ATTEMPTS)
echo "timeout $*" >>"$STUB_LOG"
shift 3
n="${*: -1}"
for t in ${STUB_TIMEOUT_ATTEMPTS:-}; do
  if [ "$t" = "$n" ]; then
    echo "Get:1 http://stalled.example/ubuntu noble/universe amd64 fonts-unifont all 1:15 [2993 kB]"
    exit 124
  fi
done
exec "$@"
STUB
cat >"$T/bin/dpkg-query" <<'STUB'
#!/bin/bash
name="${*: -1}"
v="$(awk -v n="$name" '$1 == n { print $2 }' "$STUB_INSTALLED")"
[ -n "$v" ] || exit 1
printf '%s' "$v"
STUB
cat >"$T/bin/npx" <<'STUB'
#!/bin/bash
printf '%s' "$STUB_DRYRUN"
STUB
chmod +x "$T"/bin/*
export PATH="$T/bin:$PATH"

# ---- fixtures -----------------------------------------------------------------------------------------------------
SRC="$T/sources.list.d"
mkdir -p "$SRC"
cat >"$SRC/ubuntu.sources" <<'EOF'
## comment line
Types: deb
URIs: mirror+file:/etc/apt/apt-mirrors.txt
Suites: noble noble-updates noble-backports
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: mirror+file:/etc/apt/apt-mirrors.txt
Suites: noble-security
Components: main universe restricted multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
cat >"$SRC/microsoft-prod.sources" <<'EOF'
Types: deb
URIs: https://packages.microsoft.com/ubuntu/24.04/prod
Suites: noble
Components: main
Signed-By: /usr/share/keyrings/microsoft-prod.gpg
EOF
DRY='sudo -- sh -c "apt-get update&& apt-get install -y --no-install-recommends xvfb fonts-a libnss3"'
INSTALLED="$T/installed"
printf 'xvfb 2:21.1.12-1\nfonts-a 1-1\nlibnss3 2:3.98-1\nnewpkg 1-1\n' >"$INSTALLED"

# shellcheck source=/dev/null
(
  # unit-level functions (the script only runs main when executed, not sourced)
  . "$SCRIPT"
  set +e
  fails=0
  check() { if [ "$2" = 0 ]; then echo "ok   $1"; else echo "FAIL $1"; fails=$((fails + 1)); fi; }
  # 1. package list parse
  got="$(printf 'Installing...\n%s\n' "$DRY" | parse_package_list | tr '\n' ' ')"
  [ "$got" = "xvfb fonts-a libnss3 " ]
  check "parse_package_list: sudo -- sh -c form" $? >&3
  got="$(echo 'apt-get install -y --no-install-recommends libasound2t64 libx11-6' | parse_package_list | tr '\n' ' ')"
  [ "$got" = "libasound2t64 libx11-6 " ]
  check "parse_package_list: bare form" $? >&3
  out="$(echo 'nothing useful' | parse_package_list 2>&1)"
  rc=$?
  { [ "$rc" != 0 ] && has "$out" "missing package list"; }
  check "parse_package_list: empty list -> named error" $? >&3
  out="$(echo 'x --no-install-recommends good Bad;rm' | parse_package_list 2>&1)"
  rc=$?
  { [ "$rc" != 0 ] && has "$out" "invalid apt package name"; }
  check "parse_package_list: malformed token -> named error" $? >&3

  # 2. OS segment
  [ "$(ImageOS=ubuntu24 os_segment)" = ubuntu24 ]
  check "os_segment: \$ImageOS wins" $? >&3
  printf 'ID=ubuntu\nVERSION_ID="24.04"\n' >"$T/os-release"
  [ "$(ImageOS= E2E_APT_OS_RELEASE=$T/os-release os_segment)" = ubuntu24.04 ]
  check "os_segment: falls back to os-release ID+VERSION_ID" $? >&3
  out="$(ImageOS= E2E_APT_OS_RELEASE=$T/none os_segment 2>&1)"
  rc=$?
  { [ "$rc" != 0 ] && has "$out" "cannot determine the runner OS"; }
  check "os_segment: empty -> named error" $? >&3

  # 3. URIs rewrite keeps everything else
  rw="$(rewrite_uris http://archive.ubuntu.com/ubuntu/ http://security.ubuntu.com/ubuntu/ <"$SRC/ubuntu.sources")"
  { has "$rw" "URIs: http://archive.ubuntu.com/ubuntu/" && has "$rw" "URIs: http://security.ubuntu.com/ubuntu/" &&
    ! has "$rw" "mirror+file"; }
  check "rewrite_uris: both stanzas rewritten, security stanza gets the security mirror" $? >&3
  keep=0
  for l in "Suites: noble noble-updates noble-backports" "Suites: noble-security" \
    "Components: main universe restricted multiverse" "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg" \
    "Types: deb" "## comment line"; do has "$rw" "$l" || keep=1; done
  [ "$keep" = 0 ]
  check "rewrite_uris: Suites/Components/Signed-By/Types/comments preserved" $? >&3
  exit "$fails"
) 3>&1
fails=$((fails + $?))

# ---- script-level cases (stubbed apt) -----------------------------------------------------------------------------
# run_case NAME  -- runs `run` with the current STUB_* env in a fresh HOME unless HOME_KEEP is set. Sets OUT, RC, LOG.
run_case() {
  LOG="$T/log.$1"
  : >"$LOG"
  OUT="$(
    HOME="$T/home-$1" E2E_APT_ARCHIVES="$T/home-$1/debs" E2E_APT_SOURCES_DIR="${SOURCES_OVERRIDE:-$SRC}" E2E_APT_SUDO="" \
      E2E_APT_KEY_PREFIX="e2e-apt-debs-v1-ubuntu24.04-X64-" GITHUB_OUTPUT="$T/gho.$1" STUB_LOG="$LOG" \
      STUB_INSTALLED="$INSTALLED" STUB_DRYRUN="${DRYRUN_OVERRIDE-$DRY}" STUB_DOWNLOAD="${STUB_DOWNLOAD:-}" \
      STUB_TIMEOUT_ATTEMPTS="${STUB_TIMEOUT_ATTEMPTS:-}" TMPDIR="$T" bash "$SCRIPT" run 2>&1
  )"
  RC=$?
}
gho() { grep "^$2=" "$T/gho.$1" | cut -d= -f2-; }

# A. cold: two downloads, one with an epoch (apt names it %3a, dpkg-query prints 2:) -> kept, counted
mkdir -p "$T/home-cold"
STUB_DOWNLOAD='xvfb_2%3a21.1.12-1_amd64.deb fonts-a_1-1_all.deb' run_case cold
[ "$RC" = 0 ] && [ "$(gho cold downloaded)" = 2 ]
check "cold: succeeds, downloaded=2" $?
ls "$T/home-cold/debs" | grep -q 'xvfb_2%3a' && ! has "$OUT" "pruned xvfb"
check "prune: epoch-bearing xvfb_2%3a... is normalised and KEPT" $?
key1="$(gho cold save-key)"
pfx="e2e-apt-debs-v1-ubuntu24.04-X64-"
{ has "$key1" "$pfx" && [ "${#key1}" = $((${#pfx} + 64)) ]; }
check "save-key: prefix + 64-hex sha256" $?
ls "$T"/e2e-apt-deps.*/a1/sources.list.d 2>/dev/null | grep -q microsoft && bad "microsoft source leaked" || ok "third-party source: microsoft-prod.sources not copied"
grep -q -- '--no-download' "$LOG" && grep -q -- '--download-only' "$LOG"
check "two-phase: --download-only then --no-download both invoked" $?

# B. prune-only: old version seeded, nothing downloaded -> downloaded=0, old pruned, key = hash of the kept set
mkdir -p "$T/home-prune/debs"
: >"$T/home-prune/debs/xvfb_2%3a21.1.12-1_amd64.deb"
: >"$T/home-prune/debs/fonts-a_1-1_all.deb"
: >"$T/home-prune/debs/fonts-a_0.9-1_all.deb"
STUB_DOWNLOAD='' run_case prune
{ [ "$RC" = 0 ] && [ "$(gho prune downloaded)" = 0 ] && has "$OUT" "pruned fonts-a_0.9-1_all.deb" && [ ! -e "$T/home-prune/debs/fonts-a_0.9-1_all.deb" ]; }
check "prune-only change: old version pruned, downloaded=0 (action will not save)" $?
[ "$(gho prune save-key)" = "$key1" ]
check "save-key: identical kept set -> identical key (stable across runs)" $?

# C. one new download on a warm dir -> downloaded=1 and a different key
mkdir -p "$T/home-one/debs"
: >"$T/home-one/debs/xvfb_2%3a21.1.12-1_amd64.deb"
: >"$T/home-one/debs/fonts-a_1-1_all.deb"
STUB_DOWNLOAD='newpkg_1-1_all.deb' run_case one
{ [ "$RC" = 0 ] && [ "$(gho one downloaded)" = 1 ] && [ "$(gho one save-key)" != "$key1" ]; }
check "one new download: downloaded=1 (action saves) and the key changes" $?

# D. attempt 1 times out -> attempt 2 wins -> the offline install uses attempt 2's FULL option set (C2)
mkdir -p "$T/home-fb"
STUB_DOWNLOAD='fonts-a_1-1_all.deb' STUB_TIMEOUT_ATTEMPTS='1' run_case fb
inst="$(grep -- '--no-download' "$LOG")"
{ [ "$RC" = 0 ] && has "$OUT" "attempt 1 failed or exceeded"; }
check "fallback: attempt 1 timeout -> attempt 2 is tried and wins" $?
{ has "$inst" "/a2/sources.list" && has "$inst" "/a2/sources.list.d/" && has "$inst" "/a2/lists/" && has "$inst" "Dir::Cache::Archives=$T/home-fb/debs/" &&
  ! has "$inst" "/a1/"; }
check "C2: offline install runs with attempt 2's sources, lists and archives (not attempt 1's)" $?
upd="$(grep -c ' update$' "$LOG")"
[ "$upd" = 1 ]
check "fallback: only the surviving attempt reached apt (the timed-out one never ran apt)" $?
alt="$(cat "$T"/e2e-apt-deps.*/a2/sources.list.d/ubuntu.sources 2>/dev/null)"
has "$alt" "URIs: http://archive.ubuntu.com/ubuntu/" && has "$alt" "URIs: http://security.ubuntu.com/ubuntu/"
check "fallback: attempt 2 sources point at the alternate Ubuntu mirrors" $?

# E. both attempts fail -> named error, no install
mkdir -p "$T/home-both"
STUB_TIMEOUT_ATTEMPTS='1 2' run_case both
{ [ "$RC" != 0 ] && has "$OUT" "::error::e2e-apt-deps: chromium system package fetch did not finish" && has "$OUT" "stalled.example" &&
  ! grep -q -- '--no-download' "$LOG"; }
check "both attempts fail: named ::error:: naming the stalled fetch, exit non-zero, nothing installed" $?

# F. no package list -> named error before any apt call
DRYRUN_OVERRIDE='' run_case nolist
{ [ "$RC" != 0 ] && has "$OUT" "missing package list" && [ ! -s "$LOG" ]; }
check "no package list: named error before any apt invocation" $?

# G. no Ubuntu sources file -> named error, never the full system source set
mkdir -p "$T/emptysrc"
cp "$SRC/microsoft-prod.sources" "$T/emptysrc/"
SOURCES_OVERRIDE="$T/emptysrc" run_case nosrc
{ [ "$RC" != 0 ] && has "$OUT" "no Ubuntu deb822 source file" && ! grep -q 'apt-get' "$LOG"; }
check "no Ubuntu sources: named error, no apt call, no fallback to all sources" $?

if [ "$fails" -ne 0 ]; then
  echo "$fails check(s) failed"
  exit 1
fi
echo "all e2e-apt-deps checks passed"
