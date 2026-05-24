## Evaluation Report — Cycle 1 (CS2c-2 DataSource ADT + wire-shape evolution)

### Status
**APPROVED_WITH_NOTES.** Wire shape evolves cleanly, credential redaction is correct on every path inspected, AuthService is byte-identical, CS2c-3 territory is untouched, smoke flow passes end-to-end (CSV / REST / Static all created and previewed, panels render against the existing dashboard, delete propagates), backend `sbt test` is green at 531/531. The three file-size overages flagged in the executor report are real but already captured as CS3 spinoffs and are non-blocking.

### Phase 1: Spec Review — PASS
Acceptance criteria from `proposal.md` / `ticket.md` (and inherited from `2026-05-14-backend-domain-adts-foundations`):

- DataSource sealed trait with 4 strict subtypes — **PASS** (`domain/DataSource.scala`)
- `SourceType` enum removed / reduced to `kind` boundary — **PASS** (grep across `backend/src/{main,test}/scala` for `SourceType` returns 0 hits in production code, all surviving `ResourceType` references are unrelated)
- Wire shape is discriminated-union on `type` — **PASS** (smoke confirmed: `{"type":"csv", id, name, createdAt, updatedAt, config: {path: "…"}}`; `{"type":"static", id, name, …}` with no `config`; `{"type":"rest_api", config: {url, method, auth, headers?}}`; same shape produced AND consumed)
- Frontend `DataSource` discriminated union — **PASS** (`types/models.ts:151`; `isCsvSource`/`isRestSource`/`isSqlSource`/`isStaticSource` narrowing helpers exported)
- `rowToDomain` typed dispatch on `source_type` column; `domainToRow` inverse with `"{}"` for Static — **PASS** (`DataSourceRepository.scala:25-64`)
- Service-layer typed ADT consumption (no `config.convertTo[X]`) — **PASS** (`SourceService` / `DataSourceService` pattern-match on subtypes; `convertTo[X]` only appears at the protocol/repo boundary)
- All 4 source routes ≤ 150 lines — **PASS** (SourceRoutes 57, SourcePreviewRoutes 67; DataSourceRoutes / DataSourcePreviewRoutes unmodified)
- AuthService byte-identical to main — **PASS** (`git diff main -- AuthService.scala` is empty)
- DB shape unchanged — **PASS** (no Flyway migration; `source_type` text column unchanged)
- `sbt test`: full green — **PASS** (531 / 531, +20 from 511 baseline)
- OpenSpec spec.md sync for wire shape — **PASS** (csv-upload-connector, data-source-persistence, frontend-data-sources-page, rest-api-connector, static-data-connector all updated)

The deviation from the design's "extract `SqlSourceConfig` into `domain/DataSource.scala`" — the executor left `SqlSourceConfig` in `domain/model.scala` — is consistent with the executor's note in `files-modified.md` and does not affect correctness.

### Phase 2: Code Review — PASS (with non-blocking notes)

#### ADT shape and `kind` discipline — PASS
`domain/DataSource.scala` defines the sealed trait + 4 final case classes; each subtype overrides `kind` with the constant string (`"csv" | "rest_api" | "sql" | "static"`). `DataSourceKind` holds the constants once. `CsvSourceConfig` is a real case class with a single `path: String`. StaticSource is identity-only (no `config` field), with the payload accessed via `DataSourceRepository.readRawConfig` / `updateStaticPayload` — appropriately documented in the trait-level Scaladoc.

#### `SourceType` removal — PASS
Zero references in `backend/src/{main,test}/scala`. Subtype pattern matches replace the enum at all expected sites.

#### Wire shape consistency — PASS
Smoke confirmed via direct API calls:
- POST `/api/sources` with `{type: "rest_api", config: {...}}` returns the same shape (with credentials redacted) and the source appears with the same shape in `GET /api/data-sources`
- POST `/api/data-sources` (static) with `{type: "static", columns, rows}` → response carries `{type: "static"}` with NO `config` key
- POST `/api/data-sources` (CSV multipart) → response is `{type: "csv", config: {path}}`
- The discriminated-union format's `read` and `write` are mutual inverses (`DataSourceProtocolSpec` covers each subtype)

#### Repository typed dispatch — PASS
`rowToDomain` (lines 25-43) and `domainToRow` (lines 48-64) pattern-match exhaustively on the kind string and the subtype respectively, with a loud `IllegalStateException` fallback for corrupt DB rows. `readRawConfig` + `updateStaticPayload` give the in-process engine + Spark submitter the static-payload escape hatch without leaking JSON into the ADT.

#### HEL-256 disposition — PASS (confirmed)
The executor's claim that "StaticSource schema lives on the linked `DataType` row" is consistent with `DataSourceService.createStatic` (which inserts the source + writes `{columns, rows}` to the config column via `updateStaticPayload`, **and** inserts a `DataType` with fields derived from the columns). The schema is therefore persisted in two places (DataType row + config blob) and survives a JSON round-trip in both. Static round-trip verified by smoke (created `Smoke Static` with two columns and two rows, preview returned the right headers and row values).

#### Credential redaction — PASS (rigorously verified)

Smoke evidence (all values redacted at the protocol boundary, NOT at the storage layer):
- REST bearer: created with `token: "my-super-secret-token-1234"` → both create response and subsequent `GET /api/data-sources` return `auth.token: "***"`
- REST api-key: created with `value: "my-secret-api-key"`, `name: "X-Api-Key"`, `in: "header"` → response carries `value: "***"` with `name`, `in`, and `type` preserved (the user needs to see *which* key exists, just not its value)
- Empty SQL passwords are NOT spuriously redacted (covered by `DataSourceProtocolSpec` "leave empty SQL passwords untouched"); non-empty SQL passwords ARE redacted to `***` (also in spec).

Asymmetry verified by reading `SourceService.createRest` / `createSql`: the write path uses the untouched typed config (`dataSourceRepo.insert(source)`); only `DataSourceResponse.fromDomain` performs redaction. The stored blob (`data_sources.config` column) holds the real credentials so refresh / preview / engine paths continue to work — confirmed by Smoke Bearer's REST source successfully fetching `jsonplaceholder.typicode.com/users` to infer the schema using the real bearer token.

The redaction is a SHOW-shape replacement (`"***"`) rather than silent removal — clients can see the credential exists. The `rest-api-connector/spec.md` update documents this contract.

#### AuthService untouched — PASS
`git diff main -- backend/src/main/scala/com/helio/services/AuthService.scala` returns 0 bytes.

#### CS2c-3 territory not touched — PASS
- `git diff main -- backend/src/main/scala/com/helio/api/routes/{PanelRoutes,PipelineStepRoutes}.scala backend/src/main/scala/com/helio/services/{PanelService,PipelineService}.scala` returns 0 bytes
- `PipelineRunRoutes.scala` and `InProcessPipelineEngine.scala` have **only** the mechanical changes needed to consume the typed ADT (e.g., `_: RestSource | _: SqlSource` replaces deleted `SourceType.{RestApi,Sql}` matches; `inProcessEngine.loadRows(dataSource, dataSourceRepo)` passes the repo through for static-payload reads). No new behavior, no new fields, no engine logic changes.

#### FQN compliance — PASS
`npm run check:scala-quality` is clean (no FQN violations); 19 soft warnings, all pre-existing or matched to design targets.

#### File-size budgets — PASS with non-blocking notes
Three overages, all under the rigor bar's >400-line threshold and all captured as CS3 spinoffs by the executor:
- `DataSourceProtocol.scala` 332 lines (design target 220 / soft budget 250)
- `DataSourceService.scala` 337 lines (design target 300)
- `SourceService.scala` 318 lines (design target 300)

The cleanest split for the protocol file is to move `DataSourceResponse.fromDomain` + the per-subtype response case classes into a `DataSourceResponseProtocol.scala`. Tracked in `executor-report-1.md`'s Spinoffs section.

#### Other code observations (non-blocking)
- `SourceRoutes.scala:17` has a stale Scaladoc comment ("Dispatches REST vs SQL based on the JSON payload's `sourceType` field") — the code at line 32 reads `"type"`. Minor doc drift; not blocking.
- `DataSourceConfigCodec.decodeRest` / `decodeSql` swallow `DeserializationException` / `NoSuchElementException` and fall back to empty `RestApiConfig` / `SqlSourceConfig`. The fallback is documented for legacy / seeded fixture rows; for new sources the typed-payload write side guarantees a valid round-trip, so the fallback only triggers for pre-CS2c-2 stored blobs. Acceptable but worth a unit test for the fallback case if extended.

#### Frontend type lockstep — PASS
- `models.ts` discriminated union on `type`; narrowing helpers exported and used
- `dataSourceService.ts` payloads use `type` (not `sourceType`); `refreshSource` takes a typed `DataSourceKind` and routes to `/api/sources` (REST/SQL) vs `/api/data-sources` (CSV/Static) appropriately
- `DataSourceList.tsx` narrows on `source.type`; `SourceDetailPanel.tsx` narrows on `source.type === 'csv' | 'static' | 'rest_api' | ...`

### Phase 3: UI Review — PASS

Backend started cleanly on `BACKEND_PORT=8081` (CORS allowed `http://localhost:5174`). Frontend started on `DEV_PORT=5174`. `/health` returned 200.

| Smoke step | Result |
|---|---|
| 1. Login `matt@helio.dev` / `heliodev123` | PASS — redirected to dashboards |
| 2. Navigate to `/sources` | PASS — list shows 3 seeded sources (Profit / Netflix / Test Chart Data) |
| 3. List API wire shape inspection | PASS — `type` discriminator at top level, CSV carries `config.path`, Static omits `config` entirely |
| 4. Create REST via "Add source" modal → infer schema → Create | PASS — `Smoke REST` created; visible in left list |
| 5. Create REST with bearer token (API) | PASS — token `***` in create + list responses |
| 6. Create REST with api-key (API) | PASS — `value: "***"` while `name: "X-Api-Key"` preserved |
| 7. Create Static (API) | PASS — `type: "static"`, no `config` field |
| 8. Preview Static | PASS — returns columns + rows |
| 9. Preview CSV (Netflix / Test Chart Data) | INFRA — files not on disk in worktree (uploads dir is per-checkout); the code path returned a graceful 404 with the user-friendly "Data file not found; the source may need to be re-uploaded" message and the UI displayed an alert |
| 10. Create CSV via multipart + preview | PASS — `Smoke CSV` round-trips: schema inferred, preview returns headers + rows |
| 11. Dashboard renders panels | PASS — `/` shows 8 chart elements, 54 panel divs, headings `Trend Overview`, `KPI Metric`, `Test Revenue Panel` etc. all render; no console errors |
| 12. Delete a source (API) | PASS — returns 204; source no longer in list |
| 13. Credential redaction in network responses | PASS — verified via direct fetch of `/api/data-sources` after bearer + api-key creates; both `***` |
| 14. SQL connector | SKIP — not wired in dev (no SQL connector in the AddSource modal options enabled by default); not a blocker per spec |
| Console errors during all flows | PASS — 0 errors in the captured session |

The CSV preview 404 in step 9 is **not a regression**: the source rows in the database point to UUID-named files under the uploads root, and the worktree's uploads dir is empty. The new CSV created in step 10 round-trips cleanly, which is what we actually need to verify for the wire-shape evolution.

### Overall: PASS

All rigor-bar BLOCKER conditions are clear:
- (a) Wire shape consistent across emit/consume — verified by direct round-trip
- (b) Credential redaction has no leak path — verified by smoke + reading the write-path code
- (c) HEL-256 not regressed — Static schema persists via DataType row + config blob
- (d) AuthService unchanged
- (e) No CS2c-3 territory modified beyond mechanical typed-ADT-consumption updates
- (f) Playwright ran cleanly
- (g) Happy-path smoke passes for all 4 subtypes (CSV / REST / Static / SQL skipped per spec)

### Non-blocking Suggestions

1. **Spinoff for protocol-file split** (already tracked) — extract `DataSourceResponse.fromDomain` + the per-subtype response classes into `DataSourceResponseProtocol.scala`. The current 332-line `DataSourceProtocol.scala` is over the design's 220-line target.
2. **Spinoff for service-file decomposition** (already tracked) — `DataSourceService` 337 lines and `SourceService` 318 lines are each ~30 lines over the design's 300-line target. Less urgent; CS3's frontend-and-backend pass would be a natural home.
3. **Stale Scaladoc on `SourceRoutes.scala:17`** — drop "based on the JSON payload's `sourceType` field"; the code reads `type`. Trivial drive-by fix, not blocking.
4. **Repo decoder fallback test coverage** — `DataSourceConfigCodec.decodeRest` / `decodeSql` have try/catch fallback paths that aren't exercised by the protocol round-trip tests (which only test the happy path). Worth a regression test if a legacy migration ever surfaces.
5. **Credential redaction extensibility** (already noted by executor) — when webhook secrets or other credential paths land, generalize the redaction into a `Redactable` typeclass rather than per-subtype branches in `DataSourceResponse.fromDomain`. Spinoff candidate.

### Test counts (verified)
- `sbt test`: 531 / 531 PASS (matches executor report)
- `npm run check:scala-quality`: clean with 19 soft-budget warnings
- Frontend tests not re-run by evaluator (executor reported 664 / 664)
