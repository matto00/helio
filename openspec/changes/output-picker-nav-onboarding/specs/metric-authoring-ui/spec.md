## REMOVED Requirements

### Requirement: Metrics list page
**Reason**: The Metrics registry is retired outright (HEL-903 decision 2, 11) — aggregation lives only in pipeline steps; Outputs are render-only. `/metrics` is dropped from nav and routing.
**Migration**: An aggregated value is authored as a pipeline `aggregate` step feeding a `metric`-kind Output, viewed/edited on the pipeline page (`pipeline-outputs-gallery`, `OutputEditorSheet`).

### Requirement: Metric editor supports create, edit, deprecate, and delete
**Reason**: Same as above — there is no standalone Metric entity to create/edit/deprecate/delete.
**Migration**: See the pipeline page's Output editor sheet for a `metric`-kind Output's own config (format, etc.).

### Requirement: Metric editor surfaces backend validation errors inline
**Reason**: Same as above.
**Migration**: `OutputEditorSheet` surfaces its own validation errors inline for any Output kind, metric included.
