# HEL-1530: form-uploads and assistant-conversation blobs are not removed when their rows are deleted

## Description

origin_kind: followup, origin_ticket: HEL-1434.

HEL-1434 covers stored objects behind `image_uploads` rows and file-backed `data_sources` rows. Two other blob
families are out of its scope and still leak:

1. `form-uploads/<uuid>.<ext>` objects written by `PanelFormFileSubmission` are referenced only from `dataset_rows`
   binary-ref JSON (and `binary_refs`). Deleting a dataset row, replacing rows, or deleting the dataset source
   (including through the users cascade) leaves these objects behind. Separately, HEL-1434 deliberately does NOT
   compensate a *failed* in-lock append future, because the append may have committed, so a genuinely rolled-back
   failed append also leaves its objects behind. That gap is pinned by a test in `FormSubmitRoutesSpec`.
2. `assistant-conversations/` transcript blobs (`AssistantConversationService`) are not removed when a conversation is
   deleted, if a delete path exists, or when its owner is deleted. HEL-1434 only added create-failure compensation.

Dev measurement found 48 `assistant-conversations/` and 5 `form-uploads/` objects. Neither was classified.

A possible approach: extend HEL-1434's `stored_object_deletions` queue (V128) with triggers for these tables. For
dataset rows, extracting keys from JSON needs care, as does the shared-key guard.

Also related, and known gaps documented in HEL-1434's design.md:

- Image-source keys copied into `binary_refs`, node snapshots or history payloads are not checked by the drain's
  shared-key guard.
- `TRUNCATE` fires no row triggers.

## Acceptance Criteria (derived from the ticket and the driver brief)

1. Deleting (or updating away) a `dataset_rows` row that holds a `form-uploads/` binary-ref — by row delete, row
   replace, dataset source delete, or the `users` cascade — queues the key in the same transaction, and the drain
   removes the object unless something still references it.
2. Deleting an `assistant_conversations` row by any path queues its transcript key; the drain removes it.
3. The drain's shared-key guard also checks `dataset_rows`, `assistant_conversations`, `binary_refs`,
   `node_snapshots` and `node_payload_history`, so an image-source (or form-upload) key still copied into a derived
   table is not deleted while the copy exists, and is not leaked once the copy goes away.
4. `TRUNCATE` of a table whose rows own stored objects queues their keys.
5. A form-file submit whose in-lock append future FAILS gets its stored objects removed when (and only when) no
   committed row references them; the HEL-1434 pinned test is updated accordingly.
6. Every new trigger follows V128 exactly: SECURITY DEFINER, pinned `search_path`, `row_security = off`, owned by
   `helio_privileged`, ENABLE ALWAYS; proven not to abort the user's own delete under a NOSUPERUSER NOBYPASSRLS
   owner role. Migration number V132 (V131 is reserved by parked PR #994).
7. Historic orphans are not touched (owner's HEL-1529). The PR carries an OWNER REVIEW section stating what gets
   deleted and from when, that historic orphans are untouched, and the read-only prod queries to run before release.
   The PR is parked unmerged.
