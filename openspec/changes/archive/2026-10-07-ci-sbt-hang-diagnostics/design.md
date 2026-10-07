## Context

See proposal.md (Why). Ground truth checked at planning time (premise-validation evidence):
- All three CI sbt call sites log "entering thin client - BEEP WHIRR / starting sbt server in the background" even
  with `-batch` (security run 37361823617 a1 job 111938037178 l.430-436; e2e run 37416099275 a3 job 112118533224
  l.993-999). `backend/.sbtopts` is `-Dsbt.ivy.home=.ivy2`; `project/build.properties` is `sbt.version=2.0.9`.
- CI installs the OFFICIAL runner via `sbt/setup-sbt@v1`; both sighting logs show `sbt-runner-version: 2.0.9`
  (cache key `Linux-X64-sbt-runner-2.0.9-1.5.3`), so the @v2.0.9 script is the one CI runs. In the official runner (sbt/sbt `sbt` script @v2.0.9, `isRunClient`): sbt >= 2 defaults to the client (sbtn);
  `--server` sets `use_sbtn=0` ("run sbt server in the foreground, instead of using sbtn"); `-batch` only does
  `exec </dev/null`. In non-client mode `execRunner` does `exec java ...`, so the launched PID becomes the JVM.
  (`--client=false` is NOT a flag of this runner.) Local dev uses sbt-extras (`~/.local/bin/sbt`), which never uses
  sbtn — so CI is the only place the thin client runs, and the only place both hangs were seen.
- `scripts/e2e-backend.sh` (HEL-1288) launches `setsid $SBT run` and records `$!` as the PGID; its `die` dumps
  `/tmp/backend.log` only.
- The backend step prints `eval java.lang.Runtime.getRuntime.maxMemory` because HEL-1273 found `-J-Xmx3g` ignored
  through the thin client; `.jvmopts` is written as a workaround.

## Goals / Non-Goals

Goals: a measured client-mode decision; a thread dump on every bounded sbt hang; osv step bounds. Non-goals: see
proposal.md; also no root-causing inside sbt beyond what the dumps show (a dump that names the cause is a follow-up).

## Decisions

**D1 — Run CI sbt in `--server` mode (one foreground JVM), gated on measurement.** Add `--server` to the three
invocations (`sbt --server -batch ...`). Removes the sbtn->server handoff (the common factor in both hangs), makes the
launched PID the build JVM (D3), and should make `-J-Xmx3g` apply directly. Alternatives: `-Dsbt.server.forcestart`
tuning (keeps the handoff, so keeps the suspect); `SBT_NATIVE_CLIENT=false` (no effect for sbt >= 2 — only
`use_sbtn=0` does); keeping the thin client and only adding diagnostics (kept as the fallback if D1 costs time).
**Gate:** "real time" = the per-step median (>= 3 runs each side) of backend "Compile and test", security "Generate
backend SBOM" or e2e backend-ready time rising by >= 10 s, or any run breaching backend median 5.5 min / e2e 7 min.
If tripped: do NOT ship `--server`; stop and escalate with the numbers (orchestrator raises it). The `.jvmopts` line
and the `eval maxMemory` line stay (cheap, and the eval line is the heap proof in every log).

**D1a — Startup metric (low-noise, part of the gate).** Whole-step medians are test-noise dominated (backend legs
181-199 s within one run), so the gate ALSO uses log-timestamp startup metrics per run: (i) backend and SBOM: step
start -> "set current project to helio-backend", and step start -> first `compiling`/`Nothing to compile`/first test
line; (ii) e2e: timestamp of the `Start backend` step's start -> the "backend healthy" line (NOT the `wait` step's own
"after Ns", which hides the overlap with npm/Playwright install). Recorded per run in `ci-evidence.md`; a median
startup regression >= 10 s on any of these also trips the C2 gate.

**D2 — One helper, `scripts/ci-sbt.sh`, owns launch + deadline + diagnostics.** Usage
`ci-sbt.sh --deadline <sec> --dir backend -- <sbt args...>`. **Pinned launch form** (so `$!` is sbt, never tee or a
process substitution): `setsid "$SBT" "$@" >"$LOG" 2>&1 </dev/null & pid=$!`, PGID = SID = `$pid`; the log is
streamed to the step log by a separate `tail -n +1 -f --pid="$pid" "$LOG" &` whose own PID is recorded and stopped at
exit. `LOG=$RUNNER_TEMP/sbt-diagnostics/sbt.log` (preserved; uploaded on failure). First output line is a positive
mode line: `ci-sbt: mode=<server|client> pid=<pid> exe=<readlink /proc/pid/exe> deadline=<s>` (re-printed once the
exe has become java). Normal exit -> exit with sbt's status. Deadline -> D3 capture (hard-capped at 25 s) ->
`kill -TERM -- -<pgid>` -> 5 s grace -> `kill -KILL -- -<pgid>` -> `::error::` naming the deadline and artifact ->
exit 1. **Timing inequalities** (deadline + 25 capture + 5 grace + >= 10 margin <= step bound):
- SBOM: deadline 75 s; 75+25+5 = 105 < 120 (existing `timeout-minutes: 2`).
- Backend "Compile and test": deadline 11 min (660 s); 660+30 = 690 < 780 (new step `timeout-minutes: 13`); job 15 min
  = 900 >= pre-steps (measured 25-40 s) + 780.
- Security job (300 s) per single-hang scenario: SBOM hang 47 s setup + 120 + audits <= 300; osv-download hang
  47 + ~21 SBOM + osv-install bound + audits <= 300; osv-scan hang likewise. The executor measures the audit steps'
  durations and writes each sum into `ci-evidence.md`; if one does not fit, shrink the osv bound (never below 1 min)
  or escalate.
Alternatives: GNU `timeout` around sbt (kills before a dump); dumping from a later `if: failure()` step (the step
kill has already taken the JVM).

**D3 — PID source, verification, capture budget.** Candidates, all from recorded sources: the recorded launch PID
(in `--server` mode the build JVM via `setsid`->`exec java`); every process whose `/proc/<p>/stat` PGID field equals
the recorded PGID (enumerated from `/proc`, never by name — covers the e2e forked backend JVM after
"running (fork)"); and, only if `backend/project/target/active.json` exists (thin-client mode), the PID owning the
exact socket path it names (`ss -xlpn` filtered by that literal path). A candidate is dumped only if
`/proc/<p>/exe` resolves to a `java` binary AND `/proc/<p>/cwd` is the backend dir (or below it, for forked JVMs).
Capture budget (25 s total, checked against a start timestamp): `timeout 12 jcmd <p> Thread.print -l` per verified
JVM, launch PID first; if it fails, `kill -QUIT <p>` (dump lands in sbt.log). Only if >= 8 s remain:
`GC.heap_info` and `VM.flags` (`timeout 4` each). Always: `ps -o pid,ppid,pgid,sid,stat,etime,args --sid <sid>`
(`--sid`, not `-g`, which procps reads as session — explicit to avoid a "fix"). Outputs under
`$RUNNER_TEMP/sbt-diagnostics/`.
**Unverified PID:** no dump and no individual signal is sent to an unverified PID. The recorded PROCESS GROUP is
still stopped (`kill -- -<pgid>`): the kernel never reuses a PID as a new PGID/SID while any member of that group
exists, so the group signal can only reach processes we launched; if the group is already empty the kill is a
harmless ESRCH. This is also how the selftest cleans up its stand-in JVM in the wrong-cwd case.

**D4 — e2e reuses the same dump code.** `scripts/e2e-backend.sh` keeps its start/wait contract and every HEL-1288
check; `start` adds `--server` to the sbt command (launch form unchanged: `setsid $SBT run >>"$LOG" ... & echo $!`);
`die` calls the shared capture (from `scripts/lib/ci-sbt-diag.sh`, also sourced by `ci-sbt.sh`) for the recorded PGID
before dumping the log. The deadline stays in `wait` (sbt run must outlive `start`). Workflow adds
`actions/upload-artifact` `if: failure()` for `$RUNNER_TEMP/sbt-diagnostics` in backend, security, e2e (names
suffixed with the shard where matrixed).

**D5 — osv bounds sized from measured durations.** From >= 5 successful security jobs' step timings (measured 0-1 s
each so far) set `timeout-minutes` = max(1, ceil(2.5 x max)). Add `curl --fail --connect-timeout 15 --max-time 45`
(strictly below the 60 s step bound so curl's own error surfaces first).

**D6 — Proof and where it runs.**
- `scripts/ci-sbt.selftest.mjs` (`npm run selftest:ci-sbt`): needs a JDK, so it runs in CI as a step in **backend
  shard 0 only** (`if: matrix.shard == 0`, after setup-java, before "Compile and test"; measured cost recorded) and
  NOT in `.husky/pre-commit` (no gate-chain change; `check:precommit-ci-parity` only fails on hook checks missing
  from CI, so a CI-only selftest passes it). Cases, using a stand-in `SBT_CMD` that execs `java Hang.java` (sleeps on
  main) in a temp "backend" dir: (a) hang -> dump file contains "Full thread dump" and `Hang.main`'s sleep frame,
  exit 1, recorded PID's `/proc/pid/exe` was java (tee-PID regression goes red), group gone after; (b) fast exit
  status propagated, no dump; (c) wrong cwd -> no dump, group still stopped and gone.
- Static guard `scripts/check-ci-sbt-no-pattern-kill.mjs` (`npm run check:ci-sbt-guard`) + its selftest
  (`check:ci-sbt-guard:selftest`): JDK-free, runs in the `frontend` job next to the other `check:*` lines (CI-only,
  same rationale as HEL-913/HEL-846 comments). Fails on `pgrep|pkill|killall|pidof` or a `ps ...|...grep` in
  `scripts/ci-sbt.sh`, `scripts/lib/ci-sbt-diag.sh`, `scripts/e2e-backend.sh`.
- Mutation proof for each: break PID recording / the cwd check / inject a `pgrep` and show red; transcripts recorded.
- Real-CI positive control: a throwaway commit routes `"eval Thread.sleep(600000)"` through `ci-sbt.sh` with a 60 s
  deadline in the SBOM step (hang occurs after "set current project", inside the build). Evidence must show the
  artifact's dump contains a `Thread.sleep` frame on sbt's command/main thread and that the dumped PID == the
  recorded PID (this is also D3's empirical confirmation). Reverted before delivery; its run log kept.

**D7 — CI evidence via a draft PR, one run at a time.** CI runs only on `pull_request`/`push main`. The executor
opens a DRAFT PR from the ticket branch to obtain runs, uses `gh run rerun` sequentially (never two at once), and
writes `ci-evidence.md` in the change dir: per run id/attempt, per-step durations, D1a startup metrics, mode line,
heap line, and every failing run's full log under the change dir's `ci-logs/` (not deleted). Baseline = >= 3 recent
main/PR thin-client runs. Delivery later squashes and force-pushes with lease to that same branch and marks it ready.

## Risks / Trade-offs

- [`--server` slower to first task than a warm sbtn handoff] -> D1 gate; escalate rather than ship.
- [Hang is not client-related and recurs in `--server` mode] -> D2/D3 still dump it; that is the point.
- [`--server` disables a server socket other tooling needs] -> no CI step uses BSP/sbtn; checked by grep in tasks.
- [Dump hangs on a wedged JVM] -> D3's 25 s total budget; `kill -QUIT` fallback; group stopped regardless.
- [HEL-1341 later edits ci.yml] -> edits confined to sbt lines, new steps and osv steps; expect a rebase.

## Planner Notes

- Self-approved: helper-script location `scripts/` (matches `e2e-backend.sh`); selftest as `.selftest.mjs`.
- `sbt --client shutdown` before Phase 4 cleanup is a separate Bash call (driver rule).
