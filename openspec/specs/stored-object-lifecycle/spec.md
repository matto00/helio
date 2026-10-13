# stored-object-lifecycle Specification

## Purpose
Stored objects (local uploads root or GCS) behind `image_uploads` rows and file-backed `data_sources` rows are removed when their row is deleted by any path, and a create that fails after writing its object removes it.

## Requirements

### Requirement: Deleting a file-backed row removes its stored object by every delete path

When an `image_uploads` row or a `data_sources` row of a file-backed kind (csv, text, pdf, image) is deleted and the
deleting transaction commits — through a service, workspace teardown, a cascade from `users`, or raw SQL — the system
SHALL record its stored-object key durably in the same transaction and SHALL remove that object from storage on a
later scheduler pass, unless a surviving row still references the same key. A rolled-back delete SHALL record
nothing.

#### Scenario: User delete cascades to uploads and sources
- **WHEN** a user owning an image upload and a CSV source is deleted with `DELETE FROM users`
- **THEN** both stored objects are removed after the next deletion pass, under both local and GCS storage

#### Scenario: Rolled-back delete
- **WHEN** a transaction deletes an image upload row and then rolls back
- **THEN** nothing is queued and the stored object remains

#### Scenario: Shared key still referenced
- **WHEN** two rows reference the same storage key and one of them is deleted
- **THEN** the object is kept until no row references it

#### Scenario: Storage delete fails
- **WHEN** removing a queued object fails
- **THEN** the key stays queued for a later pass, the attempt is counted, and the scheduler tick still completes

### Requirement: A data source's file outlives a failed row delete

`DataSourceService.delete` SHALL remove a file-backed source's stored object only after the row delete succeeded.

#### Scenario: Row delete fails
- **WHEN** the row delete of a CSV source fails
- **THEN** the row and its stored object both remain

#### Scenario: Row delete removes no row
- **WHEN** the row delete reports that it removed no row
- **THEN** the stored object is not removed

### Requirement: A failed create removes the object it wrote

When an image upload or an assistant conversation create fails after writing its stored object, the system SHALL
remove that object and return the original failure unchanged.

#### Scenario: Image upload insert fails
- **WHEN** the `image_uploads` insert fails after the object write
- **THEN** the object is removed and the original error is returned

#### Scenario: Assistant conversation create fails
- **WHEN** the conversation row create fails after the transcript object write
- **THEN** the object is removed and the original error is returned

### Requirement: A refused form submit removes the form files it stored

When a form panel submit stores uploaded files and the in-lock row append is then refused (returns a rejection, so no
row is written), the system SHALL remove the stored `form-uploads/` objects. When the append future itself fails, the
system SHALL queue the stored keys for guarded deletion no earlier than a grace window later, and SHALL remove an
object only if no committed row references its key at that time.

#### Scenario: Append refused
- **WHEN** the form files were stored and the in-lock append is refused
- **THEN** the stored `form-uploads/` objects are removed

#### Scenario: Append future fails
- **WHEN** the form files were stored, the append future fails, and no row was written
- **THEN** the stored objects are removed on a deletion pass after the grace window

#### Scenario: Append future fails after the row committed
- **WHEN** the form files were stored, the row was committed, and the future then fails
- **THEN** the stored objects are kept

#### Scenario: One of several file writes fails
- **WHEN** a submit with several files writes some of them and one write fails
- **THEN** the files already written are removed and the submit fails

### Requirement: Form-upload and conversation objects are removed with their rows by every delete path

When a committed transaction deletes a `dataset_rows` row, or updates one so that a `form-uploads/` binary-ref it held
is no longer present, the system SHALL record each removed `form-uploads/` storage key in the same transaction. When a
committed transaction deletes an `assistant_conversations` row, the system SHALL record its transcript key in the same
transaction. Both SHALL be removed from storage on a later scheduler pass, subject to the shared-key guard. Only keys
of the exact form `form-uploads/<uuid>.<ext>` SHALL be extracted from dataset row JSON. Recording SHALL never cause the
deleting or updating statement to fail, whatever the row JSON contains.

#### Scenario: Dataset row deleted
- **WHEN** a dataset row holding a form-upload binary-ref is deleted and the transaction commits
- **THEN** the object is removed after the next deletion pass

#### Scenario: Dataset source deleted through the users cascade
- **WHEN** a user owning a dataset source with form-upload rows is deleted with `DELETE FROM users`
- **THEN** every form-upload object of those rows is removed after the next deletion pass

#### Scenario: Row update removes a file value
- **WHEN** a dataset row update replaces or clears a form-upload binary-ref
- **THEN** the replaced object is removed after the next pass and an object still present in the row is kept

#### Scenario: Key outside the form-upload family in row JSON
- **WHEN** a deleted dataset row's JSON names a `storageKey` that is not `form-uploads/<uuid>.<ext>`
- **THEN** nothing is recorded for it

#### Scenario: Malformed row JSON
- **WHEN** a dataset row whose JSON has no binary-refs, a non-string `storageKey`, or arbitrary nesting is deleted
- **THEN** the delete succeeds

#### Scenario: Conversation deleted
- **WHEN** an assistant conversation row is deleted by any path and the transaction commits
- **THEN** its transcript object is removed after the next deletion pass

### Requirement: TRUNCATE records the stored objects of truncated rows

When a table whose rows own stored objects (`image_uploads`, `data_sources`, `dataset_rows`,
`assistant_conversations`) is truncated, directly or by `TRUNCATE ... CASCADE`, the system SHALL record the keys of
all its rows in the same transaction.

#### Scenario: Truncate cascade
- **WHEN** `TRUNCATE users CASCADE` removes upload, source, dataset row and conversation rows and commits
- **THEN** all their keys are queued, and nothing is queued if the transaction rolls back

### Requirement: The shared-key guard covers derived copies without leaking them

Before removing a queued object the system SHALL check every table that can hold its key: `image_uploads`,
file-backed `data_sources`, `dataset_rows`, `assistant_conversations`, `binary_refs`, `node_snapshots`,
`node_payload_history` and `alert_events`. A key still held by an `image_uploads`, `data_sources`, `dataset_rows` or
`assistant_conversations` row SHALL be dequeued without removal. A `dataset_rows` row counts as holding a key in this authoritative sense only
when its delete would record that key. Any other hit, including in `alert_events`, counts as derived. A key held only
by derived copies SHALL stay queued and be re-checked on a later pass, and SHALL be removed once no table holds it.

#### Scenario: Image key still in a node snapshot
- **WHEN** an image source is deleted while a pipeline node snapshot still holds a binary-ref to its key
- **THEN** the object is kept, and it is removed on a pass after the snapshot no longer holds the key

#### Scenario: Non-form key copied into a dataset row
- **WHEN** an image or transcript key also appears in a dataset row (as a binary-ref or a bare string) and its owning row is deleted
- **THEN** the object is kept while the dataset row holds the key, and removed on a pass after that row is deleted

#### Scenario: Form key copied into another dataset row
- **WHEN** one of two dataset rows holding the same form-upload key is deleted
- **THEN** the object is kept until the other row is deleted too

### Requirement: A row stuck at the attempt cap is re-armed after a cool-down
A queued stored-object deletion whose failed-attempt count has reached the drain's attempt cap SHALL NOT be claimed
until 24 hours have passed since its last attempt. After that, a deletion pass SHALL re-arm it: its attempt count is
reset and it is retried under the normal backoff, for both legacy (V128) and new-style (V132) queue rows. A re-armed
row SHALL go through the same reference check as any other claimed row, so it is deleted only if nothing still
references its key. A row that keeps failing SHALL reach the cap again and wait another 24 hours. A row at the cap
with no recorded last attempt SHALL NOT be re-armed. Re-arming SHALL NOT delete a queue row or a stored object by
itself.

#### Scenario: Stuck row inside the cool-down stays stuck
- **WHEN** a row reached the attempt cap 23 hours 59 minutes ago
- **THEN** a deletion pass neither claims nor re-arms it, and it still counts as stuck

#### Scenario: Stuck row is retried after the cool-down
- **WHEN** a row reached the attempt cap 24 hours 1 minute ago and storage deletes now succeed
- **THEN** a deletion pass re-arms it, the object is removed and the row leaves the queue

#### Scenario: Re-armed row still honours references
- **WHEN** a stuck row is re-armed while a surviving row still references its key
- **THEN** the object is kept

#### Scenario: Capped row without a recorded attempt
- **WHEN** a row is at the attempt cap with no recorded last attempt
- **THEN** a deletion pass does not re-arm it and it still counts as stuck

#### Scenario: Persistent failure reaches the cap again
- **WHEN** a re-armed row keeps failing
- **THEN** it reaches the attempt cap again and is not claimed for another 24 hours
