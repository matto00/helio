## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket / AC read**: `openspec/changes/agent-creatable-data-sources/ticket.md` — three ACs:
  (1) create → `list_source_objects` → build pipeline via MCP alone, (2) full E2E with no manual
  UI step, (3) credentials never echoed back.
- **Proposal/design/tasks/spec read** in full (`proposal.md`, `design.md`, `tasks.md`,
  `specs/mcp-data-source-tools/spec.md`).
- **CSV endpoint ground truth** —
  `backend/src/main/scala/com/helio/api/routes/DataSourceRoutes.scala:79-110` (`createCsvRoute`):
  multipart parts are `name`/`file`/`fields`; on success returns
  `StatusCodes.Created -> DataSourceResponse.fromDomain(ds)` — i.e. the **flat** source response
  only (`CsvSourceResponse{id,name,createdAt,updatedAt,config}`), no `dataType` field anywhere in
  the wire shape. Confirmed in
  `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala:26-34`.
- **`DataSourceService.createCsv`**
  (`backend/src/main/scala/com/helio/services/DataSourceService.scala:87-133`): it *does* create a
  companion `DataType` server-side (`dt`) and inserts it, but the method signature is
  `Future[Either[ServiceError, DataSource]]` — the created `DataType` is inserted and then
  discarded (`dataTypeRepo.insert(dt, user).map(_ => Right(ds))`), never returned to the caller.
  So there is no way for the HTTP response of `POST /api/data-sources` (CSV) to carry the
  companion DataType — by construction, not by oversight in this change.
- **REST/SQL endpoint ground truth** —
  `backend/src/main/scala/com/helio/services/SourceService.scala:38-145` (`createSql`/`createRest`):
  both genuinely return `CreateSourceResponse{source, dataType: Option[DataTypeResponse], fetchError}`,
  with `dataType` populated on success. The design/proposal's characterization of the REST/SQL
  return shape is accurate.
- **Existing `create_data_source` tool** (static) —
  `helio-mcp/src/helioApi.ts:163-179`, comment already on record: *"Returns the flat
  DataSourceResponse (static create is NOT the `{source,dataType}` wrapper shape the REST/SQL
  `/api/sources` endpoint returns)."* This is the same route family (`DataSourceRoutes`, same
  `DataSourceResponse.fromDomain(ds)` pattern) that CSV creation will use. The codebase already
  documents, for the sibling static case, exactly the asymmetry this plan gets wrong for CSV.
- **Credential redaction claims** — verified accurate.
  `DataSourceProtocol.fromDomain` (lines 138-170) redacts REST bearer/api-key
  (`redactRestPayload`/`redactRestAuth`, lines 175-182) and SQL passwords
  (`redactSqlPayload`, lines 186-187) uniformly, and `CreateSourceResponse.source` in both
  `createSql`/`createRest` is built via this same `fromDomain` — so the design's claim
  "`CreateSourceResponse.source` goes through the same `fromDomain` conversion, so it's redacted
  for free" is correct. Error-path messages (`ServiceError.BadRequest` from `RestApiConfigPayload
  .toDomain`, `SqlConnector.checkQuery`, the CSV 413 message) are all static strings that never
  interpolate the raw config — the "no error path echoes raw config" claim holds.
- **SQL DDL/DML keyword rejection** — `SqlConnector.checkQuery` rejects exactly
  `CREATE, DROP, ALTER, DELETE, INSERT, UPDATE, TRUNCATE` before the source is inserted
  (checked prior to `dataSourceRepo.insert` in `createSql`), matching spec.md's scenario verbatim.
- **`httpClient.ts` has no multipart support today** (only `get`/`post`/`patch`, JSON-only
  `send()`), confirming the design's stated need for a new `postMultipart` method.
- **No CSV-by-URL endpoint exists** — `DataSourceRoutes.scala`'s only `POST` handlers under
  `/data-sources` are `createStaticRoute` and `createCsvRoute` (multipart); the design's
  "no such backend endpoint exists" non-goal claim is accurate.
- **`list_source_objects` and `create_pipeline` key off `sourceId`, not a DataType id**
  (`helio-mcp/src/tools/read.ts:79-91`, `SourcePreviewRoutes.scala:60-64`,
  `helio-mcp/src/tools/write.ts:53-69`) — so the ticket's literal AC chain (create → inspect →
  pipeline) does not actually require the create tool to return a DataType id; the design's extra
  self-imposed requirement to "surface the companion DataType" is aspirational, not AC-driven.
- No `TODO`/`TBD`/hand-waving found anywhere in the four artifacts (`grep -rniE` clean).

### Verdict: REFUTE

### Change Requests

1. **`specs/mcp-data-source-tools/spec.md` (create_csv_data_source Requirement, lines 3-11) is
   factually wrong about the return shape, and contradicts `tasks.md` task 2.1's own typed
   signature.** The requirement text says the tool "returns the created source's id and its
   auto-created companion DataType," and design.md's Goals section makes the same claim generally
   ("surface the auto-created companion DataType id") — but the backend's actual CSV-create
   response (`DataSourceRoutes.createCsvRoute` → `DataSourceResponse.fromDomain(ds)`) is a flat
   `CsvSourceResponse` with **no `dataType` field at all**; the companion DataType is created and
   inserted server-side but discarded before the HTTP response is built
   (`DataSourceService.createCsv`, `.map(_ => Right(ds))`). `tasks.md` 2.1 correctly types
   `createCsvDataSource(...)` as `Promise<DataSourceResponse>` (matching ground truth) — which
   means task 4.1's verification step ("confirm companion DataType is returned" for CSV, alongside
   REST/SQL) is unexecutable as written, and spec.md's scenario is untestable/false for CSV.
   **Required revision** (pick one, make it explicit in both design.md and spec.md before
   implementation):
   - (a) — the low-risk fix, consistent with the existing documented asymmetry for
     `create_data_source`/static (`helioApi.ts:163-167` comment) — correct spec.md's
     `create_csv_data_source` requirement to state it returns **only** the created source id (no
     `dataType` field), matching `create_data_source`'s actual established pattern, and drop the
     "companion DataType" claim from design.md's Goals for the CSV case specifically. The AC does
     not require this (list_source_objects and create_pipeline both key off `sourceId`, not a
     DataType id), so this loses nothing functionally; or
   - (b) — if DataType-parity across all three tools is actually wanted — add an explicit design
     decision + task for the CSV wrapper to make a second read call after creation (there is no
     `GET /api/types?sourceId=` filter today; it would mean listing `/api/types` and filtering
     client-side by `sourceId`, with the added latency/pagination caveat called out), and update
     `tasks.md` 2.1's return type accordingly.
   Either is fine; leaving the contradiction as-is is not — it will surface as an unplanned
   decision mid-implementation.

### Non-blocking notes

- `tasks.md` 1.1/2.1 don't pin down the exact multipart part names (`name`/`file`/`fields`) that
  `DataSourceRoutes.createCsvRoute` expects — worth a one-line note in tasks.md so the executor
  doesn't have to rediscover this, though it's a minor, easily-inferred implementation detail, not
  a design blocker.
- Everything else — REST/SQL response shape, redaction claims, SQL keyword-rejection, multipart
  necessity, three-tools-not-one rationale, non-goals (CSV-by-URL, `infer_source_schema`,
  refresh) — checked out accurate against ground truth and internally consistent.
