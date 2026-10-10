#!/usr/bin/env bash
# HEL-1339 -- run one CI sbt invocation with an in-step deadline that captures a JVM thread dump before failing.
#
#   ci-sbt.sh --deadline <sec> --dir <backend-dir> -- <sbt args...>
#
# Why: sbt 2 twice went silent after "set current project to helio-backend" (security SBOM 43.5 min; e2e leg 4, 300 s)
# with nothing in the log. The thin client (sbtn handing off to a background server JVM) was the suspect, so sbt is
# always run with the official runner's `--server`: one foreground sbt JVM, no handoff (HEL-1362 removed the former
# `--mode client` lever; revert that change to get the thin client back). Launch form is pinned so `$!` IS the JVM:
#   setsid "$SBT" ... >"$LOG" 2>&1 </dev/null & pid=$!      (PGID = SID = pid)
# and the log reaches the step log through a separate `tail --pid` whose own PID is recorded and stopped at exit.
# Exit status: sbt's own status; on deadline 1 after capture (scripts/lib/ci-sbt-diag.sh) and a group stop.
# Env: SBT_CMD (default `sbt`, may be a path), CI_SBT_DIAG_DIR (default $RUNNER_TEMP/sbt-diagnostics).
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/ci-sbt-diag.sh
. "$here/lib/ci-sbt-diag.sh"

deadline="" dir="" mode="server" # mode is fixed; the token stays in the log lines
while [ $# -gt 0 ]; do
  case "$1" in
    --deadline) deadline="$2"; shift 2 ;;
    --dir) dir="$2"; shift 2 ;;
    --) shift; break ;;
    *) echo "ci-sbt: unknown option $1" >&2; exit 2 ;;
  esac
done
[ -n "$deadline" ] && [ -n "$dir" ] && [ $# -gt 0 ] || { echo "usage: ci-sbt.sh --deadline <sec> --dir <dir> -- <sbt args>" >&2; exit 2; }

diagdir="${CI_SBT_DIAG_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/sbt-diagnostics}"
mkdir -p "$diagdir"
LOG="$diagdir/sbt.log"
: > "$LOG"
read -r -a sbt_cmd <<< "${SBT_CMD:-sbt}"
sbt_cmd+=(--server)

cd "$dir" || { echo "ci-sbt: cannot cd to $dir" >&2; exit 2; }
setsid "${sbt_cmd[@]}" "$@" > "$LOG" 2>&1 < /dev/null &
pid=$!
tail -n +1 -s 0.2 -f --pid="$pid" "$LOG" &
tpid=$!
cd - > /dev/null || true

mode_line() { echo "ci-sbt: mode=$mode pid=$pid exe=$(readlink "/proc/$pid/exe" 2> /dev/null || echo unknown) deadline=${deadline}s"; }
mode_line
printed_java=0
t0=$SECONDS
timed_out=0
while kill -0 "$pid" 2> /dev/null; do
  stat="$(cat "/proc/$pid/stat" 2> /dev/null)"
  [ "$(set -- ${stat##*) }; echo "${1:-}")" = Z ] && break
  if [ "$printed_java" = 0 ]; then
    case "$(readlink "/proc/$pid/exe" 2> /dev/null)" in */java) mode_line; printed_java=1 ;; esac
  fi
  if [ $((SECONDS - t0)) -ge "$deadline" ]; then timed_out=1; break; fi
  sleep 0.2
done

if [ "$timed_out" = 0 ]; then
  wait "$pid"
  rc=$?
  wait "$tpid" 2> /dev/null
  if [ "$rc" = 0 ]; then
    # HEL-1468: sbt 2 can lose a forked test group's result events and exit 0 while ScalaTest printed a failed or
    # aborted summary (or `*** RUN ABORTED ***`, which the build-side guard cannot see). CI log lines are ANSI-wrapped.
    hit="$(sed 's/\x1b\[[0-9;?]*[A-Za-z]//g' "$LOG" \
      | grep -E -m 1 '^\[info\] \*\*\* ([0-9]+ (TEST|TESTS|SUITE|SUITES) (FAILED|ABORTED) \*\*\*$|RUN ABORTED)')"
    if [ -n "$hit" ]; then
      echo "::error::ci-sbt: sbt exited 0 but its log carries a ScalaTest failure line (\"${hit#\[info\] }\"): treating the run as failed (HEL-1468)"
      exit 1
    fi
  fi
  exit "$rc"
fi

echo "::group::ci-sbt: deadline ${deadline}s exceeded -- capturing diagnostics"
ci_sbt_capture "$pid" "$pid" "$dir" "$diagdir"
case $? in
  0) note="thread dump captured" ;;
  2) note="SIGQUIT was sent to the sbt JVM but no jcmd thread dump file was written (the dump, if the JVM honoured it, is in sbt.log)" ;;
  *) note="no verified sbt JVM was found for the recorded PID $pid / group $pid, so NO dump was taken and no individual process was signalled" ;;
esac
ci_sbt_stop_group "$pid"
wait "$pid" 2> /dev/null
sleep 1
kill "$tpid" 2> /dev/null
wait "$tpid" 2> /dev/null
echo "::endgroup::"
echo "::error::ci-sbt: sbt did not finish within its ${deadline}s in-step deadline; ${note}; see the sbt-diagnostics artifact for this job (sbt.log, threads-<pid>.txt)"
exit 1
