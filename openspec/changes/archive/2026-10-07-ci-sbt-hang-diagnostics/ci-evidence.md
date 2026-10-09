# HEL-1339 CI evidence

Draft PR #812 (branch `task/sbt-thin-client-ci-hang/HEL-1339`). CI runs only on `pull_request`/`push main`, so every
number below comes from that PR's runs, executed ONE AT A TIME (each `gh run rerun` started only after the previous
run was `completed`). Per-step durations are GitHub job-API `started_at`/`completed_at`; startup metrics (D1a) are log
timestamps from the step's own `##[group]Run` line (backend/SBOM: step start -> "set current project to helio-backend"
and -> first `compiling`/`Nothing to compile`/test line; e2e: `Start backend` step start -> "backend healthy after").

## Runs

| group | run id / attempts | code under test |
| --- | --- | --- |
| BASE10 (historical thin client) | 37575936780, 37575015046, 37549763468, 37548095865, 37546593115, 37545398166, 37543518640, 37540638210, 37536290688, 37534037966 (e2e of 37534037966 predates sharding: excluded from e2e columns) | main-equivalent ci.yml, `sbt -batch ...` thin client |
| SERVER (7 runs) | 37579760599 attempts 1-4, 37584762340 attempt 1 (the control-revert), 37590720497 attempts 1-2 | commit 3efd794bd tree (ci.yml/scripts identical in all) |
| THIN-AB (4 runs, contemporaneous baseline) | 37586488590 attempts 1-4 | same tree but `--server` removed from `e2e-backend.sh start` ONLY (backend/security keep `ci-sbt.sh`, so only the e2e rows are an A/B) |
| positive control | 37583797617 | throwaway commit ef5873054 (reverted by c4cad37c3) |

## Before/after medians (D1 / D1a gate inputs)

| metric | BASE10 historical (thin) | THIN-AB contemporaneous (thin) | SERVER (`--server`) | delta vs contemporaneous | gate (>= 10 s) |
| --- | --- | --- | --- | --- | --- |
| backend "Compile and test" step | 203 s | 177.5 s | 179.5 s | +2.0 s | no |
| backend step start -> "set current project" | 15.2 s | 14.9 s | 14.9 s | 0.0 s | no |
| backend step start -> first compile/test line | 18.4 s | 22.5 s | 21.1 s | -1.4 s | no |
| backend leg total (4 legs) | 243.5 s | 220.5 s | 220 s | -0.5 s | n/a |
| security "Generate backend SBOM" step | 20 s | 17.5 s | 19 s | +1.5 s | no |
| SBOM start -> "set current project" | 16.3 s | 15 s | 16 s | +1.0 s | no |
| e2e `Start backend` step -> backend healthy (legs) | 114.2 s | 110.5 s | 114.9 s | +4.4 s | no |
| e2e `Wait for backend health` step | 40 s | 47.5 s | 45.5 s | -2.0 s | no |
| e2e leg total (not a gated metric) | 351.5 s (BASE9) | 374.5 s | 389 s | +14.5 s | see note |
| e2e `Run e2e suite` step (not mode-dependent) | 186.5 s | 201.5 s | 212 s | +10.5 s | see note |

Heap proof: every SERVER backend leg printed `ans: Long = 3221225472` (3 GiB) via `ci-sbt.sh --server -batch -J-Xmx3g`.

Mode proof: SERVER logs carry `ci-sbt: mode=server pid=N exe=/usr/lib/jvm/temurin-21-jdk-amd64/bin/java` (re-printed
once the launch PID became the JVM; first print shows `bash`/`env`/`setsid` while `sbt` is still exec-ing) and have NO
"entering thin client - BEEP WHIRR" line. e2e: `e2e-backend: mode=server pgid=N exe=.../bin/java`. (The THIN-AB runs printed `mode=server ... exe=sbtn` because the literal was hard-coded; fixed: the mode is now derived from the launch flag, selftest case (e).) In the THIN-AB
runs the same recorded launch PID's exe was `.../sbt/bin/sbtn-x86_64-pc-linux` -- in thin-client mode the recorded
PID is the sbtn client, not a JVM, so a recorded-PID dump is impossible there (the argument for D1).

Timing targets (any run): backend median leg 220 s (target 330 s); worst backend leg across SERVER runs 255 s.
e2e legs over 420 s: SERVER 2 of 28 legs (441 s on 37579760599 attempt 2 e2e(4); 423 s on attempt 3 e2e(4)) across 2 of 7 runs;
contemporaneous thin client 1 of 16 legs (423 s); historical thin client 3 of 36 legs (452/439/430 s). Median of per-run
slowest leg: SERVER 417 s, contemporaneous 412 s, historical 411 s.

**C2 gate outcome (corrected): step/startup clause not tripped; the any-run e2e 7 min clause tripped as written (the
thin-client baseline trips it too); escalated; owner ruled `accept-server` (escalation_id
HEL-1339-1791362731430-e6b288). The first version of this section declared "NOT tripped" instead of stopping -- that was
the miss.** No gated step or startup metric regressed by >= 10 s against either baseline (largest:
e2e backend-ready +4.4 s against the contemporaneous baseline, +0.7 s against BASE10; backend/SBOM within +-2 s and no
run breached backend 5.5 min). Caveat the reviewer should weigh: whole e2e legs run +14.5 s (contemporaneous) / +37 s
(BASE9) slower, but that is entirely the `Run e2e suite` step (Playwright against an already-running backend; the
sbt mode cannot reach it) and that same step also drifts +15 s between BASE and THIN-AB, i.e. runner-load noise
dominates; per-shard medians swing in both directions (shard 1: 228 -> 194, shard 4: 190 -> 234). The gate as designed
(D1/D1a) keys on the backend-ready metric, which shows no regression.

## Failing runs (full logs kept in `ci-logs/`, credential-shaped CI-only values elided so the repo's own
`check:no-credential-leak` hook accepts them)

- 37583797617 (positive control, intended failure): `ci-logs/run37583797617-security-control.log.txt`; artifact
  contents in `ci-logs/control-artifact/`.
- 37583797617 backend (2) (unintended): `OutputRoutesSpec` "200 with real rows and materialized=true ... no re-run" failed
  at `eventually` after one attempt over 202 ms (`OutputRoutesSpec.scala:756`) -- the test's backfill poll window is
  ~200 ms; unrelated to sbt mode (test JVM code), 6 of 7 other legs and every other run passed it.
  `ci-logs/run37583797617-backend2-FAIL.log.txt`.
- 37586488590 attempt 4 backend (3): `ProductEventRollupServiceSpec.scala:85` "403 was not equal to 402" (a
  time-of-day-sensitive WAU count; the run executed at 07:48 UTC); same tree as the passing attempts.
  `ci-logs/run37586488590-attempt4-backend3-FAIL.log.txt`.
Both are pre-existing flaky tests unrelated to this change; spinoff candidates (not touched here).

## D6 in-build positive control (run 37583797617, security job)

Throwaway commit routed `"eval Thread.sleep(600000)"` through `ci-sbt.sh --deadline 60`. Log:
```
ci-sbt: mode=server pid=2564 exe=/usr/lib/jvm/temurin-21-jdk-amd64/bin/java deadline=60s
[info] set current project to helio-backend (...)
ci-sbt: deadline 60s exceeded -- capturing diagnostics
ci-sbt-diag: candidate pid=2564 source=launch -> thread dump via jcmd (722 lines) -> threads-2564.txt
ci-sbt-diag: capture finished in 1s (budget 25s)
##[error]ci-sbt: sbt did not finish within its 60s in-step deadline; thread dump captured; see the sbt-diagnostics artifact ...
```
Artifact `sbt-diagnostics-security` (downloaded; `ci-logs/control-artifact/`): `threads-2564.txt` has the "main" thread
in `java.lang.Thread.sleep` <- `$Wrape0dc1fb0ee$.$sbtdef(setting)` <- `sbt.internal.Eval.getValue` <- `sbt.BuiltinCommands$.eval`
(the build hung inside a command after "set current project"), and `ps-session.txt` shows PID 2564 == the recorded PID,
PGID 2564, SID 2564, running `java ... sbt-launch.jar eval Thread.sleep(600000)`. So D3's empirical claim holds: under
`setsid "$SBT" ... & pid=$!` in `--server` mode `$!` IS the build JVM. The step failed at 62 s (bound 120 s); `ci-complete`
failed as required. Reverted in c4cad37c3; the later runs use the shipped tree.

PID SOURCE actually used per dump: control run `source=launch` (the recorded launch PID; `active.json` does not exist
in `--server` mode and the group enumeration found the same PID, which is dumped once). Selftest cases (a) and (d)
also `source=launch`. No real hang occurred in any of the 20+ other CI legs, so no other dumps exist.

## osv-scanner step sizing (D5) and security-job inequality (D2) -- 20 distinct successful security jobs

Max measured: osv install 1 s, osv scan 1 s, 3 audits together 5 s, SBOM 22 s, pre-SBOM setup 56 s, whole job 94 s.
`timeout-minutes` = max(1, ceil(2.5 x 1 s)) = **1** for both osv steps (the floor); curl has
`--connect-timeout 15 --max-time 45` (< 60 s) and `--fail`.
Job bound 300 s, single-hang scenarios (worst-case pre-SBOM 56 s, artifact upload ~10 s):
- SBOM hang: 56 + 105 (deadline 75 + capture 25 + grace 5; step bound 120) + 5 audits + 10 upload = 176 s (<= 191 using the 120 s bound).
- osv install hang: 56 + 22 + 1 + 60 + 5 + 10 = 154 s.
- osv scan hang: 56 + 22 + 1 + 1 + 60 + 5 + 10 = 155 s.
Backend: 660 + 25 + 5 = 690 < 780 s step bound; 780 + 40 (pre-steps, max measured 31) < 900 s job bound.

## Cost of the new selftest (shard 0 only)

`time npm run selftest:ci-sbt` on shard 0: 20.1 s, 22 s, 19 s (3 samples); the shard-0 leg total stays at 200-251 s
(<< 330 s). It uses node built-ins only (the backend job has no setup-node) and a JDK for the stand-in JVM.

## Local mutation transcripts (tasks 4.1-4.3)

Reds observed (scripts copied to a scratch dir and mutated; the unmutated tree is 16/16 green):
- Launch through `| tee` (PID is tee): `(a) recorded PID's exe is java -- /usr/bin/tee`, (a) dump/exit checks and (b)/(c) red, 8 FAILED.
- cwd check removed from `_diag_is_backend_jvm`: `(c) no dump taken` and `(c) message says no dump` red, 2 FAILED.
- capture call removed from `e2e-backend.sh die`: `(d) die captured a dump of the recorded PGID's JVM` red, 1 FAILED.
- Injected `x=$(pgrep -f sbt)` into `ci-sbt-diag.sh`: `check:ci-sbt-guard` exit 1 `scripts/lib/ci-sbt-diag.sh:132: pattern-matching process lookup/kill`; the guard selftest has 7 flagged + 5 allowed spellings.

## Correction (HEL-1362, 2026-10-08)

Timing: the "25-40 s" backend pre-step figure above (and in the then-current `ci.yml` comment) is stale for shard 0, where
the selftest step (41-46 s) runs before "Compile and test". Re-measured (job start -> "Compile and test" step start,
`backend (0)`) on four HEL-1362 PR runs: 83 s (37870529638), 90 s (37871617663), 73 s (37872469892), 77 s (37874061808).
Worst 90 s: 780 s step bound + 90 s = 870 s < 900 s job bound, about 30 s to spare. (Main push run 37869010952 showed 55 s, but
that predates the longer selftest, which then took 25 s; it is not representative of main after this change.) The original
measurement above is left as recorded.

Logs: two full backend-job logs of FLAKY-TEST failures unrelated to sbt diagnostics were removed from `ci-logs/`:
`run37583797617-backend2-FAIL.log.txt` (2,266,058 B; OutputRoutesSpec:756) and
`run37586488590-attempt4-backend3-FAIL.log.txt` (3,203,939 B; ProductEventRollupServiceSpec:85), 5,469,997 B in total. They are
not hang evidence (no real hang occurred) and remain in git history at d71f646cb (runs 37583797617 and 37586488590). Kept: the
deliberate positive control `run37583797617-security-control.log.txt` and `control-artifact/`, the only dump this tooling has produced.
