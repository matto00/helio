# user-reference-integrity Specification

## Purpose
Guarantees that rows owned by a user cannot outlive that user silently: every user-owned table either cascades or
blocks on user deletion, existing orphans are removed once, and intended exceptions (append-only audit) are documented.

## Requirements

### Requirement: Data sources are bound to an existing owner

`data_sources.owner_id` SHALL be `NOT NULL` and SHALL reference `users(id)` with `ON DELETE CASCADE`. Deleting a user
SHALL delete that user's data sources, and through the existing cascades their `dataset_rows` and `pipeline_roots`.
Any existing guard that rejects the resulting state (the V99 zero-root-pipeline trigger, or a `NO ACTION` FK such as
`pipelines.owner_id`) SHALL still reject the user delete as a whole, leaving no partial deletion.

#### Scenario: Inserting a data source for a non-existent user is rejected
- **WHEN** a `data_sources` row is inserted whose `owner_id` matches no `users.id`
- **THEN** the insert fails with a foreign-key violation

#### Scenario: Inserting a data source with no owner is rejected
- **WHEN** a `data_sources` row is inserted with a NULL `owner_id`
- **THEN** the insert fails with a not-null violation

#### Scenario: Deleting a user who owns only data sources removes them
- **WHEN** a user who owns data sources (with dataset rows) but no pipelines, outputs, dashboards or panels is deleted
- **THEN** the user, their data sources and those sources' dataset rows are all deleted

#### Scenario: Deleting a user who still owns a pipeline is rejected without partial deletion
- **WHEN** a user who owns a pipeline rooted on their own data source is deleted
- **THEN** the delete fails and the user, the data source and the pipeline root all still exist

#### Scenario: Cascading into another user's pipeline's last root is rejected
- **WHEN** a user is deleted whose data source is the only root of a pipeline owned by a different user
- **THEN** the delete fails (zero-root guard or step-chain FK) and nothing is deleted

### Requirement: Image uploads are bound to an existing owner

`image_uploads.owner_id` SHALL reference `users(id)` with `ON DELETE CASCADE` (the column is already `NOT NULL`).

#### Scenario: Inserting an image upload for a non-existent user is rejected
- **WHEN** an `image_uploads` row is inserted whose `owner_id` matches no `users.id`
- **THEN** the insert fails with a foreign-key violation

#### Scenario: Deleting a user removes their image uploads
- **WHEN** a user who owns image uploads is deleted (and nothing else blocks the delete)
- **THEN** their `image_uploads` rows are deleted

### Requirement: The V119 migration removes existing orphans once, safely under production RLS

V119 SHALL delete every `data_sources` row whose `owner_id` is NULL or matches no user (cascading its `dataset_rows`),
and every `image_uploads` row whose `owner_id` matches no user, emitting the deleted counts, before adding the
constraints. It SHALL abort with a descriptive error, before deleting anything, if any data source it would delete is
still referenced: as a `pipeline_roots` root, by a join/lookup/union step's source `secondaryInput`, by an `upsertsource`
step's existing-source target, or by a form panel's `dataSourceId`. Each of these six reference kinds SHALL abort the
migration on its own, with no other reference to the orphan present. It SHALL leave rows owned by existing users
untouched, and SHALL apply when run by a non-superuser, non-BYPASSRLS table-owning role, leaving FORCE ROW LEVEL
SECURITY re-enabled on every table it relaxed.

#### Scenario: Orphans are removed and owned rows survive under the production role shape
- **WHEN** V119 runs as a NOSUPERUSER NOBYPASSRLS table owner over data containing orphaned, NULL-owner and owned rows
- **THEN** exactly the orphaned and NULL-owner data sources (and their dataset rows) and the orphaned image uploads are
  gone, every owned row remains, both constraints exist, and FORCE ROW LEVEL SECURITY is on again for every table the
  migration relaxed it on

#### Scenario: An orphan that is one of a pipeline's two roots aborts the migration intact
- **WHEN** V119 runs while an orphaned data source is one root of a pipeline whose other root belongs to a live user
- **THEN** the migration fails with an error naming the condition and no row has been deleted

#### Scenario: An orphan referenced by a pipeline step or form panel aborts the migration intact
- **WHEN** V119 runs while an orphaned data source is a step's source input, an upsert target, or a form panel's source
- **THEN** the migration fails with an error naming the condition and no row has been deleted

#### Scenario: An orphan that is a join step's source input aborts the migration intact
- **WHEN** V119 runs while an orphaned data source is referenced only as a `join` step's source `secondaryInput`
- **THEN** the migration fails with an error naming the step condition and no row has been deleted

#### Scenario: An orphan that is a lookup step's source input aborts the migration intact
- **WHEN** V119 runs while an orphaned data source is referenced only as a `lookup` step's source `secondaryInput`
- **THEN** the migration fails with an error naming the step condition and no row has been deleted

#### Scenario: An orphan that is a union step's source input aborts the migration intact
- **WHEN** V119 runs while an orphaned data source is referenced only as a `union` step's source `secondaryInput`
- **THEN** the migration fails with an error naming the step condition and no row has been deleted

#### Scenario: An orphan that is an upsertsource step's existing-source target aborts the migration intact
- **WHEN** V119 runs while an orphaned data source is referenced only as an `upsertsource` step's existing-source target
- **THEN** the migration fails with an error naming the step condition and no row has been deleted

#### Scenario: An orphan that is a form panel's source aborts the migration intact
- **WHEN** V119 runs while an orphaned data source is referenced only as a form panel's `dataSourceId`
- **THEN** the migration fails with an error naming the form-panel condition and no row has been deleted

#### Scenario: A reference to a live source does not abort the migration
- **WHEN** V119 runs while join, lookup and union steps and a form panel reference only live (owned) data sources
- **THEN** the migration applies and the live sources remain

#### Scenario: A clean database migrates as a no-op cleanup
- **WHEN** V119 runs with no orphans present
- **THEN** it deletes nothing and adds both constraints

### Requirement: User references are inventoried and audit residue is documented

The repository SHALL contain a document listing every column that references a user, with its FK and `ON DELETE`
behaviour, and SHALL state that `audit_events` rows for deleted users are permanent by design (append-only trigger),
so test users leave audit residue that cannot be removed.

#### Scenario: The inventory matches the live schema
- **WHEN** the documented inventory is compared with the FKs referencing `users` in a freshly migrated database
- **THEN** every FK-bearing user reference appears with its documented `ON DELETE` behaviour

### Requirement: Pipeline-run rate-window rows are removed with their user

`pipeline_run_rate_window.user_id` SHALL reference `users(id)` with `ON DELETE CASCADE`. A rate-window row is
per-user rate-limit bookkeeping, not user content, so it SHALL never block deleting its user: deleting a user SHALL
delete that user's rate-window rows. Every other blocking reference (for example a `NO ACTION` FK on `pipelines`)
SHALL still reject the user delete as a whole. The user-reference inventory SHALL list the column as `CASCADE`.

#### Scenario: Deleting a user whose only reference is a rate-window row succeeds
- **WHEN** a user whose only referencing rows are in `pipeline_run_rate_window` is deleted
- **THEN** the delete succeeds and none of that user's rate-window rows remain

#### Scenario: Another user's rate-window rows are untouched
- **WHEN** a user with rate-window rows is deleted while a second user also has rate-window rows
- **THEN** every rate-window row of the second user still exists

#### Scenario: A remaining blocking reference still rejects the delete
- **WHEN** a user who has a rate-window row and also owns a dashboard is deleted
- **THEN** the delete fails and the user and the rate-window row both still exist

#### Scenario: Rate-window rows still require an existing user
- **WHEN** a `pipeline_run_rate_window` row is inserted whose `user_id` matches no `users.id`
- **THEN** the insert fails with a foreign-key violation
