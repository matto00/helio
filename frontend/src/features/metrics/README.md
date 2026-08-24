# Metrics

The semantic/metric layer: `state/metricsSlice.ts`, the API client
(`services/metricService.ts`), wire types (`types/metric.ts`), and the
metrics list/detail/editor UI (`ui/`: `MetricsPage`, `MetricListTable`,
`MetricDetailPage`, `MetricEditorForm`, `CreateMetricModal`,
`AllowedDimensionsPicker`, `MetricEmptyState`).

**Belongs here:** metric definitions and their CRUD UI.
**Does not belong here:** the data types a metric's dimensions/measures are
drawn from, which live in `dataTypes`.
