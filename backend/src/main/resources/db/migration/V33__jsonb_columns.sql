-- HEL-132 — Migrate TEXT JSON columns to JSONB
--
-- All seven JSON columns across four tables are cast to JSONB in a single
-- migration. The USING clause routes each stored TEXT value through
-- PostgreSQL's JSON parser, so any malformed row causes the migration to
-- fail fast rather than silently corrupting data.
--
-- Pre-flight check (run against prod snapshot before deploying):
--   SELECT table_name, column_name, COUNT(*)
--     FROM (
--       SELECT 'dashboards' AS table_name, 'appearance' AS column_name FROM dashboards WHERE appearance IS NOT NULL AND NOT (appearance::text ~ '^[\[{"]')
--       UNION ALL SELECT 'dashboards', 'layout' FROM dashboards WHERE layout IS NOT NULL AND NOT (layout::text ~ '^[\[{"]')
--       UNION ALL SELECT 'panels', 'appearance' FROM panels WHERE appearance IS NOT NULL AND NOT (appearance::text ~ '^[\[{"]')
--       UNION ALL SELECT 'panels', 'field_mapping' FROM panels WHERE field_mapping IS NOT NULL AND NOT (field_mapping::text ~ '^[\[{"]')
--       UNION ALL SELECT 'data_sources', 'config' FROM data_sources WHERE config IS NOT NULL AND NOT (config::text ~ '^[\[{"]')
--       UNION ALL SELECT 'data_types', 'fields' FROM data_types WHERE fields IS NOT NULL AND NOT (fields::text ~ '^[\[{"]')
--       UNION ALL SELECT 'data_types', 'computed_fields' FROM data_types WHERE computed_fields IS NOT NULL AND NOT (computed_fields::text ~ '^[\[{"]')
--     ) bad_rows
--     GROUP BY 1, 2;
-- Expected result: zero rows.
--
-- Rollback: a V34 migration that casts each column back to TEXT is the
-- recovery path if a hotfix is required after production deployment.

ALTER TABLE dashboards
  ALTER COLUMN appearance    TYPE JSONB USING appearance::jsonb,
  ALTER COLUMN layout        TYPE JSONB USING layout::jsonb;

ALTER TABLE panels
  ALTER COLUMN appearance    TYPE JSONB USING appearance::jsonb,
  ALTER COLUMN field_mapping TYPE JSONB USING field_mapping::jsonb;

ALTER TABLE data_sources
  ALTER COLUMN config        TYPE JSONB USING config::jsonb;

-- computed_fields was added in V12 with DEFAULT '[]' (TEXT). PostgreSQL cannot
-- automatically cast a TEXT default to JSONB, so we drop and reset it explicitly.
ALTER TABLE data_types
  ALTER COLUMN fields                     TYPE JSONB USING fields::jsonb,
  ALTER COLUMN computed_fields DROP DEFAULT,
  ALTER COLUMN computed_fields            TYPE JSONB USING computed_fields::jsonb,
  ALTER COLUMN computed_fields SET DEFAULT '[]'::jsonb;
