-- HEL-317 — Persist Timeline panel options.
--
-- A Timeline panel renders a vertical, chronological event list bound to a
-- multi-row DataType (one row = one entry). Its binding reuses the existing
-- `type_id` / `field_mapping` columns (so the bound-trio machinery — query
-- building, binding-clear, freshness — works unchanged); this column stores
-- only the timeline-specific concern as a single JSON object:
--
--   { "sort": "asc" | "desc" }
--
-- Kept as a single dedicated nullable JSONB column following the
-- `chart_options` / `collection_options` precedent (V56/V57): one concern per
-- column, and the concern here is "timeline options".
--
-- Applies only to `type='timeline'` rows; NULL for every other kind. NULL
-- means "default timeline options" (sort=asc) = exactly the pre-change
-- behavior, so existing rows require zero data migration. Rollback = drop the
-- column.

ALTER TABLE panels ADD COLUMN timeline_options JSONB;
