## REMOVED Requirements

### Requirement: PipelineRepository exposes last successful run timestamp lookup by output DataType
**Reason**: `PipelineRepository.findLastRunAtByOutputDataTypeId` was removed outright (HEL-904 task
4.1) — `pipelines.output_data_type_id` no longer exists (V94), and the method's only caller
(`PublicDashboardRoutes`'s per-panel `dataAsOf` lookup) was removed in the same task since no panel
carries a `dataTypeId` binding anymore.
**Migration**: None. An Output-keyed freshness lookup is out of scope for this ticket; a future
P-ticket may reintroduce it against `outputs`/`node_snapshots` if the product still wants it.

### Requirement: Panel API response includes dataAsOf field
**Reason**: The `dataTypeId`-keyed binding-resolution + `dataAsOf` lookup this requirement depended
on was removed outright alongside `PipelineRepository.findLastRunAtByOutputDataTypeId` (HEL-904 task
4.1). `PanelResponse.dataAsOf` is retained on the wire shape for backward compatibility, but every
call site now passes `None` — the field is always `null` in the shipped response, not conditionally
populated as this requirement described.
**Migration**: None. Callers must not rely on `dataAsOf` ever being non-null until a future P-ticket
reintroduces a freshness lookup against the Output/node_snapshots model.
