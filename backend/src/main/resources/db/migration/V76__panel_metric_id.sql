-- HEL-500: Panel binding to a metric (metric -> panel).
--
-- Bound panels (Metric/Chart/Table) may optionally reference a stored
-- `MetricDefinition` (metrics table, V75) instead of re-specifying their own
-- dataTypeId/fieldMapping/aggregation trio. Additive nullable column, same
-- precedent as V53__panel_column_widths.sql -- NULL for panel kinds/rows
-- that don't set it, same convention as type_id/field_mapping/aggregation.
--
-- ON DELETE SET NULL (not CASCADE): deleting a metric unbinds referencing
-- panels rather than deleting them -- this is what satisfies "deleted
-- metric reads back unbound" with no service-layer code (design.md D2).
--
-- Indexed for the same reason idx_metrics_data_type_id is indexed (V75):
-- an unindexed FK column forces a full scan on every metric delete to find
-- referencing rows to null out.

ALTER TABLE panels ADD COLUMN metric_id TEXT REFERENCES metrics(id) ON DELETE SET NULL;

CREATE INDEX idx_panels_metric_id ON panels(metric_id);
