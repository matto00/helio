-- HEL-292 — Durable persistence for panel-level aggregation specs.
--
-- MetricPanelConfig/ChartPanelConfig gained an `aggregation: Option[JsObject]`
-- field (opaque JSON the backend does not interpret — see design.md
-- Decision 5). It is kept as its own column rather than folded into
-- `field_mapping` because the domain model already treats them as distinct
-- sibling fields (fieldMapping = which columns to read; aggregation = how to
-- reduce them), and conflating the two JSONB blobs at the mapper boundary
-- would require an ad-hoc sub-key convention with no corresponding benefit —
-- a plain nullable JSONB column matches the existing `field_mapping` pattern
-- exactly (V5__panel_type_binding.sql + V33__jsonb_columns.sql).
--
-- Applies to all panel rows (column is NULL for panel kinds that don't use
-- it, same convention as `type_id`/`field_mapping`).

ALTER TABLE panels ADD COLUMN aggregation JSONB;
