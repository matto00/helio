## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: `feature/rest-source-pagination/HEL-1013` at 5613ea63fdae31dbd1b1fe5d28663eb3d3fb676b (no code commits yet; the change dir is untracked). The owner rulings (a) to (e) are taken as given and are not relitigated here.

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/rest-source-pagination/HEL-1013`.
- Read ticket.md, proposal.md, design.md, tasks.md, specs/rest-source-pagination/spec.md and workflow-state.md. One `escalation.answered` event is in `.concertino/runs/HEL-1013/events.jsonl`.
- **Cited code paths exist as described:**
  - `RestApiConnectorDriver.scala` is 578 lines.
    - `guardedPoolSettings` (l.340) is the single SSRF choke point for `issueAndParse` (l.345) and `issueTest` (l.416).
    - `maxStrictBytes` (l.384), `errorText` (l.392) and `countWithinLimit` (l.400) are where the design says, so the D1 extraction is feasible.
    - `fetch(config, maxRows, ...)` (l.505) does `take(maxRows)` with `availableRowCount = Some(all.size)`.
  - `ConnectorDriver.FetchOutcome(rows, truncated, availableRowCount)` is at l.53.
  - `SourceReadStats(truncated, availableRowCount)` is at `InProcessPipelineEngine.scala:66`. The REST read is at l.822 and the secondary-read sink record at l.869.
  - `PipelineRunSupport.truncationFields` (l.49) and the hand-rolled `truncatedReadsToJson` exist. The read side `PipelineRunQueries.parseTruncationRecord` (l.155) uses `fields.get("availableRowCount")`, so an optional `pagesFetched` read the same way tolerates old rows. The JSONB no-migration claim holds.
  - `TruncatedRead` is at `AssertionResult.scala:49` and `TruncatedReadResponse` at `PipelineProtocol.scala:229`. `composeTruncationNotice` (`PipelineRunService.scala:357`) already has a "total is not known" branch, so `availableRowCount = None` for a paged truncation reads correctly.
  - `RestApiConfigPayload` is `jsonFormat11` (`DataSourceProtocol.scala:653`). spray-json's `jsonFormatN` ignores unknown keys, so the rollback claim (the old decoder ignores a stored `pagination`) holds for `DataSourceConfigCodec.decodeRest` (l.57-76).
  - `CreateSourceEnvelope.rowCapNotice` (l.80) exists.
  - `SourceSampleService` (l.132) maps a truncated read to `sourceRowCount = stats.availableRowCount`. `source-sample-response.schema.json` allows `null`, so a paged truncation is representable.
- **Technical calls judged on merits:**
  - The 8 MiB limit applies per page. With rows bounded by cap+1 and requests by `maxRequests`, bytes are bounded. Wall-clock time is not bounded; see CR6.
  - Stopping at cap+1 matches HEL-861's strict `>`.
  - `pagesFetched` is optional and `availableRowCount = None` for a paged truncation. Both are coherent with the notice composer and the sample schema.
  - Whole-fetch failure with page-1 errors unchanged is sound.
  - The guard-then-origin ordering is sound. A followed blocked hostname is necessarily cross-origin, because `isBlocked` is keyed on `(host, addr)` and the page-1 host must be admitted. So only guard-first makes the guard-bypass mutation observable, and only if the test asserts the guard's own refusal text.
- **Test plan:**
  - The stub-server pattern exists (`newServerAt("localhost", 0)` plus `isBlocked = admitLocalhost` in `RestApiConnectorDriverErrorCapSpec` and `RestApiConnectorDriverBodySpec`), and the driver constructor takes `resolveHost`/`isBlocked`. Mutations (a), (b), (c) and (e) can go red as described. (d) can go red only through a message assertion (see notes).
- **Sibling lanes:**
  - No planned file overlaps HEL-1587 (`PublicPanelListResolver`, `PublicDashboardRoutes`, `PublicDashboardViewerPage`).
  - No planned file overlaps HEL-1882 (`OutputRepository`; the insight refresh start is in `services/insights/InsightRenderService.scala`, which is not touched).
  - `PipelineRunService.scala` is touched, but only `composeTruncationNotice` (l.340-360). The insight wiring there (l.114-141) is HEL-1743 code, not a HEL-1882 file.

### Verdict: REFUTE

The design is close and its core (the loop, the guard ordering, the truncation report and the JSONB claim) is sound. Six concrete defects would each produce either an ambiguous implementation or a silently broken surface. All six are cheap to fix in the artifacts.

### Change Requests

1. **D8 builds paging on a return type that cannot carry it.**
   - `fetch(config, resolveContext)` returns `Future[Either[String, JsValue]]`: the raw body, before `rootSelector`. D8 says paging "lives inside `fetch(config, resolveContext)`'s persisted-connector path", but it never says what `JsValue` a multi-page fetch returns.
   - Its callers re-apply the selector afterwards: `SourceService.previewRest` (l.484 then `toRowsEither(json, source.config.rootSelector)`) and `inferSchema` (l.465). A concatenated `JsArray` of rows would make every paged source with a `rootSelector` fail with "rootSelector '…' not found: '…' is not an object".
   - The same JsValue return type also drops the response headers that D9's `Link`-based `looksPaged` needs.
   - Required revision:
     - Specify the internal API, for example a `fetchRows(config, ctx, cap)` returning rows (selector applied per page), `truncated`, `pagesFetched` and `looksPaged`.
     - State how each caller moves onto it: `fetch(maxRows)`, `inferSchema`, `inferSchemaForConnector`, `previewRest`.
     - State what the public `fetch(config, ctx): JsValue` does for a paged config, or that it is retired or kept no-config-only.
     - State how `fetchOverride` (JsValue per config) composes with it, so the roughly 20 `fetchOverride` fixtures keep their exact `FetchOutcome` (including `availableRowCount = Some(n)`).
2. **helio-mcp would silently drop `pagination`. The planned zod change alone is not enough.**
   - Three helio-mcp sites forward REST config by explicit field enumeration:
     - `tools/write.ts:330-340` (the `create_rest_data_source` handler)
     - `helioApi.ts:709-733` (`createRestDataSource`, which builds `config` field by field)
     - `tools/pipelinesHandlers.ts:85-95` (the inline `rest_api` pipeline root)
   - Adding `pagination` to `restDataSourceSchema.ts` makes the `.strict()` schema accept the key, and the handler then discards it. That is the exact defect class `helioApi.ts:100` records ("`rowCapNotice` added (was silently dropped too)").
   - Required revision:
     - Add these three sites to the design and to task 4.2.
     - Add a seam test asserting that the outgoing `POST /api/sources` body carries `pagination` (red when the forward is removed).
     - Also relay `pagingNotice` in `RawCreateSourceResponse`/`CreateSourceResult` (`helioApi.ts:100-106, 737`; `types.ts:~915`). Otherwise the agent surface, which owner ruling (a) puts in scope, never sees the notice ruling (c) mandates.
     - Add `pagesFetched` to helioApi.ts's own truncated-read interface (l.130-135) as well as `types.ts:773`.
3. **`rowCapNotice` would state a false row count for paged inference.**
   - D8 claims "`observedRowCount` and `rowCapNotice` stay correct (it is at most cap+1, which still exceeds the cap)".
   - The notice text (`CreateSourceEnvelope.scala:87`) is "This source held $count rows when its schema was inferred". A paged inference capped at MaxRunRows would therefore assert "held 1001 rows" when the true total is unknown. That is the overstated-measurement wording HEL-861's own skeptic already corrected once.
   - Required revision: for a paged inference that stopped at the cap, specify what happens. Either `observedRowCount` carries a "lower bound" flag (or is `None` with a separate truncated signal), or the notice uses "more than N rows" wording. Add an envelope test for the paged case.
4. **The "create-source response schema" does not exist.**
   - `schemas/sources/` has no schema for `CreateSourceResponse`. `rowCapNotice`/`fetchError` appear in no schema, and `data-source.schema.json` is the `DataSourceResponse` union and is SKIP-listed in the drift check.
   - Task 4.1 ("Add optional `pagingNotice` to the create-source response schema") and D9 therefore point at nothing. An executor will either invent a new schema (drift-check and scope implications) or skip it.
   - Required revision: state which one. Either a new `create-source-response.schema.json` covering all four fields, with its drift-check handling named, or an explicit note that this envelope has no JSON-schema contract and the spec plus a Scala wire test is the contract.
5. **The infer surface for `pagingNotice` is undefined, but the spec mandates it.**
   - The spec's last requirement says the "create/infer response SHALL carry a non-blocking `pagingNotice`", and owner ruling (c) says create/infer.
   - D9 only says "and the infer response, if it shares the envelope". It does not: `SourceService.inferRest` (l.332) returns `InferredSchemaResponse(fields)` (`jsonFormat1`, `DataSourceProtocol.scala:260/646`), which is also the type nested inside `CreateSourceResponse.inferredSchema`.
   - Required revision: name the infer endpoint(s) and decide the wire change:
     - The endpoints are the `connectorId` path, and whether the bare-`url` ephemeral path, which D8's non-goals keep single-request, also gets the heuristic.
     - For the wire change, either add an optional field on `InferredSchemaResponse` (which then also appears nested in the create response) or add a wrapper.
     - Add a test for the infer case.
   - Also say what happens when a bare-`url` infer request carries `pagination`: `toEphemeral` discards it today. Is that silent single-request behaviour or a `400`?
6. **First-request shape for `page`/`offset`, and total wall-clock time, are unspecified.**
   - D3 defines only next-request derivation. It does not say whether request 1 adds `pageParam=startPage` and `pageSizeParam=pageSize`, or `offsetParam=0` and `limitParam=limit`, or is sent as configured. A competent implementer can read this two ways, and the end-detection rule ("fewer rows than the configured page size or limit") only works if the size or limit is actually sent.
   - Specify the first request, the starting offset, and that the next offset is `offset + limit`.
   - Separately, each page keeps its own 30 s ceiling, but there is no overall deadline. That allows `maxRequests` × 30 s: 10 min at the default and 50 min at 100. This affects synchronous create, infer, preview and sample requests, where the default Pekko server request-timeout of 20 s fires while the fetch keeps running, and a pipeline run's concurrency slot.
   - Either add a total time budget that fails curated (naming it), or record the unbounded total as an explicit accepted risk in Risks / Trade-offs with that reasoning. Today it is not mentioned at all.

### Non-blocking notes

- Egress test (mutation d): the guard-bypass mutation still hits the origin refusal, so the "stub log shows no page 2 request" assertion stays green under the mutation. Only an assertion on the guard's exact refusal text goes red. Make the test assert that text, not just `Left`.
- Guard-first means the server resolves DNS for a body-supplied cross-origin hostname before refusing it. That is harmless at this threat level, but worth one sentence in D4.
- `link` parsing: say how multiple `Link` headers, multi-valued `rel` (`rel="next last"`) and unquoted `rel=next` are handled. These are small, but they are exactly where a first implementation diverges from real APIs (GitHub sends a multi-link header).
- `ProposalRestApiConfig` (`PipelineProposalProtocol.scala:50`) and its `toRestApiConfigPayload` (l.91) carry no `pagination`, so assistant- and proposal-authored sources cannot page. That is fine as a follow-up, but list it beside the UI follow-up so it is not mistaken for coverage.
- D2 is right that only `data-source.schema.json` and `create-pipeline-request.schema.json` carry the REST config shape, and that only `pipeline-run-record.schema.json` carries `truncatedReads` (verified by grep).
