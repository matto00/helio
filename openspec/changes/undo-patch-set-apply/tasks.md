## 1. Backend — Journal (D1/D2/D2a/D3)

- [x] 1.1 Add `V79__patch_set_applications.sql`: `id TEXT PK, owner_id UUID, applied_at TIMESTAMPTZ, edits JSONB, created_at TIMESTAMPTZ`, owner-scoped RLS mirroring `V77`/`V78`'s pattern
- [x] 1.2 New `PatchSetApplicationRepository`: `create` (insert + prune to last 20 per owner in the same write, via a single atomic `DELETE ... NOT IN (SELECT top-20)`), `findById` (RLS + owner-scoped)
- [x] 1.3 `PatchSetApplyService.apply`/`applyResolved` threads `targetKind`/`op` (from `ResolvedEdit`) through to the journal write via 1.2, returning the new `applicationId`; the `Vector[EditOutcome]` that becomes `PatchSetApplyResponse.edits` (`applied.map(_._2)`) is built exactly as it is today, unaffected; the failure-path call to `PatchSetApplyRollback.rollback(appliedSoFar, ...)` also keeps its existing 2-tuple `Vector[(ResolvedEdit, EditOutcome)]` shape, completely untouched; the failure-path `PatchSetApplyResponse(rolledBack, failure = Some(err.message))` construction gets an explicit `applicationId = None` alongside the new field (D2a)
- [x] 1.4 `PatchSetApplyProtocol`/`PatchSetApplyResponse` gains additive `applicationId: Option[String]` ONLY; `EditOutcome` itself gains no new field; wire `applicationId` through `PatchSetRoutes`'s existing `/apply` response unchanged otherwise
- [x] 1.5 `PatchSetApplyService.applyResolved`'s own loop (NOT `PatchSetApplyForward.applyOne` — no signature change to `applyOne` or `PatchSetApplyContext` threading needed) additionally issues one bare, unmaterialized `panelRepo.findByIdInternal(id)` fetch — using the constructor-level `panelRepo` field the class already has — for a panel `update` edit (not `create` — `PanelService.create` never materializes, so no extra fetch is needed there) right after that edit's `applyOne` call succeeds, and collects the result into a SEPARATE, index-keyed `Map[Int, JsValue]` accumulator built alongside `applied` in the same loop — never merged into `applied` itself, read only by the terminal success branch when building the journal payload (D2a)

## 2. Backend — Undo service (D4/D4a/D4b/D5)

- [x] 2.1 New `PatchSetUndoInverse`: builds a full-overwrite `Update*Request` per kind from a DECODED `XResponse` (not a domain object) — mirror `PatchSetApplyRollback`'s field-for-field mapping exactly, including `fullConfigInverse`'s explicit-null-default treatment for omitted Option config fields (D5)
- [x] 2.2 New `PatchSetUndoConflictCheck`: phase-1 pass over all journaled edits — for `update`/`create` edits, fetch each target's current live state and compare ONLY the fields that edit kind's D5 inverse-builder restores (never a whole-JSON diff — excludes server-materialized/dynamic fields like `lastRunStatus`/`lastRunAt`/`lastRunRowCount`); for `panel` specifically, `config` is DECOMPOSED before comparing — strip `metricDeprecated` (metric/chart/table, genuinely never patch-decodable) from both sides unconditionally, and for the four metric-materialized effective fields (`dataTypeId`/`fieldMapping`/`aggregation`/`unit`, when `metricId` is set), compare the CURRENT live panel's raw config (fetched via the same unmaterialized `findByIdInternal` path) against the journaled `rawResultingConfig` (1.5/D2a) — genuine raw-vs-raw, never stripped; a `panel`/`pipelineStep` `delete` edit's undo (recreate) is always eligible; a `dashboard`/`dataSource`/`dataType`/`pipeline` `delete` edit is ALWAYS flagged as a Phase-1 blocker (structurally unrecoverable, not a conflict — no live state to check, but it can never satisfy the all-or-nothing guarantee)
- [x] 2.3 New `PatchSetUndoService.undo(applicationId, user)`: loads the journal row (404 if missing/foreign), runs 2.2 across ALL edits before any mutation — ANY Phase-1 blocker (conflict OR structurally-unrecoverable delete-kind) aborts with a `409` naming every blocking edit and its reason, restoring nothing — then reverse-walks the edits restoring each via the same per-kind service method `PatchSetApplyRollback` uses (`panelService.update`, etc.), reusing 2.1's inverse builders; a genuine Phase-2 runtime failure (unforeseeable by Phase 1) aborts the remainder of the walk and reports every not-yet-reached edit `notAttempted`, without compensating edits already restored earlier in that same walk
- [x] 2.4 New `PatchSetUndoResponse`/`EditUndoOutcome` protocol types (mirrors `PatchSetApplyResponse`/`EditOutcome` shape)
- [x] 2.5 New `PatchSetUndoRoutes`: `POST /api/patch-sets/:id/undo`, wired into `ApiRoutes` beside the existing `PatchSetRoutes`

## 3. Frontend — Undo affordance (D6)

- [x] 3.1 New `undoPatchSet` thunk (`patchSetService.ts`/`patchSetsSlice.ts`): `POST /api/patch-sets/:id/undo`; mirror the new `applicationId: Option[String]` field onto the frontend `PatchSetApplyResponse` TS type (`frontend/src/features/patchSets/types/patchSet.ts`)
- [x] 3.2 `PatchSetReviewPage.handleAccept`: on a successful apply carrying `applicationId`, dispatch a `Toast` (existing component) with `duration: 0` (no auto-dismiss — the default 4000ms would vanish before the user can act, mid-navigation) and an "Undo" action bound to it, before navigating
- [x] 3.3 Clicking the toast's Undo action calls 3.1's thunk and shows a follow-up toast (success/conflict/error) — no new UI component

## 4. MCP — undo_patch_set tool (D6)

- [x] 4.1 `HelioApi.undoPatchSet` (calls `POST /api/patch-sets/:id/undo`)
- [x] 4.2 New `undo_patch_set` tool definition in `helio-mcp/src/tools/refinement.ts`, registered alongside `propose_patch_set`/`apply_patch_set`; update `helio-mcp/README.md`

## 5. Tests — Backend

- [x] 5.1 `PatchSetApplyServiceSpec` additions: a fully successful apply journals + returns `applicationId`; a partially-rolled-back apply journals nothing and returns no `applicationId`; retention prunes beyond 20 per owner; a panel update/create journals `rawResultingConfig` matching the raw (unmaterialized) post-update panel, not the materialized response
- [x] 5.2 `PatchSetUndoInverseSpec`: dedicated regression test that a config field cleared by the original edit is genuinely cleared by undo (not left at the post-apply value) — the exact omitted-Option-field class HEL-406's final gate fixed once already, now re-verified for undo's independent implementation
- [x] 5.3 `PatchSetUndoServiceSpec`: undo restores every touched resource to its pre-apply state for update edits (all six kinds) and for panel create/delete + pipelineStep delete edits (no `pipelineStep` create op exists in the model); a `dashboard`/`dataSource`/`dataType`/`pipeline` delete edit in the application refuses the WHOLE undo up front (structurally-unrecoverable Phase-1 blocker), restoring nothing else in that same application either; a conflicting update/create edit refuses the WHOLE undo with none of the application's edits restored; a Phase-2 runtime failure reports remaining edits `notAttempted` without un-restoring what Phase 2 already completed; RLS (can't undo another user's application, can't undo a pruned/nonexistent id); a raw override on a metric-bound panel's `dataTypeId`/`fieldMapping`/`aggregation`/`unit`, changed independently since apply with `metricId` unchanged, IS caught as a conflict (round-3 regression case); an unrelated metric deprecation/edit (no raw-field change) is NOT treated as a conflict
- [x] 5.4 `PatchSetUndoRoutesSpec`: request/response shape, 404/409 status mapping

## 6. Tests — Frontend + MCP

- [x] 6.1 `PatchSetReviewPage.test.tsx` additions: Undo toast appears with `applicationId` present, absent without it, clicking it calls the undo endpoint
- [x] 6.2 `refinementHandlers.test.ts` (MCP): `undo_patch_set` posts to the undo endpoint and returns its result verbatim, including the conflict case

## 7. Verification

- [x] 7.1 `sbt test` + `npm test` + `npm run lint`/`format:check` + `npm run check:schemas`/`check:openspec` all green
