## REMOVED Requirements

### Requirement: PanelQuery is derived from a panel's fieldMapping
**Reason**: `PanelQuery`/`PanelQueryExecutor` and per-panel `fieldMapping`-derived aggregation
belonged to the retired bound-panel binding model (`typeId`/`fieldMapping`). Everything they
carried (fieldMapping, aggregation, chartOptions, etc.) now lives on the Output itself
(`outputs.config`), not on the panel placement — see `outputs-model` and `output-panel-placement`.
**Migration**: There is no direct replacement route; a panel's rendered data now comes from its
Output via `GET /api/outputs/:id/rows`, which is not query-derived from panel `fieldMapping`.

### Requirement: GET /api/panels/:id/query returns the panel's structured query
**Reason**: Retired alongside `PanelQuery` — panels no longer carry `typeId`/`fieldMapping`, so
there is nothing to derive a query from.
**Migration**: Use `GET /api/outputs/:id/rows` via the panel's `config.outputId`.

### Requirement: PanelQuery is serializable to JSON
**Reason**: `PanelQuery` itself is deleted along with the route that produced it.
**Migration**: No replacement wire shape — Outputs carry their own row-fetch contract
(`schemas/outputs/*`), unrelated to the retired `PanelQuery` JSON shape.
