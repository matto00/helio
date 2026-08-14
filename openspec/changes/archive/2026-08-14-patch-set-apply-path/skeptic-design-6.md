## Skeptic Report — design gate (round 6, skeptic-design-6.md)

### What I verified (with evidence)

- Read the full artifact set fresh: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/patch-set-apply/spec.md`, `specs/patch-set-contract/spec.md`, and round 1-5 skeptic
  reports (as claims only).
- Cross-checked D4a's six named response types against actual backend source:
  - `PanelResponse.fromDomain(panel: Panel, dataAsOf: Option[String] = None)` exists
    (`backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala:112-123`), takes a bare
    `Panel` domain object — matches what D2's panel pre-validation reads
    (`panelRepo.findByIdInternal` → `Option[Panel]`). OK.
  - `DashboardResponse.fromDomain(dashboard: Dashboard)` exists (`DashboardProtocol.scala:97-106`),
    takes a bare `Dashboard` — matches `dashboardRepo.findById` → `Option[Dashboard]`. OK.
  - `DataSourceResponse.fromDomain(ds: DataSource)` exists (`DataSourceProtocol.scala:196-...`),
    takes the domain ADT directly — matches `dataSourceRepo.findByIdOwned` → `Option[DataSource]`
    (`DataSourceRepository.scala:116`). OK.
  - `DataTypeResponse.fromDomain(dt: DataType)` exists (`DataTypeProtocol.scala:42-55`), takes the
    domain object directly — matches `dataTypeRepo.findByIdOwned` → `Option[DataType]`
    (`DataTypeRepository.scala:85`). OK.
  - `PipelineStepResponse.fromDomain(step: PipelineStep)` exists
    (`PipelineStepProtocol.scala:143-...`), takes the domain ADT directly — matches
    `pipelineStepRepo.findByIdInternal` → `Option[PipelineStep]`
    (`PipelineStepRepository.scala:145`). OK.
  - `PipelineSummaryResponse` — **gap found, see Change Request 1.** It is built by
    `PipelineService.toSummaryResponse(s: PipelineSummary)` (`PipelineService.scala:667-679`),
    which requires a `PipelineRepository.PipelineSummary` DTO
    (`PipelineRepository.scala:378-389`, fields include `sourceDataSourceName`,
    `outputDataTypeName`, `lastRunRowCount`). But D2's pipeline-kind pre-validation reads
    `pipelineRepo.findByIdOwned` (`PipelineRepository.scala:85`) → `Future[Option[Pipeline]]`, and
    `Pipeline` (`domain/model.scala:571-583`) carries only `sourceDataSourceId`/`outputDataTypeId`
    (ids, not names) and has no `lastRunRowCount` field at all. `PipelineSummary` is only
    obtainable via a genuinely separate joined query — `PipelineRepository.findSummaryById`/
    `findSummaryByIdShared` (`PipelineRepository.scala:126-149`, an explicit 3-way Slick join across
    `pipelinesTable`/`dataSourcesTable`/`dataTypesTable`). Confirmed this is a real second read, not
    a re-labeling of the same data.
- Grepped design.md/tasks.md/proposal.md/both spec deltas for "resulting"/"post-mutation"/
  "after state"/"final state"/"newState" — the only hit is `ticket.md:26` itself. Confirmed
  ticket.md's Scope bullet 3 ("`POST /api/patch-sets/apply` returning the per-edit outcome + **the
  resulting resource states**") has zero coverage anywhere in the design artifacts — see Change
  Request 2.
- Verified `newId` (`design.md` D3a/D4, `tasks.md:11,107`) is discussed ONLY for the
  panel/pipelineStep delete-rollback "recreated" case, never for a plain successful `create` edit.
  Confirmed the create-path domain objects needed to populate it ARE available at forward-apply
  time regardless (`PanelService.create` returns `Future[Either[ServiceError, Panel]]`,
  `PanelService.scala:168-170`) — the gap is a missing design decision, not a missing capability.
- Re-verified D6's `PatchSetProtocol.scala` claims against the actual current file
  (`backend/src/main/scala/com/helio/api/protocols/PatchSetProtocol.scala:95-124`): confirmed the
  `Edit.read` reader currently reads `patch` unconditionally into a local val, then the
  `op == "delete"` case (falls into the catch-all `case _ =>`) discards it regardless of whether it
  was present — matches the design's description of the current bug and the planned
  `deserializationError` fix exactly. No new issue here.
- Spot-checked D1's forward-apply method claims against current signatures: `PanelService.create`
  (`:168`), `DashboardService.create` (`:56`, returns `(Dashboard, Boolean)` — consistent with D3a's
  "reject `ifExists` so the boolean is always discardable" fix), `DataSourceService.createStatic`
  (`:90`), `DataTypeService.update/delete` (`:69,127`) all exist with the claimed shapes. No
  regression found from the round-5 edit.
- Re-verified D2/D2a's ACL claims (panel/dashboard/pipelineStep divergent update-vs-delete rules,
  embedded cross-resource reference checks) against current source; unchanged since round 4/5's
  fixes and still accurate on this fresh read.

### Verdict: REFUTE

Two new, concrete, source-grounded gaps — one in the exact category this round was scoped to hunt
(a DomainObject → ResponseType construction gap for one of the six named response types), one in
the exact category round 5 caught (a ticket.md-named requirement with zero coverage anywhere in the
design).

### Change Requests

1. **D4a's "no second read" claim is false for the `pipeline` kind — fix the pre-validation read or
   the claim.** `design.md` D4a (lines 176-192) and `tasks.md` task 4.1 ("Every `update`/`delete`
   edit's `EditOutcome.priorState` is populated from the SAME pre-mutation state task 3.1 already
   read during pre-validation... no second read") state uniformly, across all six kinds, that
   `priorState` capture requires no additional DB read beyond D2's pre-validation pass. This is true
   for panel/dashboard/dataSource/dataType/pipelineStep (each response type's `fromDomain` takes
   exactly the domain object each kind's pre-validation already reads — verified above) but **false
   for `pipeline`**: `PipelineSummaryResponse` needs `PipelineSummary` (a joined DTO with
   `sourceDataSourceName`/`outputDataTypeName`/`lastRunRowCount`), while D2's pipeline
   pre-validation reads `pipelineRepo.findByIdOwned` → a bare `Pipeline` (ids only, no
   `lastRunRowCount` at all). Getting a `PipelineSummary` requires the separate joined query
   `findSummaryById`/`findSummaryByIdShared` (`PipelineRepository.scala:126-149`). An implementer
   following the design's literal instruction ("no second read") would either hit a compile error
   trying to build `PipelineSummaryResponse` from a `Pipeline`, or silently add an undocumented
   second query — and `tasks.md` task 7.10 (this AC's own test coverage) doesn't exercise a
   pipeline update/delete's `priorState` at all, so nothing would catch either outcome. Fix: add an
   explicit decision (e.g. D2b) stating pipeline-kind pre-validation captures the joined
   `PipelineSummary` (not the bare `Pipeline`) for its ACL-plus-state read — using
   `findSummaryById`/`findSummaryByIdShared` in place of (or alongside) `findByIdOwned` — so the
   "no second read" claim actually holds, or explicitly carve pipeline out of that claim as a
   documented, deliberate second read. Either way, add a pipeline-update and/or pipeline-delete case
   to task 7.10 / the "Prior-state capture..." spec requirement's scenarios so this is actually
   tested.

2. **ticket.md Scope bullet 3's "resulting resource states" has zero design coverage — distinct
   from the already-fixed "prior-state" AC.** `ticket.md:26` ("Backend Scala: `POST
   /api/patch-sets/apply` returning the per-edit outcome + **the resulting resource states**") is a
   separate requirement from the Scope bullet round 5 fixed ("Emit the captured prior-state set...",
   `ticket.md:29`, addressed by D4a's `priorState`). Grepping design.md/tasks.md/proposal.md/both
   spec deltas for "resulting"/"post-mutation"/"after state"/"final state" returns zero hits outside
   `ticket.md` itself. `EditOutcome`'s only state-carrying fields are `priorState` (the BEFORE
   state) and `newId` — and `newId` is documented (`design.md` lines 162, 170, 212) ONLY for the
   panel/pipelineStep delete-rollback "recreated" case, never for a plain, non-rolled-back `create`
   edit. Concretely: as currently specified, a `create`-op edit that succeeds and is never rolled
   back returns `status: applied`, `newId: None`, `priorState: None` — nothing in the response
   identifies what was created, even though the data is available for free (`PanelService.create`
   already returns the full created `Panel`, `PanelService.scala:168-170`; same pattern for
   `DashboardService.create`/`DataSourceService.createStatic`/`PipelineService.create`). Fix: add an
   explicit decision (mirroring D4a's shape/reasoning) that either (a) populates `newId` for every
   successful `create` (not only recreate-rollback), and/or (b) adds a resulting-state field to
   `EditOutcome` using each kind's existing response shape (the same `PanelResponse`/etc. reuse
   pattern D4a already established), and update `tasks.md` (2.1, 4.1) and
   `specs/patch-set-apply/spec.md`'s "POST /api/patch-sets/apply" requirement with a matching
   scenario for a successful create's outcome.

### Non-blocking notes

- `PanelResponse.fromDomain`'s `dataAsOf` parameter defaults to `None` when omitted — using that
  default for `priorState` capture (rather than joining `PipelineRepository.findLastRunAtByOutputDataTypeId`)
  is a reasonable, low-fidelity-but-consistent choice and does not need its own decision, but it
  would be worth one sentence in D4a saying so explicitly, the same way the pipeline gap above needs
  one.
