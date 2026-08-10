## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `specs/metric-crud-api/spec.md`, `tasks.md`,
  `files-modified.md`, `evaluation-1.md` as claims, then verified each against `git diff main...HEAD`
  directly (25 files, +1483/-20).

**AC1 — five endpoints, owner-scoped, paginated `PaginatedQueryResult` envelope:**
`backend/src/main/scala/com/helio/api/routes/MetricRoutes.scala` mounts `GET/POST /metrics`,
`GET/PATCH/DELETE /metrics/:id` under `pathPrefix("metrics")`, wired into `ApiRoutes.scala`
inside the authenticated-user route block (same `metricServiceOpt.fold(reject: Route)(...)`
pattern as `alertRuleServiceOpt`/`pipelineScheduleServiceOpt` — confirmed auth is enforced, not
bypassed). List response wraps in `PagedResult` (`items`/`total`/`offset`/`limit`) —
`MetricRepository.findAll` (`MetricRepository.scala:95-106`) does DB-level `count` + `sortBy.drop.take`
under `ctx.withUserContext`, byte-for-byte structural parity with `DataTypeRepository.findAll`
(diffed both side by side). I initially flagged the ticket's literal phrase "existing
`PaginatedQueryResult` envelope" as a possible mismatch, since `schemas/paginated-query-result.schema.json`
is actually the *rows/columns/page/pageSize/hasMore* panel-query-execution envelope, not
`PagedResult`'s `items/total/offset/limit` shape. Checked `spec.md:4-6`, which explicitly
resolves this: "wrapped in the existing `PaginatedQueryResult` envelope (`items`/`total`/`offset`/`limit`)" —
i.e. the ticket's phrase was a loose/generic reference to "the existing pagination envelope for
list endpoints," not the specific schema of that name (which wouldn't even fit a metric-definition
list — no rows/columns concept applies). `PagedResult` is what `DataTypeRoutes`/`DashboardRoutes`/
`DataSourceRoutes`/`PublicDashboardRoutes` already use for list endpoints — the correct precedent.
This exact question was independently raised and resolved at the design gate
(`skeptic-design-1.md`), so I'm not counting it as a new finding — non-blocking note only.

**AC2 — 422/400 split on create/update:** `MetricService.resolveAndValidateDataType`
(`MetricService.scala:146-174`) returns `ServiceError.UnprocessableEntity` for
not-owned/non-existent `dataTypeId`, `sourceId.isDefined` (non-pipeline-output),
unknown `measureField`/`allowedDimensions`, and out-of-allow-list `aggregation`, each with a
distinct descriptive message; `RequestValidation.validateMetricName`
(`RequestValidation.scala:143-150`) returns `Left` → `ServiceError.BadRequest` for empty/whitespace
`name`. `ServiceResponse.completeError` (`ServiceResponse.scala:58-68`) maps
`UnprocessableEntity`→422, `BadRequest`→400 exactly. Verified in `MetricRoutesSpec` (ran fresh,
see below): 7 create-rejection tests (non-owned dataTypeId, unresolvable dataTypeId, non-pipeline-output
dataTypeId, bad measureField, bad allowedDimensions entry, bad aggregation, empty name) all pass;
3 PATCH-rejection tests (bad aggregation/measureField/allowedDimensions) each assert both the 422
status *and* a follow-up `GET` proving the metric was not mutated.

**AC3 — PATCH absent-vs-null partial update:** `UpdateMetricRequest`'s hand-rolled
`RootJsonFormat.read` (`MetricProtocol.scala:113-152`) implements the 3-state decode
(absent/`null`/value) for `description`/`format`, plain `Option[X]` for
`name`/`measureField`/`aggregation`/`allowedDimensions`/`deprecated` — exactly the 7 fields the AC
names. `MetricService.applyUpdate` (`MetricService.scala:87-123`) merges each correctly
(`.getOrElse` for plain-optional fields, `.fold(existing)(identity)`/`.fold(existing)(_.getOrElse(default))`
for the nullable pair). Verified live via `MetricRoutesSpec`: absent-leaves-unchanged,
explicit-null-clears-description, whole-object-replace-and-clear-on-format all pass.

**AC4 — route-level tests, happy path + every rejection:** `MetricRoutesSpec.scala` (435 lines, 20
`it`/`in` cases) — read in full. Covers all 5 endpoints' happy paths, the pagination envelope
(owner-scoping + total/offset), every create rejection, 3 PATCH rejections (with
not-mutated follow-up assertions), and cross-user 404s on get/patch/delete. One gap I traced but
judge non-blocking: PATCH-with-empty-name (400) isn't separately tested — it shares the exact same
`RequestValidation.validateMetricName` code path already exercised by the create-side test, so this
is a coverage completeness nit, not an unverified behavior.

**AC5 — schemas, `sbt test`, no FQNs:** ran fresh, not trusted from the evaluator's report:
- `cd backend && sbt test` → **2400 tests succeeded, 0 failed** (99s), matching evaluation-1.md's
  claimed count exactly.
- `sbt "testOnly com.helio.api.routes.MetricRoutesSpec com.helio.infrastructure.MetricRepositorySpec"`
  in isolation → **44/44 passed**, including the 3 new `MetricRepository.findAll` cases (paginates
  DB-side across 3 pages with deterministic `createdAt`-ordered names, owner-scoping, empty-page).
- `npm run check:schemas` → "schemas in sync with JsonProtocols (35 checked across 29 protocol
  files)" — the 3 new metric schemas (`metric`, `create-metric-request`, `update-metric-request`)
  read and cross-checked field-by-field against `MetricResponse`/`CreateMetricRequest`/
  `UpdateMetricRequest` — match exactly (required/nullable/enum shapes align).
- `node scripts/check-scala-quality.mjs` → clean, 0 hard FQN violations. Note: I found one inline
  FQN the mechanical checker's `FQN_PREFIXES` list doesn't cover — `scala.collection.mutable.Map.empty`
  at `MetricProtocol.scala:103` — but this is an established, pervasive pattern already used
  identically (`scala.collection.mutable.Map.empty[String, JsValue]`) in `PanelProtocol.scala:183/205`
  and analogous forms in ~13 other pre-existing files across the codebase, including the exact
  `PanelProtocol.updatePanelRequestFormat` this file's scaladoc cites as the pattern it mirrors. Not
  a regression this ticket introduced; not flagging as a change request.
- `npm run check:openspec` → only "complete but not archived" (expected pre-archive), not a defect.
- No `frontend/**` files touched (`git diff --stat -- frontend/` empty) — confirms Phase 3 N/A was
  correct, no UI review applicable.

**ACL triad / RLS:** `findByIdOwned` used for every get/update/delete before mutation
(`MetricService.scala:36-40,76-79,127-135`), `None` → `ServiceError.NotFound` uniformly (never a
distinguishing 403) — existence-not-leaked rule honored. `MetricRepository`'s app-layer `ownerId`
filter is redundant-but-correct on top of the RLS `USING` clause (V75, from HEL-446, unmodified).
`create` sets `ownerId = user.id` directly from the authenticated caller — no client-supplied owner
override possible.

### Verdict: CONFIRM

The five endpoints, validation rules, PATCH semantics, and pagination envelope all trace cleanly to
real, exercised code — not just claimed in evaluation-1.md. Fresh full `sbt test` run (2400/2400)
and targeted spec run (44/44) both reproduce the evaluator's numbers independently. No UI surface to
judge (backend-only change, confirmed via diff). No blocking gaps found.

### Non-blocking notes

1. Ticket's literal "PaginatedQueryResult envelope" phrase doesn't name the schema actually reused
   (`PagedResult`, not `schemas/paginated-query-result.schema.json`'s rows/columns shape) — correctly
   resolved in `spec.md` and pre-vetted at the design gate; worth tightening ticket-writing phrasing
   in future Semantic/Metric Layer tickets (418-D/E/F) to avoid re-litigating this.
2. `PATCH` with an empty/whitespace `name` (400) isn't separately covered in `MetricRoutesSpec` —
   same validated code path as the create-side test, so low risk, but a one-line addition would
   close the AC4 checklist completely.
3. `scala.collection.mutable.Map.empty[String, JsValue]` at `MetricProtocol.scala:103` is an inline
   FQN the `check-scala-quality.mjs` `FQN_PREFIXES` list doesn't catch (no `scala.collection.`
   entry) — pre-existing gap in the tool, not something to fix in this PR, but worth a follow-up
   ticket to close the checker's coverage since the pattern recurs ~15x across the codebase.
