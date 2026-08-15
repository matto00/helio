## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- All ticket acceptance criteria addressed: journal + Flyway V79 (owner-scoped RLS), `POST
  /api/patch-sets/:id/undo`, documented conflict behavior (refuse-with-409), bounded retention (20
  per owner, atomic prune), in-app + MCP surfaces, and `applicationId` is additive on the existing
  `/apply` response.
- No AC silently reinterpreted.
- All 22 `tasks.md` items are checked and match what's actually implemented (verified file-by-file
  against `files-modified.md`, not taken on faith).
- No scope creep — diff (`git diff e6c05228..HEAD`, isolating this ticket from the stacked epic
  branch) touches only journal/undo/route/protocol/schema/test files plus the two existing-file
  surfaces (`PatchSetApplyService.scala`, `PatchSetReviewPage.tsx`) design.md calls out.
- No regressions to existing behavior: `PatchSetApplyForward.applyOne` and
  `PatchSetApplyRollback.scala` have zero diff — confirmed `applyOne`'s signature and the
  `rollback(appliedSoFar, ...)` call site's 2-tuple shape are genuinely untouched (round-5's
  tuple-arity finding stayed fixed). `EditOutcome` is unchanged (still `jsonFormat5`, 5 fields) —
  `rawResultingConfig` never reaches the `/apply` wire response; only `applicationId` is new there.
- API contracts updated in the same change: `schemas/patch-set-apply-response.schema.json`
  (additive `applicationId`) and new `schemas/patch-set-undo-response.schema.json`, both green under
  `npm run check:schemas`.
- Planning artifacts (design.md D1–D6, specs/patch-set-undo/spec.md's 6 Requirements) match the
  final implemented behavior field-for-field — verified in detail below.

**Deep-dive on the three flagged hard-won design points, verified directly against code:**

1. **D2a raw-config-snapshot mechanism** (`PatchSetApplyService.scala`): `applyResolved`'s own
   `loop` now threads a third accumulator, `rawConfigs: Map[Int, JsValue]`, built via a new private
   `captureRawPanelConfig` that fires one `panelRepo.findByIdInternal(id)` only for
   `ResolvedAction.PanelUpdate`. `applied: Vector[(ResolvedEdit, EditOutcome)]` is untouched in
   shape; the failure branch's `PatchSetApplyRollback.rollback(appliedSoFar, user, services)` call
   is byte-identical to before. Confirmed via a clean diff against `e6c05228` that
   `PatchSetApplyRollback.scala`/`PatchSetApplyForward.scala`/`PatchSetApplyTypes.scala` have zero
   changes.

2. **D4a conflict-check field-exclusion precision** (`PatchSetUndoConflictCheck.checkPanel`): the
   executor's claim of "whole-raw-config comparison, only `metricDeprecated` stripped" being
   behaviorally equivalent to a four-field-specific comparison was independently traced, not taken
   at face value. Materialization only ever touches exactly five `MetricPanelConfig` fields
   (`dataTypeId`/`fieldMapping`/`aggregation`/`unit`/`metricDeprecated`, confirmed by reading
   `PanelServiceHelpers.withMaterializedMetric` — the only writer of these fields). `checkPanel`'s
   `live` side comes from `panelRepo.findByIdInternal` (raw, unmaterialized — confirmed
   `PanelResponse.fromDomain` is a bare `PanelConfigCodec.encodeConfig` call with no
   materialization step of its own) and its baseline is `rawResultingConfig` when captured (panel
   `update`) or the already-raw `resultingState.config` (panel `create`) — so both sides of the
   whole-config comparison are genuinely raw for every field, meaning no field OTHER than the five
   materialization touches could introduce a new false-positive source. This is a sound
   simplification, not a regression. `PatchSetUndoServiceSpec`'s 5.3h positive/negative pair
   (raw-field-changed-since-apply IS a conflict; metric-deprecated-with-no-raw-change is NOT)
   directly exercises this and passes.

3. **D4/D5 delete-edit Phase-1-blocker distinction**: `PatchSetUndoConflictCheck.checkOne` matches
   `("panel"|"pipelineStep", "delete")` as always-eligible and any other kind's `"delete"` (in
   `UnrecoverableDeleteKinds`) as an unconditional Phase-1 blocker; `PatchSetUndoService.undo`
   aborts with `409` before Phase 2 starts whenever `checkAll` returns any blocker — confirmed no
   partial-restore path exists for these kinds. `PatchSetUndoServiceSpec` 5.3d (pipeline delete
   blocks the whole undo, panel-update in the same application never restored) and 5.3b/5.3c (panel
   create/delete, pipelineStep delete genuinely restore/recreate) both pass.

4. **D4 Phase-2 unforeseeable-failure carve-out**: `PatchSetUndoService.restoreAll`'s `loop` sets
   `failedOnwards = true` on a genuine restore failure and marks every remaining edit
   `notAttempted` without touching what was already restored earlier in the same reverse walk.
   `PatchSetUndoServiceSpec` 5.3f live-reproduces this (deletes a delete-edit's target dashboard
   independently after apply, so Phase 1 can't catch it; Phase 2 genuinely fails on that edit) and
   asserts the exact honest mixed outcome (`restored`/`failed`/`notAttempted` at the right indices,
   with the already-restored higher-index edit confirmed NOT rolled back).

5. **D6 toast `duration: 0`**: `PatchSetReviewPage.tsx:93` sets `duration: 0` explicitly (not the
   shared `Toast` component's `DEFAULT_DURATION = 4000` from `shared/ui/Toast.tsx:18`); confirmed
   the component's own `if (duration === 0) return;` guard (`Toast.tsx:49`) disables the
   auto-dismiss timer entirely. `PatchSetReviewPage.test.tsx` asserts `toast.duration` is `0`.

The executor's own report also flagged two things — both verified:

- The missing-import fix in `PatchSetUndoConflictCheck.scala` is real: the file compiles cleanly
  (`sbt test` succeeded with zero compile warnings/errors) and `PatchSetUndoInverseSpec` gives
  dedicated regression coverage for the exact omitted-Option-config-field bug class this file's
  sibling (`PatchSetUndoInverse`) had to re-solve independently.
- The `git commit -n` bypass of `check:openspec` is exactly as described: re-running
  `npm run check:openspec` now shows only the expected "complete but not archived" hygiene note —
  nothing else was silently skipped alongside it.

### Phase 2: Code Review — PASS

Issues: none.

**Gates run fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` flag was passed for this cycle):**

- `npm run lint` — clean, zero warnings.
- `npm run format:check` — clean.
- `npm run check:schemas` — clean (49 protocol formatters checked).
- `npm run check:scala-quality` — clean (no inline-FQN violations; 100 pre-existing file-size soft
  warnings, informational-only per `CONTRIBUTING.md`, none introduced by files this ticket added —
  `PatchSetUndoService.scala` is the only new file flagged, at 280 lines vs. the 250-line soft
  budget, 30 lines over).
- `npm test` (root, covers `helio-mcp` + `frontend`) — 156 + 1605 tests, all passed.
- `npm --prefix frontend run build` — production build succeeds.
- `cd backend && sbt test` — 2728 tests, 172 suites, all passed, zero compile
  warnings/errors, migrated cleanly through V79.
- `npm run check:openspec` — only the expected, already-explained "not archived yet" hygiene note.

**Code-quality review (diff + targeted full-file reads):**

- **Imports/qualifiers**: no inline FQNs in any new file (`PatchSetUndoService.scala`,
  `PatchSetUndoInverse.scala`, `PatchSetUndoConflictCheck.scala`, `PatchSetUndoTypes.scala`,
  `PatchSetApplicationRepository.scala`) — confirmed both by `check:scala-quality` and by reading
  each file's import block.
- **ACL triad**: `PatchSetApplicationRepository.findById` uses owner-scoped RLS (`withUserContext`)
  plus an explicit `ownerId` filter (defense-in-depth), matching the `findByIdOwned` pattern;
  `PatchSetApplicationId` is a value-class ID parsed at the route boundary
  (`IdParsing.PatchSetApplicationIdSegment`), never a raw `String` reaching the service.
- **RLS**: V79 migration mirrors `V77`'s `FORCE ROW LEVEL SECURITY` + owner-scoped policy pattern
  exactly; `patch_set_applications` is registered in `RlsPolicyGuardSpec`'s allowlist.
- **DRY**: `PatchSetUndoInverse.optionalConfigFieldNames` is a deliberate, byte-for-byte-verified
  duplicate of `PatchSetApplyRollback.optionalConfigFieldNames` — per design.md D5 this is an
  intentional independent reimplementation (undo only has response JSON, not domain objects), with
  `PatchSetUndoInverseSpec` as the drift guard. Not flagged as unwanted duplication.
- **Type safety**: no untyped escape hatches (`asInstanceOf` only appears in test fixtures reading
  known step-subtype domain objects, matching existing test conventions elsewhere).
- **Error handling**: `PatchSetUndoService.safeRestoreOne` wraps each Phase-2 restore in a
  `NonFatal` recover, converting to an honest `failed` outcome rather than throwing; route-level
  404/409/500 mapping verified end-to-end by `PatchSetUndoRoutesSpec`.
- **Tests meaningful**: `PatchSetUndoServiceSpec`'s 5.3a–5.3h and `PatchSetApplyServiceSpec`'s new
  5.1a–5.1d cases each assert on genuine persisted DB state (not just response shape), and would
  catch a real regression in any of the five hard-won design points above.
- **No dead code**: no leftover TODO/FIXME in new files; no unused imports.
- **No over-engineering**: `PatchSetUndoContext` mirrors the existing `PatchSetApplyContext`
  precedent rather than inventing a new DI shape.
- **Behavior-preserving where expected**: the apply-path change (`PatchSetApplyService.scala`) is
  additive-only — `EditOutcome`/`applyOne`/`rollback` are unchanged; the new `applicationId` field
  has a `= None` default on `PatchSetApplyResponse`, so no other constructor call site anywhere in
  the codebase needed updating (confirmed by `sbt test` compiling clean across all existing
  `PatchSetApplyResponse(...)` call sites in tests).

### Phase 3: UI Review — FAIL

Dev servers started cleanly via `scripts/concertino/start-servers.sh` /
`scripts/concertino/assert-phase.sh` (`PASS servers`). Exercised the real `/patch-sets/review` →
Accept → Undo flow against the live dev backend (port 8752) multiple times.

**Working correctly:**
- Happy path end-to-end: Accept & apply → "Applied." toast with an "Undo" action appears; clicking
  it calls `POST /api/patch-sets/:id/undo`, shows a "Undone." follow-up toast, and the backend
  genuinely reverts the resource (confirmed via a full page reload after the very first
  accept/undo cycle: panel title correctly reverted from "... (previewed)" back to its pre-apply
  value).
- `Toast`'s `duration: 0` genuinely prevents auto-dismiss (toast remained visible well past 4s).
- Interactive elements have accessible names ("Undo", "Dismiss notification") and are reachable via
  the existing `Toast` component's established keyboard/ARIA pattern (unmodified by this ticket).
- Breakpoints 1440 / 1100 / 768 / 375 all render the toast without layout breakage or clipping.
- An initial live attempt to reproduce the conflict (409) path via the panel-rename UI was
  invalidated by an unrelated, pre-existing dev-session CSRF hiccup (`PATCH /api/panels/:id` →
  `403 Missing required CSRF header`, reproduced identically via a raw `fetch()` and via the
  in-app rename UI) — not a defect in this ticket's code, and not counted against it. The
  conflict-refusal behavior itself is already exhaustively and correctly covered by
  `PatchSetUndoServiceSpec`/`PatchSetUndoRoutesSpec` (Phase 2), so this was not re-attempted.

**Issues found (both objective/mechanical, live-reproduced, not stylistic judgment calls):**

1. **Repeated Redux "non-serializable value" console errors on the primary happy path.**
   `frontend/src/features/patchSets/ui/PatchSetReviewPage.tsx:94-108` dispatches a `Toast` whose
   `action.onClick` is a live closure, stored directly in Redux state via
   `pushToast`/`toastsSlice.ts`. `PatchSetReviewPage` is the FIRST real call site in the entire
   frontend to ever populate `ToastAction`'s `onClick` (confirmed by grepping every `action: {`
   call site across `frontend/src`) — the field has existed, unused, since `HEL-236`. Because
   `store.ts` uses `getDefaultMiddleware()` with no `serializableCheck`/`ignoredPaths` exception,
   every single subsequent Redux action dispatched while the toast is present re-triggers RTK's
   `serializableStateInvariantMiddleware`, logging a `console.error`. Live-reproduced: a single
   Accept click produced 12 console errors immediately (one for the dispatch, 11 more for every
   later action while the toast persisted) — and because `duration: 0` means the toast never
   auto-dismisses, this keeps firing for the rest of the session until the user explicitly
   dismisses it. This violates Phase 3's "No console errors during any tested flow" checklist item
   on the ticket's own core flow, not an edge case.

2. **`undoPatchSet`'s success path leaves the SPA showing stale panel/dashboard data.**
   Live-reproduced cleanly (no CSRF interference): Accept → toast → click Undo → "Undone." toast
   appears, but the panel grid keeps showing the pre-undo ("... (previewed)") title; only a full
   page reload reveals the backend's genuine revert. `undoPatchSet`'s own docstring in
   `frontend/src/features/patchSets/state/patchSetsSlice.ts:203-207` claims "no cache invalidation
   of its own here; the caller (`PatchSetReviewPage`'s toast action) navigates/reloads as needed
   once this resolves" — but `PatchSetReviewPage.tsx:96-108`'s Undo `onClick` neither navigates nor
   reloads; it only dispatches the thunk and pushes a follow-up toast. This is the identical
   stale-cache bug class the sibling `applyPatchSet` thunk in the SAME file already had to fix
   (`invalidateAffectedState`, `patchSetsSlice.ts:65-179`, citing a live-reproduced skeptic finding
   from this epic's own prior review — "the backend write succeeds, but the SPA doesn't reflect it
   without a manual reload") — it was not carried forward to the new, independent `undoPatchSet`
   path. `PatchSetUndoResponse.edits[].resultingState` carries the identical response-shaped JSON
   (including `dashboardId` for a restored panel edit) that `invalidateAffectedState` already reads
   off `EditOutcome.resultingState` for the apply path, so the fix is a direct, low-risk mirror of
   the existing, already-approved pattern — not a new design.

### Overall: FAIL

### Change Requests

1. Stop storing a live closure in Redux `toasts` state for the Undo action
   (`frontend/src/features/patchSets/ui/PatchSetReviewPage.tsx:94-108`,
   `frontend/src/features/toasts/state/toastsSlice.ts`'s `ToastAction.onClick`). Either (a)
   configure `serializableCheck: { ignoredPaths: ["toasts"], ignoredActionPaths: ["payload.action.onClick"] }`
   in `frontend/src/store/store.ts`'s `getDefaultMiddleware()` call (the RTK-documented pattern for
   a deliberate, intentional non-serializable value — https://redux-toolkit.js.org/usage/usage-guide#working-with-non-serializable-data),
   or (b) restructure so the toast stores a serializable action key/payload instead of a raw
   function, resolved to a handler outside Redux state. Verify with a fresh Accept → Undo cycle
   that zero `console.error` entries appear.
2. Mirror `applyPatchSet`'s `invalidateAffectedState` cache-invalidation pattern for
   `undoPatchSet` (`frontend/src/features/patchSets/state/patchSetsSlice.ts:203-221`) — either call
   the same helper (generalized to accept `PatchSetUndoResponse`'s `EditUndoOutcome[]`, reading
   `resultingState` the same way) from the `undoPatchSet` thunk itself, or invoke it from
   `PatchSetReviewPage.tsx`'s Undo `onClick` after `.unwrap()` resolves. Also correct the thunk's
   docstring (`patchSetsSlice.ts:203-207`), which currently makes a false claim about the caller
   handling this. Verify with a fresh Accept → Undo cycle that the panel grid reflects the reverted
   title without a manual reload.

### Non-blocking Suggestions

- `backend/src/main/scala/com/helio/services/PatchSetUndoService.scala` is 280 lines, 30 over the
  250-line soft budget (`check:scala-quality`, informational only) — consider splitting the
  per-kind `restoreX` methods into a sibling object (mirrors how `PatchSetUndoInverse`/
  `PatchSetUndoConflictCheck` were already split out) if this file grows further.
