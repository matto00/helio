#!/usr/bin/env bash
# HEL-1700: install Playwright's chromium system packages for the shared e2e CI setup (.github/actions/e2e-setup)
# without `npx playwright install --with-deps`, whose apt part (a) stalled for 7-14 min on the Azure Ubuntu mirror
# (20-30 kB/s) and (b) failed outright when the runner image's preinstalled packages.microsoft.com source returned 403.
#
# Subcommands:
#   os-segment     print the OS part of the cache key (`$ImageOS`, else /etc/os-release ID+VERSION_ID); fails if empty.
#   run            derive the package list, fetch the .debs (bounded, two mirrors, cached archive dir), install offline,
#                  prune the archive dir, and write `downloaded` / `save-key` to $GITHUB_OUTPUT.
#                  Needs E2E_APT_KEY_PREFIX (e.g. e2e-apt-debs-v1-ubuntu24.04-X64-).
#   _attempt N     internal: one bounded fetch attempt (apt-get update + install --download-only).
#
# Design (openspec/changes/bound-e2e-apt-deps/design.md): D1 package list from `playwright install-deps --dry-run`;
# D2 per-attempt Ubuntu-only apt option set (own sources dir + lists dir, so no third-party source is consulted and
# /var/lib/apt/lists is untouched); D3 archive dir cached by the action; D4 `timeout -k 10 90` per attempt, worst case
# 2 x (90 + 10) = 200 s. Every apt call after an attempt succeeds uses THAT attempt's full option set (C2).
set -euo pipefail

BOUND_SECONDS="${E2E_APT_BOUND_SECONDS:-90}"
KILL_GRACE_SECONDS=10
ARCHIVES="${E2E_APT_ARCHIVES:-$HOME/.cache/e2e-apt-debs}"
SOURCES_DIR="${E2E_APT_SOURCES_DIR:-/etc/apt/sources.list.d}"
ALT_MIRROR="${E2E_APT_ALT_MIRROR:-http://archive.ubuntu.com/ubuntu/}"
ALT_SECURITY_MIRROR="${E2E_APT_ALT_SECURITY_MIRROR:-http://security.ubuntu.com/ubuntu/}"
SELF="${BASH_SOURCE[0]}"

# Privilege: `sudo -n` unless already root. E2E_APT_SUDO (even empty) overrides, for the selftest.
if [ "${E2E_APT_SUDO+set}" = set ]; then
  # shellcheck disable=SC2206
  SUDO=(${E2E_APT_SUDO})
elif [ "$(id -u)" = 0 ]; then
  SUDO=()
else
  SUDO=(sudo -n)
fi

log() { echo "e2e-apt-deps: $*"; }
die() {
  echo "::error::e2e-apt-deps: $*" >&2
  exit 1
}

# --- OS segment of the cache key -------------------------------------------------------------------------------------
os_segment() {
  local seg="${ImageOS:-}" rel="${E2E_APT_OS_RELEASE:-/etc/os-release}"
  if [ -z "$seg" ] && [ -r "$rel" ]; then
    # shellcheck disable=SC1090
    seg="$(. "$rel" && printf '%s%s' "${ID:-}" "${VERSION_ID:-}")"
  fi
  [ -n "$seg" ] || die "cannot determine the runner OS image family (\$ImageOS unset and no ID/VERSION_ID in $rel)"
  printf '%s\n' "$seg"
}

# --- D1: package list from Playwright's own dry run -----------------------------------------------------------------
# stdin: `playwright install-deps --dry-run` output. stdout: one package per line. The command it prints is
# `sudo -- sh -c "apt-get update&& apt-get install -y --no-install-recommends <pkgs>"` (the sudo prefix is optional).
parse_package_list() {
  local text pkgs p
  text="$(cat)"
  pkgs="$(printf '%s\n' "$text" | sed -n 's/.*--no-install-recommends[[:space:]]\{1,\}\(.*\)$/\1/p' | head -n1)"
  pkgs="${pkgs%%\"*}"
  pkgs="${pkgs%%\'*}"
  [ -n "${pkgs//[[:space:]]/}" ] || die "no package list in 'playwright install-deps --dry-run chromium' output (missing package list)"
  for p in $pkgs; do
    [[ "$p" =~ ^[a-z0-9][a-z0-9+.-]*$ ]] || die "invalid apt package name '$p' in Playwright's dependency list"
    printf '%s\n' "$p"
  done
}

# --- D2: Ubuntu-only sources, per attempt ---------------------------------------------------------------------------
# Rewrites ONLY the `URIs:` of each deb822 stanza (`-security` suites go to the security mirror); everything else
# (Types, Suites, Components, Signed-By) is kept exactly. stdin -> stdout.
rewrite_uris() {
  local main="$1" sec="$2"
  awk -v main="$main" -v sec="$sec" '
    BEGIN { RS = ""; ORS = "\n\n" }
    {
      n = split($0, L, "\n"); issec = 0
      for (i = 1; i <= n; i++) if (L[i] ~ /^Suites:/ && L[i] ~ /-security/) issec = 1
      out = ""
      for (i = 1; i <= n; i++) {
        line = L[i]
        if (line ~ /^URIs:/) line = "URIs: " (issec ? sec : main)
        out = out (i > 1 ? "\n" : "") line
      }
      print out
    }'
}

# The image's Ubuntu deb822 source files: `*.sources` whose URIs are the Ubuntu archive / the runner's mirror list.
ubuntu_source_files() {
  local f
  for f in "$SOURCES_DIR"/*.sources; do
    [ -f "$f" ] || continue
    if grep -Eq '^URIs:.*(ubuntu\.com|apt-mirrors\.txt)' "$f"; then printf '%s\n' "$f"; fi
  done
}

# Build attempt N's sources dir. Attempt 1 = the image's own URIs; attempt 2 = the alternate Ubuntu mirrors.
prepare_attempt() {
  local n="$1" f d
  d="$WORK/a$n"
  mkdir -p "$d/sources.list.d" "$d/lists/partial"
  : >"$d/sources.list"
  local files
  files="$(ubuntu_source_files)"
  [ -n "$files" ] || die "no Ubuntu deb822 source file with a URIs: line in $SOURCES_DIR (refusing to fall back to the system's full source set)"
  while IFS= read -r f; do
    if [ "$n" = 1 ]; then
      cp "$f" "$d/sources.list.d/$(basename "$f")"
    else
      rewrite_uris "$ALT_MIRROR" "$ALT_SECURITY_MIRROR" <"$f" >"$d/sources.list.d/$(basename "$f")"
    fi
  done <<<"$files"
}

# Sets OPTS to attempt N's full apt option set (sources, lists, archives, retries/timeouts).
apt_opts() {
  local n="$1" d
  d="$WORK/a$n"
  mkdir -p "$ARCHIVES/partial" "$d/lists/partial"
  OPTS=(
    -o "Dir::Etc::SourceList=$d/sources.list"
    -o "Dir::Etc::SourceParts=$d/sources.list.d/"
    -o "Dir::State::Lists=$d/lists/"
    -o "Dir::Cache::Archives=$ARCHIVES/"
    -o "Dir::Cache::pkgcache="
    -o "Dir::Cache::srcpkgcache="
    -o "APT::Keep-Downloaded-Packages=true"
    -o "Acquire::Retries=2"
    -o "Acquire::http::Timeout=20"
    -o "Acquire::https::Timeout=20"
  )
  # TEMP HEL-1700 verification (4.2): reproduce a live 25 kB/s trickle on attempt 1 only. REVERT BEFORE READY.
  if [ "$n" = 1 ]; then OPTS+=(-o "Acquire::http::Dl-Limit=25"); fi
}

apt() { "${SUDO[@]}" apt-get "$@"; }

# --- D4: one bounded attempt ----------------------------------------------------------------------------------------
attempt_body() {
  local n="$1"
  # shellcheck disable=SC2206
  local pkgs=($E2E_APT_PKGS)
  apt_opts "$n"
  apt "${OPTS[@]}" update
  apt "${OPTS[@]}" install -y --no-install-recommends --download-only "${pkgs[@]}"
}

list_debs() { (cd "$ARCHIVES" 2>/dev/null && ls -1 -- *.deb 2>/dev/null) | LC_ALL=C sort || true; }

# --- prune: keep only the .debs whose name+version equal the installed version -------------------------------------
# apt encodes the epoch colon in file names as %3a (xvfb 2:21.1.12 -> xvfb_2%3a21.1.12-..._amd64.deb); dpkg-query
# prints `2:`. Normalise or xvfb is pruned and re-downloaded (and the cache re-saved) every run.
prune_archives() {
  local f name rest ver have
  for f in $(list_debs); do
    name="${f%%_*}"
    rest="${f#*_}"
    ver="${rest%_*}"
    ver="${ver//%3a/:}"
    ver="${ver//%3A/:}"
    have="$(dpkg-query -W -f='${Version}' "$name" 2>/dev/null || true)"
    if [ "$have" != "$ver" ]; then
      rm -f -- "$ARCHIVES/$f"
      log "pruned $f (installed: ${have:-none})"
    fi
  done
  "${SUDO[@]}" rm -rf "$ARCHIVES/partial" "$ARCHIVES/lock"
}

# stdin: sorted file names. stdout: key suffix (sha256 of the names).
save_hash() { sha256sum | cut -c1-64; }

run() {
  [ -n "${E2E_APT_KEY_PREFIX:-}" ] || die "E2E_APT_KEY_PREFIX is not set"
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/e2e-apt-deps.XXXXXX")"
  export WORK ARCHIVES SOURCES_DIR ALT_MIRROR ALT_SECURITY_MIRROR E2E_APT_SUDO="${E2E_APT_SUDO-__unset__}"
  [ "$E2E_APT_SUDO" != "__unset__" ] || unset E2E_APT_SUDO

  log "ImageOS=${ImageOS:-<unset>}; sources in $SOURCES_DIR:"
  ls -1 "$SOURCES_DIR" 2>/dev/null | sed 's/^/e2e-apt-deps:   /' || true
  local f
  for f in $(ubuntu_source_files); do
    log "--- $f"
    grep -Ev '^[[:space:]]*(#|$)' "$f" | sed 's/^/e2e-apt-deps:   /'
  done

  local dry pkgs
  dry="$(npx playwright install-deps --dry-run chromium)" || die "'playwright install-deps --dry-run chromium' failed"
  log "playwright install-deps --dry-run chromium: $dry"
  printf '%s\n' "$dry" | parse_package_list >"$WORK/packages"
  pkgs="$(cat "$WORK/packages")"
  export E2E_APT_PKGS
  E2E_APT_PKGS="$(printf '%s' "$pkgs" | tr '\n' ' ')"
  log "playwright chromium packages: $E2E_APT_PKGS"

  mkdir -p "$ARCHIVES/partial"
  local before after
  before="$(list_debs)"

  local winner="" n uri_desc=()
  for n in 1 2; do
    prepare_attempt "$n"
    uri_desc[n]="$(grep -h '^URIs:' "$WORK/a$n/sources.list.d/"*.sources | sed 's/^URIs: *//' | sort -u | tr '\n' ' ')"
    log "attempt $n: bounded ${BOUND_SECONDS}s (+${KILL_GRACE_SECONDS}s kill grace), mirrors: ${uri_desc[n]}"
    if timeout -k "$KILL_GRACE_SECONDS" "$BOUND_SECONDS" bash "$SELF" _attempt "$n" 2>&1 | tee "$WORK/a$n/log"; then
      winner="$n"
      break
    fi
    log "attempt $n failed or exceeded ${BOUND_SECONDS}s; last fetch line: $(grep -E '^(Get|Ign|Err):' "$WORK/a$n/log" | tail -n1)"
    # apt ran as root, so what it left in partial/ is root-owned (CI run 39864699117: plain `rm` got Permission denied).
    "${SUDO[@]}" rm -rf "$ARCHIVES/partial"
    mkdir -p "$ARCHIVES/partial"
  done
  if [ -z "$winner" ]; then
    die "chromium system package fetch did not finish within ${BOUND_SECONDS}s on either mirror (attempt 1: ${uri_desc[1]}| attempt 2: ${uri_desc[2]}| last fetch: $(cat "$WORK"/a*/log | grep -E '^(Get|Ign|Err):' | tail -n1))"
  fi
  log "attempt $winner fetched the packages"

  after="$(list_debs)"
  local downloaded
  downloaded="$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$after") | grep -c . || true)"

  # C2: the offline install uses the winning attempt's full option set.
  apt_opts "$winner"
  # shellcheck disable=SC2206
  local pkgarr=($E2E_APT_PKGS)
  apt "${OPTS[@]}" install -y --no-install-recommends --no-download "${pkgarr[@]}"

  prune_archives
  "${SUDO[@]}" chown -R "$(id -u):$(id -g)" "$ARCHIVES" 2>/dev/null || true
  local key
  key="${E2E_APT_KEY_PREFIX}$(list_debs | save_hash)"
  log "downloaded=$downloaded save-key=$key kept=$(list_debs | grep -c . || true)"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
      echo "downloaded=$downloaded"
      echo "save-key=$key"
    } >>"$GITHUB_OUTPUT"
  fi
}

main() {
  case "${1:-}" in
    os-segment) os_segment ;;
    run) run ;;
    _attempt) attempt_body "${2:?attempt number}" ;;
    *) die "usage: $0 os-segment | run" ;;
  esac
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
