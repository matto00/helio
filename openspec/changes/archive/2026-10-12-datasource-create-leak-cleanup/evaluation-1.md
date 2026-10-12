## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `58d8afc3e8648e812ea101d5d0c66df73d17ef0c`. Diff base resolved live by `resolve-review-base.sh`: `62164029270bcaadfc0fde2b0f43263cd1314b03`.

### Phase 1: Spec Review — PASS
- AC1: all five chains (`createCsvWithinLimits`, `createCsvUrl`, `ingestText`, `ingestPdf`, `ingestImage`, which cover all 8 create paths) are wrapped in `compensatingFileCreate`. The wrapper starts at `fileSystem.write`. On a failed Future it deletes the row (by the fresh id, owner-scoped), then the file, then re-raises the original `ex` (`DataSourceService.scala:89-111`).
- AC2: the cleanup targets only the fresh `sourceId` and the fresh `<kind>/<uuid>.<ext>` path. A cleanup failure is logged with the id or path plus `describeFailure` (class and SQLSTATE only) and never replaces `ex`. Guard: in each route case, the earlier successful create's row and file survive. The proof of the file-delete-failure half is vacuous (see Phase 2 / CR1).
- AC3/AC4: I checked the red evidence. Its counts by exact owner id and its leaked paths are consistent with what my own mutation run reproduced. All 8 paths are driven through the route (sealed `DataSourceRoutes`). GCS is covered by a mocked `Storage`, which asserts exactly one `delete(BlobId("test-bucket", <created name>))`.
- AC5: no API, schema or migration change. Success paths are moved verbatim (the diff only wraps them). The existing specs are green.
- Tasks: all ticked, and they match the diff. `files-modified.md` has the right format: bulleted, backticked repo-relative paths, no braces.
- CONSTRAINTS C1 is honored: both temp dirs come from `TempDirectorySupport.newTempDir`, and `check:test-temp-dir-hygiene` reports clean.
- Commit: has the `HEL-1494` prefix, no claude.ai session link and no `Claude-Session` trailer.

### Phase 2: Code Review — FAIL
Gates (my own fresh runs, `nice -n 19`):
- Affected specs: `testOnly DataSourceCreateFailureCleanupSpec *DataSourceService* *DataSourceRoutes* *UploadRoutes* *CsvUploadLimits* *GcsFileSystemSpec *SourceCreatePostInsertCleanupSpec *DataSourceDelete* *FirstRun*`. Result: `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Tests: succeeded 339, failed 0` across 16 suites. Log: `.concertino/runs/HEL-1494/logs/eval-1-affected-run.log`.
  - Note: the executor's `affected-run.log` (338 tests) did not include `DataSourceDeleteAutoConnectorRoutesSpec`, even though `red-evidence.md` claims `DataSourceDelete*` was run. My run included it, and it is green.
- `npm run check:scala-quality`: exit 0. No inline FQNs in the diff. The only file-size warnings are informational: `DataSourceService.scala` is 1475 lines (it was 1434 before this change) and the new spec is 275.
- `npm run check:test-temp-dir-hygiene`: clean.
- The new spec uses `VerifiedEmbeddedPostgres.start` (spec L96).

Mutation runs. Each ran in a throwaway detached worktree at 58d8afc, removed afterwards; the delivery tree was not touched.
- M1, file-delete step removed (`if (rowStepOk) deleteStoredObject(...) else Future.unit` became `Future.unit`): `failed=17`, which is the 16 route cases plus GCS. The spec does catch a missing file cleanup. Log: `eval-1-mutation-run.log`.
- M2, row-step outcome ignored (the file is always deleted): `failed=1`, the guard "keep the file when the row delete throws" (spec L239). That guard does real work. Log: `eval-1-mutation2-run.log`.
- Under M1 the guard "surface the original insert failure when the file delete throws" stayed green, even though no file delete was ever issued. It also passes on the pre-fix tree, as `red-evidence.md` itself records.

Issues:
1. Vacuous guard, unused test state. In `DataSourceCreateFailureCleanupSpec.scala:243-252`, the test "surface the original insert failure when the file delete throws" never shows that the file delete was reached:
   - `FlakyFileSystem.deleted` (L72, filled at L78) is recorded but never read anywhere in the spec, so it is dead test state.
   - The test is green on the pre-fix tree and under M1, where no delete is attempted at all.
   - As written it proves only that an insert failure surfaces, not AC2's "a cleanup failure never replaces the original error" for the file-delete step.

Otherwise:
- The helper mirrors HEL-1475's `transformWith` pattern.
- Synchronous throws are captured by `Future.unit.flatMap`.
- Logging never includes bytes or URLs.
- Delete ordering (row before file, keep the file if the row delete fails) follows design Decision 1.

### Phase 3: UI Review — N/A
Backend-only diff (`backend/src/**` and `openspec/changes/**`). No Phase 3 trigger path changed.

### Overall: FAIL

### Change Requests
1. In `backend/src/test/scala/com/helio/services/sources/DataSourceCreateFailureCleanupSpec.scala`, test "surface the original insert failure when the file delete throws" (L243-252):
   - Clear `fs.deleted` before the request, or snapshot its size.
   - After `intercept`, assert that exactly one new entry was recorded, that it starts with `text/`, and that it is a path the request wrote. For example, compare against `files("text")` taken before the request, or assert `fs.deleted.last` does not appear in that earlier snapshot.
   - Then the guard proves the throwing file delete was actually reached and the original `"boom: insert"` still surfaced.
   - Done right, this test goes red under mutation M1 (file-delete step removed) and `deleted` stops being dead state.
   - Record the before/after in `red-evidence.md`. Optionally, also count `FaultyDataSourceRepository.delete` attempts and assert one in the row-delete-throws guard (L231-241), so it is shown to reach the throwing delete rather than only passing through ordering.

### Non-blocking Suggestions
- `red-evidence.md` "Existing affected specs" lists `DataSourceDelete*`, but the executor's `affected-run.log` did not run `DataSourceDeleteAutoConnectorRoutesSpec`. Correct the text, or cite this run (339 tests).
- `DataSourceService.scala` is now 1475 lines. CONTRIBUTING.md asks for a split proposal in the PR description once a file passes about 400 lines. Mention it in the PR body (the HEL-1434 seam is a natural extraction point).
- The wrapped chains in `DataSourceService.scala` (e.g. L308-324) were not re-indented inside the new block, so `}` braces stack at one level. This is acceptable as "moved verbatim", but re-indenting would make it easier to read.
- Spec L231 wraps the fault toggles in `repo.synchronized` while L245 does not. Pick one style (the suite runs its tests sequentially, so neither is needed).
- If `beforeAll` fails partway, `afterAll` dereferences `httpBinding` while it is still null. Guard with `Option(httpBinding).foreach(...)`.
