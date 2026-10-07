## Standing Constraints

- [C1] Never lengthen a window or deadline. Fixes use injected clocks, state waits or barriers only.
- [C2] Delay-injection probes and production mutations are temporary, never committed. Each one's transcript is kept
  under `evidence/`.
- [C3] No `ci.yml` change in this PR. The 3-fork trial runs only on the throwaway trial branch/draft PR, and 3 forks
  is never made the default.
- [C4] Never touch `playwright.config.ts` or `.gitignore`.
- [C5] `nice -n 19 sbt testFull` with `HEL924_TEST_GROUP_CONCURRENCY=2`, with a Bash timeout of 600000. Burners at
  most 3-4 in total, killed by recorded PID only. No pkill, pgrep or killall. No `--no-verify`. Never write under `~`.
- [C6] An explicit state wait (the test moves on the moment the state holds) with a NAMED give-up deadline is allowed
  by C1; a fixed sleep or a longer race window is not (driver ruling on HEL-1341, 2026-10-07).

## 1. Backend: flake-capable sites (F)

- [x] 1.1 Row 1 (D1): `DatasetWriteAutoRunEndToEndSpec` latency case -> FakeClock boundary case ADDED (whole-second t0;
  t0+999 ms none, t0+1000 ms one); real-clock pollUntil/runCount stays unconditional; only `>= 1000` removed + println gated; `testOnly` green
- [x] 1.2 Row 2 (D2): `PipelineCycleDetectionServiceSpec` -> test-held raw-JDBC lock, mandatory
  ungranted-waiter wait (classid/objid/objsubid match), then release;
  `testOnly` green
- [x] 1.3 Row 3 (D3): `SqlEgressSocketFactoriesSpec` "connect when allowed" -> bounded poll for `accepts == 1`, named deadline
  `AcceptStateWaitDeadline = 5.seconds` (C6);
  `testOnly` green
- [x] 1.4 Row 8a (D9, ruled A): `OutputRoutesSpec:756` -> explicit `/rows` state wait, named constant
  `BackfillMaterializedStateWaitDeadline = 5.seconds`; `testOnly` green

## 2. Backend: vacuous negative sites (V)

- [x] 2.1 Rows 4-6 (D4): sentinel-port-identified barrier (accepted list == [sentinelPort]) in `SqlEgressSocketFactoriesSpec`:41,
  `SqlConnectorRebindingSpec`:60/:94 and `SqlConnectorConfigShapeSpec`:66; `testOnly` green for all three
- [x] 2.2 Row 7 (D5): `ConnectorRepositorySpec` rotation -> blocked-lock barrier before the unchanged 1500 ms poll;
  `testOnly` green
- [x] 2.3 Row 8 (D6): `PipelineRunCrossInstanceSpec` self-echo -> ordered marker barrier, after first confirming B's
  marker reaches A's subscriber; if it does not, record the fallback in design.md; `testOnly` green

## 3. Tests: proof (D7)

- [x] 3.1 D7 table column P per fixed row: OLD form red, NEW form green; transcripts in `evidence/`, probes
  reverted (`git diff` clean of probe edits)
- [x] 3.2 D7 table column M per fixed row (T rows labelled test-side): NEW spec red; for V rows OLD passes vacuously under
  mutation plus slow observer (row 7: > 1500 ms pre-delete delay COMBINED with the not-awaited mutation); transcripts in `evidence/`, mutations reverted
- [x] 3.3 Full suite: `nice -n 19 sbt testFull` (concurrency 2) green; full log kept; then `sbt --client shutdown`
- [x] 3.4 `files-modified.md` lists only spec files (8), at most one shared D4
  test helper, plus change artifacts; no `ci.yml`, `playwright.config.ts` or
  `.gitignore`
- [x] 3.5 PR body lists the follow-up: `OutputRoutesSpec:780` 200 ms negative check plus a production
  backfill-completion hook (the driver files it)

## 4. CI: 3-fork trial (D8, after Part 1 merges; driven by the orchestrator resuming the executor)

- [ ] 4.1 Trial branch off post-merge `origin/main`, one commit `HEL924_TEST_GROUP_CONCURRENCY: 3`, draft PR
  `[TRIAL - DO NOT MERGE]`
- [ ] 4.2 At least 5 serial CI runs (rerun only after the previous run completes); per run, record backend leg
  results, failing suites and leg durations, plus a 2-fork baseline from recent main runs
- [ ] 4.3 Close the draft PR and delete the trial branch (local and remote); report the numbers for the ticket comment
