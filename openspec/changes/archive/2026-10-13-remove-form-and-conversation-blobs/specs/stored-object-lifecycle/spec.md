## ADDED Requirements

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

## MODIFIED Requirements

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
