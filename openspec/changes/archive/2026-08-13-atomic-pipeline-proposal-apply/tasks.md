## 1. Backend: response protocol

- [x] 1.1 Add `PipelineProposalApplyResponse(source: Option[DataSourceResponse], pipeline:
      PipelineSummaryResponse, outputDataTypeId: String, run: RunResultResponse)` case class + its
      `RootJsonFormat` (design.md D7), in `PipelineProtocol.scala` or `PipelineProposalProtocol.scala`
      (whichever already imports the needed response types with the fewest new imports); mix into
      `JsonProtocols` if not already reachable.

## 2. Backend: PipelineProposalService

- [x] 2.1 Create `backend/src/main/scala/com/helio/services/PipelineProposalService.scala` composing
      `SourceService`, `DataSourceService`, `PipelineService`, `PipelineRunService`, `DataTypeService`,
      plus `DataSourceRepository`/`DataTypeRepository` for read-only lookups (`findByIdOwned`,
      `findBySourceId`) — no direct DB writes; every delete goes through `DataTypeService.delete` /
      `DataSourceService.delete` / `PipelineService.delete`, never `*Repository.delete` directly.
- [x] 2.2 Implement structural pre-validation per design.md D1/D2, in this order: mutual-exclusivity +
      required-one-of on `source`; inline `type` in `csv|rest_api|sql|static`; when the inline branch
      is selected — `source.name` present and non-blank (`BadRequest("source.name is required for an
      inline source")`), THEN the config field matching `type` (`csvConfig`/`restConfig`/`sqlConfig`/
      `staticConfig`) is `Some` (`BadRequest("source.config is required for an inline source")`) —
      both required BEFORE the next check, since `sqlConfig.query` cannot be read if `sqlConfig` might
      be absent; inline `sql` query via `SqlConnector.checkQuery`; every step's `type`/`config`
      validated via `PipelineStepKind.All` + `PipelineStepConfigCodec.decode`. Return
      `Left(ServiceError.BadRequest/UnprocessableEntity(...))` with nothing created on any failure.
- [x] 2.3 Implement source resolution, returning an internal result carrying the resolved source PLUS
      (for the inline branch only) its companion DataType id, captured now — never re-derived after a
      later rollback deletes the source (design.md D5): `sourceId` branch calls
      `dataSourceRepo.findByIdOwned` (`NotFound` if absent), no companion id (nothing was created).
      Inline branch dispatches `sql`→`sourceService.createSql`, `rest_api`→`sourceService.createRest`
      (both return `CreateSourceResponse.dataType.map(_.id)` directly — no extra query),
      `static`→`dataSourceService.createStatic` followed immediately by one
      `dataTypeRepo.findBySourceId(source.id, user.id)` (read-only) to capture its companion id(s),
      `csv`→ pre-creation rejection per design.md D3.
- [x] 2.4 Implement design.md D4: for inline `rest_api`/`sql`, if the created source's
      `CreateSourceResponse.fetchError` is set, delete the source and return
      `Left(ServiceError.BadGateway(fetchError))` — do not proceed to pipeline creation.
- [x] 2.5 Implement pipeline + steps creation: `pipelineService.create` (sourceDataSourceId = resolved
      source's id, outputDataTypeName from the proposal), then `pipelineService.addStep` for each step
      in proposal order, short-circuiting on the first `Left`.
- [x] 2.6 Implement the run: `pipelineRunService.submit(pipelineId, isDry = false, user)`.
- [x] 2.7 Implement rollback per design.md D5, invoked on any `Left` from 2.4/2.5/2.6, entirely through
      service methods: delete pipeline (`pipelineService.delete`, cascades steps/runs) → delete the
      pipeline's output DataType (`dataTypeService.delete` — `sourceId` is always `None`, so
      `checkSourceLink` passes trivially) → if this call created the source: delete the source FIRST
      (`dataSourceService.delete`, nulls the companion DataType's `sourceId`), then delete the
      companion DataType(s) using the id(s) already captured by 2.3 at creation time via
      `dataTypeService.delete` (must run after the source delete, or `checkSourceLink` rejects it; must
      NOT re-query `findBySourceId` at this point — the source is already gone and it would return
      nothing). Return the original `Left` unchanged after rollback completes.
- [x] 2.8 Assemble the `201`-worthy success response (`PipelineProposalApplyResponse`) from the
      resolved/created source (`None` for the `sourceId` branch), pipeline summary, output DataType id,
      and run result.

## 3. Backend: route + wiring

- [x] 3.1 Create `backend/src/main/scala/com/helio/api/routes/PipelineProposalRoutes.scala`:
      `POST /api/pipelines/apply-proposal`, `entity(as[PipelineProposal])`, `ServiceResponse.run` →
      `StatusCodes.Created` — mirror `DashboardProposalRoutes.scala`'s structure exactly.
- [x] 3.2 Wire `PipelineProposalService` + `PipelineProposalRoutes` into `ApiRoutes.scala` (construct
      the service near `pipelineService`/`pipelineRunService`; add the route alongside
      `PipelineRoutes`/`PipelineStepRoutes` in the route concatenation, ~line 358-363).

## 4. Tests

- [x] 4.1 Add `PipelineApplyProposalSpecBase` (embedded-Postgres + Flyway + real-RLS `ApiRoutes`
      fixture) mirroring `ApplyProposalSpecBase.scala`'s structure — seed a user, a session, and helper
      methods (`apply(body)`, count helpers for `data_sources`/`pipelines`/`pipeline_steps`/
      `data_types`).
- [x] 4.2 Happy path: inline `static` source proposal with 1-2 steps → `201`, source+pipeline+steps
      created, run succeeds, response's output DataType id has `sourceId` unset.
- [x] 4.3 Happy path (existing source): proposal with `sourceId` referencing a pre-seeded static
      source → `201`, response `source` field absent, pipeline created against that source.
- [x] 4.4 Mid-apply failure rollback: inline `rest_api` (or `sql`) source with a stub connector that
      succeeds at schema inference → pipeline+steps created → run fails (unsupported source kind) →
      error response; assert `data_sources`/`pipelines`/`pipeline_steps`/`data_types` counts equal
      their pre-call values (design.md D6).
- [x] 4.5 SQL non-SELECT rejected creating nothing: inline `sql` source with a DDL/DML query → `4xx`
      with the guardrail message verbatim; assert no new rows in any of the four tables.
- [x] 4.6 Source-fetch failure rollback: inline `rest_api` source with a stub connector returning
      `Left` → error response carrying the connector's message; assert no new `data_sources` row.
- [x] 4.7 Guardrail edge cases: both `sourceId` and inline `type` set → `400`, nothing created; neither
      set → `400`, nothing created; inline `csv` → structured `4xx`, nothing created; unrecognized step
      `type` → `400`, nothing created; inline `type` set with `name` omitted → `400`, nothing created;
      inline `type` set with `config` omitted (`sql` and `rest_api`) → `400`, nothing created (round-3
      skeptic finding — proves neither an unhandled 500 nor a silently-created nameless source occurs).
- [x] 4.10 Mid-apply failure rollback, `static` branch: inline `static` source created successfully,
      then a subsequent step's `addStep` fails (e.g. a `join`/`union`/`lookup` step referencing a
      right-source id the caller doesn't own) → error response; assert `data_sources`/`pipelines`/
      `pipeline_steps`/`data_types` counts equal their pre-call values. Exercises the `static` branch's
      distinct capture-at-create-time path (`findBySourceId` after `createStatic`, design.md D5) that
      4.4's `rest_api`/`sql`-only coverage cannot reach (round-2/3 skeptic non-blocking note).
- [x] 4.8 RLS enforced: a proposal referencing a `sourceId` owned by another user → `NotFound`/`403`
      per existing `findByIdOwned` semantics, nothing created.
- [x] 4.9 Run `sbt test` and confirm the full suite is green.
