## MODIFIED Requirements

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
