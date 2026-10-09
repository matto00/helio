#!/usr/bin/env bash
# HEL-1339 -- shared sbt-hang diagnostics, SOURCED by scripts/ci-sbt.sh and scripts/e2e-backend.sh.
#
# Every PID handled here comes from a RECORDED source, never a process-name or command-line match:
#   launch  the PID recorded when CI launched sbt (in `--server` mode `setsid` execs `sbt` which execs the build JVM,
#           so it becomes the JVM itself);
#   group   every process whose /proc/<p>/stat process-group field equals the PGID recorded at launch (this is how
#           the JVM forked by `sbt run` / the forked test JVMs are found), enumerated from /proc, not by name.
# CI only ever launches sbt with `--server` (one foreground JVM), so no sbt server lives outside the recorded group.
# A candidate is dumped only if /proc/<p>/exe is a `java` binary and /proc/<p>/cwd is the backend dir or below it.
# Nothing is ever signalled individually unless it passed that check; the recorded process GROUP is stopped as a
# whole (the group id of a live group cannot be handed to an unrelated process; an already-empty group is a
# harmless ESRCH -- a reused PID number is negligible, not impossible, over the seconds involved).
#
# Total capture budget is CI_SBT_CAPTURE_BUDGET seconds (default 25) and is a HARD ceiling (HEL-1362): every external
# call's cap INCLUDING its 1 s kill grace, and every sleep, is clamped to what is left, and a candidate is skipped
# (logged) when too little budget remains to start it. `SECONDS` is whole-second, so the true ceiling is budget + <1 s.

CI_SBT_CAPTURE_BUDGET="${CI_SBT_CAPTURE_BUDGET:-25}"
_diag_t0=0

_diag_remaining() { echo $((CI_SBT_CAPTURE_BUDGET - (SECONDS - _diag_t0))); }

# _diag_timeout <cap-seconds> <cmd...>: run for at most min(cap, remaining budget) seconds in total, kill grace
# included (`timeout -k 1 (n-1)` ends by n at the latest); 124 when under 2 s remain (nothing is started).
_diag_timeout() {
  local cap="$1" rem
  shift
  rem="$(_diag_remaining)"
  [ "$cap" -gt "$rem" ] && cap="$rem"
  [ "$cap" -lt 2 ] && return 124
  timeout -k 1 "$((cap - 1))" "$@"
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

# ci_sbt_capture <pgid> <launch-pid> <backend-dir> <outdir>
# Writes thread dumps to <outdir>/threads-<pid>.txt. Returns 0 when at least one jcmd dump file was written, 2 when
# none was but SIGQUIT was delivered to at least one verified JVM (its dump, if any, is in the JVM's own log), 1 when
# nothing was dumped or signalled.
# Prints one `ci-sbt-diag:` line per candidate naming the PID SOURCE actually used.
ci_sbt_capture() {
  local pgid="$1" launch="$2" dir outdir="$4" p pg dumped=0 quit=0 src rem cap
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
    rem="$(_diag_remaining)"
    if [ "$rem" -lt 3 ]; then
      echo "ci-sbt-diag: candidate pid=$p source=$src -> skipped: capture budget exhausted (${rem}s of ${CI_SBT_CAPTURE_BUDGET}s left)"
      continue
    fi
    cap=$((rem - 1)) # reserve 1 s of the budget for the post-SIGQUIT wait below
    [ "$cap" -gt 12 ] && cap=12
    if _diag_timeout "$cap" jcmd "$p" Thread.print -l > "$outdir/threads-$p.txt" 2> "$outdir/jcmd-$p.err" && [ -s "$outdir/threads-$p.txt" ]; then
      echo "ci-sbt-diag: candidate pid=$p source=$src -> thread dump via jcmd ($(wc -l < "$outdir/threads-$p.txt") lines) -> threads-$p.txt"
      dumped=1
    else
      rm -f "$outdir/threads-$p.txt"
      echo "ci-sbt-diag: candidate pid=$p source=$src -> jcmd failed ($(head -c 200 "$outdir/jcmd-$p.err" 2> /dev/null)); sending SIGQUIT (dump goes to the JVM's own stdout log)"
      kill -QUIT "$p" 2> /dev/null && quit=1
      [ "$(_diag_remaining)" -ge 2 ] && sleep 1
    fi
    if [ "$(_diag_remaining)" -ge 8 ] && [ -s "$outdir/threads-$p.txt" ]; then
      _diag_timeout 4 jcmd "$p" GC.heap_info > "$outdir/heap-$p.txt" 2>&1
      _diag_timeout 4 jcmd "$p" VM.flags > "$outdir/vmflags-$p.txt" 2>&1
    fi
  done
  echo "ci-sbt-diag: capture finished in $((SECONDS - _diag_t0))s (budget ${CI_SBT_CAPTURE_BUDGET}s), artifacts in $outdir"
  [ "$dumped" = 1 ] && return 0
  [ "$quit" = 1 ] && return 2
  return 1
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
