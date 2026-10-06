#!/usr/bin/env bash
# HEL-1288 — start and health-wait the backend for the CI `e2e` job.
#
#   e2e-backend.sh start   launch `sbt run` in the background in its OWN session (setsid), recording its PGID
#   e2e-backend.sh wait    wait until /health answers; fail FAST and loudly when the backend is dead or hung
#
# Run 37416099275 attempt 3 had `nohup sbt run` print "entering thin client / starting sbt server in the
# background ... set current project" and then nothing for 300 s (no compile ever began); a plain 300 s curl
# loop only reported it after 5 minutes. `wait` checks two exact things, never a process-name pattern:
#   (a) liveness of the process GROUP recorded at `start` (the sbt client and everything it forks, including
#       the backend JVM after "running (fork)"): if no process in the group is alive and /health is not
#       answering, fail within one poll;
#   (b) that the log reaches the compile/run stage within STAGE_TIMEOUT seconds; otherwise fail (no restart).
# A thin-client sbt SERVER may live outside the group; it is not used as a liveness handle (its death shows up
# as the client exiting, i.e. (a)). Every failure dumps the log. Tunables are env vars so the guard can be
# exercised without CI.
set -u
LOG="${BACKEND_LOG:-/tmp/backend.log}"
PGIDFILE="${BACKEND_PGIDFILE:-/tmp/backend.pgid}"
HEALTH_URL="${HEALTH_URL:-http://localhost:8080/health}"
DIR="${BACKEND_DIR:-backend}"
TOTAL_TIMEOUT="${TOTAL_TIMEOUT:-300}"
STAGE_TIMEOUT="${STAGE_TIMEOUT:-120}"
POLL="${POLL:-2}"
SBT="${SBT_CMD:-sbt}"

die() {
  echo "::error::backend: $1" >&2
  echo "----- $LOG -----" >&2
  cat "$LOG" >&2
  exit 1
}

case "${1:-}" in
  start)
    : > "$LOG"
    # setsid makes the child a session (and group) leader, so its PID is the PGID of the whole tree.
    ( cd "$DIR" || exit 1; setsid $SBT run >> "$LOG" 2>&1 < /dev/null & echo $! > "$PGIDFILE" ) > /dev/null 2>&1
    ;;
  wait)
    pgid="$(cat "$PGIDFILE" 2>/dev/null)"
    [ -n "$pgid" ] || die "no recorded process group (did 'start' run?)"
    t0=$SECONDS
    while :; do
      curl -sf --max-time 3 "$HEALTH_URL" > /dev/null 2>&1 && { echo "backend healthy after $((SECONDS - t0))s"; exit 0; }
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
  *) echo "usage: $0 start|wait" >&2; exit 2 ;;
esac
