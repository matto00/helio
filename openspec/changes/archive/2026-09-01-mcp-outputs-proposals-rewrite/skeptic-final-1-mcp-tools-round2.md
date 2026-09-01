## Skeptic Report — final gate, dimension: MCP tool surface + removals (round 2, skeptic-final-1-mcp-tools-round2.md)

Cold re-derivation from the actual code at `d36bb991`. The executor's account was read only as
claims; every conclusion below is grounded in the file contents or a probe I ran myself.

### What I verified (with evidence)

**1. The round-1 finding IS genuinely fixed — confirmed.**
- `helio-mcp/src/types.ts:533-542` — `CreateSourceResult` now declares
  `{ source, inferredSchema, fetchError, rowCapNotice }`. No `dataType` field remains.
- `helio-mcp/src/helioApi.ts:77-82` — `RawCreateSourceResponse` = `{ source, inferredSchema?,
  fetchError?, rowCapNotice? }`.
- `helio-mcp/src/helioApi.ts:428-437` and `:462-471` — both `createRestDataSource` and
  `createSqlDataSource` map `inferredSchema`/`rowCapNotice`/`fetchError` with `?? null`
  normalization. `inferredSchema` and `rowCapNotice` are no longer dropped.
- **Wire-truth cross-check (not the executor's word):**
  `backend/.../sources/DataSourceProtocol.scala:184-189` —
  `CreateSourceResponse(source, inferredSchema: Option[InferredSchemaResponse],
  fetchError: Option[String], rowCapNotice: Option[String] = None)`. The TS shape now matches the
  Scala shape field-for-field, including `inferredSchema` being a **sibling** of `source`.
- Descriptions corrected: `write.ts:120-125` (create_rest) and `:160-165` (create_sql) now say
  "on success the response includes the re-inferred `inferredSchema`; on failure it returns
  `inferredSchema: null` and a fetchError message" — the false "dataType null means failure" claim
  is gone.
- The follow-up sweep item is real too: `write.ts:57-66` (`create_data_source`) no longer contains
  the copy-paste "creates the pipeline with ZERO Outputs" sentence; it now says "creates no
  pipeline and no Output". `teardown_resources`' description (`write.ts:498-520`) is clean of
  DataType language. `listDataTypes` is genuinely absent from `helioApi.ts` (only a tombstone
  comment at `:242`).

**2. My own fresh sweep found a SIBLING INSTANCE of the identical defect class, still shipping.**

`run_pipeline` promises an agent a field that the backend has not sent since HEL-904, and that the
agent will never receive.

- Agent-facing promise — `helio-mcp/src/tools/write.ts:313-315`:
  `"Returns { pipelineId, status, rowCount, sourceRowCount, outputDataTypeId, truncated, ... }"`.
- Source of that field — `helio-mcp/src/helioApi.ts:552-558`: `runPipeline` re-reads
  `GET /api/pipelines/:id` as `PipelineSummaryResponse` and maps
  `outputDataTypeId: summary.outputDataTypeId`.
- TS type claiming it exists — `helio-mcp/src/types.ts:249-262`: `PipelineSummaryResponse` still
  declares **`outputDataTypeName: string`** and **`outputDataTypeId: string`**, both required.
- **Ground truth on the wire — it does not exist.**
  `backend/.../pipelines/PipelineProtocol.scala:44-54` declares exactly nine fields
  (`id, name, sourceDataSourceId, sourceDataSourceName, lastRunStatus, lastRunAt, lastRunRowCount,
  ownerId, tag`) — no `outputDataTypeId`, no `outputDataTypeName`. Confirmed by the formatter at
  `PipelineProtocol.scala:215`: `jsonFormat9(PipelineSummaryResponse.apply)`. Nine fields, all
  accounted for.
- **Reproduced at runtime.** I drove the real `HelioApi.runPipeline` with a fake HTTP client whose
  `GET` returns exactly the nine fields the Scala case class declares:

  ```
  outputDataTypeId value: undefined
  agent-visible JSON (what jsonResult sends):
  { "pipelineId": "p1", "status": "succeeded", "rowCount": 5, "sourceRowCount": 5,
    "truncated": false }
  ```

  `JSON.stringify` drops the `undefined` key, so the field the tool description explicitly
  enumerates is **silently absent** from every real `run_pipeline` result. Run twice, identical
  both times; this is deterministic code with no flake surface.
- **Why no test catches it (evidence-shaped non-evidence):**
  `helio-mcp/src/runPipelineTruncation.test.ts:20-23`'s fake `get` returns
  `{ lastRunStatus: "succeeded", outputDataTypeId: "dt-1" }` — a fixture asserting a field the
  backend no longer sends. The suite is green precisely because the fixture is wrong.
- This is the same defect class as round 1, in the same file, with the same shape: a
  dead-since-HEL-904 DataType field mapped from a wire key the backend stopped sending, promised in
  an agent-facing description. It is arguably worse than the round-1 instance, because round 1
  produced a misleading `null` while this produces a **missing** key against an explicit
  enumeration.

**3. Same class, secondary instances (type-level only, not agent-visible output).**
- `helio-mcp/src/types.ts:366-372` — `PipelineAnalyzeResponse` declares required
  `outputDataTypeName: string` and `outputDataTypeId: string`. Backend
  `PipelineAnalyzeProtocol.scala:183-190` has neither. `analyze_pipeline` passes the server JSON
  through verbatim, so the agent sees the truth; but the TS interface is a lie and is the same
  stale-shape residue.
- `helio-mcp/src/helioApi.ts:93` — `RunOutcome`'s doc comment states "rows are written to
  `outputDataTypeId`", which is no longer a thing at all.

**4. Stale internal docstrings still asserting the retired DataType model** (lower severity —
human-facing comments, not agent-facing descriptions, but they actively mis-describe the wire and
one of them describes the exact wrapper shape this cycle just proved does not exist):
- `helioApi.ts:336-341` (`createDataSource`) — "The backend auto-creates a source-companion
  DataType… static create is NOT the `{source,dataType}` wrapper shape the REST/SQL `/api/sources`
  endpoint returns." The `{source,dataType}` wrapper does not exist on any endpoint.
- `helioApi.ts:372-376` (`createCsvDataSource`) — same "auto-creates a source-companion DataType…
  no `dataType` field" framing.
- `helioApi.ts:473-475` — "`tag` … propagated to the newly-created output DataType as well (the
  only site that ever inserts that row)".
- `helioApi.ts:770-776` — `teardownResources` docstring still describes deleting "every data
  source, pipeline, and DataType", and its conflict cases in DataType terms, while the tool
  description it backs correctly says "data source, pipeline, and dashboard".

**5. Everything else from round 1 re-confirmed clean.** Removed tools remain absent (`write.ts:184`,
`:302`, `:33` tombstones with no aliases); the new tool files (`pipelines.ts`, `outputs.ts`,
`placements.ts`) are registered; `server.test.ts`'s exact-tool-name-set test is real.

### Verdict: REFUTE

The round-1 fix itself is correct and I confirm it. But the explicit follow-up ask this cycle was to
sweep the **class**, not the instance, and the sweep stopped at the two `POST /api/sources` callers.
A live, reproduced, agent-visible instance of the same class remains on `run_pipeline`.

### Change Requests

1. **`helio-mcp/src/types.ts:249-262`** — remove `outputDataTypeName: string` and
   `outputDataTypeId: string` from `PipelineSummaryResponse`. Ground truth:
   `backend/.../pipelines/PipelineProtocol.scala:44-54` + `jsonFormat9` at `:215`. Neither field is
   on the wire.
2. **`helio-mcp/src/helioApi.ts:94-99` and `:552-558`** — remove `outputDataTypeId` from
   `RunOutcome` and stop mapping `summary.outputDataTypeId` in `runPipeline`. Fix the `RunOutcome`
   doc comment at `:93` ("rows are written to `outputDataTypeId`") to describe the Outputs model. If
   an agent still needs the produced Output id(s) after a run, surface the pipeline's real
   `outputs[]` instead — do not leave a silently-absent key.
3. **`helio-mcp/src/tools/write.ts:313-315`** — remove `outputDataTypeId` from `run_pipeline`'s
   "Returns { … }" enumeration so the description matches what is actually emitted.
4. **`helio-mcp/src/runPipelineTruncation.test.ts:20-23`** — remove `outputDataTypeId: "dt-1"` from
   the fake `get` fixture and make it mirror the real nine-field `PipelineSummaryResponse`. As it
   stands the fixture is what prevents any test from catching CR1-3.
5. **`helio-mcp/src/types.ts:366-372`** — remove `outputDataTypeName`/`outputDataTypeId` from
   `PipelineAnalyzeResponse`; `PipelineAnalyzeProtocol.scala:183-190` has neither.
6. **`helio-mcp/src/helioApi.ts:336-341`, `:372-376`, `:473-475`, `:770-776`** — rewrite these
   docstrings off the retired DataType model. Specifically delete the `{source,dataType}` wrapper
   claim at `:338` (no endpoint returns that shape) and the "auto-creates a source-companion
   DataType" claims, and restate `teardownResources`' docstring in the data source / pipeline /
   dashboard terms its own tool description already uses.

### Non-blocking notes
- `combinedProposal.ts:62-69`'s `dataTypeId` sentinel language is **correct** and should NOT be
  swept — `backend/.../CombinedProposalService.scala:203-212` genuinely still writes that slot. I
  checked this specifically so a follow-up sweep does not over-correct it.
- After CR1-5, a cheap guard against the whole class would be one test per MCP wire interface
  asserting the TS key set equals the Scala case class's — the recurring failure here is that
  `http.get<T>()` casts unvalidated JSON, so a stale interface never fails typecheck.
