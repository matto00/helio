## Why

HEL-1434 (V128) removes the stored object behind a deleted `image_uploads` / file-backed `data_sources` row. Two other
blob families still leak (`form-uploads/` objects referenced from `dataset_rows`, and `assistant-conversations/`
transcripts), the drain's shared-key guard ignores copies of a key in derived tables, `TRUNCATE` bypasses the row
triggers, and a form submit whose append future fails keeps its files forever. See ticket.md.

## What Changes

- New migration V132: delete/update triggers on `dataset_rows` (form-upload keys extracted from the row JSON) and a
  delete trigger on `assistant_conversations` (`gcs_body_ref`), all feeding the existing `stored_object_deletions`
  queue, with V128's exact security shape (SECURITY DEFINER, pinned `search_path`, `row_security = off`, owned by
  `helio_privileged`, ENABLE ALWAYS).
- V132: statement-level `BEFORE TRUNCATE` triggers on every table whose rows own stored objects.
- V132: a `not_before` column on the queue so an entry can be held back (deferral, grace window).
- The drain's shared-key guard also checks `dataset_rows`, `assistant_conversations`, `binary_refs`,
  `node_snapshots` and `node_payload_history`. A key still held by an authoritative row is dequeued (that row's own
  delete re-queues it); a key held only by a derived copy is deferred and re-checked later instead of dropped.
- A form submit whose append future fails queues its stored keys behind a grace window; the drain deletes them only if
  no committed row references them.
- Starting from deployment, prod deletes these objects. Historic orphans are untouched.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `stored-object-lifecycle`: form-upload and conversation keys join the queue, TRUNCATE is covered, the shared-key
  guard covers derived copies, and a failed form-append future is compensated through the guarded queue.

## Impact

`backend/src/main/resources/db/migration/V132__*.sql`, `StoredObjectDeletionRepository`,
`StoredObjectDeletionService`, `PanelFormFileSubmission` (and its wiring), `FormSubmitRoutesSpec`, new migration and
drain specs. No API or frontend change. Prod behaviour change: objects are deleted after their rows are deleted.

## Non-goals

- Cleaning historic orphans already in storage (owner ticket HEL-1529).
- A user-facing conversation delete route or account deletion (HEL-1301).
- Changing what reads a binary-ref, or authorization of blob reads.
