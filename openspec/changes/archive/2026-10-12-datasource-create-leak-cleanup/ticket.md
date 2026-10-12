# HEL-1494: DataSourceService create paths (csv/csvUrl/text/pdf/image) leave a row and a file behind on a post-insert failure

## Description

origin_kind: followup
origin_ticket: HEL-1475

HEL-1475 fixed post-insert failure cleanup in `SourceService.createSql`/`createRest`. Several `DataSourceService` create
paths have the same shape but were out of scope, because they are not inline-root kinds:

* `createCsv`, `createCsvUrl`, `createTextUpload`/`createTextUrl`, `createPdfUpload`/`createPdfUrl`,
  `createImageUpload`/`createImageUrl`.
* Each does `fileSystem.write`, then `dataSourceRepo.insert`, then `upsertInferredSchema`.

Two failure windows:

* **The insert fails:** the uploaded file is orphaned.
* `upsertInferredSchema` **fails:** the row (and the file) remain, and the id never reaches the caller.

`createStatic` was verified to be a single transaction and is not affected.

Fix shape: the same `transformWith`/cleanup-then-re-raise pattern HEL-1475 used in `SourceService`. Red-first through
`POST /api/data-sources`, using a fault-injected `DataSourceRepository`, counting by exact owner id.

## Acceptance Criteria

Derived from the description plus the driver's owner-approved overnight brief:

1. For every listed create path (csv upload, csv URL, text upload/URL, pdf upload/URL, image upload/URL), a failure
   after the file write (the row insert failing, or the post-insert schema write failing) leaves no `data_sources` row
   created by that request and no stored file/blob created by that request, and surfaces the ORIGINAL failure unchanged.
2. The cleanup deletes only the object path this request created (a fresh `<kind>/<new uuid>.<ext>`); it never deletes
   a pre-existing object or row. A cleanup failure is logged (ids, exception class only) and never replaces the original
   error.
3. Each path is reproduced red first (pre-fix tree) with fault injection after the insert, showing the row and the
   stored file remain; any path that does not leak is reported.
4. Proven through `POST /api/data-sources` where the route reaches the path, counting `data_sources` by exact owner id
   and checking the stored object by exact path; storage covered for the local backend and for GCS through its test
   double (mocked `Storage`).
5. Successful creates are unchanged (status, body, stored file). No API, schema or migration change.
6. Out of scope: prod orphan cleanup (HEL-1495, owner-owned); blobs left behind when rows are deleted (HEL-1434).
