#!/usr/bin/env bash
# HEL-1339 -- run one CI sbt invocation with an in-step deadline that captures a JVM thread dump before failing.
#
#   ci-sbt.sh --deadline <sec> --dir <backend-dir> [--mode server|client] -- <sbt args...>
#
# Why: sbt 2 twice went silent after "set current project to helio-backend" (security SBOM 43.5 min; e2e leg 4, 300 s)
# with nothing in the log. The thin client (sbtn handing off to a background server JVM) is the suspect, so
# `--mode server` (default) adds the official runner's `--server`: one foreground sbt JVM, no handoff. `--mode client`
# keeps the thin client (the pre-change baseline). Launch form is pinned so `$!` IS the JVM, never a tee/wrapper:
#   setsid "$SBT" ... >"$LOG" 2>&1 </dev/null & pid=$!      (PGID = SID = pid)
# and the log reaches the step log through a separate `tail --pid` whose own PID is recorded and stopped at exit.
# Exit status: sbt's own status; on deadline 1 after capture (scripts/lib/ci-sbt-diag.sh) and a group stop.
# Env: SBT_CMD (default `sbt`, may be a path), CI_SBT_DIAG_DIR (default $RUNNER_TEMP/sbt-diagnostics).
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# shellcheck source=lib/ci-sbt-diag.sh
. "$here/lib/ci-sbt-diag.sh"

deadline="" dir="" mode="server"
while [ $# -gt 0 ]; do
  case "$1" in
    --deadline) deadline="$2"; shift 2 ;;
    --dir) dir="$2"; shift 2 ;;
    --mode) mode="$2"; shift 2 ;;
    --) shift; break ;;
    *) echo "ci-sbt: unknown option $1" >&2; exit 2 ;;
  esac
done
[ -n "$deadline" ] && [ -n "$dir" ] && [ $# -gt 0 ] || { echo "usage: ci-sbt.sh --deadline <sec> --dir <dir> [--mode server|client] -- <sbt args>" >&2; exit 2; }
case "$mode" in server | client) ;; *) echo "ci-sbt: --mode must be server|client" >&2; exit 2 ;; esac

diagdir="${CI_SBT_DIAG_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/sbt-diagnostics}"
mkdir -p "$diagdir"
LOG="$diagdir/sbt.log"
: > "$LOG"
read -r -a sbt_cmd <<< "${SBT_CMD:-sbt}"
[ "$mode" = server ] && sbt_cmd+=(--server)

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
  exit "$rc"
fi

echo "::group::ci-sbt: deadline ${deadline}s exceeded -- capturing diagnostics"
if ci_sbt_capture "$pid" "$pid" "$dir" "$diagdir"; then
  note="thread dump captured"
else
  note="no verified sbt JVM was found for the recorded PID $pid / group $pid, so NO dump was taken and no individual process was signalled"
fi
ci_sbt_stop_group "$pid"
wait "$pid" 2> /dev/null
sleep 1
kill "$tpid" 2> /dev/null
wait "$tpid" 2> /dev/null
echo "::endgroup::"
echo "::error::ci-sbt: sbt did not finish within its ${deadline}s in-step deadline; ${note}; see the sbt-diagnostics artifact for this job (sbt.log, threads-<pid>.txt)"
exit 1
