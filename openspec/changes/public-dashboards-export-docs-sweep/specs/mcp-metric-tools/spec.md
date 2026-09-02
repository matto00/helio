## REMOVED Requirements

### Requirement: get_workspace_context advertises the metric catalog
**Reason**: `buildWorkspaceContext` (`helio-mcp/src/context.ts`) no longer includes a `metrics`
field — the `/api/metrics` REST API and the `metrics`/`MetricDefinition` semantic layer it
fronted were removed outright by HEL-904 (Decision 11), leaving no non-deprecated-metric catalog
to advertise. This was the last live requirement in this spec; the other four (`list_metrics`,
`get_metric`, `create_metric`, `update_metric`, `delete_metric`) were already removed by the
archived `2026-09-01-mcp-outputs-proposals-rewrite` change.
**Migration**: None. Agents ground themselves via `get_workspace_context`'s `pipelines[].outputs[]`
(or `list_outputs`) instead of a metric catalog; any prior metric-derived measure is expressed as a
pipeline compute step feeding an Output.
