## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `6adc97c05ba4be340345d55a8322fc13742b42bd` (cb7d1a8d + 6adc97c0), base resolved live via
`resolve-review-base.sh` = `0cc7aef797be23b6358266daf9a96f3b96f9b7ff`.

### What I verified (with evidence)

**Gates, re-run fresh by me**
- `sbt testOnly *ApplyWriteBacks* *UpsertSource* PipelineCycleDetectionServiceSpec PipelineCreateTransactionalSpec PipelineStepSpec PipelineAnalyzeServiceSpec PipelineStepRequiredConfigSpec`:
  `Suites: completed 11, aborted 0` / `Tests: succeeded 247, failed 0` / `All tests passed.` exit=0.
- Frontend: `jest stepNarrowing|useStepCardState|StepCard.test`: 3 suites, 75 passed; `npm run lint` clean; `npm run typecheck` clean.
- I did not re-run the full 4342-test backend suite. The evaluator's pasted result is unambiguous, and the defect below is outside what that suite covers anyway.

**Running app (servers started via start-servers.sh, `PASS servers`)**
- I created a probe pipeline through the real API, `POST /api/pipelines` (201), with one `upsertsource` step (newSource target).
- **`GET /api/pipelines/:id/analyze` → 500**, reproduced 3 times (the page load plus 2 curls). A control pipeline on the same source with a
  `limit` step instead → 200. Backend log (`.concertino-backend.log`):
  `java.lang.IllegalStateException: PipelineService.toAnalyzeStepResponse: codec returned unexpected config type com.helio.domain.steps.UpsertSourceConfig for op 'upsertsource'`
  `at com.helio.services.pipelines.PipelineService.toAnalyzeStepResponse(PipelineService.scala:1664)`
- **`POST /api/pipelines/analyze-proposal` with an `upsertsource` step → 500**. The same body with a `limit` step → 200. Same exception
  (4 occurrences of the log line in total).
- Root cause (code read): `PipelineService.scala:1635-1666` matches on every `*Config` type and ends with `case Success(other) => throw`.
  No `UpsertSourceConfig` arm was added, and no `UpsertSourceAnalyzeStepResponse` exists. `PipelineAnalyzeService` inference (:457) was
  updated, but the service-level response mapping was not. No test drives `PipelineService.analyze`/`analyzeProposal` with an
  upsertsource step: grepping `src/test` for files that mention upsertsource and call analyze finds only `PipelineStepRequiredConfigSpec`,
  and that spec calls `PipelineAnalyzeService` directly.
- Frontend fallback (point 6), in the running app (dark theme): the step renders as "Unsupported step (upsertsource)" with a HelpCircle
  icon. Expanded, it shows "This step type is not yet supported in this version of the pipeline editor. Its configuration is preserved,
  but it cannot be edited here." There is no config editor. The network log after load and expand shows only GETs (no PATCH to
  `/steps`). It never masquerades as `OP_TYPES[0]`. Screenshots are not persisted: Playwright wrote them outside the worktree, so the
  claims rest on the network log and DOM text above. The notice reuses the existing `pipeline-detail-page__step-card-desc` class, so no
  new visual dialect is introduced. I did not toggle the light theme.
- I deleted both probe pipelines afterwards (204 each).

**Point-by-point**
1. *Deferred-write scenarios.* Not satisfied. The spec has SHALL scenarios "A later failing step prevents the write" and "Preview does
   not write" (a step preview, not only a dry run). Neither is tested; tasks.md 3.5 is still `[ ]` PARTIAL; and C2 requires the
   deferral tests to be mutation-proven. The structural argument is right today: the Failure branch and `previewAtNode` never call
   `applyPendingWriteBacks`. But nothing would catch a regression that applied the sink on either path. The dry-run test only guards
   the `isDry` branch. See CR3.
2. *"import" in the AC.* Confirmed inapplicable. The only import route is `DashboardSnapshotRoutes.scala:34` (`/api/dashboards/import`
   → `DashboardService.importSnapshot`). No pipeline import route or service exists, and `PipelineRoutes`/`PipelineStepRoutes` expose
   only step `duplicate`. The other five paths have direct and transitive API-level tests in `PipelineCycleDetectionServiceSpec`,
   which passed in my run. The AC is satisfied for every path that exists.
3. *Concurrency.* The race test is genuinely concurrent: `fut1`/`fut2` are both constructed before either `await`
   (`DataSourceRepositoryApplyWriteBacksSpec.scala:153-155`), with pool size 10. The concurrent-reader test is too weak to fail as the
   spec demands (see CR4).
4. *RLS.* Adequate. Both RLS specs build `helio_app_test` as `NOSUPERUSER` and use `SET ROLE` on the app pool. Coverage: owner write
   (`DataSourceRepositoryApplyWriteBacksRlsSpec:116`), scheduler via the real `PipelineSchedulerService.tick()`
   (`PipelineRunServiceUpsertSourceRlsSpec:188`), and grantee via the real `submit` (:208). The harness really enforces RLS: the grantee
   read returns 0 (:220-223), and owner inserts pass `FORCE`d policies under the GUC. Caveat: the foreign-target test (:126) is rejected
   by the app-level `ownerId` filter in `writeExistingDatasetAction` before RLS is ever consulted, so it proves the D5 re-resolve, not
   the RLS backstop.
5. *Registration scope / D10.* `upsertsource` is the only new registry entry. `convertformat`/`analyzewithai`/`generatetext` rejections
   remain in `PipelineCreateTransactionalSpec`, which passed. The helio-mcp `write.ts:375` description is deliberately excluded (HEL-1102).
   My grep found no other string-literal op list. **However, the D10 audit missed hand-enumerated per-kind pattern matches.** That is
   exactly how the analyze 500 shipped, and `PatchSetPreviewProjectionSteps.scala` has another one (CR2).
6. *Frontend fallback.* Verified in the running app, as described above.

### Verdict: REFUTE

### Change Requests
1. **Analyze crashes on any pipeline or proposal containing `upsertsource`** (AC "analyze/infer parity"; spec requirement "Analyze
   treats upsertsource as schema pass-through"). The pipeline editor calls `GET /analyze` on every load, so every saved upsertsource
   pipeline gets a 500 in the editor. Fix `PipelineService.toAnalyzeStepResponse` (`PipelineService.scala:1638-1666`): add a
   `case Success(cfg: UpsertSourceConfig)` arm and an `UpsertSourceAnalyzeStepResponse` subtype, including its JSON format and the
   schema/openspec contract if analyze response subtypes are enumerated there. Add service- or route-level tests for both
   `PipelineService.analyze` and `analyzeProposal` with an upsertsource step, asserting 200, output schema == input schema, and a
   downstream step's input schema == the upsertsource step's input schema (the spec's own scenario).
2. **The same defect class exists in patch-set preview.** `PatchSetPreviewProjectionSteps.scala:18-43` `withPosition` has no
   `UpsertSourceStep` arm and no wildcard, so it throws `MatchError`. `withDecodedConfig` (:53-78) has no arm either and returns a
   spurious `Left`. Its caller is `PatchSetPreviewProjection.scala:352`. Add the arms and a test. Then redo the D10 audit for
   **per-kind exhaustive matches**, not just string lists: grep `backend/src/main` for every `case s: AssertStep` / `case ...AssertConfig`
   site and confirm each one has an upsertsource arm. Record the list in files-modified.md.
3. **Test the two untested deferral scenarios (spec + C2).** (a) Run a pipeline where an `upsertsource` step is followed by a step
   that fails at evaluation: assert the run failed and the target is byte-identical. (b) Call `previewStep` on the upsertsource step
   (or a downstream step): assert the target is unchanged. Mutation-prove each and record red-then-green in files-modified.md. Mutations:
   apply `writeBackSink` in the `Failure` branch; apply it in `previewAtNode`. Then tick 3.5.
4. **Strengthen the concurrent-reader replace test and mutation-prove it (C2).**
   `DataSourceRepositoryApplyWriteBacksSpec.scala:83-96` only records `count == 0`. A half-written state (0 < n < 300, or old and new
   rows mixed) passes. There is also no evidence that any read overlapped the transaction. The waiver in files-modified.md ("not
   something a single-line mutation demonstrates") is incorrect. The guarantee depends on delete and insert sharing one transaction
   (`DbContext.withUserContext` wraps `.transactionally`), so running them as two separate `withUserContext` calls is a real
   single-point mutation. Required: assert every observed read is exactly the old set (400 `row-*`) or exactly the new set (300 `new-*`);
   count and assert the reads that happened while the write was in flight (> 0); and record a red under the split-transaction mutation.

### Non-blocking notes
- `DataSourceRepositoryApplyWriteBacksRlsSpec` "foreign target" test: consider also asserting RLS alone blocks the write. For example,
  call `appendRowsAction` for a foreign id directly under `withUserContext(ownerA)` to exercise the policy rather than the app filter.
- AC "fault injection" is proven at the repository level. `PipelineRunServiceUpsertSourceSpec` 3.6 does not assert `last_run_status =
  failed` or the absence of node-snapshot writes after a write-back failure. It would be cheap to add.
- Light-theme parity for the notice was not visually checked. Low risk: the notice reuses an existing token-styled class.
- No mtime-based evidence was relied on in this review.
