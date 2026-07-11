-- HEL-293 — Durable persistence for the metric panel literal label/unit
-- override.
--
-- MetricPanelConfig gained `label: Option[String]` / `unit: Option[String]`
-- fields — a literal display override distinct from `fieldMapping.label`/
-- `fieldMapping.unit` (which bind to a data column). Kept as plain nullable
-- TEXT columns (not JSONB) because the backend interprets these values
-- directly (unlike the opaque `aggregation` JSONB column from V43) — see
-- design.md Decision 3.
--
-- Applies to all panel rows (column is NULL for panel kinds other than
-- metric, same convention as `type_id`/`field_mapping`/`aggregation`).

ALTER TABLE panels ADD COLUMN metric_label TEXT;
ALTER TABLE panels ADD COLUMN metric_unit TEXT;
