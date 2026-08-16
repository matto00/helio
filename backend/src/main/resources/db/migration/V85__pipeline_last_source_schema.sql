-- HEL-462 — Baseline source-schema capture for pipeline schema-drift detection.
--
-- Stores the source schema (declared DataType fields, [{name, type}]) captured
-- on each successful (non-dry) pipeline run, so analyze-time can diff the
-- current source schema against the last known-good baseline and report
-- added/removed/type-changed columns. Kept as its own nullable JSONB column
-- following the exact `column_widths` precedent (V53__panel_column_widths.sql)
-- rather than folded into an existing column, since the baseline is an
-- independent concern from the existing last-run metadata.
--
-- NULL until the pipeline's first successful run (no baseline yet).

ALTER TABLE pipelines ADD COLUMN last_source_schema JSONB;
