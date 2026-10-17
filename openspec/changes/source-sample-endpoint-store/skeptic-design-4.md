## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed cold against the worktree at d777803c1fbdf45f093584527ed4c052c8ad992f (the change dir is untracked and no code exists yet).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/source-sample-store-label/HEL-1628`.

### What I verified (with evidence)

- **Round-3 CR1 (phone layout) is resolved as option (a), and the artifacts agree with each other.**
  - Spec "Sample label rules" now says "in both the desktop spine layout and the phone layout".
  - D8 places the compact `SourceSampleLabel` under each chip in `PipelineDetailHeader` (`PipelineDetailHeader.tsx:205-238`, `renderSourceChip`). Task 2.6 implements it, and task 3.6 adds a phone-viewport screenshot.
  - Task 2.4 mounts the hook once in `usePipelineDetailPage`, which serves both layouts.
  - Code check:
    - `PipelineDetailPage.tsx:49` calls `usePipelineDetailPage()`, and `:409` renders `isPhoneShell ? phoneLayout : <PipelineSpineLayout page={page}/>`.
    - `PipelineDetailHeader` renders only inside `phoneLayout` (`:180`), so desktop cannot show the label twice.
    - `renderSourceChip` is the single render path for both visible and overflow chips, so overflowed sources get the label too.
    - `SpineSourceCard.tsx:49-56` has the `spine-card__meta` kind line that D8 places the label under.
  - D7's "called from the pipeline page" and task 2.4's `usePipelineDetailPage` name the same call site, so the phone layout no longer spends budget invisibly.
- **D9 error mapping is grounded.**
  - Every curated engine failure is an `IllegalArgumentException`. This covers the CSV/text/PDF URL `Left(err)` branches, the missing `path` case, REST `Left(err)` and SQL `Left(err)` (`InProcessPipelineEngine.scala:522-690`).
  - The "Data file not found; the source may need to be re-uploaded" 404 mirrors `DataSourceService.previewCsv` (`:1384-1399`). That method recovers on `java.nio.file.NoSuchFileException`.
  - Any other throwable now gets the generic "Failed to read source" message, which closes the round-3 non-blocking note about `getMessage` leakage.
- **The RLS proof (task 3.3) runs on the restricted role.**
  - `TwoUserRlsApiFixture.scala:34` builds the full route tree over the non-BYPASSRLS `helio_app_test` pool.
  - The ownership check is `findByIdOwned` (app pool, user context).
  - The dataset rows are then read through `readDatasetRows`, which uses `ctx.withSystemContext` → `privilegedDb` (`DataSourceRepository.scala:920-928`, `DbContext.scala:63-64`). This is the same path a run uses, so "owner 200 with rows" is achievable on the restricted fixture and is a meaningful assertion.
- **Evaluator hand-off (D6/D7).**
  - `decodeValue`/`decodeRow` exist at `evaluator/testing/corpus.ts:37-68` with exactly D6's forms, so the planned move to `evaluator/wire.ts` is unchanged code.
  - `RootFrame {rootId, rows}` and `SourceFrames` (keyed by source id, with `complete`) are at `evaluatePipeline.ts:29-34`, which matches the planned selectors.
  - `useNow` (`hooks/useNow.ts:68`) and `formatRelativeTime` exist for the 30 s age tick.
- **D4 counts and labels.**
  - The counts derive cleanly from `SourceReadStats`.
  - The spec table matches the ticket's §4 rules:
    - A non-static source always shows the capture age.
    - Any source over 1,000 rows gets "first 1,000 of N" plus the caveat.
    - Only a static exact sample keeps "Static · N rows".
    - An unknown total reads "1,000+".
  - A URL-backed CSV over 1,000 rows yields `truncated = rows.size > 1000` with an exact count, so it gets the live prefix label. That is consistent.
- **AC → task trace.**
  - AC1 (REST/SQL/CSV/dataset, access as preview): service tests in 1.2 and the route/RLS test in 3.3.
  - AC2 (31st request is 429, run guard untouched): 3.1 and 3.2.
  - AC3 (capture once, refresh only, nothing across reload): 2.3, 2.4, 3.5, plus 3.6 with a real `page.reload()` network count.
  - AC4 (four label cases): 2.5 unit/component tests and 3.6 screenshots in both themes.
- **Driver brief.**
  - Schema plus a two-sided seam test: 1.4, 3.4, 3.4a.
  - RLS on the restricted role: 3.3.
  - No row logging and the run's credential path (`Internal` only after the owner check): D3.
  - Evaluator not wired into the UI: proposal non-goals.
  - Placement recorded in the PR body: D8.
- **Standing constraint C1** is reflected in 3.4 and 3.4a: the real writer is used, a negative case (plain-number Int cells, missing fields) must fail, and the backend asserts the committed fixture equals the serializer's output, so the client half is also fed real serializer output.
- No placeholders or TBDs. Tasks do not contradict the design.

### Verdict: CONFIRM

### Non-blocking notes

- **Spec wording.** "Each source shown on the pipeline page ... SHALL carry a label" could be read as including join/union/lookup secondaries named inside step cards. D7 says (b) captures root sources only. Reading it as "each root source (spine source card / phone source chip)" would remove the ambiguity at the final gate.
- **Labels while the sources list is loading.** Before the caller's sources list resolves, a root has no entry and is not yet known to be invisible. Render "Loading sample…" in that window, not "Sample unavailable".
- **Missing-file test.** D9's missing-file 404 has no listed test in 1.2. `GcsFileSystem.read` may not throw `NoSuchFileException`, so check the GCS not-found exception type, or accept a 502 there.
- **Oversized CSV.** A CSV over `CsvLimits` surfaces as an engine `IllegalArgumentException` → 502, while `/preview` returns 413. This is acceptable, since it is curated, but it is a difference worth knowing.
