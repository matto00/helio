## ADDED Requirements

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
system SHALL NOT remove the stored objects (the append may have committed).

#### Scenario: Append refused
- **WHEN** the form files were stored and the in-lock append is refused
- **THEN** the stored `form-uploads/` objects are removed

#### Scenario: Append future fails
- **WHEN** the form files were stored and the append future fails
- **THEN** the stored objects are not removed (the append may have committed)
