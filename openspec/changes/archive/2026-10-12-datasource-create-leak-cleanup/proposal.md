## Why

HEL-1475 made `SourceService` creates clean up after a post-insert failure. The file-backed `DataSourceService` creates
(csv, csv URL, text, pdf, image; upload and URL) still write a file, insert a row, then write the inferred schema with no
compensation: a failed insert orphans the stored file, and a failed schema write leaves both the row and the file while
the id never reaches the caller (HEL-1494).

## What Changes

- One private compensation step in `DataSourceService` wraps everything from the file write onward for each file-backed
  create: on any failure it deletes the row this request inserted (by its fresh id, owner-scoped) and the object at the
  fresh path this request wrote, then re-raises the original exception unchanged.
- Cleanup failures are logged (source id, path, exception class only) and never replace the original error.
- Red-first specs through `POST /api/data-sources` with a fault-injected `DataSourceRepository`, local storage in a temp
  root, plus a GCS test-double case.

## Capabilities

### New Capabilities

### Modified Capabilities
- `inline-source-create-atomicity`: adds a requirement that file-backed data source creation leaves no row and no stored
  file behind when it fails after the file write.

## Impact

- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` (create paths only).
- New backend specs. No API, schema, frontend or migration change. `FirstRunDashboardService` (calls `createCsv`)
  inherits the cleanup.

## Non-goals

- Deleting existing prod orphans (HEL-1495, owner).
- Blobs left behind when rows are deleted by other paths (HEL-1434).
- Making file write + insert crash-atomic (a process crash between steps can still orphan; same accepted risk as HEL-1475).
- `createStatic` (verified one transaction), refresh paths.
