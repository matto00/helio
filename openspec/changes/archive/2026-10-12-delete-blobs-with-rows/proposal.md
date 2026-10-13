## Why

Deleting a user (`DELETE FROM users`, V119's `ON DELETE CASCADE`) or running V119's orphan cleanup removes `image_uploads` and file-backed `data_sources` rows inside Postgres, where the application never sees them, so their stored objects (local `HELIO_UPLOADS_ROOT` / GCS bucket) are never removed. Image uploads have no app delete path at all, so the cascade is the only way they ever disappear, and every such delete leaks. Two create paths (image upload, assistant conversation) also write the object before the row and leave the object behind if the row insert fails.

## What Changes

- New migration (V128): a `stored_object_deletions` queue table plus `AFTER DELETE` row triggers on `data_sources` (csv/text/pdf/image kinds, keyed on `config.path`) and `image_uploads` (`storage_key`). Every committed row delete, from any path (service, teardown, cascade, raw SQL), enqueues its object key; a rolled-back delete enqueues nothing.
- A drain pass on the existing `PipelineSchedulerService` tick deletes each queued object through `FileSystem.delete` and then removes the queue row, skipping (and dequeuing) a key still referenced by a surviving row. Bounded per pass, never fails the tick, idempotent on a missing object.
- `DataSourceService.delete` removes the file only AFTER the row delete succeeded (through `deleteStoredObject`), so a refused/failed row delete no longer leaves a source pointing at a deleted file.
- `ImageUploadService.upload` and `AssistantConversationService.create` remove the just-written object when the row insert fails (same compensation shape as HEL-1494).
- A read-only orphan-object measurement procedure (dev measured; prod queries/steps provided for the owner). No historic orphan is deleted by this change.
- `docs/user-reference-inventory.md`'s "not cleaned up" note is updated (V119 itself is never edited: an applied migration's checksum must not change).

## Capabilities

### New Capabilities
- `stored-object-lifecycle`: when an `image_uploads` row or a file-backed `data_sources` row is deleted by any path, its stored object is removed; a create that fails after writing its object removes it.

### Modified Capabilities

## Impact

- Backend: new Flyway migration V128; new repository + service for the deletion queue; `PipelineSchedulerService` wiring in `Main.scala`; `DataSourceService.delete` ordering; `ImageUploadService`; `AssistantConversationService`.
- Operations: once deployed, objects of rows deleted in prod (e.g. an owner's manual user delete) are removed automatically on the next tick. Historic orphans (pre-existing, V119) are untouched and only measured.
- No API or schema-file (`schemas/`) change.
