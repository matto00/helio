## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All three ticket ACs addressed explicitly:
  1. "Create SQL/CSV/REST → list_source_objects → build pipeline" — verified live: created a CSV
     source (multipart), a REST source (bad URL), and a SQL source (bad role) against a running
     backend; the CSV/REST/SQL companion DataType is confirmed present via `GET /api/types` (the
     backend surface `list_source_objects` reads from).
  2. "End-to-end source → pipeline → dashboard, no manual UI step" — this ticket's scope is
     source-creation only (design.md explicitly scopes `create_pipeline`/`create_dashboard`/etc. as
     pre-existing, untouched tools); no regression to that chain was introduced.
  3. "Credentials handled safely" — verified live: a REST bearer token and a SQL password never
     appeared raw in either the success (`"***"` redaction) or error (`fetchError`/DDL-rejection
     message) paths.
- tasks.md's 13 items all correspond to code actually present (postMultipart, types, three
  helioApi wrappers, three registered tools, description update, README update) — no
  reinterpretation.
- No scope creep — diff touches exactly the 4 files + README called out in proposal.md's Impact
  section, plus planning artifacts. No backend/frontend/schema files touched.
- No regressions: `httpClient.ts`'s `send`/`dispatch` refactor is behavior-preserving (JSON POST/
  GET/PATCH paths unchanged; only the network-dispatch guts were extracted into a shared private
  method) — confirmed by exercising existing JSON-based calls (login, source list, type list)
  against a live backend with no failures.
- No API contract changes — three new MCP tools call pre-existing backend endpoints with
  payload shapes that match the frontend's established `dataSourceService.ts` usage 1:1 (verified
  by reading `SourceRoutes.scala`/`DataSourceProtocol.scala`/`DataSourceRoutes.scala` against both
  the new MCP wrapper and the frontend's existing caller).
- Planning artifacts (proposal/design/tasks/spec) match the final implementation; files-modified.md
  is accurate.

### Phase 2: Code Review — PASS
Issues: none blocking.

- `httpClient.ts`'s `postMultipart` correctly omits a manual `Content-Type` (relies on `fetch`
  setting the multipart boundary) — verified this actually works end-to-end against the real
  backend's `Multipart.FormData` unmarshaller (CSV source created successfully).
- DRY: the `send`/`postMultipart` → shared `dispatch` extraction removes what would otherwise be
  duplicated 401/error/204/network-failure handling — a genuine, well-motivated refactor, not
  over-engineering.
- Types: `CreateSourceResult`/`RestAuthInput`/`RawCreateSourceResponse` are precisely typed, no
  `any`. The `Option`-omitted-on-wire → explicit-`null` normalization in `helioApi.ts` is documented
  and consistent with the codebase's established spray-json gotcha (per user's own project memory
  on this exact pattern).
- Security: credential redaction is correctly *verified, not re-implemented* (per design.md's own
  stated decision) — confirmed live that bearer token and SQL password are never echoed raw in any
  success or error path, including the DDL-rejection error message.
- Error handling: `guarded()` (pre-existing pattern, reused not duplicated) surfaces backend errors
  verbatim including status/url, matching the existing `create_data_source` tool's convention.
- No dead code, no TODO/FIXME, no console.log left in the diff.
- Tests: `helio-mcp` has no unit-test harness (established in prior HEL-148 phases, not a gap
  introduced by this ticket) — tasks.md correctly scoped verification to build/typecheck + manual
  exercise against a live backend, which I re-ran independently (see Gates below) rather than
  trusting the executor's report.
- Minor: `helioApi.ts` grew from ~262 to 350 lines, over the informational 250-line soft budget
  (still under the 400-line "propose a split" threshold) — CONTRIBUTING.md marks this budget as
  soft/informational, not mechanically enforced for TypeScript files (`check:scala-quality` is
  Scala-only). Non-blocking.

**Gates re-run independently (fresh evidence):**
- `helio-mcp`: `npm run build` (tsc) — clean, no errors.
- Root `npm run lint` — 0 warnings (zero-warnings policy).
- Root `npm run format:check` — clean.
- Root `npm run check:schemas` — in sync.
- Root `npm run check:scala-quality` — clean (34 pre-existing informational file-size warnings,
  none introduced by this diff; no Scala files touched).
- Root `npm test` — 713/713 frontend tests passed (jest --passWithNoTests for root; no backend
  files touched, `sbt test` correctly not required).
- `node scripts/check-openspec-hygiene.mjs` — reproduces the executor's claimed failure exactly:
  `change "agent-creatable-data-sources" is complete (13/13) but not archived`. This is the
  well-established "complete-but-not-yet-archived" gate that always fires before the orchestrator's
  later archive step (precedented at HEL-295 `4300ea5` and HEL-292 `727a594`, both cited correctly
  in the commit message) — **not** masking a real lint/format/test/schema/scala-quality failure,
  all of which were independently confirmed passing above. The `git commit -n` bypass is
  legitimate.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**` (archived specs) files
changed — this is an entirely `helio-mcp/` (server-side TS) change with no UI surface.

**Live functional verification performed in place of Phase 3** (since this is the ticket's actual
functional surface): started the backend on the assigned worktree ports, minted a PAT, and called
`HelioApi.createCsvDataSource` / `createRestDataSource` / `createSqlDataSource` directly against
the compiled `dist/` build:
- CSV: multipart upload succeeded; source + companion DataType created; response contains no CSV
  content echo.
- REST: bad hostname → `dataType: null`, `fetchError: "...UnknownHostException: example.invalid"`;
  bearer token `"super-secret-token-xyz"` never appeared in the raw JSON response (redacted to
  `"***"`).
- SQL: bad role → `dataType: null`, `fetchError: "...role \"baduser\" does not exist"`; password
  `"super-secret-password-xyz"` never appeared raw (redacted to `"***"`).
- SQL DDL (`DROP TABLE users`) → rejected with `400 Bad Request: Query contains DDL/DML keywords...`
  verbatim, no source created.
- Companion DataType confirmed inspectable via `GET /api/types` for the CSV source.
- All test data (3 sources, 1 PAT) cleaned up after verification; backend process stopped.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `helio-mcp/src/helioApi.ts` is now 350 lines (soft budget 250, informational only) — if a future
  ticket adds another source kind, consider splitting the `create*DataSource` methods into a
  dedicated module (e.g. `helioApi.sources.ts`) rather than growing this file further.
