## Standing Constraints

- [C1] No fix before a probe-confirmed root cause; if the evidence shows a real protocol gap (a), stop and return ESCALATION before touching production lock code.
- [C2] Scratch only under /home/matt/Development/helio/.concertino/scratch/HEL-1654/; durable evidence in the change's evidence/ dir and .concertino/runs/HEL-1654/evidence/. Isolated DB helio_hel1654 only. Leave no server or DB process running; stop with pg_ctl / stop-servers.sh, never by signal; no pkill/pgrep/killall.
- [C3] Load gate before every heavy run (1-min loadavg <= 10, else sleep 60 s, up to 30 min); every sbt test run under `nice -n 19` and `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/sbtfull.lock`.

## 1. Probe and decide

- [x] 1.1 (Outcome: the backend specs boot their own embedded Postgres in a temp dir per spec, so no `helio_hel1654` DB was created and the shared `helio` DB was never contacted; project paths verified in every log.) Create isolated DB `helio_hel1654` and point the worktree's backend tests at it; verify the spec runs green once unloaded and that no query touches `helio` (show the connection target).
- [x] 1.2 Statistical repro: run `DraftSaveDeadlockSpec` repeatedly (taskset 2 cores, nice 19, `HEL924_TEST_GROUP_CONCURRENCY=2`, `HELIO_TEST_JVM_XMX=4g`, CI=true where it matters) and record the failure rate and signatures to evidence/repro-under-load.log.txt.
- [x] 1.3 Deterministic probe: with throwaway instrumentation, snapshot `pg_stat_activity` (state, wait_event_type) and granted `pg_locks` of the save backend at the instant `parked` completes and when the writer completes, with and without an external delay on the save's first lock; record to evidence/probe-parked-locks.log.txt.
- [x] 1.4 Write evidence/root-cause.md stating (a) or (b) with the traces. If (a): return ESCALATION (C1). Verify: the file names the lock (or absence of one) at the parked point.

## 2. Fix (only under b)

- [x] 2.1 Make `RaceSaveHooks` signal `parked` only when its DBIO executes (D2); verify the 1.3 forcing probe now yields a correct verdict.
- [x] 2.2 Confirm the save backend is `idle in transaction` at the parked point and trace its granted locks (D3); verify via the trace in a run log.
- [x] 2.3 Replace verdict-deciding short windows with condition waits plus hang guards, and cover every writer backend (D4) in race/race3/duel; verify the full race/deadlock/set-race specs pass once.
- [x] 2.4 Sibling audit (D5) of DraftSaveRaceSpec and DraftSaveSetRaceSpec recorded in evidence/sibling-audit.md.

## 3. Proof

- [x] 3.1 50 consecutive passes of DraftSaveDeadlockSpec under the 1.2 load profile → evidence/fifty-under-load.log.txt; siblings repeated (count stated).
- [x] 3.2 Re-apply every recorded mutation targeting these specs — M1–M7 (openspec/changes/archive/2026-10-17-atomic-draft-save-endpoint/evidence/) and SK1, SK3, SK5 (.concertino/runs/HEL-1629/evidence/) — plus every LockSite control already in the specs, on the new tree; a table lists each mutation's path, the case expected red, and the observed result → evidence/mutations/.
- [x] 3.3 Old-fixture vs new-fixture comparison under the forcing probe → evidence/old-vs-new.log.txt.
- [x] 3.4 Short note in docs/live-draft-preview.md §8.3.1 on the harness correction and its evidence location.
- [x] 3.5 Record release-exposure evidence (v0.9.8 = 29cb0a60f; 544bd79ea not an ancestor; no V137 in v0.9.8 tree) → evidence/release-exposure.md.
- [x] 3.6 Full backend `sbt testFull` passes once (flock); drop nothing else. Report leftover processes/DBs (should be none besides helio_hel1654).
