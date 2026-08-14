## 1. Backend — protocol + schema

- [x] 1.1 Create `backend/src/main/scala/com/helio/api/protocols/PatchSetPreviewProtocol.scala`:
      `EditPreview(index: Int, kind: String, op: String, before: Option[JsValue],
      after: Option[JsValue], impact: Vector[String])`,
      `PatchSetPreviewResponse(edits: Vector[EditPreview])`, formats.
- [x] 1.2 Create `schemas/patch-set-preview-response.schema.json` (matching 1.1's fields exactly
      for `check-schema-drift.mjs`).
- [x] 1.3 Add the new protocol trait to `JsonProtocols.scala`'s `extends` list.

## 2. Backend — preview service

- [x] 2.1 Create `backend/src/main/scala/com/helio/services/PatchSetPreviewService.scala`:
      `preview(patchSet, user)` calls `PatchSetApplyResolvers.resolveAll` (design.md D1, same
      `PatchSetApplyContext` construction `PatchSetApplyService` already builds) — a pre-validation
      failure returns the same `Left(ServiceError)`. On success, maps each `ResolvedEdit` through
      `PatchSetPreviewProjection` (2.2), which itself returns `Either[ServiceError, EditPreview]`
      per edit (design.md D1a) — the FIRST `Left` among all edits fails the WHOLE `preview` call
      with that `ServiceError`, matching a `resolveAll` failure's shape exactly (not a partial/
      per-edit-only failure). No repository writes anywhere in this file.
- [x] 2.2 Create `backend/src/main/scala/com/helio/services/PatchSetPreviewProjection.scala`
      (design.md D2/D3/D1a — kept in its own file from the start, learning from HEL-406/HEL-668's
      file-size lesson). Returns `Either[ServiceError, EditPreview]` per edit (not a bare
      `EditPreview`), since every branch below is fallible:
      - `before(edit: ResolvedEdit): Option[JsValue] = edit.priorStateJson` (reused verbatim).
      - `after` for `delete` → `None`, EXCEPT dataType delete (see the two content checks below,
        which run for `dataType` `delete` specifically and can fail the whole call).
      - `after` for `update`: panel via `PanelServiceHelpers.resolvePatch` (propagates its `Left`
        on a blank title/cross-type-PATCH/invalid-appearance-JSON — design.md D1) +
        `validateScatterAggregationConflict`-equivalent check (design.md D1, mirrors
        `PanelService.scala:450`) + `PanelAppearance.applyPatchJson` + `PanelConfigCodec.
        applyConfigPatch` (all pure), composed onto `prior`, serialized via `PanelResponse.
        fromDomain`; dashboard via `DashboardServiceValidation.validateDashboardUpdateRequest`
        (pure, propagates its `Left`) + `existing.copy(name = nameOpt.getOrElse(existing.name),
        appearance = appearanceOpt.getOrElse(existing.appearance), layout =
        layoutOpt.getOrElse(existing.layout))` (design.md's corrected three-field mirror),
        serialized via `DashboardResponse.fromDomain`; dataSource via the trivial rename-only
        `.copy` `PatchSetApplyRollback` already uses; dataType via the trivial field `.copy` PLUS
        the computed-field content check below; pipeline via a NEW blank-name check mirroring
        `PipelineService.scala:154-155` (`if (req.name.trim.isEmpty) Left(...)`) before the
        trivial rename `.copy`; pipelineStep via `PipelineStepConfigCodec.decode` (pure,
        propagates its `Try`'s failure) + a `.copy(...)`, serialized via
        `PipelineStepResponse.fromDomain`.
      - `after` for `create`: panel via `PanelServiceHelpers.buildNewPanel` (pure, using a
        `PanelId("(pending)")` sentinel and the current user as `ownerId`/`meta.createdBy`);
        dashboard/dataSource/pipeline via a trivial field-echo of the decoded `Create*Request`
        (each carries few enough fields that no shared builder exists to reuse — construct the
        projected response directly, `id = "(pending)"`).
      - **dataType `update` content check** (design.md D1/D1a): reject on the SAME conditions
        `DataTypeService.applyUpdate` does — `RequestValidation.MaxExpressionLength` per computed
        field, then `ExpressionEvaluator.validateTolerant(expression, fieldNames)` per computed
        field (both public, pure, reused directly — mirrors `DataTypeService.scala:79-108`).
      - **dataType `delete` content checks** (design.md D1/D1a/D4): (a)
        `dataTypeRepo.existsBoundToAnyOwnedPanel(id, user)` (a genuine READ) — `true` fails the
        WHOLE preview call with the same `Conflict` message `DataTypeService.delete` would give
        (mirrors `DataTypeService.scala:133-138`); (b) a source-link check mirroring
        `DataTypeService.checkSourceLink` (`private`, not directly reusable — replicate its two-line
        shape: if `prior.sourceId` is defined, `dataSourceRepo.findByIdInternal` existence — `Some`
        fails the whole call with the same `Conflict` message, mirrors `DataTypeService.scala:
        159-171`).
- [x] 2.3a Add `PanelRepository.existsBoundToType(dataTypeId: DataTypeId, user: AuthenticatedUser):
      Future[Boolean]` (design.md D4's detection mechanism, round-2 REFUTE fix): a plain
      `SELECT COUNT(*) FROM panels WHERE type_id = ...` run inside `ctx.withUserContext(user.id.
      value)` (app pool, RLS-enforced) — deliberately NO `owner_id` filter in the SQL; `panels_select`'s
      own RLS policy (`USING (helio_can_access_dashboard(dashboard_id))`) already restricts visible
      rows to panels on a dashboard this user can access. Mirrors `existsBoundToAnyOwnedPanel`'s
      existing `withUserContext`/raw-SQL style, deliberately WITHOUT its `owner_id` clause.
- [x] 2.3 Create `backend/src/main/scala/com/helio/services/PatchSetPreviewImpact.scala`
      (design.md D4): one pure/read-composing function per the corrected rule set — `pipeline`/
      `pipelineStep` `update`/`delete` stale-rows hint; `pipeline` `delete` additionally names the
      steps/run-history cascade qualitatively; `dataSource` `delete` cascade hint; `dataType`
      `delete` — ONLY when 2.2's owned-panel check (a) returned `false` (i.e. preview did not
      already reject) AND `2.3a`'s `existsBoundToType` returns `true` — the corrected "shared-panel
      unbind, not visible to this ownership-scoped check" hint (design.md D4); `dashboard` `delete`
      panel-count hint (via `panelRepo.findAllByDashboardId(id, Some(user), Page(0, 1)).map(_.total)`
      — a read, not a write); `panel` `update` with a `config.dataTypeId` change → rebind hint.
      Every other (kind, op) → empty `Vector.empty`. Only reached for edits 2.2 did NOT already
      reject.

## 3. Backend — route

- [x] 3.1 Add `POST /api/patch-sets/preview` to the EXISTING `PatchSetRoutes.scala` (HEL-406),
      alongside `/apply` — same file, same `entity(as[PatchSet])` + `ServiceResponse.run` shell
      style, no new route file.
- [x] 3.2 Wire `PatchSetPreviewService` into `ApiRoutes.scala`'s existing `PatchSetRoutes`
      construction (constructor param addition, not a new route composition point).

## 4. Frontend — types + service + state

- [x] 4.1 Create `frontend/src/features/patchSets/types/patchSet.ts`: TS types mirroring
      `PatchSet`/`Edit`/`EditTarget` (HEL-403) and `PatchSetPreviewResponse`/`EditPreview` (1.1).
- [x] 4.2 Create `frontend/src/features/patchSets/services/patchSetService.ts`:
      `previewPatchSet(patchSet)` (`POST /api/patch-sets/preview`) and `applyPatchSet(patchSet)`
      (`POST /api/patch-sets/apply`, HEL-406's existing endpoint) — mirrors
      `proposalService.applyDashboardProposal`'s exact `httpClient.post` shape.
- [x] 4.3 Create `frontend/src/features/patchSets/state/patchSetsSlice.ts`: `previewPatchSet`/
      `applyPatchSet` thunks mirroring `dashboardsSlice.applyProposal`'s exact
      `createAsyncThunk`/`rejectWithValue`/Axios-error-unwrap shape.

## 5. Frontend — review component

- [x] 5.1 Create `frontend/src/features/patchSets/ui/PatchSetReview.tsx` (design.md D6/D7): props
      `{ preview: PatchSetPreviewResponse, applying: boolean, error?: string | null, onAccept: () =>
      void, onReject: () => void }`. Reuses `Modal`/`InlineError` (mirrors `ProposalReview.tsx`'s
      exact usage). Lists each edit: kind/op header, impact hints (if any), before/after as
      formatted JSON blocks (design.md D7 — no bespoke per-kind diff widget). Footer: Reject /
      Accept buttons, `applying` disables both, matching `ProposalReview.tsx`'s exact button
      pattern.
- [x] 5.2 Create `frontend/src/features/patchSets/ui/PatchSetReview.css` following `DESIGN.md`
      tokens (`--app-*`/`--space-*`/`--text-*`), mirroring `ProposalReview.css`'s structure.
- [x] 5.3 Create `frontend/src/features/patchSets/ui/PatchSetReviewPage.tsx` (design.md D6, round-4
      REFUTE fix — mirrors `ProposalReviewPage.tsx`'s ACTUAL structure, verified against its real
      git history, not the false "component shipped first" precedent the original draft cited):
      reads `location.state.patchSet` if present, else synthesizes a demo `PatchSet` from real
      workspace data — the first dashboard's first panel, a single title-only `update` edit (kept
      genuinely applyable, mirroring `ProposalReviewPage`'s own "kept applyable" demo-proposal
      comment). Calls `previewPatchSet` on mount; on success renders `PatchSetReview` with the
      result; `onAccept` dispatches `applyPatchSet` then navigates to `/`; `onReject` navigates to
      `/` directly. Loading/error states mirror `ProposalReviewPage.tsx`'s own `EmptyState`/loading
      patterns.
- [x] 5.4 Wire `/patch-sets/review` into `frontend/src/app/App.tsx`, alongside the existing
      `/proposals/review` route registration (same `<Route>` list, same `ProtectedRoute`/`AppShell`
      nesting).

## 6. Tests

- [x] 6.1 `PatchSetPreviewServiceSpec.scala`: a mixed patch set (panel update + panel delete +
      dashboard update) computes the correct before/after for each edit and writes nothing
      (assert every touched resource unchanged after `preview` returns).
- [x] 6.2 A create edit's `after` carries the `"(pending)"` id sentinel; a delete edit's `after`
      is `None`.
- [x] 6.3 An invalid/unauthorized edit is rejected by `preview` identically to how `apply` would
      reject it (same error) — a `resolveAll`-level rejection.
- [x] 6.4 (design.md D1/D1a/D1's four named content-check gaps) Each of the following is rejected
      by `preview` with the SAME error `apply` would give, proving the gap closed, not merely
      absent from these tests: a panel-update edit with a blank title; a panel-update edit setting
      `chartType: "scatter"` together with an `aggregation`; a pipeline-rename edit with a blank
      `name`; a dataType-update edit with a computed-field expression exceeding
      `RequestValidation.MaxExpressionLength`; a dataType-update edit with an invalid computed-field
      expression (per `ExpressionEvaluator.validateTolerant`); a dataType-delete edit targeting a
      DataType with a panel OWNED by the deleting user bound to it (assert the `Conflict` message
      matches `DataTypeService.delete`'s); a dataType-delete edit targeting a source-companion
      DataType (assert the `checkSourceLink`-equivalent `Conflict`).
- [x] 6.5 Each of the corrected impact-hint rules (2.3) is exercised by its own test case, including
      the dashboard-delete panel-count hint against a dashboard with a known panel count, the
      corrected dataType-delete cross-owner-shared-panel hint (distinct from the rejection case in
      6.4), and the "no hint" case for an ordinary rename. Also directly unit-test
      `PanelRepository.existsBoundToType` (2.3a) — **using the REAL, non-superuser `helio_app_test`
      dual-pool test harness** (mirrors `RlsSharingAwareTablesSpec.scala`/
      `WorkspaceTeardownServiceSpec.scala`'s established pattern; NOT the simplified `DbContext(db,
      db)` pattern most ordinary service/repository specs use — that pattern connects both pools as
      the `postgres` superuser, which silently bypasses RLS regardless of `FORCE ROW LEVEL
      SECURITY`, so it would make this specific assertion pass for the wrong reason, or worse, tempt
      an "obvious fix" — adding an `owner_id` predicate to `existsBoundToType`'s own SQL — that would
      silently collapse it back into `existsBoundToAnyOwnedPanel`'s owner-only behavior, defeating
      round 2's entire cross-owner-detection fix without tripping any test. This codebase has already
      hit and documented this exact trap once, for a structurally identical raw-SQL-no-owner_id-
      predicate situation — see `WorkspaceTeardownServiceSpec.scala`'s own doc comment, cited
      directly, not re-derived, round-3 REFUTE finding). `PatchSetPreviewServiceSpec.scala`'s OTHER
      assertions (before/after diff correctness, content-check rejections) need no real RLS
      enforcement and may use the ordinary simplified harness — this ONE assertion is the exception,
      and should be isolated into its own test (or its own file, mirroring
      `WorkspaceTeardownServiceSpec.scala`'s own separation) rather than mixed into a
      superuser-harness spec where it would be silently miscovered): `true` for a panel bound to the
      type on a dashboard the caller can access (owner or shared), `false` when no panel is bound OR
      when a bound panel's dashboard is NOT visible to the caller (proving the RLS scoping actually
      narrows results, not just that the method compiles).
- [x] 6.6 `PatchSetPreviewRoutesSpec.scala`: `POST /api/patch-sets/preview` returns the diff and a
      subsequent read of every named resource shows it unchanged.
- [x] 6.7 `PatchSetReview.test.tsx` (RTL): renders a diff (kind/op/impact/before/after) for a
      sample `PatchSetPreviewResponse`; clicking Accept calls `onAccept`; clicking Reject calls
      `onReject`; `applying` disables both buttons.
- [x] 6.8 `patchSetsSlice.test.ts`: `previewPatchSet`/`applyPatchSet` thunks fulfill/reject
      correctly, mirroring `dashboardsSlice`'s existing `applyProposal` test coverage style.
- [x] 6.9 `PatchSetReviewPage.test.tsx` (RTL, mirrors `ProposalReviewPage.test.tsx`'s coverage
      style): renders the synthesized demo patch set's preview when no router state is supplied;
      renders `location.state.patchSet`'s preview when one is supplied; Accept dispatches
      `applyPatchSet` and navigates to `/`; Reject navigates to `/` without applying.
- [x] 6.10 Run `sbt test` + `npm test` (root + frontend); confirm green alongside the existing
      suites.
