#!/usr/bin/env bash
# HEL-1699 selftest for `scripts/e2e-backend.sh lane-start` (and that `start` stays CI-only).
#
# C2: nothing here touches this worktree's git admin dir. The script under test is COPIED, with scripts/lib/ci-sbt-diag.sh,
# into a throwaway `git init` repo, so its `concertino-servers/` is that repo's. SBT_CMD is a stub that exits on its own
# after a few seconds, and the "live record" is this test's own PID, so this test never signals anything. BACKEND_PORT is
# 9 (discard; nothing answers /health) so the "port already answers" refusal cannot mask the record cases; that refusal
# has its own case against a throwaway HTTP server that exits on its own. Every case asserts its refusal message.
# Timing: the stub outlives the stage deadline by a wide margin (sleep 20 vs STAGE_TIMEOUT=1, TOTAL_TIMEOUT=30), so `wait` always fails on the stage check, never the total timeout or a dead group.
set -u
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_PREFIX
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
T="$(mktemp -d "${TMPDIR:-/tmp}/e2e-backend-lane-selftest.XXXXXX")" || exit 1
trap 'rm -rf "$T"' EXIT
fails=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fails=$((fails + 1)); }
check() { if [ "$2" = 0 ]; then ok "$1"; else bad "$1"; fi; }

real_admin="$(git -C "$ROOT" rev-parse --absolute-git-dir)"
real_rec="$real_admin/concertino-servers/backend.pid"
snap() { if [ -e "$real_rec" ]; then sha256sum < "$real_rec"; else echo ABSENT; fi; }
before="$(snap)"

R="$T/repo"
mkdir -p "$R/scripts/lib" "$R/backend"
git init -q "$R"
cp "$ROOT/scripts/e2e-backend.sh" "$R/scripts/e2e-backend.sh"
cp "$ROOT/scripts/lib/ci-sbt-diag.sh" "$R/scripts/lib/ci-sbt-diag.sh"
cat > "$T/stub-sbt" <<'STUB'
#!/bin/sh
echo "stub-sbt PORT=$PORT CORS_ALLOWED_ORIGINS=$CORS_ALLOWED_ORIGINS cwd=$(pwd)"
sleep 20
STUB
chmod +x "$T/stub-sbt"
S="$R/scripts/e2e-backend.sh"
REC="$(git -C "$R" rev-parse --absolute-git-dir)/concertino-servers/backend.pid"
export SBT_CMD="$T/stub-sbt" TOTAL_TIMEOUT=30 STAGE_TIMEOUT=1 POLL=1 CI_SBT_DIAG_DIR="$T/diag"

# 1. unset ports
out="$(env -u DEV_PORT -u BACKEND_PORT bash "$S" lane-start 2>&1)"; rc=$?
{ [ "$rc" = 2 ] && grep -q "needs DEV_PORT and BACKEND_PORT" <<< "$out"; }; check "lane-start without ports exits 2 naming both variables" $?
out="$(DEV_PORT=7131 env -u BACKEND_PORT bash "$S" lane-start 2>&1)"; rc=$?
{ [ "$rc" = 2 ] && grep -q "needs DEV_PORT and BACKEND_PORT" <<< "$out"; }; check "lane-start with only DEV_PORT exits 2" $?

# 2. CI `start` writes no backend.pid and leaves the admin dir alone
BACKEND_LOG="$T/ci.log" BACKEND_PGIDFILE="$T/ci.pgid" BACKEND_DIR="$R/backend" bash "$S" start
{ [ ! -e "$REC" ] && [ -s "$T/ci.pgid" ]; }; check "start writes its pgid file but no concertino-servers/backend.pid" $?

# 3. live record: refused, file unchanged
mkdir -p "$(dirname "$REC")"
echo "$$" > "$REC"; cp "$REC" "$T/rec.orig"
out="$(DEV_PORT=7131 BACKEND_PORT=9 bash "$S" lane-start 2>&1)"; rc=$?
{ [ "$rc" = 1 ] && grep -q "refused: .*backend.pid names live pid $$" <<< "$out"; }; check "live record refused (exit 1, names file and pid)" $?
cmp -s "$REC" "$T/rec.orig"; check "live record left byte-identical" $?

# 4. dead record: replaced, CORS/PORT passed to the backend, log+pgid in the admin dir
sh -c 'exit 0' & dead=$!; wait "$dead"
echo "$dead" > "$REC"
out="$(DEV_PORT=7131 BACKEND_PORT=9 bash "$S" lane-start 2>&1)"; rc=$?
new="$(cat "$REC")"
{ [ "$new" != "$dead" ] && grep -q "^[0-9][0-9]*$" <<< "$new"; }; check "dead record replaced with the new setsid pid ($dead -> $new)" $?
grep -q "lane-start pid=$new record=$REC" <<< "$out"; check "lane-start reports pid and record path" $?
admin="$(dirname "$REC")"
grep -q "stub-sbt PORT=9 CORS_ALLOWED_ORIGINS=http://localhost:7131 cwd=$R/backend" "$admin/e2e-backend.log"; check "backend got PORT, CORS for DEV_PORT and the repo-root backend dir" $?
[ "$(cat "$admin/e2e-backend.pgid")" = "$new" ]; check "lane pgid file in admin dir matches the record" $?
{ [ "$rc" = 1 ] && grep -q "::error::backend: hung before the compile/run stage" <<< "$out"; }; check "wait logic ran (stub never compiles: fails fast via the stage check, exit 1)" $?

# 5. answering port refused (throwaway server that exits on its own)
rm -f "$REC"
python3 -I - > "$T/port" <<'PY' &
import http.server, socket, sys, threading
s = http.server.HTTPServer(("127.0.0.1", 0), type("H", (http.server.BaseHTTPRequestHandler,), {"do_GET": lambda self: (self.send_response(200), self.end_headers(), self.wfile.write(b"ok")), "log_message": lambda *a: None}))
print(s.server_address[1], flush=True)
threading.Timer(8, s.shutdown).start()
s.serve_forever()
PY
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$T/port" ] && break; sleep 0.5; done
port="$(cat "$T/port")"
out="$(DEV_PORT=7131 BACKEND_PORT="$port" bash "$S" lane-start 2>&1)"; rc=$?
{ [ "$rc" = 1 ] && grep -q "refused: port $port already answers /health" <<< "$out"; }; check "answering BACKEND_PORT refused (exit 1, names the port)" $?
[ ! -e "$REC" ]; check "refusal on an answering port wrote no record" $?

# C2: the real worktree's record is byte-identical (or still absent)
after="$(snap)"
[ "$before" = "$after" ]; check "real worktree backend.pid unchanged by this selftest ($before)" $?

if [ "$fails" != 0 ]; then echo "$fails check(s) FAILED"; exit 1; fi
echo "all e2e-backend lane-start checks passed"
