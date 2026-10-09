## Why

`data_sources.owner_id` and `image_uploads.owner_id` have no foreign key to `users`, so deleting a user silently
orphans their rows (dev: 57 orphaned data sources across 50 deleted users, plus 2 NULL-owner rows). Orphans are
invisible to every user under RLS, block nothing, and will be the default outcome of any account deletion (HEL-1301).

## What Changes

- New migration **V119** (V117/V118 are taken), owner-ruled 2026-10-09 (escalation HEL-1347, chat):
  - Deletes `data_sources` rows whose owner no longer exists **and** rows with NULL `owner_id` (cascading their
    `dataset_rows`), logging the count. **Approved prod data deletion** (owner checks prod count before release).
  - Fails loudly, before deleting anything, if any such row is still a `pipeline_roots` root.
  - Deletes `image_uploads` rows whose owner no longer exists, logging the count.
  - Adds `data_sources.owner_id → users(id) ON DELETE CASCADE` and makes `owner_id` `NOT NULL`.
  - Adds `image_uploads.owner_id → users(id) ON DELETE CASCADE`.
  - Safe as prod's non-BYPASSRLS, table-owning `helio` Flyway role (NO FORCE … FORCE bracket, V117 precedent).
- Documents the full user-reference inventory (every user-referencing column and its `ON DELETE` behaviour), including
  `audit_events` actor columns as intended, permanent residue for deleted (test) users.

## Capabilities

### New Capabilities
- `user-reference-integrity`: FK/`ON DELETE` guarantees for user-owned rows, the V119 orphan cleanup, and the
  documented user-reference inventory (incl. append-only audit residue).

### Modified Capabilities
<!-- none -->

## Impact

- `backend/src/main/resources/db/migration/V119__*.sql` (new), a new migration spec under
  `backend/src/test/scala/com/helio/infrastructure/persistence/`, `docs/user-reference-inventory.md` (new).
- Backend test fixtures that insert `data_sources`/`image_uploads` rows for non-existent users or without an owner must
  seed a real `users` row (the constraint is new; the fixtures are what is wrong, not the constraint).
- Shared dev DB: applying V119 deletes the dev orphans by the migration's exact predicate.

## Non-goals

- Making user deletion possible: pipelines/outputs/dashboards/panels FKs stay `NO ACTION`; no account-deletion path.
- Storage blobs (GCS/local files) behind deleted image uploads or CSV sources are not cleaned up.
- FKs for `audit_events.actor_*` or the TEXT `dashboards.created_by` / `panels.created_by` provenance columns.
- Changing the Slick `ownerId: Option[UUID]` column mapping.
