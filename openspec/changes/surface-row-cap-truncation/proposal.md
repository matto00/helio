## Why

`InProcessPipelineEngine.maxRunRows = 1000` caps every pipeline run's source read. The cap is a deliberate memory bound and stays. The defect is that the cap is applied **silently**: a run over a 3,303-row JSON array reports `sourceRowCount: 1000`, indistinguishable from a genuine 1,000-row source. A downstream `filter` or `sort` then produces a plausible-looking answer computed over an arbitrary first-1000 slice — a "top 10 receivers" panel that is really "top 10 among whatever the API happened to return first". Nothing anywhere gives a caller, human or agent, grounds to distrust the number.

This is the "quietly wrong" failure class the rest of epic HEL-857 has been closing. Pagination (the eventual real remedy) is HEL-427's job; honest truncation now beats complete data later.

## What Changes

- **Connector SPI** — `ConnectorDriver.fetch` returns a `FetchOutcome(rows, truncated, availableRowCount)` instead of a bare `Vector[JsValue]`, so truncation information survives the call rather than being discarded at the boundary. Two production implementations and exactly two production call sites exist, plus three test fixtures that also implement the trait.
- **REST** reports truncation **exactly**, with a true available-row count: `RestApiConnectorDriver` already materializes the whole parsed array before `.take(maxRows)`, so the pre-truncation size is free.
- **SQL** reports truncation **exactly but without a total**, via a `maxRows + 1` probe: if the extra row arrives, more rows exist. No `COUNT(*)` query, no extra round trip.
- **Run result** gains `sourceTruncated`, `sourceAvailableRowCount`, a server-composed `truncationNotice` sentence, and `truncatedReads` (one entry per truncated read). The notice is composed once, server-side, so every surface says the same correct thing.
- **Secondary sources count too.** `join`, `union` and `lookup` steps re-read a second source through the same capped path. `sourceTruncated` is true if **any** read in the run was truncated, so the run never asserts completeness it cannot support.
- **MCP** `run_pipeline` returns the truncation fields and the notice, and its tool description stops promising a complete row count.
- **UI** renders a truncation warning on the pipeline detail page. `runSourceRowCount` is currently a dead destructure that nothing displays; this change gives it a render surface.
- **Source creation** warns at create time when the source already holds more rows than a run will process. The count rides out on the existing schema-inference result (`InferredSchema` gains a defaulted `observedRowCount`) — no second request. REST measures it for free; SQL cannot, and stays silent rather than guessing.
- **Specs** updated for the new run-result fields and the new SPI contract.

### Ticket-premise corrections (re-derived against `main` @ `83e99a0e`)

1. The ticket cites `services/pipeline/InProcessPipelineEngine.scala:40` with call sites at 136/141. Actual: `domain/engine/InProcessPipelineEngine.scala:65`, call sites `:176` and `:181`. `maxRunRows` occurs exactly three times in the whole tree, all in that one file.
2. The MCP `apply_pipeline_proposal` / `apply_proposal` responses embed `run: RunResultResponse` raw and stringify it verbatim, so they inherit the truncation fields automatically — this is the primary agent path that creates-and-runs a pipeline, and it is documented here rather than left as luck.
3. The ticket implies source creation applies the same 1000-row cap. **It does not.** Source creation and inference use entirely different caps: SQL infer 100 (`SqlConnectorDriver.scala:147`), preview 10, static payload 500 (`DataSourceService.scala:60`), and REST infer is **uncapped**. The create-time signal in this change is therefore an advisory — "runs over this source will be truncated" — not a report of a cap that creation itself applied.

## Capabilities

### New Capabilities
- `pipeline-run-truncation-reporting`: how a pipeline run detects, carries, and reports that its source read was capped, and what each surface (API, MCP, UI) must show.

### Modified Capabilities
- `connector-spi`: `fetch` returns a truncation-carrying outcome rather than a bare row vector; every implementation must report whether it truncated, and its available-row count when it can know one.
- `pipeline-run-execution`: the run-result body gains truncation fields.

Per-driver behaviour (REST exact totals, SQL exact flag with unknown total), the MCP surface and the UI surface are all specified in the new `pipeline-run-truncation-reporting` capability rather than duplicated into `rest-api-connector`, `sql-database-connector` and `mcp-data-source-tools` deltas — one contract, one place, no drift.

## Impact

- `backend/src/main/scala/com/helio/domain/connectors/ConnectorDriver.scala` — SPI return type, new `FetchOutcome`
- `backend/src/main/scala/com/helio/domain/connectors/RestApiConnectorDriver.scala` — exact counts
- `backend/src/main/scala/com/helio/domain/connectors/SqlConnectorDriver.scala` — `maxRows + 1` probe
- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — thread the outcome out of `loadRows`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — populate the response
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala` — `RunResultResponse` fields, `jsonFormat7` → `jsonFormat11`
- `backend/src/main/scala/com/helio/services/sources/CreateSourceEnvelope.scala` — composes the create-time advisory generically
- `backend/src/main/scala/com/helio/domain/model/model.scala` — `InferredSchema` gains a defaulted `observedRowCount`
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala` — `rowCapNotice` on `CreateSourceResponse`
- `helio-mcp/src/{types.ts,helioApi.ts,tools/write.ts}` — MCP surface + tool description
- `frontend/src/features/pipelines/{services/pipelineService.ts,state/pipelinesSlice.ts,ui/*}` — UI warning
- `openspec/specs/*` — spec deltas

No migration. No change to `maxRunRows`. No pagination.
