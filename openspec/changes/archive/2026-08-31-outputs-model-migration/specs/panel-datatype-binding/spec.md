## REMOVED Requirements

### Requirement: Panel can be bound to a DataType
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: PATCH /api/panels/:id accepts typeId, fieldMapping, and refreshInterval
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: User can bind a panel to a DataType
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Field mapping slots are appropriate to the panel type
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Refresh interval is configurable
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Saving persists the binding
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Unsaved changes trigger a discard warning
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: typeId is set at panel creation time for data-bound panels
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Panel response includes dataAsOf field for data freshness
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Backend rejects binding a panel to a companion DataType
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Binding editor exposes aggregation controls for metric and chart panels
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Saving the binding persists the aggregation spec
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Metric panel supports a literal label/unit override
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Text panel joins the bound-capable panel set
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Text panel binding persists via existing generic columns
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Clearing a Text panel's binding preserves its literal content
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Markdown panel joins the bound-capable panel set
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Markdown panel binding persists via existing generic columns
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Clearing a Markdown panel's binding preserves its literal content
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Bound panels may bind to a stored MetricDefinition via metricId
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: create/update reject an unresolvable or non-pipeline-output metricId
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: A cross-user or deleted metricId clears on read instead of erroring
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Deleting a metric unbinds referencing panels instead of deleting them
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: A Metric panel's read response materializes the metric's effective binding
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Panel binding editor supports a bind-to-metric mode for metric/chart/table panels
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: A metric panel's bind-to-metric mode shows the resolved binding read-only
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: A chart or table panel's bind-to-metric mode does not materialize into fieldMapping
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

### Requirement: Binding editor surfaces a deprecated indicator for a bound deprecated metric
**Reason**: Panels no longer bind to a DataType/metric; a Panel is either an OutputPanel (placement of an Output) or a content panel. The DB columns this capability depended on (type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options, timeline_options, column_widths, table_density, column_order, chart_annotation) are dropped by this migration.
**Migration**: Every previously-bound panel is migrated to an OutputPanel (output_id) pointing at a new Output carrying the same config; the frontend binding editor is deleted in P1.6 (decision 17: the running app is non-functional between P1.3 and P1.6, which is expected).

