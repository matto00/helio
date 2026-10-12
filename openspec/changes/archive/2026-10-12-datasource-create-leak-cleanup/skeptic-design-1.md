## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed on HEAD 62164029270bcaadfc0fde2b0f43263cd1314b03 (= origin/main 621640292; the change dir is untracked, no code diff yet).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/datasource-create-leak-cleanup/HEL-1494`.

### What I verified (with evidence)

- **Premise, all five create sites** (read in `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala`):
  `createCsvWithinLimits` L267-290, `createCsvUrl` L334-356, `ingestText` L413-434, `ingestPdf` L504-524, `ingestImage`
  L584-609. Each builds `sourceId = UUID.randomUUID()`, `filePath = <kind>/<sourceId>.<ext>`, then
  `fileSystem.write` -> `dataSourceRepo.insert` -> `upsertInferredSchema` -> `audit` -> `Right`, with no compensation.
  Matches design Context and premise-validation.md.
- **No `Left` after the write**: every `Left` in those methods is returned before `fileSystem.write`, so "compensate failed
  Futures only" covers every post-write failure. Matches Decision 1.
- **Precedent**: `SourceService.cleaningUpOnFailure` (SourceService.scala ~L67-77) is `Future.unit.flatMap(_ => body).transformWith`,
  repo delete, log, `Failure(ex)`. Design reuses the shape and improves the log line (class only, not `getMessage`).
- **Seams exist**: `FileSystem.delete` (trait L10); `LocalFileSystem.delete` = `Files.deleteIfExists`; `GcsFileSystem.delete`
  = `storage.delete(BlobId.of(bucket, path))`. `DataSourceRepository` is a non-final class with `insert`/`delete`/
  `upsertInferredSchema` overridable (the HEL-1475 spec `SourceCreatePostInsertCleanupSpec` already subclasses it as
  `FaultyDataSourceRepository`). `DataSourceRepository.delete(id, user)` is owner-scoped (RLS user context) and returns
  `false` when nothing matched, as Decision 1 states. `ImplicitConnectorCleanup.describeFailure` exists (object in
  `InlineSourceCleanup.scala`, `private[services]`, reachable from `com.helio.services.sources`).
- **Route reachability (AC4)**: `DataSourceRoutes(dataSourceService, user, ...)` takes an injected service; it calls
  `createCsv`/`createTextUpload`/`createPdfUpload`/`createImageUpload` (multipart, L346-385) and all four `create*Url`
  (L260-284). `DataSourceService` exposes `resolveHost`/`isBlocked` seams; `DataSourceServiceCsvUrlSpec` already runs a
  local HTTPS server for the https-only csv URL path, so route-level coverage of every URL variant is feasible.
- **Only-this-request's-object (AC2)**: path is derived solely from a UUIDv4 generated in the same call; row delete is by
  the same id under RLS. No pre-existing object or row is reachable. Row-before-file ordering and "keep file if row
  delete fails" are stated and justified.
- **AC coverage**: AC1 -> Decision 1 + spec scenarios 1-3; AC2 -> Decision 1 "Only this request's object"/Logging + spec
  scenarios 4 and 6; AC3 -> Decision 3 + tasks 1.1/1.2; AC4 -> Decision 3 items 1, 2, 5; AC5 -> Decision 3 item 6, task
  3.3, Migration Plan "None"; AC6 -> Non-goals. Mutation proof (task 3.2), `VerifiedEmbeddedPostgres.start`,
  `[hel1468-guard]`, `nice -n 19`, `testOnly`/`testFull`, inline-FQN guard are all pinned.
- **Spec delta**: targets the existing capability `openspec/specs/inline-source-create-atomicity` (Purpose already covers
  "Calls that create a data source, directly or ..."); an ADDED requirement under a Modified capability is correct
  OpenSpec usage. Scenarios are observable (status, owner-scoped count, path existence, GCS delete call).
- **Placeholders/contradictions**: none found. No TODO/TBD; helper name left to the executor explicitly; proposal,
  design, tasks and spec agree.

### Verdict: CONFIRM

### Non-blocking notes

1. **Temp root.** Decision 3 says a temp dir "under backend/target/ (never /tmp)". The repo convention is
   `TempDirectorySupport.newTempDir` (registered teardown); `check:test-temp-dir-hygiene` flags any raw
   `Files.createTempDirectory(`/`createTempFile(` in specs, including one rooted at `backend/target`. If the executor keeps
   the `backend/target` choice, create it with `Files.createDirectories` on a UUID-named path and delete it in `afterAll`;
   otherwise just use `TempDirectorySupport`.
2. **Audit inside the wrapped body.** `audit(...)` runs inside `body`; if `auditService.record` ever threw synchronously,
   the row would be compensated after a `data_source.create` audit was already emitted. Harmless edge; consider keeping
   the audit as the last thing on the success path (it already is), and not widening it.
3. **Sibling write-then-record paths not in scope** (same shape, not verified to leak): `ImageUploadService.scala:78`,
   `PanelFormFileSubmission.scala:87`, `AssistantConversationService.scala:49`. Worth a follow-up check if not already
   ticketed; do not fold into this change.
4. `tasks.md` has an empty `## Standing Constraints` heading and `### Backend`/`### Tests` subheadings placed after
   sections they don't head. Cosmetic.
