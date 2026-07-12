-- HEL-253 — Durable persistence for Table panel per-column widths.
--
-- TablePanelConfig gains a `columnWidths: Map[String, Int]` field (column key
-- -> pixel width). Kept as its own nullable JSONB column following the exact
-- `aggregation` precedent (V43__panel_aggregation_column.sql) rather than
-- folded into `field_mapping`, since widths are a display concern layered on
-- top of the binding, not part of the binding itself.
--
-- Applies to all panel rows (column is NULL for panel kinds that don't use
-- it, same convention as `type_id`/`field_mapping`/`aggregation`).

ALTER TABLE panels ADD COLUMN column_widths JSONB;
