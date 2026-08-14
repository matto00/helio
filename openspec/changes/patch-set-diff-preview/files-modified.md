# Files Modified — HEL-408 (patch-set-diff-preview)

## Backend — new

- `backend/src/main/scala/com/helio/api/protocols/PatchSetPreviewProtocol.scala` — `EditPreview`/`PatchSetPreviewResponse` wire types + spray-json formats (design.md D5).
- `backend/src/main/scala/com/helio/services/PatchSetPreviewService.scala` — `preview(patchSet, user)`: reuses `PatchSetApplyResolvers.resolveAll` for pre-validation, then projects every `ResolvedEdit`, short-circuiting on the first content-check `Left`; no repository writes anywhere.
- `backend/src/main/scala/com/helio/services/PatchSetPreviewProjection.scala` — the pure(-ish) before/after projection per (kind, op), including the four content-check gaps closed per design.md D1/D1a (panel blank-title/scatter+aggregation conflict, pipeline blank-rename, dataType computed-field validation, dataType owned-panel/source-link delete conflicts).
- `backend/src/main/scala/com/helio/services/PatchSetPreviewProjectionSteps.scala` — the 22-arm pipelineStep `.copy(position/config)` dispatch, split out to keep `PatchSetPreviewProjection.scala` within the file-size budget.
- `backend/src/main/scala/com/helio/services/PatchSetPreviewImpact.scala` — the small, explicit impact-hint rule set (design.md D4): stale-rows, cascade, dataType-delete cross-owner-unbind, dashboard-delete panel-count, panel-rebind hints.
- `backend/src/test/scala/com/helio/services/PatchSetPreviewServiceSpec.scala` — service-level coverage (tasks.md 6.1-6.5), using the REAL non-superuser `helio_app_test` dual-pool RLS harness (mirrors `WorkspaceTeardownServiceSpec.scala`) for the whole spec, including the RLS-narrowing cross-owner-shared-panel hint scenarios and a direct unit test of `PanelRepository.existsBoundToType`.
- `backend/src/test/scala/com/helio/api/routes/PatchSetPreviewRoutesSpec.scala` — route-level coverage for `POST /api/patch-sets/preview` (tasks.md 6.6): returns the diff, mutates nothing, 404s a cross-owner edit identically to the existing PATCH route.
- `schemas/patch-set-preview-response.schema.json` — JSON Schema for `PatchSetPreviewResponse`, checked by `scripts/check-schema-drift.mjs` against `EditPreview`/`PatchSetPreviewResponse`.

## Backend — modified

- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — new `existsBoundToType(dataTypeId, user)`: RLS-scoped (no `owner_id` predicate), run under `withUserContext` — design.md D4's detection mechanism for the dataType-delete cross-owner-shared-panel impact hint.
- `backend/src/main/scala/com/helio/api/routes/PatchSetRoutes.scala` — added `POST /patch-sets/preview` alongside the existing `/apply` route, same file/shell style.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — constructs `PatchSetPreviewService` and wires it into `PatchSetRoutes`.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — added `PatchSetPreviewProtocol` to the aggregator's `extends` list.
- `backend/src/test/scala/com/helio/api/routes/PatchSetRoutesSpec.scala` — updated fixture wiring for `PatchSetRoutes`'s new `patchSetPreviewService` constructor param (no new assertions here — preview route coverage lives in `PatchSetPreviewRoutesSpec.scala`).

## Frontend — new

- `frontend/src/features/patchSets/types/patchSet.ts` — `PatchSet`/`Edit`/`EditTarget` (HEL-403 wire shape) + `PatchSetPreviewResponse`/`EditPreview` (HEL-408) + `PatchSetApplyResponse`/`EditOutcome` (HEL-406, reused verbatim).
- `frontend/src/features/patchSets/services/patchSetService.ts` — `previewPatchSet`/`applyPatchSet`, mirrors `proposalService.applyDashboardProposal`'s `httpClient.post` shape.
- `frontend/src/features/patchSets/state/patchSetsSlice.ts` — `previewPatchSet`/`applyPatchSet` thunks, mirrors `dashboardsSlice.applyProposal`'s `createAsyncThunk`/`rejectWithValue`/Axios-error-unwrap shape.
- `frontend/src/features/patchSets/state/patchSetsSlice.test.ts` — thunk fulfill/reject coverage (tasks.md 6.8).
- `frontend/src/features/patchSets/ui/PatchSetReview.tsx` — presentational review component: kind/op header, impact hints, before/after raw-JSON blocks (design.md D7 — no bespoke per-kind diff widget), Reject/Accept footer mirroring `ProposalReview.tsx`.
- `frontend/src/features/patchSets/ui/PatchSetReview.css` — `DESIGN.md` tokens (`--app-*`/`--space-*`/`--text-*`), mirrors `ProposalReview.css`'s structure.
- `frontend/src/features/patchSets/ui/PatchSetReview.test.tsx` — RTL coverage (tasks.md 6.7).
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.tsx` — route container at `/patch-sets/review`: reads `location.state.patchSet` or synthesizes a genuinely-applyable demo (first dashboard's first panel, title-only update edit), calls `previewPatchSet` on mount, wires Accept to `applyPatchSet` (HEL-406's existing endpoint) / Reject to navigating home — mirrors `ProposalReviewPage.tsx`'s real, git-verified structure (design.md D6).
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.test.tsx` — RTL coverage (tasks.md 6.9): demo synthesis, router-state patch set, Accept/Reject navigation.

## Frontend — modified

- `frontend/src/app/App.tsx` — registers `/patch-sets/review` alongside the existing `/proposals/review` route.
- `frontend/src/store/store.ts` — registers `patchSetsReducer` under the `patchSets` key.

## Planning artifacts

- `openspec/changes/patch-set-diff-preview/tasks.md` — all 26 tasks marked complete.
