## Context

See proposal.md - Why. Verified on origin/main 621640292 (`.concertino/runs/HEL-1494/evidence/premise-validation.md`):

- `DataSourceService.createCsvWithinLimits` (behind `createCsv`), `createCsvUrl`, `ingestText` (behind
  `createTextUpload`/`createTextUrl`), `ingestPdf` (behind `createPdf*`) and `ingestImage` (behind `createImage*`) each
  build a fresh `sourceId = UUID.randomUUID()` and `filePath = <kind>/<sourceId>.<ext>`, then run
  `fileSystem.write(filePath, bytes)` -> `dataSourceRepo.insert(source, user)` -> `dataSourceRepo.upsertInferredSchema`
  -> `audit(...)` -> `Right(...)`. No step after the write is compensated.
- HEL-1475's precedent, `SourceService` (L71-78): `Future.unit.flatMap(_ => body).transformWith`, on `Failure(ex)` delete
  the inserted row via `dataSourceRepo.delete(id, user)`, log a cleanup failure, re-raise `ex`.
- `FileSystem.delete(path)` exists on both backends: `LocalFileSystem` (`Files.deleteIfExists`) and `GcsFileSystem`
  (`storage.delete(BlobId.of(bucket, path))`). `GcsFileSystemSpec` already drives `GcsFileSystem` over a mocked
  `Storage` (the GCS test double).
- `DataSourceService.delete` already deletes the stored file of a csv/text/pdf/image source; we do NOT use it here (its
  `findByIdOwned`/reference pre-checks are pointless for an id no caller has seen, and it emits a `data_source.delete`
  audit for a source the user never received).
- Callers: `DataSourceRoutes` (`POST /api/data-sources`, multipart upload and JSON `config.url`) and
  `FirstRunDashboardService` (`createCsv`). All inherit the fix.

## Goals / Non-Goals

**Goals:** AC1-AC5 of `ticket.md`, each path measured red first.

**Non-Goals:** prod orphan cleanup (HEL-1495); blobs left by row deletes elsewhere (HEL-1434); crash-atomicity;
`createStatic` (one transaction, verified by HEL-1475); refresh paths; any API/schema/migration change.

## Decisions

### Decision 1 -- One private compensation helper, wrapping from the file write onward

Add to `DataSourceService` a private helper, e.g.
`compensatingFileCreate[A](sourceId: DataSourceId, filePath: String, user: AuthenticatedUser, context: String)(body: => Future[A]): Future[A]`.
`body` is the existing `fileSystem.write(...).flatMap(insert ... upsertInferredSchema ... audit ... Right(...))` chain,
moved verbatim. It runs as `Future.unit.flatMap(_ => body).transformWith`:

- `Success(v)` -> `v` unchanged (a `Left` is never produced after the write today; if one ever is, it is passed through
  untouched -- only failed Futures are compensated, exactly like HEL-1475).
- `Failure(ex)` -> (1) `dataSourceRepo.delete(sourceId, user)` (owner-scoped, by the fresh id; returns `false` when the
  insert never happened -- not an error); (2) only if step 1 did not fail, `fileSystem.delete(filePath)`; then re-raise
  `ex` unchanged. Each step is wrapped (`Future.unit.flatMap`, `.recover`) so a cleanup failure is logged and never
  replaces `ex`.

Wrapping from the write (not from the insert) also covers a failed write itself (a partially-written GCS/local object at a
fresh path is removed; `LocalFileSystem` already removes its temp file). All five call sites use the same helper; no
second copy.

**Row before file, and keep the file if the row delete fails:** a row left pointing at a deleted file would surface to the
user as a broken source; a row left with its file intact is at least consistent and is what HEL-1495-style cleanup
expects. Logged either way.

**Only this request's object:** the path is `<kind>/<fresh UUIDv4>.<ext>` computed in the same call, never derived from
user input or an existing row, so the delete can only target the object this request wrote. The row delete is by the same
fresh id. No pre-existing object or row is reachable from either.

**Logging:** source id, path, context, exception class (reuse `ImplicitConnectorCleanup.describeFailure`, which yields
class + SQLSTATE and never the message). Never the bytes or a URL.

*Alternative rejected -- one transaction:* the file write is object storage, not Postgres; it cannot join the
transaction. Writing the file after a committed insert only moves the window (row without file).
*Alternative rejected -- call `DataSourceService.delete`:* pre-checks and a delete audit for a source nobody received.

### Decision 2 -- HEL-1434 seam

Keep the stored-object delete in one small private method on `DataSourceService` (e.g. `deleteStoredObject(path,
context): Future[Boolean]`, never throws, logs). HEL-1434 can lift it later; this change does not touch any delete path.

### Decision 3 -- Proof (red first, on the pre-fix tree)

New spec(s) under `backend/src/test/scala/com/helio/services/sources/` or `api/routes/sources/`, using
`VerifiedEmbeddedPostgres.start`, real repositories, a `DataSourceRepository` subclass that can fail `insert` or
`upsertInferredSchema` on demand, and a `LocalFileSystem` rooted in a fresh temp dir from the repo's `TempDirectorySupport.newTempDir` (passes
`check:test-temp-dir-hygiene`; never `~/.helio/uploads`), deleted after the spec. Counts: `data_sources WHERE owner_id = <exact test user id>`,
before and after; stored object: `exists(<kind>/...)` listing of the kind's prefix in the temp root before/after.

1. Through `POST /api/data-sources` (sealed `DataSourceRoutes`): csv upload, text upload, pdf upload, image upload, each
   with (a) schema write failing, (b) insert failing -> error status unchanged vs pre-fix, count unchanged, no new file.
2. URL variants (csv URL, text URL, pdf URL, image URL): through the route if the existing test seams admit a local stub
   (`resolveHost`/`isBlocked`, https-only for csv URL); otherwise at service level with real repositories, stating why.
3. Guard: a successful create of the same user exists first; after a failed create, its row and file are still there.
4. Cleanup failure: a `FileSystem` whose `delete` throws (and a repo whose `delete` throws) -> the ORIGINAL exception
   still surfaces.
5. GCS: `GcsFileSystem` over a mocked/fake `Storage` (precedent `GcsFileSystemSpec`) at service level -> after a failed
   create, `storage.delete(BlobId.of(bucket, <exact path>))` was issued exactly once and no other delete.
6. Success unchanged: existing `DataSourceService*`/route specs stay green.
7. Mutation: neutralize the helper's compensation -> the specs go red; recorded in `red-evidence.md`.

Every sbt run is `nice -n 19`, uses `testOnly`/`testFull` (never bare `sbt test`), and its log must show
`[hel1468-guard]`. Any path that does not leak pre-fix is reported as such.

## Risks / Trade-offs

- [Not crash-atomic: a process crash between steps still orphans] -> accepted, same as HEL-1475; HEL-1495 handles prod.
- [Row delete fails -> row and file both kept] -> logged with ids; consistent rather than half-deleted.
- [UUID path collision with an existing object] -> UUIDv4; not a realistic risk, and the object would already have been
  overwritten by the write itself before any cleanup.

## Migration Plan

None. Rollback = revert the commit.

## Planner Notes

- Self-approved: helper name/placement at the executor's discretion; row-before-file ordering; route-level vs
  service-level per URL path decided by what the existing seams allow (stated in `red-evidence.md`).
- No product call is involved (pure internal cleanup on an error path), so no OWNER REVIEW section is expected.
