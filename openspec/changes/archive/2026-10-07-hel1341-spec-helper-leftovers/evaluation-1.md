## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: bcc922cb804ffb18e72558600b28b5e86aece5be. Diff base (resolved live): 575a58b1f537cc4e79013b196afaf1d1ade020fd.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (helper name no longer claims it asserts; behaviour-preserving): `assertNothingAcceptedBeforeSentinel` was renamed to
  `acceptedThroughSentinel` in `AcceptRecordingListener.scala:45`. The body is byte-identical (the diff touches only the name
  line and the scaladoc). All 4 call sites changed only the method name (SqlConnectorRebindingSpec:49, :84;
  SqlConnectorConfigShapeSpec:63; SqlEgressSocketFactoriesSpec:30), and each caller's `accepted shouldBe List(sentinelPort)`
  is unchanged. A grep for the old name returns nothing in live code. The only remaining hits are historical archive
  records (the HEL-1341 evaluation/skeptic reports and evidence transcripts), which correctly stay as they were. Both
  scaladoc references are fixed, and the incorrect "true iff" wording is gone.
- AC2: the test description now reads "fire a debounced auto-run through the real system clock, creating exactly one run".
  The body (`DatasetWriteAutoRunEndToEndSpec.scala:279-308`) does exactly that: a real SystemClock, `pollUntil` 10 s, then
  `runCount(pid) shouldBe 1`, with elapsed time printed only under `HELIO_MEASURE=1`. In the report output it reads
  "should fire ...", which is grammatical. Only the name line changed.
- AC3, independently verified against the tree:
  - `PipelineShapeServiceSpec` `whenReady` is at :29, :35 and :45, and nowhere else. `PipelineShapeService.expand`
    (`PipelineShapeService.scala:51-57`) returns `Future.successful`, so the future is complete before the first poll.
    Harmless, confirmed.
  - `SparkJobSubmitterSpec:345` is `eventually(timeout(30000 ms), interval(50 ms))` inside `awaitRunPersisted`, and :165
    is a 30 s `Await.result`. The design names :337, which is the `await` helper `Await.result(f, 30.seconds)` (line 337
    in the live tree). It is a bounded state wait, so harmless, confirmed.
  - The corrected sentence says no `eventually` remains on the 150 ms default. Confirmed: every `eventually` in
    `backend/src/test` either passes an explicit `timeout` (PipelineRunRegistrySpec:136, OutputRoutesSpec:769,
    SparkJobSubmitterSpec:345) or runs under an overridden implicit `patienceConfig` of 2 s / 20 ms
    (AssistantTelemetrySpec:59, AuthoringTelemetrySpec:68). The `eventuallyAuditRows` helpers are hand-rolled 2 s loops,
    not ScalaTest's `eventually`. The only `ScalaFutures` mixin in the test tree is PipelineShapeServiceSpec.
- Tasks 1.1-3.2 are all ticked and match the diff. There is no scope creep and no production code change.
- The archived design.md edit is labelled "added by HEL-1357" / "HEL-1357 correction" as design D3 requires, and
  `check:openspec` passes.
- `workflow-state.md` CONSTRAINTS is `[]`, so there is nothing to honour.

### Phase 2: Code Review — PASS
Issues: none.

Gates were run fresh in WORKTREE_PATH by the evaluator (backend changed; no `frontend/**` changes):
- `nice -n 19 sbt testFull`: exit 0. 6085 run, 6085 succeeded, 0 failed, 4 canceled (the same 4 canceled as the
  executor's log). Both renamed tests appear in the run: "should refuse a loopback address without connecting, and close
  itself" and "should fire a debounced auto-run through the real system clock, creating exactly one run". The transcript
  is saved as `evidence-evaluator-testFull.log` in the change dir (gitignored).
- Equivalent pre-commit checks for the changed file types also pass: `npm run format:check`, `check:openspec`,
  `check:spec-structure`, `check:scala-quality` and `check:test-temp-dir-hygiene` all exit 0.

The guard-is-failable evidence (D1) was reviewed. `evidence-mutation-red.log` shows SqlEgressSocketFactoriesSpec failing
with `List(52404, 52418) was not equal to List(52418) (SqlEgressSocketFactoriesSpec.scala:32)`: the stray port comes
before the sentinel, and the caller's assertion catches it. `evidence-mutation-green.log` shows 11/11 after the revert.
This supports the design's argument that the helper does not need to assert. The red transcript is consistent with a real
stray connection, not a staged failure.

Code quality: the new scaladoc is accurate. The method opens only the sentinel and returns `acceptedPorts` after waiting
for `accepted.contains(sentinelPort)`. If the sentinel is never accepted, it is absent from the list and the caller's
assertion fails, exactly as the doc says. There is no dead code, no new imports, and no type escapes.

### Phase 3: UI Review — N/A
Changed files are under `backend/src/test/**` and `openspec/changes/**` (not `openspec/specs/**`). No trigger matches.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- None. The new test name drops the "within a 10 s bounded wait" detail the proposal mentioned. That is acceptable,
  because the inline comment already states the bound.
