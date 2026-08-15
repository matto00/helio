# Files modified — undo-patch-set-apply (HEL-413)

## Backend — journal (D1/D2/D2a/D3)

- `backend/src/main/resources/db/migration/V79__patch_set_applications.sql` — journal table, owner-scoped RLS, both indexes (owner_id; owner_id+applied_at DESC for the retention prune)
- `backend/src/main/scala/com/helio/domain/model.scala` — added `PatchSetApplicationId` value-class id
- `backend/src/main/scala/com/helio/api/protocols/IdParsing.scala` — added `PatchSetApplicationIdSegment` path matcher
- `backend/src/main/scala/com/helio/api/protocols/PatchSetApplyProtocol.scala` — `PatchSetApplyResponse` gained additive `applicationId: Option[String]`
- `backend/src/main/scala/com/helio/infrastructure/PatchSetApplicationRepository.scala` (new) — `create` (insert + atomic prune-to-20 per owner), `findById` (RLS + owner-scoped)
- `backend/src/main/scala/com/helio/services/PatchSetApplyService.scala` — wired `PatchSetApplicationRepository` into the constructor; `applyResolved`'s loop now also captures a panel-update edit's raw (unmaterialized) config into a separate index-keyed accumulator, and the terminal success branch journals the application, returning `applicationId`
- `backend/src/test/scala/com/helio/services/PatchSetApplyServiceSpec.scala` — added `applicationRepo` to the fixture + 4 new tests (task 5.1: journal-on-success, no-journal-on-rollback, retention prune, raw vs materialized rawResultingConfig)
- `backend/src/test/scala/com/helio/api/routes/PatchSetRoutesSpec.scala`, `backend/src/test/scala/com/helio/api/routes/PatchSetPreviewRoutesSpec.scala`, `backend/src/test/scala/com/helio/services/PatchSetPreviewServiceSpec.scala` — updated `PatchSetApplyService` construction for the new constructor param
- `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala` — registered `patch_set_applications` in the direct-owner-tables list (done by the prior session)

## Backend — undo service (D4/D4a/D4b/D5)

- `backend/src/main/scala/com/helio/services/PatchSetUndoTypes.scala` (new) — `PatchSetUndoContext` (repos undo's Phase-1/Phase-2 passes need)
- `backend/src/main/scala/com/helio/services/PatchSetUndoInverse.scala` (new) — full-overwrite `Update*Request` builders per kind, from decoded response JSON (not a domain object)
- `backend/src/main/scala/com/helio/services/PatchSetUndoConflictCheck.scala` (new, fixed a missing `PatchSetApplicationRepository` import found during this session) — Phase-1 field-scoped conflict pass over all journaled edits
- `backend/src/main/scala/com/helio/services/PatchSetUndoService.scala` (new) — `undo(applicationId, user)`: loads the journal row, runs the Phase-1 conflict check, then reverse-walks and restores each edit via the same per-kind service methods `PatchSetApplyRollback` uses; honest `notAttempted`/`failed` reporting on a genuine Phase-2 failure
- `backend/src/main/scala/com/helio/api/protocols/PatchSetUndoProtocol.scala` (new) — `PatchSetUndoResponse`/`EditUndoOutcome` wire types
- `backend/src/main/scala/com/helio/api/routes/PatchSetUndoRoutes.scala` (new) — `POST /api/patch-sets/:id/undo`
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — constructs `PatchSetApplicationRepository`/`PatchSetUndoService`, mounts `PatchSetUndoRoutes`
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixed in `PatchSetUndoProtocol`
- `backend/src/test/scala/com/helio/services/PatchSetUndoInverseSpec.scala` (new) — unit regression coverage for the omitted-Option-config-field-must-become-explicit-null bug class
- `backend/src/test/scala/com/helio/services/PatchSetUndoServiceSpec.scala` (new) — full undo-service integration coverage (all-six-kinds restore, create/delete undo, structurally-unrecoverable Phase-1 blocker, conflict blocker, Phase-2 partial-failure honesty, RLS, metric raw-field conflict precision)
- `backend/src/test/scala/com/helio/api/routes/PatchSetUndoRoutesSpec.scala` (new) — route-level 200/404/409 status-mapping coverage

## Frontend — undo affordance (D6)

- `frontend/src/features/patchSets/types/patchSet.ts` — `PatchSetApplyResponse.applicationId`, new `EditUndoOutcome`/`PatchSetUndoResponse` types
- `frontend/src/features/patchSets/services/patchSetService.ts` — `undoPatchSet(applicationId)`
- `frontend/src/features/patchSets/state/patchSetsSlice.ts` — `undoPatchSet` thunk + `undoStatus`/`undoError` state
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.tsx` — `handleAccept` pushes an "Applied. Undo" toast (`duration: 0`) when the apply response carries an `applicationId`; the Undo action calls the new thunk and shows a follow-up toast
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.test.tsx` — added `toasts` reducer to the test store + 4 new tests (toast appears/absent, Undo click calls the endpoint, Undo error path)

## MCP — undo_patch_set tool (D6)

- `helio-mcp/src/types.ts` — `PatchSetApplyResponse.applicationId`, new `EditUndoOutcome`/`PatchSetUndoResponse` types
- `helio-mcp/src/helioApi.ts` — `HelioApi.undoPatchSet(applicationId)`
- `helio-mcp/src/tools/refinementHandlers.ts` — `undoPatchSetHandler`
- `helio-mcp/src/tools/refinement.ts` — registers the `undo_patch_set` tool
- `helio-mcp/src/tools/refinementHandlers.test.ts` — 3 new tests (call-routing, conflict propagation, 404 propagation)
- `helio-mcp/README.md` — tool-catalog row + updated typical-flow sentence

## Schemas

- `schemas/patch-set-apply-response.schema.json` — added `applicationId`
- `schemas/patch-set-undo-response.schema.json` (new) — `PatchSetUndoResponse`/`EditUndoOutcome`

## OpenSpec

- `openspec/changes/undo-patch-set-apply/tasks.md` — checkboxes updated to reflect completed work

## Cycle 2 — evaluation-1.md change requests

- `frontend/src/store/store.ts` — CR1: configured `serializableCheck.ignoredPaths`/`ignoredActionPaths` in `getDefaultMiddleware()` so the Undo toast's `action.onClick` (a deliberate, intentional live closure in `toasts` state — the first real call site to populate `ToastAction.onClick`) no longer triggers RTK's `serializableStateInvariantMiddleware` `console.error` on every subsequent dispatch
- `frontend/src/store/store.test.ts` (new) — regression coverage for CR1: dispatching a toast with a live `onClick` produces zero `console.error` with the config, plus a negative-control test proving the SAME dispatch DOES log without it (mirrors `store.ts`'s exact middleware config in an isolated store rather than importing the real singleton, to avoid an unrelated, pre-existing circular-type reference between `store.ts`/`listenerMiddleware.ts` that only surfaces when `store.ts` is ts-jest's per-file compilation entry point)
- `frontend/src/features/patchSets/state/patchSetsSlice.ts` — CR2: `invalidateAffectedState` generalized to accept an `OutcomeLike[]` (satisfied structurally by both `EditOutcome[]` and `EditUndoOutcome[]`) instead of the full `PatchSetApplyResponse`; `undoPatchSet` thunk now takes `{applicationId, patchSet}` (the original patch set, needed to resolve each `EditUndoOutcome.index` back to its `target.kind`) and calls `invalidateAffectedState` after a successful undo, exactly mirroring `applyPatchSet`; corrected the thunk's docstring, which previously made a false claim about the caller handling cache invalidation
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.tsx` — Undo action's `onClick` now dispatches `undoPatchSet({ applicationId, patchSet })` (was `undoPatchSet(applicationId)`)
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.test.tsx` — added a CR2 regression test: Undo genuinely refreshes the touched dashboard's cached panels (mirrors the existing Accept-side regression test for the identical bug class)
- `frontend/src/features/patchSets/state/patchSetsSlice.test.ts` — updated all `invalidateAffectedState` call sites for the new `edits` (not `response`) parameter; added `undoPatchSet.fulfilled`/`.rejected` reducer tests (previously missing entirely)

## Cycle 3 — skeptic-final-1.md change requests

- `frontend/src/features/patchSets/state/patchSetsSlice.ts` — CR1 (blocking): `invalidateAffectedState`'s panel-dashboardId resolution now falls back to `patchSet.edits[outcome.index].patch`'s `dashboardId` (the ORIGINAL edit's create payload) when both `resultingState`/`priorState` are absent — the exact shape `PatchSetUndoService.restoreCreateUndo` returns for a `create` edit's undo (the created resource is deleted, so nothing survives to describe in either field). Fixes a created-then-undone panel staying visible as a "ghost" until a manual reload. Known, explicitly out-of-scope residual gap (not part of the skeptic's requested lower-risk fix, and not fixable without a backend change): a created-then-undone **dashboard** is still never removed from `dashboardsSlice`, since a dashboard create's patch has no id field at all (the dashboard doesn't exist yet when the patch is built) and `EditUndoOutcome` tracks no `newId` for a `restored` create-undo.
- `frontend/src/features/patchSets/state/patchSetsSlice.test.ts` — added the regression test the skeptic specified: an `EditUndoOutcome`-shaped `{status: "restored", resultingState: undefined}` outcome for a `create`-op panel edit asserts the correct dashboard IS invalidated via the new patch-payload fallback.
- `frontend/src/features/toasts/state/toastsSlice.ts` — CR2: `pushToast` converted to RTK's `prepare`-callback form so the generated `id` is available synchronously on the returned action (`pushToast(input).payload.id`), before dispatch — needed so a toast's own action can dismiss itself.
- `frontend/src/features/toasts/hooks/useToast.ts` — `push` now returns the pushed toast's id (previously returned nothing).
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.tsx` — CR2: the "Applied." toast's Undo `onClick` now dispatches `dismissToast(toastId)` (captured from `pushToast`'s return value) before calling the undo thunk, so the toast is dismissed by its own Undo click per design.md D6's stated behavior ("dismissed only by an explicit close/Undo click...") rather than lingering as a stale, still-clickable affordance alongside the new "Undone." toast.
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.test.tsx` — extended the existing Undo-click test to assert the "Applied." toast's id is no longer present in `toasts.items` after Undo is clicked.

Live UI re-verification (Playwright against the running dev servers) was not performed by this executor session — no browser tooling available in this session; the automated regression coverage above (including the skeptic's exact requested test shape for CR1) is the evidence provided. The next review round should confirm live: a patch set with a `panel` `create` edit → Accept → Undo → the panel disappears from the grid without a manual reload, and the "Applied." toast disappears immediately on Undo click.

## Cycle 4 — skeptic-final-2.md CR1 (dashboard half of the create-undo ghost bug), human-approved fix

- `backend/src/main/scala/com/helio/services/PatchSetUndoService.scala` — `restoreCreateUndo` now populates `EditUndoOutcome.newId` with `Some(id)` (the just-deleted resource's own id) instead of hardcoding `None`, for every create-undo (`panel`/`dashboard`/`dataSource`/`pipeline`) — closes the gap round 2 found specifically for `dashboard`: unlike a panel create, a dashboard's own create patch never carries an id (it didn't exist yet when the patch was built), so `newId` is the ONLY surviving way for a caller to know which resource was removed once `resultingState`/`priorState` are both unavailable.
- `backend/src/main/scala/com/helio/api/protocols/PatchSetUndoProtocol.scala` — `EditUndoOutcome`'s doc comment updated to describe `newId`'s expanded semantics (populated for BOTH a `recreated` delete-undo and now a `restored` create-undo).
- `backend/src/test/scala/com/helio/services/PatchSetUndoServiceSpec.scala` — strengthened the existing panel-create-undo test (5.3b) to assert `newId` equals the deleted panel's id; added a new dedicated test (5.3b-dashboard) exercising a dashboard create → apply → undo end-to-end, asserting `newId` is populated and the dashboard is genuinely gone.
- `frontend/src/features/patchSets/state/patchSetsSlice.ts` — `invalidateAffectedState`'s `dashboard`-kind branch now dispatches `dashboardRemoved(outcome.newId)` when `edit.op === "create"` and `outcome.newId` is present (mirroring the existing `edit.op === "delete"` branch, keyed off `newId` instead of `priorState`/`target.id`), closing the residual gap explicitly flagged (not fixed) in the Cycle 3 section above. `OutcomeLike` gained a `newId` field.
- `frontend/src/features/patchSets/state/patchSetsSlice.test.ts` — added the regression test the skeptic specified: an `EditUndoOutcome`-shaped `{status: "restored", newId: "dash-created-1", resultingState: undefined}` outcome for a `create`-op dashboard edit asserts `dashboardRemoved` IS dispatched.

**Live verification performed this cycle** (the human explicitly asked for real browser verification, not just the unit test):
- Browser/Playwright-driven verification of the actual chat-driven refinement flow was attempted but not completed: `@playwright/test` is not installed in this worktree's `node_modules` (which doesn't exist at all here — root-level tooling resolves via Node's parent-directory walk-up to the main checkout's `node_modules`, which also lacks `@playwright/test`). Installing it would write to `~/Development/helio/node_modules` outside this worktree, under the home directory, which CLAUDE.md's file-system-permissions rule requires explicit user "Approved" for — not obtained in this session, so not done.
- Instead, performed a genuine **wire-level live verification** against the actual running dev backend (restarted via `scripts/concertino/start-servers.sh` so it loaded this cycle's fix — the previously-running process predated the code change): registered a fresh user, `POST /api/patch-sets/apply` with a real `{target: {kind: "dashboard"}, op: "create", patch: {name: "HEL-413 Wire Verify Ghost Dashboard"}}` edit (200, dashboard genuinely created and visible via `GET /api/dashboards`), then `POST /api/patch-sets/:id/undo` (200) — the response now reads `{"edits":[{"index":0,"newId":"d8d9a2a2-...","status":"restored"}]}`, i.e. `newId` is genuinely populated on the live server (previously absent, per skeptic-final-2.md's own identical wire-level check), and `GET /api/dashboards` afterward confirms the dashboard is genuinely gone. This directly confirms the backend half of the fix live, end-to-end, against the real running system — not just the embedded-Postgres test suite.
- What this wire-level check does NOT cover: whether the React frontend, driven through an actual browser, correctly dispatches `dashboardRemoved` and re-renders the sidebar without the ghost. That specific gap is covered by the new `patchSetsSlice.test.ts` regression test above, constructed from the EXACT wire shape just confirmed live (`newId` present, `resultingState` absent) — but a true end-to-end browser confirmation was not possible in this session for the reason stated above.
