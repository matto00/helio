-- HEL-255 — Persist per-panel Table display config (density + column order).
--
-- TablePanelConfig gains two optional display concerns:
--   * `density`     ("condensed" | "normal" | "spacious") — DataGrid row spacing
--   * `columnOrder` (ordered array of visible data-column keys)
--
-- Each is kept as its own dedicated nullable column following the exact
-- `column_widths` precedent (V53__panel_column_widths.sql) rather than folded
-- into `field_mapping`: display state is layered on top of the binding, not
-- part of it. One-concern-per-column keeps the shape greppable and bounded.
--
-- Applies to all panel rows (columns are NULL for panel kinds that don't use
-- them, same convention as `column_widths`/`aggregation`). NULL means the
-- defaults (normal density; all columns visible in natural order), so existing
-- rows require zero data migration.

ALTER TABLE panels ADD COLUMN table_density TEXT;
ALTER TABLE panels ADD COLUMN column_order JSONB;
