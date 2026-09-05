## 1. Establish the failing baseline (red first)

- [x] 1.1 Add a ScalaTest fixture building a two-lane pipeline with a rejoin: root -> lane A (`s1` -> `s2`), root ->
      lane B (`s3`), and a `join` step `s4` whose `parentStepId` is `s2` and whose `secondaryInput` is
      `SecondaryInput.Lane("s3")`. `s3` must contribute at least one column that lane A does not have, with a
      distinguishable value, so a "reflects both inputs" assertion is possible.
- [x] 1.2 Assert the CURRENT behaviour is a failure: previewing `s4` yields `ServiceError.UnprocessableEntity`
      carrying the `LaneReferenceError` text. Record the exact message in `files-modified.md`. This test must be RED
      against unmodified code and is rewritten in 3.1 — it exists to prove the defect is real and reproduced, not as a
      permanent guard.
- [x] 1.3 Confirm the same node succeeds via the real run path on the same fixture, and capture its rows. This is the
      oracle for 3.2's equality assertion, and it is what establishes that the defect is preview-only rather than a
      fixture error.

## 2. The dependency-closure helper

- [x] 2.1 Add the helper in `com.helio.domain.engine` (design.md D2 fixes the package; the exact object/method name is
      the executor's call). It SHALL be at least `private[engine]`, not `private`, so 2.6 can test it directly rather
      than only through the service. Signature shape: given the pipeline's full step vector and a target step, return the
      target's transitive dependency closure as a `Vector[PipelineStep]`.
- [x] 2.2 Implement it as a visited-set fixed-point expansion over BOTH edges: `parentStepId`, and
      `InProcessPipelineEngine.laneDependencyOf` for any `join`/`union`/`lookup` already in the set. Terminate on the
      visited set (design.md risk: cycles must not hang, per HEL-911 contract item 7's run-time arm).
- [x] 2.3 De-duplicate by step id — a lane consumed by two rejoins (a legal diamond, HEL-911 Decision 3) must appear
      exactly once.
- [x] 2.4 Emit the closure in repository execution order, filtered. Do NOT sort, rank, or otherwise impose an
      evaluation order — `executeTree` owns ordering (design.md D1 corollary). A reviewer should be able to see that no
      ordering decision was made here.
- [x] 2.5 Do not pre-filter disabled steps (design.md risk; HEL-911 contract item 9 — a disabled lane-referenced node's
      passed-through frame is what the rejoin reads, so it must stay in the closure).
- [x] 2.6 Unit-test the helper directly: parent-only chain (equals the old `pathToRoot` output exactly), single lane
      edge, transitive lane edge (a lane step that itself holds a lane reference), diamond, and a cyclic input that must
      terminate rather than hang.

## 3. Wire both call sites

- [x] 3.1 Replace `pathToRoot` at `PipelineRunService.scala:504` (`previewStep`) with the helper. Rewrite 1.2's red test
      to assert `200` and correct rows.
- [x] 3.2 Assert run/preview agreement (design.md D4, acceptance criterion 2): for the 1.1 fixture, preview's rows for
      `s4` equal the run path's rows for `s4`, field for field — AND at least one assertion compares against an
      independently-written literal, so the test cannot pass by both paths being wrong identically.
- [x] 3.3 Assert the rejoin's preview rows actually carry lane B's distinguishing column with its expected value.
- [x] 3.4 Assert exclusion: previewing lane A's own terminal step (`s2`, which holds no lane reference) does NOT execute
      lane B. Assert on the closure's membership, not just on rows, so the "include everything" non-fix is caught.
- [x] 3.4a Cross-root closure (design.md D5, round-1 CR1): add a fixture with TWO roots where a rejoin under root A has
      `secondaryInput` naming a lane step under root B. Assert preview returns 200 with rows equal to the run path's for
      that node. Assert explicitly that BOTH call sites still pass the FULL `roots` vector — narrowing `roots` to the
      target's own root trips `InProcessExecutionBackend.execute`'s `roots.size == 1` shortcut, which remaps root B's
      lane step onto root A and evaluates it against the WRONG root's frame — returning 200 with wrong rows and NO
      error. The discriminator must therefore be a ROW VALUE, never an error message.
      Fixture requirements, both mandatory (design.md D5 fact 1): (i) root A's and root B's sources must carry
      DISTINGUISHABLE data, or the corrupt implementation produces the same rows as the correct one; (ii) the fixture
      must be DB-backed with real `root_id`s — a genuine two-root graph takes the `stepRepo.rootIdsOf(pipeline.id)`
      branch, so the `PipelineStepRepository(null)` / in-memory-steps style used by single-root engine tests will not
      work here. Do not downgrade this to a single-root test if the fixture proves awkward; escalate instead.
- [x] 3.4b Assert the target's rows are read from `nodeOutcomes(StepKey(target))` and not from `TreeWalkResult.rows`
      (which is the lowest-positioned root's trunk terminal under multi-root, HEL-913 R10). Preserve the existing
      fallback shape at both sites; do not "simplify" it. Make this BEHAVIOURAL rather than a code-shape assertion by
      targeting a rejoin in 3.4a's fixture that is NOT the lowest-positioned root's trunk terminal — then reading
      `TreeWalkResult.rows` by mistake returns observably different rows, and the test cannot be satisfied by a comment.
- [x] 3.4c Assert `stepCounts` semantics (design.md D6, round-1 CR2): a rejoin preview's `stepCounts` contains an entry
      for every step of the referenced secondary lane as well as the target's own chain. Assert the specific lane step
      ids are present with their real counts, not merely that the map grew.
- [x] 3.5 Replace the second `pathToRoot` at `:663` (`evaluateNodeRowsForBackfill`) with the same helper, and delete
      both local copies so no third definition of "depends on" survives in the service.
- [x] 3.6 Cover the backfill site: a rejoin-bound Output backfills its node snapshot with the rejoined rows rather than
      failing into the site's `.recover` log-and-swallow arm.

## 4. Parity and regression

- [x] 4.0a Confirm `evaluateNodeRowsForBackfill`'s `explicitRootId` stays `None` on the step-bound branch this change
      touches — it governs only the root-bound (`targetStepId.isEmpty`) branch (design.md D5 fact 3).
- [x] 4.1 Parity test (acceptance criterion 5): for a pure-trunk pipeline and a trunk-plus-tails pipeline with no lane
      reference, preview output is byte-identical to pre-change. Derive the expected values from the pre-change code
      path, not from the new one.
- [x] 4.2 Re-run the existing `PipelineRunServiceSpec` / `OutputRoutesSpec` preview suites; the "does not mutate
      last_run_status/last_run_at" tests in both arms must stay green (this change must not make preview write).
- [x] 4.3 Correct the now-satisfied `pipeline-preview-api` claim: verify the merged scenario "Preview of a rejoin Output
      reflects both inputs" is genuinely true after this change, and say so in `files-modified.md` with the test name
      that proves it. Do NOT edit that spec — it was already correct; only the code was wrong.

## 5. Widening (acceptance criterion 6) — verify, do not assume

- [x] 5.1 Re-derive the widening independently rather than trusting planning's survey: sweep the backend for the
      PROPERTY "a step-set handed to `backend.execute`, or any dependency/reachability decision, built from
      `parentStepId` alone". State the site count found and name every site.
- [x] 5.2 For each site found, classify it as (a) sharing the defect, or (b) legitimately parent-only. Planning's
      finding — that `PipelineAnalyzeService.analyzeNodes` is already lane-aware, and that
      `PipelineService.ancestorChainOf` / the inline `ancestorClientIds` are correctly parent-only because they are
      cycle checks rather than execution slices — is a claim to CONFIRM OR REFUTE with evidence, not to repeat.
- [x] 5.3 Record the conclusion in `files-modified.md`: preview-only, or shared. If shared, escalate scope rather than
      silently widening the change.

## 6. Report, do not fix

- [x] 6.1 Record the `RuntimeGraphPath` scaladoc/implementation divergence over transitive lane following (design.md
      D3): the doc claims transitive, `pathOf` consults `laneDep` for the target step only. State which is true. Do NOT
      fix it in this change.
- [x] 6.2 Note in `files-modified.md` that `InProcessPipelineEngine.scala:386`'s message ("does not exist in this
      pipeline") is misleading when the vector is a slice. Do not reword it here — after this change preview no longer
      produces that state, so a reword would be an untested edit to the run path's error text.

## 7. Gates

- [x] 7.1 `sbt test` green from the worktree, on the worktree's own backend port.
- [x] 7.2 Scala code-quality check, and the repo's pre-commit chain, green. No `git commit -n`.
- [x] 7.3 No Flyway migration added (hard constraint — shared dev Postgres across three parallel runs). Verify
      `backend/src/main/resources/db/migration/` is untouched.
- [x] 7.4 No browser/Playwright run, and no frontend file touched (a sibling run owns the shared session).
- [x] 7.5 No edit to sibling-owned paths: `RestApiConnectorDriver`, `RestApiConfig`, `SchemaInferenceEngine`,
      `InProcessPipelineEngine.loadCsvRowsFromBytes`, `frontend/src/features/pipelines/**`.
