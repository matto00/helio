## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Checklist:
- [x] All ticket acceptance criteria addressed explicitly (not partial)
  - AC1 (five endpoints, owner-scoped, paginated `PaginatedQueryResult` envelope): `MetricRoutes.scala` mounts `GET/POST /api/metrics`, `GET/PATCH/DELETE /api/metrics/:id`; `MetricRepository.findAll` is a DB-level count+drop/take mirroring `DataTypeRepository.findAll` exactly (verified diff parity between the two `findAll` implementations); wrapped in `PagedResult`.
  - AC2 (422/400 validation split): `MetricService.resolveAndValidateDataType` returns `UnprocessableEntity` for not-owned/non-pipeline-output dataTypeId, unknown `measureField`/`allowedDimensions`, and out-of-allow-list `aggregation`; `RequestValidation.validateMetricName` empty/whitespace name returns `BadRequest`. Matches ticket + spec.md scenarios exactly.
  - AC3 (PATCH partial update, absent-vs-null): `UpdateMetricRequest` custom `RootJsonFormat` implements the three-state decode (absent/null/value) for `description`/`format`; plain `Option[X]` for `name`/`measureField`/`aggregation`/`allowedDimensions`/`deprecated`. Matches `MetricPanelConfig.Patch` convention as specified.
  - AC4 (route-level ScalaTests, happy path + each rejection): `MetricRoutesSpec` (435 lines, 20 test cases) covers all five endpoints, every validation rejection (dataTypeId ownership/shape/unknown, measureField/allowedDimensions membership, aggregation allow-list, empty name), PATCH absent-vs-null semantics, and cross-user 404s for get/patch/delete.
  - AC5 (JSON Schemas, `sbt test` passes, no FQNs): three schemas added and pass `check:schemas` drift check; `sbt test` — 2400/2400 passing (fresh run, see Phase 2); `check:scala-quality` reports zero FQN violations.
- [x] No AC silently reinterpreted — none found.
- [x] All task items in `tasks.md` marked done and match the implementation (verified each of sections 1–6 against the diff).
- [x] No unnecessary changes outside ticket scope — diff is confined to metric service/routes/protocols/repository/schemas/tests + the minimal wiring touch points (`ApiRoutes.scala`, `Main.scala`, `package.scala`, `IdParsing.scala`, `PaginationProtocol.scala`, `RequestValidation.scala`). No panel-binding, MCP, UI, or deprecation-propagation code touched (correctly out of scope per ticket).
- [x] No regressions to existing behavior — `listByOwner` untouched/still exercised by its own spec; `ApiRoutes`'s `metricRepo` param is nullable-optional (mirrors `alertRuleRepo`/`pipelineScheduleRepo`), so existing fixtures that don't pass it are unaffected. Full `sbt test` suite green.
- [x] API contracts/schemas updated — three new schemas (`metric`, `create-metric-request`, `update-metric-request`) added and verified in sync with the Scala protocols via `npm run check:schemas`.
- [x] Planning artifacts reflect final implemented behavior — design.md's five decisions (paginated `findAll`, inline binding-check reuse, PATCH shape, no dedicated `MetricId` file, file/module placement) all match the diff precisely.

Issues: none.

### Phase 2: Code Review — PASS

Gates run fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` set — `default` speed):
- `cd backend && sbt test` → **2400 tests succeeded, 0 failed** (98s). Also re-ran targeted `testOnly com.helio.api.routes.MetricRoutesSpec com.helio.infrastructure.MetricRepositorySpec` in isolation → **44/44 passed**, confirming the new specs execute and pass independently.
- `node scripts/check-scala-quality.mjs` → clean, 0 FQN violations (82 pre-existing file-size soft warnings across the codebase, informational only per CONTRIBUTING.md; none of the new files exceed the ~400-line hard-flag threshold — largest new file is `MetricRoutesSpec.scala` at 435 lines, a test file, consistent with the many other 250+ line test files already in the codebase).
- `npm run check:schemas` → schemas in sync with `JsonProtocols` (35 checked).
- `npm run check:openspec` → only flags "complete but not archived", which is expected pre-archive at this workflow stage, not a code defect.

No changed files matched `frontend/**`, so the frontend gates (lint/format:check/test/build) were correctly out of scope for this run.

Checklist:
- [x] Canonical code-quality compliance (CONTRIBUTING.md) — no inline FQNs (mechanically verified via `check-scala-quality.mjs`); ID segment wrapped at the route boundary via `MetricIdSegment: PathMatcher1[MetricId]` (`IdParsing.scala:27`), repositories/services accept `MetricId` value classes only; per-domain formatters live in `MetricProtocol.scala` under `com.helio.api.protocols`, `JsonProtocols` only mixes it in (no new formatters added to the aggregator directly).
- [x] ACL triad honored — `findByIdOwned` used throughout `MetricService` for get/update/delete (mutation + no-sharing-grant paths), returning `None` → `ServiceError.NotFound` (never 403), matching the "existence-not-leaked" rule in CONTRIBUTING.md.
- [x] DB access via `DbContext.withUserContext` only — `MetricRepository.findAll` (`MetricRepository.scala:91-105`) never calls `db.run` directly.
- [x] DRY — `findAll`'s count+slice pattern intentionally duplicates `DataTypeRepository.findAll`'s shape; design.md Decision/Risk explicitly self-approves this as consistent with existing codebase precedent (no shared pagination helper exists for `AlertRuleRepository`/`PipelineRepository` either) rather than introducing a premature abstraction — reasonable per CLAUDE.md's "avoid unrelated refactors."
- [x] Readable — clear naming (`resolveAndValidateDataType`, `applyUpdate`), no magic values (aggregation allow-list lives in `MetricAggregation.values`, not inlined).
- [x] Modular — thin route shell (`MetricRoutes.scala`, 72 lines) delegates all logic to `MetricService`; `MetricService` composes two repositories without reaching into their internals.
- [x] Type safety — no `.get`/`asInstanceOf`/untyped escape hatches found in the diff.
- [x] Security — `dataTypeId` binding re-validated as caller-owned + pipeline-output on every create/update; RLS relied upon transitively via `withUserContext`.
- [x] Error handling — every repository `Either`/`Option` result is exhaustively pattern-matched into a `ServiceError`; no silent failures.
- [x] Tests meaningful — 20 `MetricRoutesSpec` cases + 3 new `MetricRepositorySpec.findAll` cases exercise every branch named in tasks.md/spec.md, including negative-path "value unchanged after rejected PATCH" assertions that would catch a real regression (e.g., a validation bug that silently persists an invalid patch).
- [x] No dead code — no unused imports flagged by the quality script; no leftover TODO/FIXME in the diff.
- [x] No over-engineering — `MetricService` implements the DataType-binding check inline rather than introducing a shared cross-service helper, per design.md Decision 2's explicit reasoning (different shape/concern than `DashboardProposalService.preValidateBindings`).
- [x] Behavior-preserving where expected — `listByOwner` (HEL-446) is untouched; the new `findAll` is purely additive.

Issues: none.

### Phase 3: UI Review — N/A

This is a backend-only ticket (per task framing) — no `frontend/**` files changed, and while `schemas/**` technically matches the listed trigger set, the three new schema files (`metric.schema.json`, `create-metric-request.schema.json`, `update-metric-request.schema.json`) are net-new wire contracts for a REST surface with zero frontend consumer in this change (authoring UI is explicitly out of scope, ticket HEL-493F). There is no UI flow, page, or component to exercise; the browser-based checks (happy path, empty/error states, breakpoints, accessible names) have no applicable target. Schema↔backend contract correctness was already mechanically verified via `npm run check:schemas` in Phase 2.

### Overall: PASS

### Non-blocking Suggestions
- `MetricService.applyUpdate` (`MetricService.scala:83-88`) has minor local misalignment in the `val format = ...`/`val deprecated = ...` lines (extra space before `=`) — cosmetic only; no scalafmt gate is configured for the backend so this doesn't fail any check, but worth a tidy-up if the file is touched again.
