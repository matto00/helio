## Context

HEL-446 (418-A, merged, PR #314) landed `MetricDefinition`/`MetricFormat`/`MetricAggregation` in
`domain/model.scala`, the `metrics` table (V75, owner-only RLS), and `MetricRepository` with
`insert`/`findByIdOwned`/`listByOwner`/`update`/`delete`/`findByIdInternal`. This ticket adds the
service + REST layer on top, following the existing thin-route/service split
(`DataTypeService`/`DataTypeRoutes`, `AlertRuleService`/`AlertRuleRoutes`).

## Goals / Non-Goals

**Goals:**
- Five REST endpoints (list/create/get/patch/delete) under caller RLS, owner-scoped, paginated list.
- Create/update validation: `name` non-empty; `dataTypeId` → caller-owned, pipeline-output (`sourceId
  == None`) DataType; `measureField` + `allowedDimensions` are fields of that DataType;
  `aggregation` in the allow-list.
- Absent-vs-null `PATCH` semantics for nullable fields, mirroring `MetricPanelConfig.Patch`.

**Non-Goals:**
- Panel→metric binding (418-C), MCP tools (418-D), authoring UI (418-F), deprecation propagation
  (418-G) — all future tickets.
- Deep/partial merge of the `format` sub-object on `PATCH` — the whole `format` object is
  replaced or cleared, not merged field-by-field (see Decision 3).

## Decisions

**Decision 1 — `MetricRepository.findAll` (paginated), added in this ticket.**
`listByOwner` (418-A) returns an unpaginated `Vector`. The AC requires the existing
`PaginatedQueryResult` envelope (`PagedResult[A]`, `schemas/paginated-query-result.schema.json`).
Add `findAll(user, page): Future[PagedResult[MetricDefinition]]` to `MetricRepository`, mirroring
`DataTypeRepository.findAll`'s DB-level `count` + `drop/take` query (not an in-memory slice of
`listByOwner`, which wouldn't scale and would defeat RLS-scoped `LIMIT`/`OFFSET` pushdown).
`listByOwner` stays (still exercised by `MetricRepositorySpec` from 418-A) — this is additive.

**Decision 2 — DataType binding check reuses `ProposalPanelSupport`'s pattern, not the helper
itself.** `ProposalPanelSupport.preValidateBindings` is panel-shaped (`Vector[ProposalPanel]`,
returns on the first bad panel) and lives in a different concern (dashboard proposals). `MetricService`
implements the same two checks — `findByIdOwned` returns `None` → not-found/not-owned;
`dt.sourceId.isDefined` → "panels can only bind to pipeline-output data types"-equivalent — inline,
against a single `dataTypeId`, returning `ServiceError.UnprocessableEntity` (422, matching the AC's
explicit 422/400 split: malformed input is 400 `BadRequest`, semantically-invalid-but-well-formed
references are 422). Once `measureField`/`allowedDimensions` are checked against
`dt.fields.map(_.name).toSet`, the DataType lookup already happened — no second query.

**Decision 3 — `PATCH` request shape.** `UpdateMetricRequest` is decoded from raw `JsObject` like
`MetricPanelConfig.Patch.decode`, not `jsonFormatN` macro-derived (macros can't express "key
absent" vs "key present, null"):
- `name: Option[String]`, `measureField: Option[String]`, `aggregation: Option[String]`,
  `allowedDimensions: Option[Vector[String]]`, `deprecated: Option[Boolean]` — absent = unchanged,
  present = replace. None of these are meaningfully nullable (an empty `allowedDimensions` is
  itself a valid *present* value, not "no dimensions field").
- `description: Option[Option[String]]`, `format: Option[Option[MetricFormat]]` — absent =
  unchanged, `null` = clear, object = replace whole. Matches `MetricPanelConfig.Patch`'s existing
  `dataTypeId`/`fieldMapping` fields exactly (same three-state decode branches).
- Validation (aggregation allow-list, dataTypeId ownership/shape, measureField/allowedDimensions
  membership) runs against the *merged* result (existing ∪ patch), same as
  `DataTypeService.applyUpdate`/`AlertRuleService.applyUpdate` — a `PATCH` that only changes `name`
  still re-validates the (unchanged) `aggregation` etc., since `MetricRepository.update` re-runs
  `MetricAggregation.validate` unconditionally regardless.

**Decision 4 — no dedicated `MetricId` path segment file split.** Add `MetricIdSegment` to the
existing `IdParsing.scala` object (one line, matching every other ID segment there) rather than a
new file.

**Decision 5 — route/service/protocol file names.** `MetricService.scala`, `MetricRoutes.scala`
(new). Wire types extend the existing `MetricProtocol.scala` (already holds `MetricResponse`/
`metricFormatFormat` from 418-A) rather than a new protocol file — `CreateMetricRequest`/
`UpdateMetricRequest` + their formatters are added there, matching how `AlertRuleProtocol.scala`
holds both the response and the create/update request types for `/api/alert-rules`.

## Risks / Trade-offs

- [Risk] `findAll`'s new DB query duplicates `DataTypeRepository.findAll`'s shape closely enough
  that a shared helper might be warranted → Mitigation: out of scope here; the codebase already
  tolerates this duplication across `DataTypeRepository`/`AlertRuleRepository`/`PipelineRepository`
  (no existing shared pagination helper) — introducing one is a separate refactor ticket, not this
  one (CLAUDE.md: "avoid unrelated refactors unless requested").
- [Risk] Whole-object `format` replace-on-`PATCH` (not deep merge) is a minor surprise if a caller
  expects to patch just `format.unit` → Mitigation: documented in `update-metric-request.schema.json`
  description and `MetricService` scaladoc; matches the existing `MetricPanelConfig.Patch`
  precedent exactly, so it is consistent with the rest of the codebase, not a new pattern.

## Planner Notes

- Self-approved: reusing `UnprocessableEntity` (422) for "not found/not owned/wrong shape" dataType
  binding errors and for `measureField`/`allowedDimensions`/`aggregation` semantic violations, and
  `BadRequest` (400) only for structurally-empty `name`/malformed JSON — this is the split the AC's
  "rejects (422/400)" phrasing implies and what `ServiceResponse.completeError` already maps.
- Self-approved: extending `MetricRepository` (rather than opening a second repository) since it's
  the natural, minimal extension point already covering this table, following the same pattern
  `DataTypeService` uses against a single `DataTypeRepository`.
