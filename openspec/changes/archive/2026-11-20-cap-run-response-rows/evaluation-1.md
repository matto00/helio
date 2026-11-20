## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `59ae7d4a87f9658711d5a4b9b0ca4e6c2ee53ee8`. Base `fef01cda9c089e90c2f93f65e1b59ee1f11d8a16` (resolved live with
resolve-review-base.sh). The diff has 2 commits: red-run `394cbfe76` and implementation `59ae7d4a8`.

### Phase 1: Spec Review — FAIL

Verified:
- AC "cap applied with seam tests on both client and server". `PipelineRunResponseCapSpec` runs the real
  `POST /run` and holds the normalised body to `shared-test-fixtures/pipeline-run/run-capped-response.json` (whole JSON
  value). `SpineRunStatus.runCap.test.tsx` and `helio-mcp/src/tools/runCapSeam.test.ts` read the same fixture.
- All six response sites are capped through the one helper, `RunResultResponse.preview`: executor, both
  `PipelineRunPreview` arms, `GET /runs/:runId`, and both apply routes, which embed the executor's response.
  `PipelineRunService:250` (empty run) keeps the `false` default.
- D2 holds: `PipelineRunExecutor` builds the preview after `onRunSuccess` has received the full `jsRows`. On the live
  stack (lane DB `helio_hel1696`) an apply-proposal returned `run.rows` 10, `rowCount` 25 and `rowsTruncated` true over a
  chunked response, and `GET /api/outputs/:id/rows` returned all 25 rows.
- D4: the `RunStatusResponse` writer and reader carry the field, and the route copies it. The test asserts it on the
  wire.
- AC "MCP and helio-news unaffected or updated":
  - MCP types and both apply descriptions are updated, and the handlers stay pass-through (C15).
  - `/home/matt/Development/helio-news` calls only `run_pipeline` (news/timeseries.py:131,144,154). That tool already
    returns counts with no rows.
- AC "Cloud Run behaviour documented": the docs-only finding (the 32 MiB limit does not apply to chunked responses) is
  quoted in proposal.md Why and design.md Risks. C8 forbids a prod probe. The PR body must carry it (see suggestions).
- C16: the only backend test that read run-body rows is `RunResponseChunkedRoutesSpec`. Its chunking assertions are
  unchanged, and its row assertion moved to `rowCount`/`rowsTruncated`. The full sbt suite passes, so no other test
  read more than 10 rows. No e2e spec reads `rows` from a `/run` or apply body (grep of e2e/).
- Red-run claim: `394cbfe76` adds only tests, the fixture and artifacts, and was committed `--no-verify`. Its commit
  message states this, as C12 requires. Against base the run body had 25 rows and no `rowsTruncated`, so the recorded
  red is consistent.
- The executor's claim that `rowsTruncated` is optional in `pipelineService.ts` is true. It matches the optional sibling
  fields there and D6's older-server rationale, and nothing reads it. It is still an unrecorded deviation from D5 (see
  CR2).

Issues:
- **Divergence from D5 (dead prop).** D5 says "`SpineRunState` replaces `runResult` with `runRowCount`". The
  implementation adds `runRowCount` but keeps `runResult` in `SpineRunState`
  (`frontend/src/features/pipelines/ui/spine/SpineRunStatus.tsx:17`). `SpineRunStatus` no longer reads it. It is still
  threaded in at `PipelineSpineLayout.tsx:169` and `MobilePipelineHeader.tsx:172`, and
  `SpineRunStatus.runCap.test.tsx:38` populates it.
- **Planning artifacts not updated for two deviations.**
  - design.md D5 says `rowsTruncated: boolean` on both `RunResult` types. `services/pipelineService.ts:253` has
    `rowsTruncated?: boolean`.
  - tasks.md 0.3 names `PipelineRunRoutesSpec`. The test is in `PipelineRunResponseCapSpec` ("cap GET /runs/:runId for
    a cached 25-row run").

### Phase 2: Code Review — PASS (one dead-code item, counted under Phase 1 / CR1)

Gates, run fresh by me in WORKTREE_PATH at `59ae7d4a8`:
- `npm run lint`: exit 0. `npm run format:check`: "All matched files use Prettier code style!"
- `npm test` (3 workers): root 71 suites / 621 tests passed, including `helio-mcp/src/tools/runCapSeam.test.ts`.
  Frontend 882 suites / 10394 tests passed.
- `npm --prefix frontend run typecheck` exit 0. `npm --prefix frontend run build` exit 0. helio-mcp `npm run
  typecheck` exit 0. helio-mcp has no `test` script; its tests run under root jest.
- `SpineRunStatus.runCap.test.tsx`, run on its own: 2/2 passed.
- `sbt -batch -J-Xmx3g testFull` in 6 shards (`HELIO_TEST_SHARD_COUNT=6`, index 0..5): every shard exit 0 and "All
  tests passed".
  - 10062 succeeded, 0 failed, 5 canceled.
  - The canceled tests are pre-existing `assume`-gated opt-in measurements: `HELIO_MEASURE=1`, for example
    `RunPathHeapSpec:331`.
  - The new specs ran and passed: all 7 `PipelineRunResponseCapSpec` cases, `PipelineApplyProposalRunCapSpec` (2),
    `CombinedApplyProposalRunCapSpec` (1) and `RunResponseChunkedRoutesSpec` (2).
- `node scripts/check-scala-quality.mjs`: "clean". The soft size warnings were already there. `PipelineProtocol.scala`
  was already over its budget and grew by 15 lines.

Review:
- Canonical rules: no inline FQNs, no `any`, no TODO/FIXME, and comments carry ticket refs consistent with the repo.
- DRY: one helper for the cap and the flag. `PipelineRunQueries` uses `PreviewRows` directly, because its rows are
  `Map`s rendered lazily and it renders only 10. That is the right call.
- Mutation claims (mutations.md): I did not re-execute them, because I may not modify code. I checked each one against
  the assertions. Every mutation would turn a concrete assertion red:
  - Removing the cap breaks `should have size 10`.
  - Flipping the flag breaks `JsBoolean(true/false)`.
  - Counting from the preview breaks `rowCount shouldBe 25`.
  - Dropping the writer field breaks the raw-JSON `fields("rowsTruncated")` on GET.
  - On the frontend, `runResult.length` would show 10, not 25.
- Slice: `runRowCount` is set and cleared on every path where `runResult` is set or cleared, except the reducer
  `setRunStatus({rows})`, which has no non-test dispatcher. `pending` clears neither, the same as before.

### Phase 3: UI Review — PASS

Servers ran through start-servers.sh on 7128/10035 against the lane DB `helio_hel1696` (created; Flyway history 142
rows), with `ANTHROPIC_API_KEY` exported empty. assert-phase `PASS servers`.
- Happy path: on the pipeline page with a 25-row static root, "Run pipeline" gives the chip "Run status: succeeded",
  "Snapshot replaced: 25 rows". "Dry run" gives "Preview: 25 rows". On the wire the dry run returned rows 10, rowCount
  25 and rowsTruncated true.
- Breakpoints 1440 / 1100 / 768 / 375: the chip stays visible with the correct text and there is no horizontal
  overflow. At 375 the mobile header path is used.
  - Screenshot at 1100:
    `/home/matt/Development/helio/.concertino/runs/HEL-1696/evidence/.concertino-eval-hel1696-1100.png`
- Console: one 404 on `GET /api/pipelines/:id/schedule`. It is the normal response for a pipeline with no schedule and
  is unrelated to this change. There were no other errors.
- The chip is a non-interactive status span with an aria-label, unchanged.
- Cleanup:
  - The test user `8e16f6ec-bea2-4d5a-b008-99756e35dfec` was deleted by exact id and email with `buildUserDeleteSql`
    (0 rows remain).
  - The servers were stopped with stop-servers.sh, and the ports are free.

### Overall: FAIL

### Change Requests
1. Finish D5's `SpineRunState` change. Remove `runResult` from `SpineRunState`
   (`frontend/src/features/pipelines/ui/spine/SpineRunStatus.tsx:17`), then drop the now-dead `runResult:` entries:
   - `ui/spine/PipelineSpineLayout.tsx:169`
   - `ui/mobile/MobilePipelineHeader.tsx:172`
   - `ui/spine/SpineRunStatus.runCap.test.tsx:38`
   - the `SpineRunStatus` props in `ui/mobile/PipelineMobileLayout.test.tsx`, if it passes one

   If nothing else then reads `page.runResult` / `own.runResult`, also remove the passthrough in
   `hooks/usePipelineDetailPage.ts:215`, `hooks/usePipelineOwnPipeline.ts:16,62` and the matching key in
   `usePipelineDetailPage.keys.test.tsx`. The Redux `runResult` state key stays, per D5. Re-run lint, typecheck and the
   affected spec files.
2. Bring the planning artifacts in line with what shipped:
   - design.md D5: state that `services/pipelineService.ts` `RunResult.rowsTruncated` is optional, matching its optional
     siblings and D6's older-server tolerance, while `types/output.ts` is required.
   - tasks.md 0.3: name `PipelineRunResponseCapSpec` as the spec that holds the GET `/runs/:runId` route assertion.

### Non-blocking Suggestions
- The PR body should quote the Cloud Run quotas line (the 32 MiB HTTP/1 limit "applies if not using
  `Transfer-Encoding: chunked` or streaming"). It should say this was not probed (C8) and that HTTP/2 is undocumented.
  This is the AC1 record.
- Note the BREAKING `rows` change and the release-time MCP redeploy in the PR body, as design.md Risks says.
