## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `1ac52d52c82277177f27d93dca2c7a7284f1b4c9`. Base resolved live: `469f4ea9377729f90d32e640a22b61be3c487439` (origin/main).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (inventory): design.md has 21 rows. Each row gives the window, the work inside it and the contention effect (F/V/-).
- AC2 (fix plus proof): rows 1-8 and 8a are fixed as D1-D6 and D9 specify (checked one by one below). Each fix has P/M transcripts under `evidence/`, and I re-ran a sample myself (Phase 2).
- AC3 (3-fork trial): this is deliberately post-merge (D8, tasks group 4 unchecked) and is not part of this diff. That matches the driver constraint that the trial runs on a separate branch. It is still owed before the ticket closes.
- Scope: the diff (`git diff --name-only 469f4ea93...HEAD`) contains 8 spec files, 1 new helper (`testsupport/AcceptRecordingListener.scala`) and change artifacts. It has no hits for `ci.yml`, `playwright.config.ts`, `.gitignore` or `src/main` (grep exit 1).
- CONSTRAINTS C1-C6 are honoured. No fixed sleep was added as a fix: the old `Thread.sleep(150/200/300/500)` sites are gone, and the only remaining poll sleep is the pre-existing 25 ms in ConnectorRepositorySpec. Every new bound is a named state-wait constant: `AcceptStateWaitDeadline`, `AdvisoryWaiterStateWaitDeadline`, `RotationBlockedStateWaitDeadline`, `SelfEchoMarkerStateWaitDeadline` and `BackfillMaterializedStateWaitDeadline`. The 1500 ms pending poll in row 7 is unchanged.

Row-by-row match against the decisions:
- Row 1 / D1: the FakeClock boundary case was added (whole-second t0, 999 ms gives 0 runs, 1000 ms gives 1). The real-SystemClock case stays unconditional: `pollUntil(..., 10.seconds)` plus `runCount shouldBe 1` are outside any `if` (DatasetWriteAutoRunEndToEndSpec.scala:297-301). Only the `>= 1000L` assertion was removed, and only the println is gated behind `HELIO_MEASURE=1`.
- Row 2 / D2: tx1 is a test-owned raw JDBC lock with no pg_sleep. The ungranted-waiter wait is mandatory and matches classid/objid/objsubid as derived from the key. tx1's release timestamp is recorded, then it commits. The 50 ms tolerance was dropped, which makes the test stricter.
- Row 3 / D3: a bounded `awaitAccepted(1)`, then a size-1 assertion.
- Rows 4-6 / D4: a sentinel-port barrier that asserts the accepted list equals `[sentinelPort]`, applied at all 4 sites through one shared helper.
- Row 7 / D5: a `pg_stat_activity` Lock-wait barrier on the `connector_credentials` delete, placed before the unchanged 1500 ms poll.
- Row 8 / D6: B publishes a `running` marker. The spec waits on content through a `ConcurrentLinkedQueue` and asserts `List("queued", "running")`. The D6 precondition is recorded in files-modified.md and confirmed by the M transcript (`[queued, queued, running]` shows foreign events reach A's single LISTEN connection).
- Row 8a / D9: `eventually(timeout(BackfillMaterializedStateWaitDeadline), interval(50.millis))`, as ruled (A).

Weakening check (backend-ci-test-execution): no test was weakened.
- Row 1 dropped a lower bound, but the new FakeClock case proves the same property (debounce not ignored) more strongly. I confirmed this with the `fire_at = now` mutation below: the FakeClock case goes red.
- Row 2 got stricter (tolerance removed). Rows 4-8 changed from vacuous to failable.
- Row 8a lengthens patience from 150 ms to a 5 s give-up. That is the C6-ruled state-wait case, not a race window.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates (my own fresh runs; backend-only diff, so frontend gates do not apply):**
- `nice -n 19 env HEL924_TEST_GROUP_CONCURRENCY=2 sbt testFull` at HEAD 1ac52d52c with a clean tree: exit 0. 6085 tests, 436 suites, 0 failed, 0 aborted, 4 canceled. All 8 changed target tests appear in the log (grep count 8), so this was not a cached no-op. Then `sbt --client shutdown`. Log: `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/eval-testfull.log`.
- `node scripts/check-scala-quality.mjs`: "clean". Soft file-size warnings only, none new from this diff, and there are no inline-FQN hits.

**Independent D7 re-runs.** All edits were temporary and reverted by exact path. Afterwards `git status --short` and `git diff HEAD --stat` were both empty, and HEAD was unchanged.

- Run A: NEW specs plus production mutations (log `.../scratchpad/evalA-mutations.log`). All five targets went red:
  - Row 1 M (`fire_at = now`): `1 was not equal to 0 (DatasetWriteAutoRunEndToEndSpec.scala:272)`
  - Row 6 M (the dialect-refusal path opens a socket): `List(59492, 59496) was not equal to List(59496) (SqlConnectorConfigShapeSpec.scala:64)`
  - Row 7 M (delete not awaited): `rotation reported success while ... still blocked (ConnectorRepositorySpec.scala:491)`
  - Row 8 M (echo guard removed): `List("queued", "queued", "running") was not equal to List("queued", "running")`
  - Row 8a M (backfill disabled): `Attempted 81 times over 5.05 seconds ... (OutputRoutesSpec.scala:761)`
- Run B: OLD specs restored from 469f4ea93, plus probes (log `.../scratchpad/evalB-old-probes.log`):
  - Row 7 P (pg_sleep(2) before a not-awaited delete): the target test "does not return success until..." **passed**. OLD green is confirmed, so the old form was vacuous.
  - Row 8 P (guard removed plus a 1500 ms delay on the self-echo): "self-echo guard..." **passed** (vacuous).
  - Row 8a P (300 ms backfill delay): **red**, "Attempted 6 times over 164 ms".
- Run C: NEW specs plus the same probes, and the row 2 test-side probe (300 ms before tx1 takes the lock) (log `.../scratchpad/evalC-new-probes.log`):
  - Row 7: red at :491.
  - Row 8: red with `[queued, queued, running]`.
  - Row 8a: **green**.
  - Row 2 "SAME advisory lock key...": **green**.

These match the executor's transcripts row for row. I did not re-run rows 2-OLD, 3 or 4-5 myself. Those transcripts are internally consistent: each shows a `git diff HEAD` of the temporary edit, and the reported line numbers match the files.

Code-quality checks:
- DRY / modular: the three copy-pasted `listener()`/`countingListener()` helpers are folded into one shared `AcceptRecordingListener`. That is a net reduction.
- Type safety, security, dead code: no escape hatches. Unused imports (`ServerSocket`, `AtomicInteger`, `SocketException` where no longer used) were removed. No TODO/FIXME.
- Spin waits: `Thread.onSpinWait()` follows the existing repo pattern (`NodePayloadTrimPurgeLockOrderSpec.scala:164`, `RetentionLockGuardSpec.scala:141`), so it is not a finding. See the suggestions.

### Phase 3: UI Review — N/A
Only `backend/src/test/**` and `openspec/changes/**` changed. No Phase 3 trigger matches.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `backend/src/test/scala/com/helio/testsupport/AcceptRecordingListener.scala:589-597`: `assertNothingAcceptedBeforeSentinel()` asserts nothing and returns `(List[Int], Int)`, yet its Scaladoc says "true iff ...". Consider renaming it (for example `acceptedThroughSentinel()`) and fixing the doc, or making it actually assert.
- `DatasetWriteAutoRunEndToEndSpec.scala:279`: the test name "reports the observed elapsed time..." no longer describes what CI checks, because reporting is now HELIO_MEASURE-only. Consider renaming it to something like "fires a debounced auto-run on the real SystemClock".
- In SqlEgressSocketFactoriesSpec, SqlConnectorRebindingSpec and SqlConnectorConfigShapeSpec, the repeated comment "HEL-1341 D4: sentinel-identified barrier -- nothing but the sentinel was ever accepted." restates the assertion below it. The `// HEL-1341 D3: ... instead of a fixed sleep` comment narrates history. CONTRIBUTING.md's test-comment rule ("no restating an assertion in prose") suggests trimming both.
- The pure spin waits in the D2 and D5 loops issue back-to-back `pg_locks`/`pg_stat_activity` queries with no interval. That matches repo precedent and is negligible on the passing path. A small poll interval (as OutputRoutesSpec's `interval(50.millis)` uses) would be gentler on a contended runner during the give-up path.
- Remember that AC3 (the 3-fork trial, D8) is still owed after merge, along with the follow-up for `OutputRoutesSpec:780` noted in the PR body.
