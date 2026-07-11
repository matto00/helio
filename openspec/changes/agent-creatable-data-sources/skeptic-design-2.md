## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- **Ticket / AC read**: `ticket.md` — three ACs: (1) create → `list_source_objects` → build
  pipeline via MCP alone, for SQL/CSV/REST, (2) full E2E source → pipeline → dashboard with no
  manual UI step, (3) credentials never echoed back.
- **Proposal/design/tasks/spec read in full** (`proposal.md`, `design.md`, `tasks.md`,
  `specs/mcp-data-source-tools/spec.md`).

**Round-1 contradiction — verified resolved and consistent across all four artifacts:**
- `proposal.md` "What Changes" (lines 15-16) now states plainly: REST/SQL return
  `CreateSourceResponse` with the companion DataType; makes no such claim for CSV.
- `design.md` Goals (lines 27-32) explicitly documents the asymmetry: REST/SQL include the
  companion DataType inline (backend genuinely returns it); CSV does not, because
  `DataSourceService.createCsv` creates the DataType server-side but discards it before returning
  — matching the existing `static` tool's precedent.
- `tasks.md` 4.1 verification step is now phrased consistently: "confirm REST/SQL responses
  include the companion DataType (CSV's does not — verify `list_source_objects` shows its shape
  instead)."
- `specs/mcp-data-source-tools/spec.md` `create_csv_data_source` Requirement (lines 3-8) now says
  the tool "returns the created source's id" only, with the companion DataType inspectable via
  `list_source_objects` — no `dataType` field claimed. REST/SQL Requirements (lines 19-23, 35-39)
  correctly claim the companion DataType is returned when the initial fetch/query succeeds.
- Re-verified against ground truth myself (not just re-reading the artifacts):
  - `backend/src/main/scala/com/helio/api/routes/DataSourceRoutes.scala:104-106` — CSV route
    completes with `DataSourceResponse.fromDomain(ds)` only (flat shape, no `dataType` field).
  - `backend/src/main/scala/com/helio/services/DataSourceService.scala:110-132` — `createCsv`
    inserts the companion `DataType` (`dataTypeRepo.insert(dt, user)`) then discards it
    (`.map(_ => Right(ds))`); signature is `Future[Either[ServiceError, DataSource]]` — structurally
    incapable of returning the DataType.
  - `backend/src/main/scala/com/helio/services/SourceService.scala:38-145` — `createSql`/
    `createRest` both genuinely construct and return
    `CreateSourceResponse(source, dataType = Some(...), fetchError = None)` on success, and
    `dataType = None, fetchError = Some(err)` on initial-fetch/query failure. This exactly matches
    design.md/spec.md's characterization, including the "still returns source id + fetchError on
    failure" scenario in spec.md (lines 30-33).
  - **Contradiction is fully resolved; no remaining inconsistency found.**

**Fresh review of the rest of the plan against ground truth (not just the one fix):**
- `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala` — `SqlSourceConfigPayload`
  fields (`dialect, host, port, database, user, password, query`) and `RestApiConfigPayload`/
  `RestApiAuthPayload` fields (`url, method, auth{type,token,name,value,in}, headers`) match
  design.md/spec.md/tasks.md's described tool input schemas field-for-field.
  `redactRestPayload`/`redactRestAuth` (lines 175-182) and `redactSqlPayload` (lines 186-187) are
  applied inside `DataSourceResponse.fromDomain`, which both `createSql`/`createRest` call to build
  `CreateSourceResponse.source` — the "redacted for free" claim holds.
- `backend/src/main/scala/com/helio/domain/SqlConnector.scala:13-22` — `checkQuery` rejects exactly
  `CREATE|DROP|ALTER|DELETE|INSERT|UPDATE|TRUNCATE` (case-insensitive) before the source is even
  inserted — matches spec.md's "Query contains a disallowed keyword" scenario verbatim.
- `backend/src/main/scala/com/helio/domain/DataSource.scala:93-105` (`DataSourceKind`) — wire values
  `rest_api`/`sql`/`csv`/`static` match what tasks.md 2.2/2.3 say to post as `type`.
- `backend/src/main/scala/com/helio/api/routes/SourceRoutes.scala` — single `POST /api/sources`
  dispatches SQL vs REST by body `type`, confirming the plan's routing description.
- `helio-mcp/src/httpClient.ts` — confirmed only `get`/`post`/`patch` exist today (JSON-only
  `send()`), substantiating the need for a new `postMultipart` method (design.md decision).
- `helio-mcp/src/tools/write.ts` / `helio-mcp/src/helioApi.ts` — the existing `create_data_source`
  tool and `createDataSource` wrapper already carry an explicit code comment documenting the same
  CSV/static asymmetry ("Returns the flat DataSourceResponse... NOT the `{source,dataType}` wrapper
  shape the REST/SQL endpoint returns") — the plan's now-corrected CSV requirement is consistent
  with an established, already-documented codebase precedent, not a novel judgment call.
  `types.ts` already defines `DataTypeResponse`/`DataSourceResponse`, confirming tasks.md 1.2's
  claim that new types only need to mirror `CreateSourceResponse`/`RestAuthInput`, reusing existing
  shapes.
- **Pipeline engine already handles non-static sources** —
  `backend/src/main/scala/com/helio/services/PipelineRunService.scala:86-87,116-117` pattern-matches
  `RestSource`/`SqlSource` explicitly, confirming AC2 (source → pipeline → dashboard, no manual UI
  step) is mechanically satisfiable today for CSV/REST/SQL sources once they exist — this ticket's
  scope (creation only) is correctly bounded; no hidden backend gap the design missed.
- No `TODO`/`TBD`/placeholder language found in any of the four artifacts.
- Non-goals (CSV-by-URL, `infer_source_schema`, refresh tooling) re-confirmed accurate:
  `DataSourceRoutes.scala`'s only `POST` handlers are `createStaticRoute`/`createCsvRoute`
  (multipart) — no CSV-by-URL route exists.

### Verdict: CONFIRM

### Non-blocking notes

- `tasks.md` 4.1 verifies each tool's *create* response shape but doesn't include an explicit task
  to run one full source → pipeline → dashboard chain over a newly-created non-static source (only
  the existing `compose.ts` harness does this for `static`). Given `PipelineRunService` already
  handles `RestSource`/`SqlSource` today, this is very likely a non-issue in practice, but a
  one-line addition to task 4 (or a follow-up in `compose.ts`) exercising the full chain for at
  least one new source kind would make AC2's "no manual UI step" claim empirically verified rather
  than inferred.
- `spec.md`'s `create_rest_data_source` scenarios cover `bearer` auth and no-auth/failure paths but
  not `api_key` auth explicitly, even though the input schema (per tasks.md 3.2) and the backend's
  `RestApiAuthPayload` support all three (`none`/`bearer`/`api_key`). Minor spec completeness gap,
  not a contradiction — the general requirement text still covers it.
- Carried over from round 1 (still unaddressed, still non-blocking): `tasks.md` 1.1/2.1 don't pin
  the exact multipart part names (`name`/`file`/`fields`) `DataSourceRoutes.createCsvRoute` expects
  — a one-line note would save the executor a lookup, but it's trivially discoverable.
