## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth re-established**
- Read `ticket.md` (3 ACs), `proposal.md`, `design.md`, `tasks.md`,
  `specs/mcp-data-source-tools/spec.md`, both `skeptic-design-*.md` rounds, `evaluation-1.md`,
  `files-modified.md` — treated all as claims, not facts.
- `git diff 761707b...9e6e30c --stat` — confirmed the diff touches exactly
  `helio-mcp/src/{httpClient.ts,helioApi.ts,types.ts,tools/write.ts}` + `helio-mcp/README.md` +
  planning artifacts. No backend/frontend/schema files touched, matching the proposal's Impact
  section and `files-modified.md`.
- Read all four changed `helio-mcp/src/*` files in full (not excerpts).

**Design-gate contradiction (CSV response shape) — confirmed shipped code matches the
*corrected* plan, not the original mistaken claim**
- `backend/src/main/scala/com/helio/api/routes/DataSourceRoutes.scala:79-110` — `createCsvRoute`
  completes with `DataSourceResponse.fromDomain(ds)` only; no `dataType` field on the wire.
- `backend/src/main/scala/com/helio/services/DataSourceService.scala:87-133` — `createCsv`
  inserts a companion `DataType` then discards it (`.map(_ => Right(ds))`); return type is
  `Future[Either[ServiceError, DataSource]]`, structurally incapable of returning it.
- `helio-mcp/src/helioApi.ts:198-203` — `createCsvDataSource` is typed
  `Promise<DataSourceResponse>` (flat, no `dataType`), matching ground truth and the
  round-2-corrected `spec.md`/`design.md`, not the round-1 (refuted) claim that CSV returns the
  companion DataType inline.
- `helio-mcp/src/helioApi.ts:211-267` — `createRestDataSource`/`createSqlDataSource` are typed
  `Promise<CreateSourceResult>` (`{source, dataType, fetchError}`), matching
  `backend/.../SourceService.scala:38-145`'s genuine `CreateSourceResponse(source, dataType =
  Some(...)/None, fetchError = ...)` construction.
- **Live-verified this exact asymmetry myself** (see below) — not just read.

**Credential redaction — live-verified, not just read**
- `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala:172-187` —
  `redactRestPayload`/`redactRestAuth` mask bearer token/api-key value to `"***"`;
  `redactSqlPayload` masks non-empty passwords. Applied inside `fromDomain`, which both
  `createSql`/`createRest` (`SourceService.scala`) call to build `CreateSourceResponse.source`.
- Started the app: `scripts/concertino/start-servers.sh` → `READY backend=…` `READY frontend=…`;
  `scripts/concertino/assert-phase.sh servers … → PASS servers`.
- Minted a PAT via `POST /api/tokens` against the running backend (port 8374).
- Ran `helio-mcp/dist/helioApi.js` functions directly against the live backend with real secrets:
  - REST with `auth: {type: bearer, token: "super-secret-bearer-xyz-123"}` against an unreachable
    host → response `{"source":{"config":{"auth":{"token":"***",...}}},"dataType":null,
    "fetchError":"...UnknownHostException..."}` — secret token verified absent from the full
    JSON string.
  - SQL with `password: "super-secret-password-xyz-456"` and a bad role → response
    `{"source":{"config":{"password":"***",...}},"dataType":null,"fetchError":"...role \"baduser_
    skeptic\" does not exist"}` — secret password verified absent from the full JSON string.
  - REST with `api_key` auth (`value: "super-secret-apikey-999"`) against a real reachable
    endpoint (`jsonplaceholder.typicode.com`) — success path returned the companion DataType
    inline (`dataType: {...}`, `fetchError: null`) and the api-key value was verified absent
    (redacted to `"***"`) even on the success path.
  - **Repeated the same three checks a second time through the real MCP protocol** (stdio,
    `@modelcontextprotocol/sdk` `Client`/`StdioClientTransport`, calling `client.callTool(...)`
    against the built `dist/index.js` server, not just the raw `helioApi.ts` functions) — same
    redaction result, confirming the zod-validated tool boundary doesn't leak the secret either.
- SQL DDL rejection: `create_sql_data_source` with `query: "DROP TABLE users"` /
  `"DELETE FROM foo"` → `400 Bad Request: Query contains DDL/DML keywords (CREATE, DROP, ALTER,
  DELETE, INSERT, UPDATE, TRUNCATE) which are not permitted` verbatim, `isError: true`, no source
  created — matches `SqlConnector.checkQuery` (`backend/.../SqlConnector.scala:13-22`) and
  `spec.md`'s scenario exactly.

**AC1 + AC2 — full chain live-verified end to end (not inferred)**
Ran the actual chain through `HelioApi` against the live backend: created a CSV source with
inline content → `listSourceObjects` (confirmed `previewKind: "csv"`, headers/rows correctly
surfaced the 2-column, 3-row content) → `createPipeline` over the source id → `runPipeline`
(synchronous, `status: "succeeded"`, `rowCount: 3`) → `createDashboard` → `createPanel` →
`bindPanel` to the pipeline's `outputDataTypeId` — succeeded end-to-end with **zero manual UI
steps**, directly satisfying both AC1 ("create → list_source_objects → build a pipeline") and
AC2 ("source → pipeline → dashboard, no manual UI step"). This closes the one non-blocking gap
the design-gate skeptic flagged (round 2: "AC2's claim is inferred rather than empirically
verified") — it is now empirically verified, at least for CSV; REST/SQL sources feed the same
pipeline engine (`PipelineRunService.scala:86-87,116-117` pattern-matches `RestSource`/`SqlSource`
explicitly, confirmed in round-2 design review) so the same chain applies to them without new
code.
- Confirmed via the real MCP protocol layer that `create_data_source`'s tool description was
  updated to read "For a real integration use create_csv_data_source, create_rest_data_source, or
  create_sql_data_source instead" — matches tasks.md 3.4 and the proposal.
- All test data (7 data sources + 1 dashboard/panel/pipeline chain + 2 PATs) created during
  verification was deleted afterward via `DELETE /api/data-sources/:id` (204 for all); dev
  servers stopped (`fuser -k` on both assigned ports).

**Gates re-run myself (fresh evidence, not trusting the evaluator's paste)**
- `helio-mcp`: `npm run build` (tsc) — clean, no errors.
- Root `npm run lint` — `eslint . --max-warnings=0` — clean, 0 warnings.
- Root `npm run format:check` — `prettier . --check` — clean.
- Root `npm run check:schemas` — "schemas in sync with JsonProtocols (10 checked across 16
  protocol files)".
- Root `npm run check:scala-quality` — "clean (34 soft warning(s))" — same 34 pre-existing
  informational file-size warnings the evaluator cited; none introduced by this diff (no Scala
  files touched — confirmed by the `git diff --stat` above).
- Root `npm test` — `jest --passWithNoTests` (root, no tests) + frontend suite: **713/713
  passed, 61/61 suites**, matching the evaluator's claim exactly.
- `npm run check:openspec` — reproduces the same "complete (13/13) but not archived" hygiene
  finding the executor's commit message and evaluation-1.md cite; confirmed this is the
  well-established pre-archive gate (not masking a real failure) since every other gate above
  passed independently under my own re-run.
- Read the commit (`9e6e30c`) message directly — the `-n` bypass is explicitly called out with
  the same reasoning verified above (all other hooks re-run clean before the commit).

**Code quality**
- `httpClient.ts`'s `dispatch()` extraction is a genuine, behavior-preserving refactor (verified
  by reading `send`/`postMultipart` both delegate to it unchanged in status/401/204/error-body
  handling) — not a regression risk on the pre-existing JSON paths, and I independently exercised
  the JSON `get`/`post`/`patch` paths (login, listDataSources, listSourceObjects, createPipeline,
  runPipeline, createDashboard, createPanel, bindPanel — all JSON-path calls) with no failures
  during live verification above.
- No `any`, no dead code, no TODO/FIXME in the diff.
- Types (`RestAuthInput`, `CreateSourceResult`, `RawCreateSourceResponse`) are precisely typed and
  documented; the `Option`-omitted-on-wire → explicit-`null` normalization matches the codebase's
  documented spray-json gotcha.
- No UI surface — `helio-mcp/` only, no `frontend/**`/`ApiRoutes.scala`/`schemas/**` touched, so
  DESIGN.md's token/light-dark-parity review does not apply. Live functional verification (above)
  substitutes for the UI-judgment step this gate would otherwise perform.

### Verdict: CONFIRM

### Non-blocking notes
- `helio-mcp/src/helioApi.ts` is 350 lines (soft budget 250, informational only per
  CONTRIBUTING.md for TS files) — matches evaluator's note; a future source-kind addition should
  consider splitting `create*DataSource` into a dedicated module.
- `scripts/compose.ts` (the write-tool composition harness) still only exercises `static` sources,
  not the three new kinds — I closed this gap manually for CSV this round (see AC1/AC2 evidence
  above) but a permanent addition to `compose.ts` covering at least one non-static kind would make
  future regressions in this chain catch automatically rather than requiring another live-manual
  pass.
- `spec.md`'s REST scenarios still don't have an explicit `api_key`-auth scenario (carried over
  from design gate round 2's non-blocking note) — I exercised it live myself this round and it
  redacts correctly; still worth adding to spec.md for completeness, not blocking.
