## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-proposal-apply/spec.md` in full.
- Cross-checked every factual claim in `design.md`'s Context/Decisions against the
  actual composed services and migrations, not just the prose:
  - `DashboardProposalService.scala` (the cited precedent) — confirmed it performs
    **zero direct repository writes**; every mutation goes through
    `dashboardService`/`panelService`, and `dataTypeRepo`/`metricRepo` are used
    read-only (`ProposalPanelSupport.preValidateBindings`).
  - `backend/src/main/resources/db/migration/V22__pipelines.sql`:
    `output_data_type_id ... ON DELETE CASCADE` (data_types→pipelines direction
    only) and `source_data_source_id ... ON DELETE CASCADE` (data_sources→pipelines).
    `V4__data_sources_and_types.sql`: `data_types.source_id ... ON DELETE SET NULL`.
    `V23`/`V24`: `pipeline_steps`/`pipeline_runs` cascade from `pipelines`.
    Confirms design's two stated FK facts are accurate, but see note below on a
    third FK fact the design's Context section omits.
  - `SourceService.createSql`/`createRest` + `CreateSourceEnvelope.build` — confirmed
    D4's claim: on `inferSchema` failure, `dataTypeRepo.insert` is never called
    (`Left(err) => CreateSourceResponse(... dataType = None, fetchError = Some(err))`,
    `CreateSourceEnvelope.scala:39-44`), so the source-fetch-failure rollback only
    ever needs to delete the source, never a dangling DataType.
  - `PipelineRepository.create` (`PipelineRepository.scala:205-261`) — confirmed the
    output DataType (`sourceId = None`) is inserted before the `pipelines` row, and
    the method's only `Left` path (`"Data source not found"`) fires *before* that
    insert — so a `pipelineService.create` failure never leaves an orphan output
    DataType. Confirms AC "Output DataType is pipeline-bindable" is achievable.
  - `PipelineRunService.runPipeline` (`PipelineRunService.scala:119-125`) — confirmed
    the exact rejection message and that only `RestSource`/`SqlSource` are rejected
    (static/csv proceed), matching Context's D6 claim verbatim.
  - `SqlConnector.checkQuery`, `PipelineStepKind.All`, `CreatePipelineStepRequest`,
    `CsvSourceConfigPayload(path: String)` (no bytes field), `CreateSourceRequest`/
    `SqlCreateSourceRequest`/`StaticDataSourceRequest` shapes — all consistent with
    what `design.md`/`tasks.md` assume is buildable from `PipelineProposalSource`.
  - `ApiRoutes.scala` — confirmed `PipelineRoutes`/`PipelineStepRoutes`/`PipelineRun*`
    mount around line 358-363 (tasks.md 3.2's citation is accurate) and that
    `dataTypeService`/`pipelineService`/`proposalService` are all constructed
    in-file the same way a new `PipelineProposalService` would be (line 144-158).
  - **`DataTypeService.delete`** (`backend/src/main/scala/com/helio/services/DataTypeService.scala:127-141`)
    — read in full; this is the finding below.

### Verdict: REFUTE

### Change Requests

1. **Rollback's DataType deletions bypass the existing, guarded `DataTypeService.delete`
   in favor of raw `DataTypeRepository.delete`, contradicting the ticket's own AC and
   the cited precedent — and the chosen delete *order* makes the guarded service
   unusable as currently sequenced.**
   `design.md` D5 / `tasks.md` 2.7 have the `PipelineProposalService` call
   `dataTypeRepo.delete` directly for both (a) the pipeline's output DataType and
   (b) — when this call created an inline source — the source's companion
   DataType(s), found via `dataTypeRepo.findBySourceId`. But
   `DataTypeService.delete` already exists (`DataTypeService.scala:127`) and enforces
   two safety guards this plan silently skips:
   - `checkSourceLink` (line 159): refuses to delete a DataType whose `sourceId`
     points at a *still-existing* DataSource (`Conflict`) — this is precisely the
     HEL-256 orphan-schema guard.
   - `existsBoundToAnyOwnedPanel` (line 134): refuses to delete a DataType any panel
     is bound to (`Conflict`).

   This is a literal contradiction of the ticket's own acceptance criterion
   (`ticket.md` line 23: "Composes existing `SourceService` / `PipelineService` /
   `PipelineRunService` — no direct DB writes, RLS enforced") and a departure from
   `DashboardProposalService` — the change's own stated precedent — which performs
   **zero** direct repository writes (verified above).

   The reason the plan reaches for the raw repo call is real, but the design never
   states it or resolves it: D5's order deletes the companion DataType **before**
   the source (step 3: "find and delete its companion DataType(s) ... then delete
   the source itself"). At that point the source still exists, so routing through
   `DataTypeService.delete` would *always* hit `checkSourceLink`'s `Conflict` and
   break the rollback — the design's current text doesn't acknowledge this tension
   or explain why the guarded service was passed over.

   **Required revision:** reverse D5 step 3's order — delete the source first
   (`DataSourceService.delete`, already planned), then delete its now-unlinked
   companion DataType. `data_types.source_id ... ON DELETE SET NULL` (verified,
   `V4__data_sources_and_types.sql:12`) nulls the companion type's `sourceId` as
   part of that single source delete, so by the time the companion DataType is
   looked up again its `sourceId` already reads `None` — `checkSourceLink` passes
   cleanly, and `DataTypeService.delete` can be composed instead of the raw
   repository call. Apply the same substitution to D5 step 2 (the pipeline's own
   output DataType): its `sourceId` is always `None` by construction
   (`PipelineRepository.create`), so `checkSourceLink` is a no-op there too and
   `DataTypeService.delete` works unchanged, no reordering needed for that step.
   `dataTypeRepo.findBySourceId` (a *read*, not a write) can stay as-is for locating
   the companion DataType — reads aren't the AC's concern. `dataTypeService` is
   already constructed in `ApiRoutes.scala:154`, immediately next to
   `pipelineService`/`proposalService`, so this is a small constructor-wiring change,
   not a new dependency to build.

   This isn't just literal AC compliance: `existsBoundToAnyOwnedPanel` is a real (if
   narrow) defense-in-depth check this design would otherwise forfeit — e.g. a
   concurrent request from the same user binding a panel to the freshly created
   output DataType in the brief window before a run failure triggers rollback. The
   design should get that guard for free by composing the service that already has
   it, exactly as it already does for `SourceService`/`PipelineService`/
   `PipelineRunService`.

### Non-blocking notes

- `design.md`'s Context section states "Two backend facts constrain this design"
  and cites `V22__pipelines.sql` as one of the files it verified the FK definitions
  against — but that same file also defines a third relevant FK immediately above
  the one it does cite: `pipelines.source_data_source_id ... ON DELETE CASCADE`
  (source→pipeline cascade). It happens not to break D5's rollback order as written
  (the pipeline is always deleted before the source in every branch), so this isn't
  independently blocking, but the Planner Notes' claim of having "verified against
  the actual FK definitions ... not assumed" should be complete. Worth re-checking
  this fact stays inert once Change Request 1's reordering is applied.
- `specs/pipeline-proposal-apply/spec.md`'s "Structural pre-validation" requirement
  covers "a `source` that sets neither" in its SHALL-text, but (unlike the "both set"
  case) has no dedicated `#### Scenario` block for it, even though `tasks.md` 4.7
  tests it. Minor traceability gap — not blocking.
- `scripts/concertino/next-report-number.sh`, `persist-evidence.sh`, and
  `emit-event.sh` are absent from this worktree's `scripts/concertino/` (only
  `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`, `start-servers.sh`, `.concertino.env`,
  `README.md` are present) even though they exist in the main checkout
  (`/home/matt/Development/helio/scripts/concertino/`). I invoked the main
  checkout's copies against this worktree's change directory to produce this
  report and its durable copy/verdict, since they are stateless filesystem
  utilities parameterized entirely by the paths passed in. Flagging so the
  worktree's `scripts/concertino/` can be re-synced (`concertino sync`) before the
  next round needs them.
