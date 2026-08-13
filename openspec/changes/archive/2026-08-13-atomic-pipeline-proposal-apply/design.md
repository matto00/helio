## Context

`DashboardProposalService` (HEL-225) is the precedent: validate up front, compose existing services,
delete-the-whole-thing on failure. This ticket brings the same pattern to `PipelineProposal`
(HEL-379), composing `SourceService`/`DataSourceService`, `PipelineService`, `PipelineRunService`.

Two backend facts constrain this design, discovered by reading the composed services directly:

1. **FK cascade is asymmetric.** `pipelines.output_data_type_id REFERENCES data_types(id) ON DELETE
   CASCADE` cascades *from* data_types *to* pipelines, not the reverse — deleting a pipeline
   (`PipelineRepository.delete`) does NOT delete its output DataType. Separately, `data_types.source_id
   REFERENCES data_sources(id) ON DELETE SET NULL` — deleting a source does NOT delete its companion
   DataType, it nulls `source_id`, which is exactly the shape V41 treats as "pipeline-bindable." A
   naive rollback that only deletes the pipeline/source rows leaves orphaned, panel-bindable
   DataTypes behind — the opposite of "no partially-created resources."
2. **`PipelineRunService.runPipeline` unconditionally rejects `RestSource`/`SqlSource`** ("Unsupported
   source type for Spark job submission ... Only static and csv are currently supported") — a
   pre-existing constraint, not something this ticket can or should change (out of scope). Any
   proposal whose resolved source is `rest_api` or `sql` will always fail at the run step.

## Goals / Non-Goals

**Goals:**
- Atomic apply: source (if inline) → pipeline → steps → run, all-or-nothing.
- Rollback that accounts for both FK-cascade gaps above — verified by a DB-count-based test.
- Guardrails surfaced verbatim: SQL non-SELECT rejected pre-creation; source-fetch failure rolled
  back and returned as a structured error.

**Non-Goals:**
- Expanding `PipelineRunService` to support `rest_api`/`sql` Spark submission.
- Resolving inline CSV bytes (no upload channel in a JSON proposal) — deferred, rejected cleanly.
- Analyze/dry-run, MCP tool wiring, combined dashboard+pipeline proposals (ticket's own Out of Scope).

## Decisions

**D1 — `source.sourceId` and inline fields are mutually exclusive; both-set is rejected.**
HEL-379's design.md left this an open apply-time question. Silently preferring one over the other
would discard proposal content the caller explicitly sent with no signal. Reject with
`BadRequest("source: specify either sourceId or an inline type, not both")` during pre-validation —
nothing created. Neither set is likewise rejected pre-validation (`"source: sourceId or inline type is
required"`).

**D2 — Pre-validation checks structure only, mirroring `DashboardProposalService.validateStructure`:**
`pipelineName`/`outputDataTypeName` non-blank; D1's mutual exclusivity; inline `type` is one of
`csv|rest_api|sql|static`. **When the inline branch is selected, two checks the real HEL-379 wire
contract requires but does not itself enforce (round-3 skeptic finding — `schemas/pipeline-
proposal.schema.json`'s `PipelineProposalSource` has no `required` array, so `name`/`config` are both
legally absent even with `type` set):** `source.name` must be present and non-blank →
`Left(ServiceError.BadRequest("source.name is required for an inline source"))`, mirroring
`pipelineName`/`outputDataTypeName`'s own treatment above and `DashboardProposalService
.validateStructure`'s `dashboardName.trim.isEmpty` guard; the config field matching `type`
(`csvConfig`/`restConfig`/`sqlConfig`/`staticConfig`) must be `Some` →
`Left(ServiceError.BadRequest("source.config is required for an inline source"))`. Both run BEFORE the
next check (`sqlConfig.query` cannot be inspected if `sqlConfig` might be absent). Only then: inline
`sql` config's query passes `SqlConnector.checkQuery` (the read-only guardrail); every step's `type` is
in `PipelineStepKind.All` and its `config` decodes via `PipelineStepConfigCodec.decode` (catches
malformed step configs before creation begins, mirroring `preValidateBindings`'s "fail before any side
effect" contract). ACL checks that need a DB round-trip (join/union/lookup right-source ownership,
already inside `PipelineService.addStep`) are NOT re-implemented here — they run at creation time,
covered by the rollback path below as defense in depth.

**D3 — Inline `csv` is schema-valid but apply-time-rejected.** `CsvSourceConfigPayload` carries only
`path` — a JSON proposal has no channel for raw file bytes, and `DataSourceService.createCsv` requires
them. Rejected pre-creation with `UnprocessableEntity("inline csv sources are not supported by
apply-proposal yet; create the CSV source separately and reference it via sourceId")`. An existing CSV
source is still usable via `sourceId` — D1's branch is unaffected. No ticket acceptance criterion or
Tests-section item requires inline CSV creation, so this is a scoped punt, not a gap.

**D4 — Inline source-fetch failure (`rest_api`/`sql`) rolls back and returns `BadGateway`, not the
create-endpoint's `dataType: null` envelope.** `SourceService.createSql`/`createRest` return `Right`
even when `connector.inferSchema` fails (fetchError set, no DataType inserted) — a deliberate UX
choice for the standalone create-source endpoint (retry later). Apply-proposal is all-or-nothing: a
source with no inferable schema can't back a pipeline, so treat this as a failure — delete the
just-created source (no DataType exists yet in this branch, `CreateSourceEnvelope`'s `Left` path never
calls `dataTypeRepo.insert`) and return `Left(ServiceError.BadGateway(fetchError))`, passing the
connector's curated message through unmodified (HEL-311 convention — never re-wrapped).

**D5 — Rollback order, accounting for both FK gaps in Context, composed entirely through existing
services (never a raw `dataTypeRepo.delete`).** `DataTypeService.delete` — not
`DataTypeRepository.delete` directly — is the correct composition target: it enforces
`checkSourceLink` (refuses to delete a DataType whose source still exists) and
`existsBoundToAnyOwnedPanel`, exactly the "no direct DB writes" contract this ticket's own AC states
and `DashboardProposalService` (the cited precedent) already honors. `checkSourceLink` also fixes the
rollback *order*: a companion DataType can only be deleted through this guard once its source is
already gone (source deletion nulls `sourceId` via `ON DELETE SET NULL`), so the source must be
deleted *before* its companion DataType, not after.

**Capture the companion DataType's id at CREATE time, not at rollback time.** Deleting the source
first (required above) fires the `ON DELETE SET NULL` FK *synchronously* — by the time a rollback
step went looking for it via `dataTypeRepo.findBySourceId(source.id, ...)` *after* the source delete,
that query would already return nothing (`source_id` is already `NULL`), silently orphaning the
companion DataType (round-2 skeptic finding). So the companion DataType's id is captured once, at
inline-source-creation time (step 2.3), before any rollback path can run: for `rest_api`/`sql`, it's
`CreateSourceResponse.dataType.map(_.id)` — already returned by `SourceService.createSql`/`createRest`,
no extra query. For `static`, `DataSourceService.createStatic` returns only the bare `DataSource`, so
immediately after a successful `createStatic` call, one `dataTypeRepo.findBySourceId(source.id,
user.id)` (a read, not a write) captures its companion id(s) while the source still exists. This
captured id (or `None`/empty for the `sourceId` branch, which created nothing) is carried alongside
the resolved source through the rest of `apply` as part of its internal creation-result state, so
rollback never has to re-derive it once the source it depended on is already gone. Order: (1) delete
the pipeline (`PipelineService.delete` — cascades steps + runs); (2) delete the pipeline's output
DataType via `DataTypeService.delete` (its `sourceId` is always `None` by construction, so
`checkSourceLink` passes
trivially, and it cannot yet be panel-bound — this apply call just created it); (3) if this apply
created the source: delete the source first (`DataSourceService.delete` — handles file cleanup
uniformly for any source kind, and nulls the companion DataType's `sourceId`), then delete the
companion DataType(s) using the id(s) captured at creation time (above) via `DataTypeService.delete` —
never re-queried after the source is gone.

**D6 — Run failure (including the `rest_api`/`sql` Spark-submission rejection from Context) is "a
failure at any step" per the ticket's own wording — full rollback, not a partial success with
`run: null`.** This is the natural, realistic mid-apply-failure scenario for tests: an inline
`rest_api`/`sql` proposal creates its source successfully, then fails deterministically at the run
step with no test-only failure injection needed.

**D7 — Response shape.** New `PipelineProposalApplyResponse(source: Option[DataSourceResponse],
pipeline: PipelineSummaryResponse, outputDataTypeId: String, run: RunResultResponse)` — `source` is
`None` for the existing-`sourceId` branch (nothing new to report), `Some` for the inline branch.
Mirrors `DashboardProposalService`'s "return what was actually built" convention over introducing a
new envelope type.

## Risks / Trade-offs

- [Non-transactional rollback — a crash between create and rollback leaves orphans] → Same accepted
  risk `DashboardProposalService` already carries (app-level delete-on-failure, not a DB transaction);
  not introduced by this change.
- [Any `rest_api`/`sql`-sourced proposal always fails at run, by design of the composed service] →
  Documented in D6/Context rather than silently "fixed" by skipping the run step for those kinds,
  which would violate the ticket's own "atomically ... and runs it" acceptance criterion.

## Migration Plan

Purely additive: new service + route file, one new case class, one `ApiRoutes` wiring change. No
migration. Rollback = revert the new files; no existing endpoint touched.

## Open Questions

None blocking — D1/D3/D4 resolve the two items HEL-379's design.md left open for this ticket.

## Planner Notes

Self-approved: capability name `pipeline-proposal-apply` (no collision in `openspec/specs/`); D1's
"reject both-set" over "sourceId wins" (explicit over silent precedence); D3's CSV punt (no test/AC
requires it); D5's explicit companion-DataType cleanup (verified against the actual FK definitions in
`backend/src/main/resources/db/migration/V4__data_sources_and_types.sql` and `V22__pipelines.sql`,
not assumed).
