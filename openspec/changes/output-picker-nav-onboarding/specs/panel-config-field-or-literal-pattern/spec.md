## REMOVED Requirements

### Requirement: Field-or-literal config slots expose a bind-to-field/fixed-text toggle
**Reason**: The "bind to field" side of this toggle bound to a DataType field, which no longer exists (HEL-903 decision 11); panel-level field binding is retired in favor of Output-owned field mapping authored once in `OutputEditorSheet`.
**Migration**: An Output's field mapping is authored on the pipeline page; a placed panel never re-exposes a bind/literal toggle for it (see `panel-detail-modal`'s Panel sheet, which has no field-mapping control at all).

### Requirement: Literal label/unit are editable after panel creation
**Reason**: Same as above — label/unit for an output-kind panel are Output-owned config, not a placement-time literal.
**Migration**: Edited on the Output via `OutputEditorSheet`, propagating to every placement (decision 1).

### Requirement: The field-or-literal pattern is documented as reusable for follow-on config-redesign tickets
**Reason**: The pattern itself is retired along with panel-level field binding.
**Migration**: N/A.

### Requirement: Field-or-literal control supports a multiline literal input
**Reason**: Same as above.
**Migration**: N/A.

### Requirement: Text is the pattern's first non-Metric consumer
**Reason**: Same as above — Metrics are retired outright, and Text panels are literal-only after this change (see `text-panel-content-source`).
**Migration**: N/A.

### Requirement: Chart Annotation is a consumer of the field-or-literal pattern
**Reason**: A chart-kind Output's annotation config is authored once in `OutputEditorSheet` against the node's projected schema, not via a per-panel bind/literal toggle.
**Migration**: See the pipeline page's `OutputEditorSheet` chart-annotation config (P1.5).
