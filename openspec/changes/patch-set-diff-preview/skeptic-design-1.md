## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/patch-set-preview/spec.md` in full. No code has been written yet
(`git status` clean except the untracked `openspec/changes/patch-set-diff-preview/`
dir) — this is a pure design-soundness review.

I independently re-verified every specific function/signature/visibility claim
design.md makes against the actual backend source (not trusting the doc's
prose), per the brief:

- `PatchSetApplyResolvers.resolveAll(edits: Vector[Edit], user: AuthenticatedUser,
  ctx: PatchSetApplyContext)(implicit ec): Future[Either[ServiceError,
  Vector[ResolvedEdit]]]`, `private[services]` — confirmed,
  `PatchSetApplyResolvers.scala:56-71`.
- `ResolvedEdit.priorStateJson: Option[JsValue]` — confirmed,
  `PatchSetApplyTypes.scala:73`.
- `PanelServiceHelpers.resolvePatch(request: UpdatePanelRequest, existing: Panel):
  Either[String, ResolvedPanelPatch]`, public — confirmed,
  `PanelServiceHelpers.scala:21`.
- `PanelConfigCodec.applyConfigPatch(existing: Panel, json: JsValue):
  Either[String, Panel]`, public, returns the complete `Panel` — confirmed,
  `backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala:77`.
- `PanelAppearance.applyPatchJson(json: JsValue, existing: PanelAppearance):
  Either[String, PanelAppearance]`, public — confirmed,
  `backend/src/main/scala/com/helio/domain/model.scala:387`.
- `PanelServiceHelpers.buildNewPanel/.resolveCreateConfig/.resolveCreateAppearance`,
  `private[services]`, exact cited line numbers 68/109/130 — all confirmed.
- `DashboardServiceValidation.validateDashboardUpdateRequest(request):
  Either[String, (Option[String], Option[DashboardAppearance],
  Option[DashboardLayout])]`, `private[services]` — confirmed,
  `DashboardServiceValidation.scala:95`.
- `PipelineStepConfigCodec.decode(kind: String, raw: String): Try[Any]`, public —
  confirmed, `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala:75`.
- `PanelRepository.findAllByDashboardId(dashboardId, callerOpt: Option[AuthenticatedUser],
  page: Page): Future[PagedResult[Panel]]`, and `PagedResult.total` — confirmed,
  `PanelRepository.scala:43-59` (`total` from `PagedResult.scala`/`pagination.scala:21`);
  `Page(0, 1)` (offset=0, limit=1) matches `Page(offset, limit)`'s real constructor order.
- `PatchSetApplyRollback`'s `fullDashboardInverse`/`fullDataTypeInverse`/
  `fullPipelineStepInverse` builders and the DataSource/Pipeline single-field
  rollback calls — all confirmed present as described.
- FK cascade facts backing the impact hints: `pipelines.source_data_source_id
  ... ON DELETE CASCADE` (V22), `pipeline_steps`/`pipeline_runs` `pipeline_id
  ... ON DELETE CASCADE` (V23/V24), `panels.dashboard_id ... ON DELETE CASCADE`
  (V2) — all confirmed, backing the dataSource-delete / pipeline-delete /
  dashboard-delete hints.
- Route/wiring feasibility: `PatchSetRoutes.scala`'s real current shape (single
  `/apply` path, `entity(as[PatchSet])` + `ServiceResponse.run`) and its
  `ApiRoutes.scala:419` construction site — both confirmed to support the
  D5/task-3.1/3.2 plan as described.
- Frontend: `ProposalReview.tsx` exists and does import `Modal`/`TextField`/
  `InlineError` as claimed; `dashboardsSlice.applyProposal` exists as a
  `createAsyncThunk`.

Every specific reuse claim I checked was accurate as stated — HEL-406's own
lesson about verifying claims against source was genuinely applied here for
the reuse inventory. **However**, tracing the actual consequences of these
correctly-identified functions surfaced a substantive, verifiable gap in the
design's central technical premise (below).

### Verdict: REFUTE

### Change Requests

1. **D1's "preview and apply share failure behavior 1:1 by construction" is
   false — `resolveAll` is a narrower gate than the real per-kind service
   methods, and I can name four concrete (kind, op) cases where a
   preview-clean edit would still fail at real `apply`, directly undermining
   AC2 ("Preview and apply share pre-validation, so a preview-clean patch set
   applies cleanly").**
   - **Panel update**: `PatchSetApplyResolvers.resolvePanelUpdate`
     (`PatchSetApplyResolvers.scala:272-305`) never calls
     `PanelServiceHelpers.resolvePatch` — it only extracts `dataTypeId`/
     `metricId` for binding checks and stores the raw request. The real
     forward-apply path, `PanelService.update` (`PanelService.scala:434-469`),
     calls `resolvePatch` first (rejects a blank title, a cross-type PATCH,
     an invalid appearance-patch JSON — `PanelServiceHelpers.scala:21-48`)
     and then `validateScatterAggregationConflict` (scatter-chart +
     aggregation conflict, `PanelService.scala:450`) — neither check is
     replicated in pre-validation. A blank-title or scatter+aggregation
     panel-update edit passes `resolveAll` (and thus `preview`) but is
     rejected by real `apply`.
   - **DataType update**: `PatchSetApplyResolvers.resolveDataTypeUpdate`
     (lines 505-528) does no content validation. The real
     `DataTypeService.applyUpdate` (`DataTypeService.scala:79-108+`)
     validates computed-field expression length and re-runs
     `ExpressionEvaluator.validateTolerant` per computed field. A
     preview-clean dataType update with an invalid computed-field expression
     fails at real `apply`.
   - **DataType delete**: `PatchSetApplyResolvers.resolveDataTypeDelete`
     (lines 530-549) never checks bound panels. The real
     `DataTypeService.delete` (`DataTypeService.scala:127-141`) calls
     `dataTypeRepo.existsBoundToAnyOwnedPanel` and **rejects the delete
     outright with `Conflict`** when true. This check is scoped to
     `owner_id = <the deleting user>` (`DataTypeRepository.scala:190-203`),
     i.e. it fires for the *common* case (a user deleting their own DataType
     that their own panels are bound to), not an edge case.
   - **Pipeline rename**: `PatchSetApplyResolvers.resolvePipelineUpdate`
     (lines 553-583) never checks that `request.name` (a plain `String`, not
     `Option`, per `UpdatePipelineRequest` at `PipelineProtocol.scala:14`) is
     non-blank. The real `PipelineService.updateName`
     (`PipelineService.scala:153-163`) 400s on an empty/blank name.

   This is a structural fact about the already-merged `resolveAll` (D1's
   choice to reuse it verbatim is otherwise sound and correctly verified —
   this is not asking to modify HEL-406), but design.md must stop asserting
   parity "by construction" and instead: (a) name this gap explicitly in
   Risks/Trade-offs, (b) decide whether the preview's projection layer should
   proactively replicate these specific checks (it is *already* calling
   `resolvePatch`/`applyConfigPatch`/etc., which do surface some of these —
   see CR3) or whether some of them (the DataType-delete conflict check,
   the Pipeline-rename blank check — neither of which corresponds to any
   already-existing *pure* function this ticket can reuse) need new pure
   helpers extracted, and (c) soften AC2's wording to what is actually
   achievable, or scope in the missing checks.

2. **The `dataType` `delete` impact hint (design.md D4, spec.md's "A dataType
   delete surfaces an unbind hint" scenario) is factually wrong for the
   common case.** Ground truth: `DataTypeService.delete` blocks the delete
   with a 409 `Conflict` whenever any panel *owned by the deleting user* is
   bound to the DataType (`DataTypeRepository.existsBoundToAnyOwnedPanel`,
   `owner_id`-scoped). "Panels bound to this DataType will be unbound, not
   deleted" only actually happens for the narrow case where every bound panel
   belongs to a *different* user via a sharing grant — the mechanism there is
   the DB-level `panels.type_id ... ON DELETE SET NULL` constraint
   (`V5__panel_type_binding.sql:1`), which only fires because the app-level
   owned-panel guard doesn't see cross-owner bindings. As specified, a user
   previewing a delete of their own bound DataType will see "will be
   unbound" and then have `apply` reject with a Conflict instead — the
   opposite of what preview promised. Fix the hint (and D4/spec.md's
   scenario) to reflect the actual, owner-scoped conflict-rejection behavior,
   or add the `existsBoundToAnyOwnedPanel` read to the impact computation (a
   read, consistent with the existing dashboard-delete-count precedent in
   D4) and surface a distinct "this delete will be rejected: N panel(s) you
   own are bound" hint instead.

3. **`EditPreview`'s response protocol (design.md D5, tasks.md 1.1) has no
   field to represent a per-edit projection failure**, yet every reused pure
   function the projection layer calls is fallible — `resolvePatch`,
   `applyConfigPatch`, `applyPatchJson` all return `Either[String, _]`,
   `validateDashboardUpdateRequest` returns `Either[String, _]`,
   `PipelineStepConfigCodec.decode` returns `Try[Any]` — and per CR1 these
   *will* be reached with inputs `resolveAll` did not already validate away
   (e.g. a blank panel title reaching `resolvePatch` inside the new
   projection code, after `resolveAll` already accepted the edit). Neither
   design.md, spec.md, nor tasks.md specifies what `PatchSetPreviewService
   .preview` does when this happens: fail the whole preview call the same
   way a `resolveAll` failure would (arguably the right answer, for
   consistency with AC2's "vice versa" framing), surface a per-edit error
   field, or something else. `tasks.md` 6.3 ("An invalid/unauthorized edit
   is rejected by `preview` identically to how `apply` would reject it")
   only exercises `resolveAll`-level rejection — no task/scenario covers a
   projection-level failure on an already-`ResolvedEdit`. This needs an
   explicit decision (and, if a whole-call failure, a task/scenario proving
   preview's failure in this case actually matches what `apply` would do for
   the same edit — not just assumed).

### Non-blocking notes

- Design.md's mirrored `.copy(...)` description for dashboard-update
  projection ("`existing.copy(appearance = ..., layout = ...)`,
  `DashboardService.scala:163-179`) omits `name` from the enumerated fields.
  The real `applyUpdate` (`DashboardService.scala:147-184`) composes `name`
  too (via the `renamed` intermediate in the `Some(name)` branch) — the
  correct one-shot pure mirror is `existing.copy(name =
  nameOpt.getOrElse(existing.name), appearance = ..., layout = ...)`. Minor
  imprecision in the prose; the executor should catch this from reading
  `DashboardService.scala` directly, but worth tightening in design.md so
  it isn't a silent gap.
