## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed cold against the worktree at d777803c1fbdf45f093584527ed4c052c8ad992f (change dir untracked; no code yet).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/source-sample-store-label/HEL-1628`.

### What I verified (with evidence)

- **D4 engine path and counts.** Verified in `InProcessPipelineEngine.scala`:
  - `loadRowsWithStats` is at `:522`, and `MaxRunRows = 1000` at `:113`.
  - REST and SQL use the cap with `ConnectorResolveContext.Internal` (`:661`, `:673`) and return `SourceReadStats(outcome.truncated, outcome.availableRowCount)`.
  - Dataset, CSV, text, PDF and image all return `(false, None)`.
  - The run path calls exactly this method (`InProcessExecutionBackend.scala:54`).
  - The D4 rules follow correctly: if `stats.truncated`, then `truncated` is true and `sourceRowCount` is the nullable count; otherwise `truncated` is `rows.size > 1000` and `sourceRowCount` is `rows.size`.
  - `FetchOutcome`'s doc (`ConnectorDriver.scala`) confirms that `availableRowCount` can be `None` while `truncated` is true.
- **D2 seam.** `urlFetchSeam` is private at `PipelineRunService.scala:125-139`. It reads `system` at call time and passes the engine `resolveHost`/`isBlocked`, which `ApiRoutes.scala:467-468` sets to `sqlUrlResolveHost`/`sqlUrlIsBlocked`.
  - The engine constructor (`:163-177`) accepts `fileSystem, connector, urlFetch, sqlResolveHost, sqlIsBlocked`, so a second engine is constructible with no AI client.
  - The extraction plan (task 1.0) is sound.
- **D1 limiter mount and run-guard isolation.**
  - `DataSourcePreviewRoutes` wraps its whole `concat` in `rateLimited` inside `pathPrefix("data-sources")`.
  - It is mounted with `sourceFetchRateLimitDirective`, a separate `InMemoryRateLimiter` (`ApiRoutes.scala:315-321`, `:932`).
  - `DataSourceRoutes` is mounted before it and has no `:id/sample` path (only `:id`, `schema`, `rows`, `rows/aggregate`, `rows/:rowId`), so nothing shadows the new route.
  - The run guard is reachable only through `PipelineRunService.submit` and the executor. A service that calls `loadRowsWithStats` on its own engine cannot reach it.
- **D3 access and credentials.**
  - `DataSourceService.preview` authorizes with `findByIdOwned` and returns `NotFound("Data source not found")` (`DataSourceService.scala:1349-1353`).
  - `findByIdOwned` uses `withUserContext` plus an explicit owner filter (`DataSourceRepository.scala:180-185`).
  - `Internal` matches the run path's credential handling. The doc comment it plans to update is at `ConnectorDriver.scala:11-20`.
- **D6 wire contract.**
  - `jsValueToAny` stringifies objects and arrays (`PipelineRowJson.scala:54-63`).
  - Loaders produce only `String`, `null`, `Double`, `Boolean`, `Int` (PDF `pageNumber`/`pageCount`/`characterCount`) and `Long` (`sizeBytes`). The only nested map is the image `BinaryRef`, which D5 refuses. So a closed cell type is correct and complete.
  - `ParityCorpus.encodeValue` (test scope, `ParityCorpus.scala:48-59`) and the TS `decodeValue`/`decodeRow` (`evaluator/testing/corpus.ts:37-68`) match D6's forms, including `-0.0`.
  - The `sourceRowCount` null writer and its required `["integer","null"]` schema type are pinned.
  - Schema-validator tooling exists on both sides (`testsupport/JsonSchemaValidation.scala`, and Ajv2020 in frontend contract tests).
- **D7 store and selectors for HEL-1631.**
  - `RootFrame {rootId, rows}` and `SourceFrames` are keyed by data-source id (`evaluatePipeline.ts:29-34`).
  - `combine.ts:50-55` reads secondaries by `dataSourceId` and treats `complete: false` as `secondaryNotCached`.
  - The planned selectors match these shapes.
  - `clearAuth` is the reset action used by sibling slices (`homeSummarySlice.ts:102`, `scheduledItemsSlice.ts:57`).
- **D8 label vs §4.** I compared the spec table with `docs/live-draft-preview.md` §4 (lines 196-204). The two rules are independent, the age shows on every non-static source, and "Static · N rows" appears only when the sample is static and exact. They match.
- **D9.** `ServiceError.BadGateway` and `InternalError` exist and map to 502 and 500 (`ServiceResponse.scala:123-124`).
- **D10.** The approach is consistent with the blocked-host guard. Screenshot paths must go through `e2e/support/evidencePath.ts` (`check:e2e-evidence-paths`).
- **AC coverage.**
  - AC1 is covered by 1.2 and 3.3.
  - AC2 is covered by 3.1 and 3.2.
  - AC3 is covered by 3.5 and 3.6.
  - AC4 is covered by 2.5 and 3.6.
  - C1 is reflected in 3.4, which requires the real writer plus negative cases.
- **Phone layout (the defect below).** `PipelineDetailPage.tsx:48,409` renders `isPhoneShell ? phoneLayout : <PipelineSpineLayout/>`. The phone layout shows each source as a chip in `PipelineDetailHeader.renderSourceChip` (`PipelineDetailHeader.tsx:205-238`). It never renders `SpineSourceCard`. Both layouts share `usePipelineDetailPage`. Neither the change dir nor the design doc says anything about phone or mobile (grep shows zero hits).

### Verdict: REFUTE

All prior-round defects are fixed, and every grounded claim checked out. One new contradiction is left. The implementer would have to guess how to resolve it, and either guess violates either the spec or the limiter-budget intent.

### Change Requests

1. **Define phone-shell behaviour. The spec and the design disagree, and D7's hook call site can be read two ways.**
   - The spec requirement "Sample label rules" says "Each source shown on the pipeline page SHALL carry a label", and "In-memory sample store" says "A refresh control SHALL re-fetch that one source".
   - D8 puts the label and the refresh button only in `SpineSourceCard`, which exists only in the desktop layout (`PipelineSpineLayout`). On the phone shell, sources render as header chips (`PipelineDetailHeader.tsx:205-238`) with no label and no refresh.
   - D7 says the hook is "called from the pipeline page". That could mean `usePipelineDetailPage`/`PipelineDetailPage`, which captures on phone with no label and no way to refresh, spending source-fetch budget invisibly. It could equally mean `PipelineSpineLayout`, which never captures on phone.
   - Pick one and make the spec, D7, D8 and the tasks agree:
     - (a) Label and refresh on the phone header chips too, with a component test and a phone-viewport screenshot in 3.6.
     - (b) Desktop-only for (b). The hook is mounted in the desktop layout only, so phone sends no sample request. The spec says "each source card of the desktop pipeline page", and a test or e2e asserts zero `/sample` requests on the phone shell. Record the phone gap as an (e) follow-up.

### Non-blocking notes

- **D9 catch-all.** Pass through only the engine's curated `IllegalArgumentException` messages for 502. Any other `Throwable`, such as a DB error from `readDatasetRows` or a JDBC or Pekko exception, should get a generic message and not `getMessage`. Otherwise "curated" is not guaranteed.
- **Task 3.4a comparison.** `ParityCorpus` renders doubles with `java.lang.Double.toString` through its own `OJ` type, while spray's `JsNumber` prints differently (`1.0E10` vs `1.0E+10`). Compare parsed values, not rendered strings, or the test will fail spuriously.
- **Task 3.4 shared fixture.** For C1 to hold on the client half, the committed fixture the frontend validates should be one the backend test asserts equals the real writer's output. That can be a regenerate mode plus an equality check, as `PipelineStepParitySpec` does. A hand-written fixture is not enough.
- **Reload scenario.** Spec scenario "Reload holds nothing" expects a new first capture after reload. Task 3.6 could add one `page.reload()` and assert exactly one fresh `/sample` request. The jest "fresh store" test alone is weak evidence for it.
- **Sources list still loading.** `sourceByRootId` is `undefined` until the caller's sources list loads. Do not render "Sample unavailable" during that window: show the loading state, and have the hook dispatch once the list resolves.
- **Age wording.** `formatRelativeTime` yields "3 minutes ago", not the doc's "3m ago". That is fine, since the wording is reversible. Consider `useNow` for the 30 s tick.
