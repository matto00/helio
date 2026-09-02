## REMOVED Requirements

### Requirement: Stable pipeline-output DataType selector
**Reason**: The DataType model is dropped entirely by HEL-904 (P1.1) — pipelines produce Outputs,
not DataTypes, and there is no `state.dataTypes.items` left to select from.
**Migration**: Consumers select Outputs directly from `state.outputs`/`currentPipeline.outputs`
(already flat, keyed by `outputId`, per P1.3) — no selector-stability shim is needed since Output
identity and array reference come from the same normalized slice pattern already used elsewhere.
