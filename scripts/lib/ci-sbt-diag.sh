#!/usr/bin/env bash
# HEL-1339 -- shared sbt-hang diagnostics, SOURCED by scripts/ci-sbt.sh and scripts/e2e-backend.sh.
#
# Every PID handled here comes from a RECORDED source, never a process-name or command-line match:
#   launch  the PID recorded when CI launched sbt (in `--server` mode `setsid` execs `sbt` which execs the build JVM,
#           so it becomes the JVM itself);
#   group   every process whose /proc/<p>/stat process-group field equals the PGID recorded at launch (this is how
#           the JVM forked by `sbt run` / the forked test JVMs are found), enumerated from /proc, not by name;
#   socket  only when backend/project/target/active.json exists (thin-client mode): the PID owning the exact socket
#           path that file names (`ss -xlpn`, matched against the literal path).
# A candidate is dumped only if /proc/<p>/exe is a `java` binary and /proc/<p>/cwd is the backend dir or below it.
# Nothing is ever signalled individually unless it passed that check; the recorded process GROUP is stopped as a
# whole (the group id of a live group cannot be handed to an unrelated process; an already-empty group is a
# harmless ESRCH -- a reused PID number is negligible, not impossible, over the seconds involved).
#
# Total capture budget is CI_SBT_CAPTURE_BUDGET seconds (default 25); every external call is clamped to what is left.

CI_SBT_CAPTURE_BUDGET="${CI_SBT_CAPTURE_BUDGET:-25}"
_diag_t0=0

_diag_remaining() { echo $((CI_SBT_CAPTURE_BUDGET - (SECONDS - _diag_t0))); }

# _diag_timeout <cap-seconds> <cmd...>: run with min(cap, remaining budget); 124 when no budget is left.
_diag_timeout() {
  local cap="$1" rem
  shift
  rem="$(_diag_remaining)"
  [ "$rem" -le 0 ] && return 124
  [ "$cap" -gt "$rem" ] && cap="$rem"
  timeout -k 1 "$cap" "$@"
}

# _diag_pgrp <pid>: process-group id from /proc/<pid>/stat (field 5; parsed after the ") " that ends comm).
_diag_pgrp() {
  local stat rest
  stat="$(cat "/proc/$1/stat" 2> /dev/null)" || return 1
  rest="${stat##*) }"
  set -- $rest
  echo "${3:-}"
}

# _diag_is_backend_jvm <pid> <abs-backend-dir>: 0 when exe is a java binary and cwd is the backend dir or below.
_diag_is_backend_jvm() {
  local exe cwd
  exe="$(readlink "/proc/$1/exe" 2> /dev/null)" || return 1
  cwd="$(readlink "/proc/$1/cwd" 2> /dev/null)" || return 1
  case "$exe" in */java) ;; *) return 1 ;; esac
  [ "$cwd" = "$2" ] || case "$cwd" in "$2"/*) return 0 ;; *) return 1 ;; esac
}

# _diag_socket_owner <abs-backend-dir>: PID owning the socket path named by active.json; empty when none.
_diag_socket_owner() {
  local aj="$1/project/target/active.json" body path line
  [ -f "$aj" ] || return 0
  body="$(cat "$aj" 2> /dev/null)"
  [[ "$body" =~ \"uri\"[[:space:]]*:[[:space:]]*\"local://([^\"]+)\" ]] || return 0
  path="${BASH_REMATCH[1]}"
  while IFS= read -r line; do
    if [[ "$line" == *"$path"* && "$line" =~ pid=([0-9]+) ]]; then
      echo "${BASH_REMATCH[1]}"
      return 0
    fi
  done < <(_diag_timeout 4 ss -xlpn 2> /dev/null)
}

# ci_sbt_capture <pgid> <launch-pid> <backend-dir> <outdir>
# Writes thread dumps to <outdir>/threads-<pid>.txt and returns 0 when at least one JVM was dumped, 1 otherwise.
# Prints one `ci-sbt-diag:` line per candidate naming the PID SOURCE actually used.
ci_sbt_capture() {
  local pgid="$1" launch="$2" dir outdir="$4" p pg dumped=0 src
  local -a order=()
  local -A seen=() source_of=()
  dir="$(cd "$3" 2> /dev/null && pwd -P)" || { echo "ci-sbt-diag: backend dir $3 not found; nothing dumped"; return 1; }
  mkdir -p "$outdir"
  _diag_t0=$SECONDS

  _diag_add() { # pid source
    [ -n "$1" ] || return 0
    [ -n "${seen[$1]:-}" ] && return 0
    seen[$1]=1
    source_of[$1]="$2"
    order+=("$1")
  }
  _diag_add "$launch" launch
  for p in /proc/[0-9]*; do
    p="${p#/proc/}"
    pg="$(_diag_pgrp "$p")" || continue
    [ "$pg" = "$pgid" ] && _diag_add "$p" group
  done
  _diag_add "$(_diag_socket_owner "$dir")" socket

  {
    echo "=== process tree of recorded session $pgid ($(date -u +%FT%TZ)) ==="
    _diag_timeout 5 ps -o pid,ppid,pgid,sid,stat,etime,args --sid "$pgid" 2>&1
  } > "$outdir/ps-session.txt"

  for p in "${order[@]}"; do
    src="${source_of[$p]}"
    if ! _diag_is_backend_jvm "$p" "$dir"; then
      echo "ci-sbt-diag: candidate pid=$p source=$src exe=$(readlink "/proc/$p/exe" 2> /dev/null || echo gone) cwd=$(readlink "/proc/$p/cwd" 2> /dev/null || echo gone) -> NOT a JVM in $dir; no dump, no individual signal"
      continue
    fi
    if _diag_timeout 12 jcmd "$p" Thread.print -l > "$outdir/threads-$p.txt" 2> "$outdir/jcmd-$p.err" && [ -s "$outdir/threads-$p.txt" ]; then
      echo "ci-sbt-diag: candidate pid=$p source=$src -> thread dump via jcmd ($(wc -l < "$outdir/threads-$p.txt") lines) -> threads-$p.txt"
      dumped=1
    else
      rm -f "$outdir/threads-$p.txt"
      echo "ci-sbt-diag: candidate pid=$p source=$src -> jcmd failed ($(head -c 200 "$outdir/jcmd-$p.err" 2> /dev/null)); sending SIGQUIT (dump goes to the JVM's own stdout log)"
      kill -QUIT "$p" 2> /dev/null && dumped=1
      sleep 1
    fi
    if [ "$(_diag_remaining)" -ge 8 ] && [ -s "$outdir/threads-$p.txt" ]; then
      _diag_timeout 4 jcmd "$p" GC.heap_info > "$outdir/heap-$p.txt" 2>&1
      _diag_timeout 4 jcmd "$p" VM.flags > "$outdir/vmflags-$p.txt" 2>&1
    fi
  done
  echo "ci-sbt-diag: capture finished in $((SECONDS - _diag_t0))s (budget ${CI_SBT_CAPTURE_BUDGET}s), artifacts in $outdir"
  [ "$dumped" = 1 ]
}

# ci_sbt_stop_group <pgid>: TERM the recorded group, 5 s grace, then KILL. Group signals only.
ci_sbt_stop_group() {
  local i
  kill -TERM -- "-$1" 2> /dev/null || return 0
  for i in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 -- "-$1" 2> /dev/null || return 0
    sleep 0.5
  done
  kill -KILL -- "-$1" 2> /dev/null
  return 0
}
