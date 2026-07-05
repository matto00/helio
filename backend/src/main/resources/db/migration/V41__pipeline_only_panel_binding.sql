-- enforce-pipeline-only-bindings — convert panel-bound companion DataTypes
-- into pipeline outputs.
--
-- Why: registering a source auto-creates a "companion" DataType
-- (data_types.source_id = the source's id) as an internal schema record that
-- feeds pipeline analyze, source preview computed fields, and refresh
-- upserts. Panels were also able to bind directly to these companion types
-- (panels.type_id), which the enforce-pipeline-only-bindings change retires:
-- panels should bind only to pipeline-output DataTypes (source_id IS NULL).
-- See openspec/changes/enforce-pipeline-only-bindings/design.md (D1).
--
-- For every companion DataType bound by at least one panel, this migration:
--   (a) inserts a zero-step pass-through pipeline (source -> type) so the
--       binding's provenance survives as a pipeline the user can re-run;
--       last_run_* stay NULL — it has never actually run, only its output
--       snapshot (captured before this migration) already exists.
--   (b) inserts a fresh companion DataType for the source (same name /
--       fields / computed_fields / owner_id) so source schema display,
--       pipeline analyze, and refresh upserts keep resolving exactly one
--       companion type per source.
--   (c) clears source_id on the original DataType, turning it into a
--       genuine pipeline-output type. Panels keep their existing type_id
--       and data_type_rows snapshot untouched — zero rendering disruption.
--
-- Order matters: (a) and (b) run before (c) so the original row is never
-- observed in a half-converted state (source_id cleared but no pipeline /
-- replacement companion yet).
--
-- Companion types with zero bound panels are left untouched entirely.
--
-- RLS caution (see V40's post-mortem): pipelines and data_types carry FORCE
-- ROW LEVEL SECURITY (V35), which applies to the table owner too — only
-- superusers and BYPASSRLS roles are exempt. Whatever role Flyway
-- authenticates as here may be the (non-superuser) table owner in
-- production, so without an explicit bypass the loop below would either
-- silently see zero rows or error on the unset `app.current_user_id` GUC.
-- `SET LOCAL ROLE helio_privileged` (BYPASSRLS, granted to the migrating
-- role by V34) makes this migration's DML immune to RLS regardless of which
-- role actually runs it; `LOCAL` confines the role switch to this
-- transaction.

SET LOCAL ROLE helio_privileged;

DO $$
DECLARE
  bound_type       RECORD;
  new_pipeline_id  TEXT;
  new_companion_id TEXT;
BEGIN
  FOR bound_type IN
    SELECT dt.id, dt.source_id, dt.name, dt.fields, dt.computed_fields, dt.owner_id
    FROM data_types dt
    WHERE dt.source_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM panels p WHERE p.type_id = dt.id)
  LOOP
    new_pipeline_id  := gen_random_uuid()::text;
    new_companion_id := gen_random_uuid()::text;

    -- (a) Pass-through pipeline: source -> the now-former companion type.
    -- owner_id is NOT NULL on pipelines but nullable on data_types; fall
    -- back to the system user (V10) for any pre-ownership row, mirroring
    -- the V32 pipelines.owner_id backfill.
    INSERT INTO pipelines (
      id, name, source_data_source_id, output_data_type_id,
      last_run_status, last_run_at, last_run_row_count,
      owner_id, created_at, updated_at
    ) VALUES (
      new_pipeline_id, bound_type.name || ' (migrated)', bound_type.source_id, bound_type.id,
      NULL, NULL, NULL,
      COALESCE(bound_type.owner_id, '00000000-0000-0000-0000-000000000001'::uuid), NOW(), NOW()
    );

    -- (b) Replacement companion DataType for the source.
    INSERT INTO data_types (
      id, source_id, name, fields, version, computed_fields, owner_id, created_at, updated_at
    ) VALUES (
      new_companion_id, bound_type.source_id, bound_type.name, bound_type.fields, 1,
      bound_type.computed_fields, bound_type.owner_id, NOW(), NOW()
    );

    -- (c) Convert the original DataType into a pipeline-output type.
    UPDATE data_types
    SET source_id = NULL, updated_at = NOW()
    WHERE id = bound_type.id;
  END LOOP;
END
$$;
