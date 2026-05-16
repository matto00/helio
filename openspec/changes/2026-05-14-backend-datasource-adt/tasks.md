# Tasks — backend-datasource-adt (CS2c-2)

## 0. Bind to standards

- [x] 0.1 Read `WORKTREE_PATH/CONTRIBUTING.md` in full
- [x] 0.2 Read `ticket.md`, `proposal.md`, `design.md` (and inherit from `openspec/changes/2026-05-14-backend-domain-adts-foundations/design.md` for the CS2c-series pattern)
- [x] 0.3 Read memory: `feedback-no-inline-fqns.md`, `feedback-refactor-discipline.md`, `project-backend-architecture-remodel.md`

## 1. Exploration (resolve open design questions)

- [x] 1.1 Grep `SourceType` usages — decide on full delete vs. keeping `parseKind`/`kindString` helpers
- [x] 1.2 Inspect today's `CsvSourceConfig` shape — typed case class or `JsObject` blob? If the latter, design the case class to match what the CSV connector emits/consumes
- [x] 1.3 Inspect today's `StaticSource` config + schema persistence — is the schema in `data_sources.config`, on a linked `DataType` row, or both? Note: this is likely the HEL-256 root cause; capture and decide whether the fix lands in this PR or as a parallel side-PR
- [x] 1.4 Inspect frontend `DataSourceType` enum / type literal — what gets replaced by the discriminated union?
- [x] 1.5 Inspect `GET /api/data-sources/:id/sources` shape and consumers — does it return DataSource shapes?
- [x] 1.6 Record decisions in the executor report (cycle 1)

## 2. Backend domain

- [x] 2.1 Create `domain/DataSource.scala` — `sealed trait DataSource` + 4 subtypes (`CsvSource`, `RestSource`, `SqlSource`, `StaticSource`) with typed configs
- [x] 2.2 Add `CsvSourceConfig` case class if not already typed (co-locate in `domain/DataSource.scala`)
- [x] 2.3 Remove old `DataSource` flat case class from `domain/model.scala`
- [x] 2.4 Prune or replace `SourceType` enum per task 1.1 decision
- [x] 2.5 `sbt compile` — green

## 3. Backend infrastructure

- [x] 3.1 Update `DataSourceRepository.rowToDomain` to dispatch on `source_type` column and return typed subtype
- [x] 3.2 Update `DataSourceRepository.domainToRow` to pattern-match on subtype and flatten back. Keep `data_sources` table shape unchanged.
- [x] 3.3 `sbt compile` — green

## 4. Backend protocol

- [x] 4.1 Rewrite `api/protocols/DataSourceProtocol.scala` as a discriminated-union `RootJsonFormat[DataSource]` with `type` discriminator and per-subtype `config` payload
- [x] 4.2 Update request/response payload formatters for `DataSourceCreateRequest`, `DataSourceResponse`, `DataSourceListResponse` to match the new wire shape
- [x] 4.3 `sbt compile` — green

## 5. Backend services

- [x] 5.1 Update `services/DataSourceService.scala` — typed ADT consumption, no `config.convertTo[X]` at service-layer boundaries; pattern-match dispatch where multi-type handling is needed
- [x] 5.2 Update `services/SourceService.scala` — same
- [x] 5.3 Both services ≤ 300 lines after the cleanup (today: 332 and 339 — typed dispatch should reduce line count, not increase)
- [x] 5.4 `sbt compile` — green

## 6. Backend routes

- [x] 6.1 Update `routes/DataSourceRoutes.scala` — typed request/response entity unmarshalling
- [x] 6.2 Update `routes/DataSourcePreviewRoutes.scala` — same
- [x] 6.3 Update `routes/SourceRoutes.scala` — same
- [x] 6.4 Update `routes/SourcePreviewRoutes.scala` — same
- [x] 6.5 All 4 routes ≤ 150 lines
- [x] 6.6 `sbt test` — full green (511 tests baseline; expect 0 regressions on count, +N for new ADT tests)

## 7. Frontend type sync

- [x] 7.1 Update `frontend/src/types/models.ts` — `DataSource` becomes a discriminated union over `type` with typed `config` per subtype
- [x] 7.2 Add type-narrowing helpers (`isCsvSource`, etc.) only if 3+ consumers need the same narrow
- [x] 7.3 Update `frontend/src/slices/dataSourcesSlice.ts` — thunk payloads + Redux state shape
- [x] 7.4 Update source editor components — narrow per subtype via `if (source.type === '...')`
- [x] 7.5 Update source list + detail views to consume the union
- [x] 7.6 Update preview / refresh / infer call sites
- [x] 7.7 Remove any frontend `DataSourceType` enum / string literal type if replaced by the discriminated union
- [x] 7.8 `npm run lint`, `npm test`, `npm run format:check` — green

## 8. Backend ADT-specific tests

- [x] 8.1 Create `backend/src/test/scala/com/helio/domain/DataSourceSpec.scala` — pattern-match coverage + `kind` correctness per subtype
- [x] 8.2 Add or update `DataSourceRepositorySpec.scala` round-trip tests for each subtype
- [x] 8.3 Protocol round-trip tests for each subtype (`DataSourceProtocolSpec.scala` — new file or add to existing)
- [x] 8.4 `sbt test` — full green

## 9. Cross-cutting

- [x] 9.1 No JSON Schema files for DataSource today (verified during planning); do NOT create new ones unless schema drift surfaces
- [x] 9.2 Update OpenSpec spec.md files that reference DataSource request/response payloads (csv-upload-connector, datasource-edit-delete, frontend-data-sources-page, sql-database-connector, pipeline-create-modal — executor finds them via grep) with the new wire shape
- [x] 9.3 `npm run check:schemas` and `npm run check:openspec` — green

## 10. Verification gates

- [x] 10.1 `sbt test` — full green
- [x] 10.2 `npm test` — full green
- [x] 10.3 `npm run lint` — zero warnings
- [x] 10.4 `npm run format:check` — clean
- [x] 10.5 `npm run check:schemas` — passes
- [x] 10.6 `npm run check:openspec` — clean
- [x] 10.7 `npm run check:scala-quality` — passes (no inline FQNs)
- [x] 10.8 File-size budget audit: routes ≤ 150, services ≤ 300, other src ≤ 250
- [x] 10.9 No `match { case SourceType.X => ... }` switch-cases remain in route / service code (one pattern match each in JSON formatter + repo `rowToDomain` is expected and fine)
- [x] 10.10 AuthService unchanged: `git diff main -- backend/src/main/scala/com/helio/services/AuthService.scala` shows no diff

## 11. Smoke validation (executor runs)

- [ ] 11.1 Backend starts with `BACKEND_PORT=8081 sbt run`; `/health` returns 200
- [ ] 11.2 Frontend starts with `DEV_PORT=5174 npm run dev`
- [ ] 11.3 Manual smoke (8 steps from design.md): login → data sources page → create CSV → create REST → create Static → preview each → bind a panel to CSV-backed DataType → confirm renders → delete one source

*(Smoke not run by the executor — evaluator runs Phase 3 against `DEV_PORT=5174` / `BACKEND_PORT=8081`. Backend + frontend builds and 1195 automated tests all green; the wire-shape evolution is fully covered by `DataSourceProtocolSpec` round-trip + the updated route/repo specs.)*

## 12. Commit / PR handoff

- [x] 12.1 Multi-commit history matches per-area sequencing (exploration notes + commit-per-area: domain → infra → protocol → services → routes+tests → frontend → openspec specs)
- [x] 12.2 All commits on branch `task/backend-datasource-adt/HEL-236`
- [x] 12.3 Orchestrator handles push + PR — do not push

## Spinoff candidates (capture, do NOT pull into CS2c-2)

- [x] 13.1 `PipelineService.AllowedOps` missing `"aggregate"` — pre-existing; track for HEL-141 or follow-up ticket
- [x] 13.2 HEL-256 follow-up if not addressed inline
- [x] 13.3 Anything else surfaced during work
