## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: `feature/rest-source-pagination/HEL-1013` at 5613ea63fdae31dbd1b1fe5d28663eb3d3fb676b (no code commits; the change dir is untracked). Owner rulings (a)-(e) (`escalation.answered` 1795642525752 in `.concertino/runs/HEL-1013/events.jsonl`) are taken as given.

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/rest-source-pagination/HEL-1013`.
- I re-read ticket.md, proposal.md, design.md, tasks.md, specs/rest-source-pagination/spec.md and the round-1 report.

**CR1 (internal API and callers): resolved.**
- D8 is consistent with the live tree. The only `connector.fetch(config, maxRows, ...)` caller is `InProcessPipelineEngine.scala:822` (`loadRowsWithStats`).
- **The D8 claim about the sample route holds.** `SourceSampleService.sample` (l.127-128) calls `engine.loadRowsWithStats(ds, dataSourceRepo)` on its own `InProcessPipelineEngine` (l.59, built with `connector`). For a `RestSource`, that reaches `connector.fetch(r.config, maxRunRows, ConnectorResolveContext.Internal)` at l.822. So sample pages exactly as a run does. It then maps `stats.availableRowCount` to `sourceRowCount` (l.133).
- Every other driver entry point stays single-request under D8:
  - `inferSchema` is called from `SourceService:342/443`, `CreateSourceEnvelope:48` and `PipelineProposalAnalyze:316`.
  - `inferSchemaForConnector`/`ForResolvedConnector` is called from `SourceService:235-236`, the HEL-1638 inline dry run.
  - `inferSchemaEphemeral`/`testConnectionEphemeral` is called from `SourceService:351/382`.
  - `fetch(config, ctx)` is called from `previewRest`, `SourceService:484`.
  - `testConnection` is called from `ConnectionTest:33`.
- No other `InProcessPipelineEngine` is built with a connector. The `ApiRoutes:623` draft-preview engine has none.
- The `fetchOverride` behaviour (ignored when wired, no-config path untouched) is stated explicitly.

**CR2 (helio-mcp): resolved.** All three forwarding sites exist as D10 describes:
- `tools/write.ts:330-340`
- `helioApi.ts:709-733`
- `tools/pipelinesHandlers.ts:86-96`

Two more items are named in D10 and task 4.2:
- the `RawCreateSourceResponse` relay (`helioApi.ts:100-106`)
- the truncated-read interfaces (`helioApi.ts:130-135`, `types.ts:773`)

A seam test that is red when a forward is removed is planned.

**CR3 (row count): resolved.**
- `observedRowCount` is set only at `RestApiConnectorDriver:466/485`.
- `rowCapNotice` is computed solely from it (`CreateSourceEnvelope:80-90`).
- D8 sets it to `None` when `pagination` is `Some`, and the spec's "Create a paged source" scenario asserts that no notice is returned.

**CR4 (no create/infer schema): resolved.** D9 and task 4.1 state this explicitly.

**CR5 (InferredSchemaResponse.pagingNotice): resolved in mechanism, but the endpoint names are wrong (see CR-A).**
- `InferredSchemaResponse` is `jsonFormat1` (`DataSourceProtocol.scala:646`).
- It is nested in `CreateSourceResponse` (l.243), built in `CreateSourceEnvelope:60` and returned by `SourceService.inferRest` (l.332).
- No `NullOptions` is mixed in under `api/protocols` (grep), so a `None` default is omitted and existing bodies stay byte-identical.
- The CSV and SQL infer paths also construct `InferredSchemaResponse` (`DataSourceService:1393`, `SourceService:315`). They are unaffected by an optional field that defaults to `None`.

**CR6 (first request, offset progression, budget): resolved in substance, but the spec and design disagree on the budget's semantics (see CR-B).**
- D3 now specifies the request-1 params for `page` and `offset`, and the `offset + limit` progression.
- The 120 s budget and the 20 s server-timeout risk are recorded under Risks.

**New-contradiction checks:**
- REST create/infer routing:
  - `SourceRoutes.scala:29-61`: REST create is `POST /api/sources` (`sourceService.createRest`).
  - `SourcePreviewRoutes.scala:46-66`: REST infer is `POST /api/sources/infer` (`sourceService.inferRest`).
  - `DataSourcePreviewRoutes.scala:86-110`: `POST /api/data-sources/infer` is the multipart CSV infer (`dataSourceService.infer(bytes)`).
  - `DataSourceRoutes.scala:146-147`: `POST /api/data-sources` takes only static or multipart create.
  - The canonical `openspec/specs/schema-inference/spec.md:91/106` agrees with these routes.
- `UpdateDataSourceRequest(name: Option[String])` (`DataSourceProtocol.scala:158`): no update route carries REST config.
- Proposal, design, tasks and spec now agree that only the run and sample routes page.

### Verdict: REFUTE

All six round-1 change requests are addressed, and the technical core is sound. The revisions introduced two contract defects in the spec and design. Both are cheap to fix, but each would otherwise be archived into the canonical spec or force the executor to choose a meaning.

### Change Requests

1. **CR-A. The REST create/infer endpoints are misnamed in the spec, D9 and the test plan.**
   - REST create is `POST /api/sources` and REST infer is `POST /api/sources/infer` (`SourceRoutes.scala:29-61`, `SourcePreviewRoutes.scala:46-66`).
   - `POST /api/data-sources/infer` is the multipart CSV infer (`DataSourcePreviewRoutes.scala:86`). `POST /api/data-sources` takes only static or multipart create (`DataSourceRoutes.scala:146-147`).
   - The wrong names appear in these places:
     - spec.md, scenario "Unconfigured infer with a next field": `POST /api/data-sources/infer`
     - design.md D9, "Wire placement": "the body of `POST /api/data-sources/infer`" and "`POST /api/data-sources` REST create"
     - design.md test plan, "Envelope and wire": "on both `POST /api/data-sources` and `POST /api/data-sources/infer`"
     - tasks.md 3.6: "`/api/data-sources/infer`"
   - As written, the mandated route-level wire tests target routes that cannot accept a REST config, and the archived spec would state a false contract.
   - Required revision: rename every occurrence to `POST /api/sources` and `POST /api/sources/infer`. The design's own non-goals section already uses `/api/sources/infer|test` correctly.
2. **CR-B. The time-budget semantics differ between spec and design.**
   - The spec says a paged fetch "SHALL fail ... if its pages have not completed within a total time budget of 120 seconds".
   - D3 checks the budget only before each page is issued (step 6). Two consequences follow:
     - A page issued at 119 s still runs to its own ceiling, so real worst-case wall clock is about 120 s plus one page.
     - If the budget elapses during the last page, that page ends the loop with no next request, and the fetch succeeds even though pages did not complete within 120 s.
   - Required revision: pick one meaning and make spec, D3 and the test plan's "Time budget" case agree. Either:
     - enforce a true deadline, by giving each page a timeout of `min(per-page, remaining)` or wrapping the whole loop in a deadline, or
     - reword the spec to "no page is issued after 120 s have elapsed" and record the "+ one page" overrun in Risks.

### Non-blocking notes

- Spec requirement 1 says an invalid config is rejected with `400` "on create and update". No REST config update route exists (`UpdateDataSourceRequest` carries only `name`). Say "on create, infer and test" (and the inline pipeline root), or drop "update".
- Spec, "Only pipeline runs page": "the inline pipeline dry run" means the HEL-1638 root-schema dry run (`dryRunRestSchema` → `inferSchemaFor*Connector`, single request). A dry *pipeline run* (`runService.submit(isDry = true)`, `DraftSaveService:174`) goes through the engine and will page. That follows from "only pipeline runs page", but a sentence would prevent a misreading.
- D9: for a bare-`url` infer that carries `pagination`, `toEphemeral` drops it after validation. The notice rule ("config has no `pagination`") must then be evaluated on the request payload, not on the `EphemeralRestConfig`. Say so, or the dropped key will make a configured request emit a notice.
- The "per-page 30 s ceiling" in D3 and D7 is the 2xx body `toStrict(30.seconds)` (`RestApiConnectorDriver:361`). Time-to-headers is governed by the client pool settings, not by that 30 s. This only matters for the arithmetic in CR-B.
