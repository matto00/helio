-- HEL-932: backfill non-canonical "number" column types inside
-- `data_sources.inferred_schema`.
--
-- HEL-906 closed the WRITE path: every route-reachable, caller-supplied
-- column-`type` string now goes through `DataFieldType.canonicalizeLegacy` /
-- `validateAndCanonicalize` before a `SchemaField` is constructed (see
-- `DataSourceService`, `PipelineAnalyzeService`, `PipelineService`,
-- `SchemaInferenceFacade`), which maps the legacy synonym `"number"` (and
-- `"double"`) to the canonical wire value `"float"`. This migration corrects
-- the historical residue that predates that closure: rows whose
-- `inferred_schema` JSONB array still carries a field object shaped
-- `{"name": ..., "type": "number"}` from before HEL-906 shipped.
--
-- `inferred_schema` is JSONB, so this rewrites element positions with
-- `jsonb_set`/`jsonb_agg` rather than a string `replace()` -- a naive text
-- replace could corrupt a field literally NAMED "number" (see the fixture
-- in `SchemaFieldNumberFieldNameSpec`/this migration's own gate) or a data
-- value that happens to contain the substring "number". Only the `type` key
-- of each element is ever touched, and only when its value is exactly the
-- string "number" -- every other key (including a field's own `name`) is
-- passed through unchanged via `jsonb_set`, and elements that don't match
-- are passed through unchanged via the `ELSE elem.value` branch. `jsonb_agg`
-- with `WITH ORDINALITY ... ORDER BY elem.ord` preserves the original field
-- order.
--
-- `data_sources` carries FORCE ROW LEVEL SECURITY (V35) and its owner policy
-- reads `current_setting('app.current_user_id')` WITHOUT `missing_ok`, which
-- throws SQLSTATE 42704 when the GUC is unset -- exactly what broke three
-- prior production deploys (see V94's header, HEL-943). Flyway's migration
-- role (`helio` in prod, `helio_migration_test` in
-- `FlywayNonSuperuserMigrationSpec`) OWNS the table it created, so bracketing
-- this single UPDATE with `NO FORCE` / `FORCE ROW LEVEL SECURITY` (the same
-- pattern V94 section 0/22 uses) lets the table owner bypass RLS for this
-- statement without needing `app.current_user_id` set at all, and restores
-- the FORCE posture immediately after so the table's RLS enforcement is
-- identical before and after this migration runs.

ALTER TABLE data_sources NO FORCE ROW LEVEL SECURITY;

UPDATE data_sources ds
SET inferred_schema = (
  SELECT jsonb_agg(
           CASE
             WHEN elem.value ->> 'type' = 'number'
               THEN jsonb_set(elem.value, '{type}', '"float"'::jsonb)
             ELSE elem.value
           END
           ORDER BY elem.ord
         )
  FROM jsonb_array_elements(ds.inferred_schema) WITH ORDINALITY AS elem(value, ord)
)
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(ds.inferred_schema) AS e(value)
  WHERE e.value ->> 'type' = 'number'
);

ALTER TABLE data_sources FORCE ROW LEVEL SECURITY;
