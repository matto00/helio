# HEL-1434: Storage blobs are left behind when image_uploads / CSV data_sources rows are deleted (incl. V119 CASCADE and cleanup)

## Description

Origin: HEL-1347 (matto00/helio#879), lane-reported. Deleting an `image_uploads` row or a CSV-backed `data_sources` row (directly, via V119's orphan cleanup, or via the new ON DELETE CASCADE from `users`) removes the DB row but not the stored blob (local `HELIO_UPLOADS_ROOT` / GCS `HELIO_UPLOADS_BUCKET`).

## Acceptance Criteria

1. Inventory every delete path for these rows and what happens to the blob.
2. Decide between deleting the blob in the delete path and a periodic orphan-blob sweep (it must be safe against in-flight uploads), then implement one.
3. Measure current dev/prod orphan blobs read-only first. Any prod deletion needs owner approval.

## Driver context (latest comment, from HEL-1494 #975; claims verified in premise-validation.md)

- `DataSourceService.delete` already removes the stored file for csv/text/pdf/image sources; the target is the other delete paths (V119 `ON DELETE CASCADE` from users, image_uploads deletion, workspace teardown).
- The private `deleteStoredObject` in `DataSourceService` is the seam to reuse.
- Probe the write-file-then-record candidates `ImageUploadService.scala:78`, `PanelFormFileSubmission.scala:87`, `AssistantConversationService.scala:49`; fix here only if the same small pattern, otherwise list as follow-ups.
- Reproduce each delete path red first, under both local and GCS storage (GCS via its test double).
- Migrations: next free number V127 (re-check before committing).

## Premise findings (Setup step 2)

- There is no image-upload delete endpoint and no app-level user delete: image_uploads rows die only by the users cascade, V119, or raw SQL; users are deleted only by raw SQL (e2e cleanup, manual ops).
- Workspace teardown ALREADY removes the files of deleted csv/text/pdf/image sources (post-commit). Driver claim that teardown leaks is stale.
- `DataSourceService.delete` removes the file BEFORE the row; a failing row delete leaves a source pointing at a deleted file.
