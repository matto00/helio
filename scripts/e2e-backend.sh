#!/usr/bin/env bash
# HEL-1288 — start and health-wait the backend for the CI `e2e` job.
#
#   e2e-backend.sh start   launch `sbt run` in the background in its OWN session (setsid), recording its PGID
#   e2e-backend.sh wait    wait until /health answers; fail FAST and loudly when the backend is dead or hung
#   e2e-backend.sh lane-start   (HEL-1699) a concertino LANE only: `start` + `wait` for DEV_PORT/BACKEND_PORT, see below
#
# lane-start (needs DEV_PORT and BACKEND_PORT exported): starts the backend on BACKEND_PORT with CORS allowing
# http://localhost:$DEV_PORT, health-waits http://localhost:$BACKEND_PORT/health, keeps its log and pgid file in the git
# admin dir of THIS script's repo (<admin>/concertino-servers/), and records the setsid PID (= PGID) as
# <admin>/concertino-servers/backend.pid, which is exactly the record scripts/concertino/stop-servers.sh stops. Refuses
# when a variable is unset, BACKEND_PORT already answers, or backend.pid names a live process (signal 0 probe only; a
# dead record is replaced). It adds no kill path: stop with
#   scripts/concertino/stop-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>
# `start` and `wait` never write backend.pid. Run it as the worktree's own scripts/e2e-backend.sh. See e2e/README.md.
#
# Run 37416099275 attempt 3 had `nohup sbt run` print "entering thin client / starting sbt server in the
# background ... set current project" and then nothing for 300 s (no compile ever began); a plain 300 s curl
# loop only reported it after 5 minutes. `wait` checks two exact things, never a process-name pattern:
#   (a) liveness of the process GROUP recorded at `start` (the sbt client and everything it forks, including
#       the backend JVM after "running (fork)"): if no process in the group is alive and /health is not
#       answering, fail within one poll;
#   (b) that the log reaches the compile/run stage within STAGE_TIMEOUT seconds; otherwise fail (no restart).
# sbt runs with `--server` (one foreground JVM), so no sbt server lives outside the group. Every failure dumps
# the log. Tunables are env vars so the guard can be exercised without CI.
set -u
LOG="${BACKEND_LOG:-/tmp/backend.log}"
PGIDFILE="${BACKEND_PGIDFILE:-/tmp/backend.pgid}"
HEALTH_URL="${HEALTH_URL:-http://localhost:8080/health}"
DIR="${BACKEND_DIR:-backend}"
TOTAL_TIMEOUT="${TOTAL_TIMEOUT:-300}"
STAGE_TIMEOUT="${STAGE_TIMEOUT:-120}"
POLL="${POLL:-2}"
SBT="${SBT_CMD:-sbt}"
# HEL-1339: `--server` = one foreground sbt JVM, no thin-client handoff. Always on (HEL-1362 removed the empty-flag
# thin-client A/B lever); MODE stays in the log lines as the fixed token `server`.
MODE=server
DIAG_DIR="${CI_SBT_DIAG_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/sbt-diagnostics}"
# HEL-1339: shared thread-dump capture (PIDs from the recorded PGID only; see the library header).
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/lib/ci-sbt-diag.sh"

# HEL-1339: before failing, dump every verified JVM of the recorded group. Deliberately does NOT stop the group:
# the backend is meant to outlive `start`, and the runner reaps it at job end.
die() {
  echo "::error::backend: $1" >&2
  local gid
  gid="$(cat "$PGIDFILE" 2> /dev/null)"
  if [ -n "$gid" ]; then
    ci_sbt_capture "$gid" "$gid" "$DIR" "$DIAG_DIR" >&2
    case $? in
      0) ;;
      2) echo "backend: SIGQUIT was sent to a verified JVM in group $gid but no jcmd thread dump file was written (the dump, if any, is in $LOG)" >&2 ;;
      *) echo "backend: no verified JVM in group $gid to dump" >&2 ;;
    esac
  fi
  echo "----- $LOG -----" >&2
  cat "$LOG" >&2
  exit 1
}

case "${1:-}" in
  start)
    : > "$LOG"
    # setsid makes the child a session (and group) leader, so its PID is the PGID of the whole tree.
    # HEL-1339: `--server` = one foreground sbt JVM (no sbtn -> background-server handoff), so $! is the build JVM.
    ( cd "$DIR" || exit 1; setsid $SBT --server run >> "$LOG" 2>&1 < /dev/null & echo $! > "$PGIDFILE" ) > /dev/null 2>&1
    ;;
  wait)
    pgid="$(cat "$PGIDFILE" 2>/dev/null)"
    [ -n "$pgid" ] || die "no recorded process group (did 'start' run?)"
    t0=$SECONDS
    echo "e2e-backend: mode=$MODE pgid=$pgid exe=$(readlink "/proc/$pgid/exe" 2> /dev/null || echo unknown)"
    while :; do
      curl -sf --max-time 3 "$HEALTH_URL" > /dev/null 2>&1 && { echo "backend healthy after $((SECONDS - t0))s"; echo "e2e-backend: mode=$MODE pgid=$pgid exe=$(readlink "/proc/$pgid/exe" 2> /dev/null || echo unknown)"; exit 0; }
      elapsed=$((SECONDS - t0))
      [ "$elapsed" -ge "$TOTAL_TIMEOUT" ] && die "did not become healthy within ${TOTAL_TIMEOUT}s"
      if ! kill -0 -- "-$pgid" 2> /dev/null; then
        if grep -qE 'running \(fork\)' "$LOG"; then
          die "backend process group $pgid is gone after the fork (${elapsed}s in)"
        fi
        die "sbt process group $pgid is gone before the fork (${elapsed}s in)"
      fi
      if [ "$elapsed" -ge "$STAGE_TIMEOUT" ] && ! grep -qE 'compiling|done compiling|running \(fork\)|Nothing to compile' "$LOG"; then
        die "hung before the compile/run stage for ${STAGE_TIMEOUT}s (log shows no compile or fork)"
      fi
      sleep "$POLL"
    done
    ;;
  lane-start)
    lane_usage="usage: DEV_PORT=<dev> BACKEND_PORT=<backend> $0 lane-start"
    [ -n "${DEV_PORT:-}" ] && [ -n "${BACKEND_PORT:-}" ] || { echo "e2e-backend: lane-start needs DEV_PORT and BACKEND_PORT ($lane_usage)" >&2; exit 2; }
    lane_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
    lane_admin="$(git -C "$lane_root" rev-parse --absolute-git-dir)" || { echo "e2e-backend: lane-start: $lane_root is not a git checkout" >&2; exit 2; }
    lane_dir="$lane_admin/concertino-servers"
    mkdir -p "$lane_dir"
    lane_rec="$lane_dir/backend.pid"
    if [ -s "$lane_rec" ]; then
      lane_old="$(cat "$lane_rec")"
      if [ -n "$lane_old" ] && kill -0 "$lane_old" 2> /dev/null; then
        echo "e2e-backend: lane-start refused: $lane_rec names live pid $lane_old (stop it with scripts/concertino/stop-servers.sh first)" >&2
        exit 1
      fi
    fi
    if curl -sf --max-time 3 "http://localhost:$BACKEND_PORT/health" > /dev/null 2>&1; then
      echo "e2e-backend: lane-start refused: port $BACKEND_PORT already answers /health (stop it with scripts/concertino/stop-servers.sh first)" >&2
      exit 1
    fi
    export PORT="$BACKEND_PORT" CORS_ALLOWED_ORIGINS="http://localhost:$DEV_PORT"
    export HEALTH_URL="http://localhost:$BACKEND_PORT/health"
    export BACKEND_LOG="$lane_dir/e2e-backend.log" BACKEND_PGIDFILE="$lane_dir/e2e-backend.pgid"
    export BACKEND_DIR="${BACKEND_DIR:-$lane_root/backend}"
    bash "$0" start || exit 1
    cat "$BACKEND_PGIDFILE" > "$lane_rec"
    echo "e2e-backend: lane-start pid=$(cat "$lane_rec") record=$lane_rec log=$BACKEND_LOG cors=$CORS_ALLOWED_ORIGINS"
    exec bash "$0" wait
    ;;
  *) echo "usage: $0 start|wait|lane-start" >&2; exit 2 ;;
esac
