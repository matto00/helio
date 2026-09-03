-- HEL-911 (design.md Decisions 1/1a, Engine contract item 5): rewrite every
-- `join`/`union`/`lookup` `pipeline_steps.config` row carrying the legacy flat
-- second-source field (`rightDataSourceId` / `otherDataSourceId` /
-- `referenceDataSourceId`) into the discriminated `secondaryInput` shape:
--
--   {"secondaryInput": {"kind": "source", "dataSourceId": "<the old id, or "" if it was empty>"}}
--
-- There is deliberately no lane-kind output here -- V97 never invents a `lane`
-- reference; every legacy row (including the two known empty-id `lookup` drafts,
-- `hel904-real-dump.sql:10163`/`:10230`, HEL-950) becomes a `source`-kind
-- secondaryInput, preserved as an incomplete draft rather than dropped, errored,
-- or upgraded to `lane` (Decision 1a's one bounded, deliberate exception: this
-- migration layer coerces a legacy flat field into `{kind:"source"}`, which the
-- runtime decoder -- strict from this commit onward -- never does again).
--
-- `pipeline_steps` carries FORCE ROW LEVEL SECURITY (V35) with an indirect-owner
-- policy reading `current_setting('app.current_user_id')` WITHOUT `missing_ok`.
-- Flyway's migration role (`helio` in prod, `helio_migration_test` in
-- `FlywayNonSuperuserMigrationSpec`) is NOT superuser and does NOT have
-- BYPASSRLS -- this exact combination (FORCE RLS + non-`missing_ok` policy +
-- non-superuser migration role) broke three consecutive production deploys
-- (v0.7.8/9/10, see V94's header, HEL-943) because local dev/CI/prod-dump replay
-- all connect as superuser and mask the failure completely. Bracketing these
-- UPDATEs with `NO FORCE` / `FORCE ROW LEVEL SECURITY` (copied verbatim from
-- V96__canonicalize_inferred_schema_type.sql, which deployed successfully in
-- v0.7.13) lets the table's OWNER (the migration role, since it created the
-- table) bypass RLS for these statements without `app.current_user_id` being
-- set at all, and restores the FORCE posture immediately after so RLS
-- enforcement is identical before and after this migration runs. A green LOCAL
-- run proves NOTHING about this bracket -- only `FlywayNonSuperuserMigrationSpec`
-- (a real non-superuser connection) does.
--
-- `pipeline_steps.config` is TEXT, not JSONB (V23) -- a `::jsonb` round-trip
-- reorders keys and normalizes whitespace, so every statement below is scoped
-- by a `WHERE ... config::jsonb ? '<legacy field>'` predicate strict enough
-- that a row NOT carrying that legacy field is never touched at all (not
-- merely "touched but restored to the same bytes" -- literally excluded from
-- the UPDATE's row set), so untouched rows are trivially byte-identical.
-- Idempotent: after a row is rewritten, its legacy field key no longer exists,
-- so `? '<legacy field>'` is false and re-running this statement is a no-op.

ALTER TABLE pipeline_steps NO FORCE ROW LEVEL SECURITY;

-- union: otherDataSourceId -> secondaryInput
UPDATE pipeline_steps
SET config = (
  (config::jsonb - 'otherDataSourceId')
  || jsonb_build_object(
       'secondaryInput',
       jsonb_build_object('kind', 'source', 'dataSourceId', COALESCE(config::jsonb ->> 'otherDataSourceId', ''))
     )
)::text
WHERE op = 'union' AND config::jsonb ? 'otherDataSourceId';

-- join: rightDataSourceId -> secondaryInput
UPDATE pipeline_steps
SET config = (
  (config::jsonb - 'rightDataSourceId')
  || jsonb_build_object(
       'secondaryInput',
       jsonb_build_object('kind', 'source', 'dataSourceId', COALESCE(config::jsonb ->> 'rightDataSourceId', ''))
     )
)::text
WHERE op = 'join' AND config::jsonb ? 'rightDataSourceId';

-- lookup: referenceDataSourceId -> secondaryInput (covers the two known
-- empty-id drafts, hel904-real-dump.sql:10163/:10230 -- preserved as
-- {"kind":"source","dataSourceId":""}, never dropped or errored).
UPDATE pipeline_steps
SET config = (
  (config::jsonb - 'referenceDataSourceId')
  || jsonb_build_object(
       'secondaryInput',
       jsonb_build_object('kind', 'source', 'dataSourceId', COALESCE(config::jsonb ->> 'referenceDataSourceId', ''))
     )
)::text
WHERE op = 'lookup' AND config::jsonb ? 'referenceDataSourceId';

ALTER TABLE pipeline_steps FORCE ROW LEVEL SECURITY;
