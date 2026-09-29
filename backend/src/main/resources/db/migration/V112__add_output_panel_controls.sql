-- HEL-1189: adds output panel controls' persisted config column (leaf 2 of HEL-915's re-scope,
-- design.md D1). `panels.output_controls` carries an OPTIONAL, ordered list of
-- `OutputControlSpec` entries (date-range/dropdown/numeric-range/text) an author has attached to
-- an `output`-kind panel, alongside the existing `output_id` column (V94 §4), which is untouched.
-- NULL/absent decodes to an empty list -- no backfill needed since the column starts empty for
-- every existing panel.
--
-- `NO FORCE`/`FORCE ROW LEVEL SECURITY` bracket mirrors V108's `form_config` addition exactly (same
-- rationale: every `panels` policy -- `panels_select`/`panels_update`/`panels_delete`/
-- `panels_insert`, V36 -- is `missing_ok`-safe and reads no config column, and this migration is
-- pure DDL, not DML against a policy). Follows the repo's established never-leave-a-table-under-
-- FORCE-RLS-mid-migration convention.
ALTER TABLE panels NO FORCE ROW LEVEL SECURITY;

ALTER TABLE panels ADD COLUMN output_controls JSONB NULL;

ALTER TABLE panels FORCE ROW LEVEL SECURITY;
