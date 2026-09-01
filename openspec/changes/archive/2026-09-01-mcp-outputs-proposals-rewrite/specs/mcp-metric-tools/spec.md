## REMOVED Requirements

### Requirement: list_metrics MCP tool
**Reason**: Metrics are removed from the model (P1.1); no replacement tool — the semantic layer
this served is superseded by Outputs.
**Migration**: None. Callers must express any prior metric-derived measure as a pipeline compute
step feeding an Output.

### Requirement: get_metric MCP tool
**Reason**: See `list_metrics` above.
**Migration**: None.

### Requirement: create_metric MCP tool
**Reason**: See `list_metrics` above.
**Migration**: None.

### Requirement: update_metric MCP tool
**Reason**: See `list_metrics` above.
**Migration**: None.

### Requirement: delete_metric MCP tool
**Reason**: See `list_metrics` above.
**Migration**: None.
