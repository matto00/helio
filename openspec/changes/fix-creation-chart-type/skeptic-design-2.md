## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

**Round-1 item 1 (false "reuses existing validated PATCH path" claim) — now corrected.**
Design.md D1 now states plainly: "today `validateChartType`'s only caller is
`DashboardProposalService` ... neither the PATCH path (`PanelServiceHelpers.resolvePatch` →
`PanelPatchApplier`) nor any DB constraint validates `chartType`. This change **newly wires
chartType validation into ordinary panel CRUD**." I re-read the actual code to confirm this is
now accurate, not just reworded:
- `backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala:21-46` (`resolvePatch`) —
  line 38, `chart = p.chart` — confirms no validation call, matches the revised claim exactly.
- `backend/src/main/scala/com/helio/services/DashboardProposalService.scala:80` — confirmed the
  only current caller of `validateChartType`.
- The "Risks / Trade-offs" section now correctly separates "reuses the wire shape/codec" (true —
  `PanelAppearancePayload`/`JsonProtocols` are genuinely reused) from "chartType validation is new
  to panel CRUD" (now stated explicitly). This revision is accurate and resolves round-1 CR1.

**Round-1 item 2 (undecided create/PATCH asymmetry) — a decision was made (D5), but it targets
the wrong code path and the resulting claim of completeness is false.**

Design.md D5 / tasks.md 1.3 / the new `panel-appearance-settings` spec delta all state the fix is
"add `RequestValidation.validateChartType` to the appearance branch of
`PanelServiceHelpers.resolvePatch`" and the spec requirement claims validation applies "on both
panel appearance write paths: `POST /api/panels` ... and `PATCH /api/panels/:id`." I traced where
chart-type edits actually flow at runtime in this codebase and found a **third, live, currently-used
appearance-write path that bypasses `resolvePatch` entirely and would remain completely
unvalidated after this change** — and, critically, it is the path the real edit-time UI uses, not
the one D5 patches:

1. `frontend/src/features/panels/ui/PanelDetailModal.tsx:210-225` — the panel-edit modal's submit
   handler builds `appearancePayload` (including `chart: chartAppearance` for chart panels, i.e.
   the chart-type selector value) and dispatches it via `accumulatePanelUpdate({ panelId, fields:
   { appearance: appearancePayload, ... } })` — **not** via the single-item `updatePanelAppearance`
   thunk.
2. `frontend/src/features/panels/hooks/usePanelUpdatesFlush.ts:81-92` (`flushPanelUpdates`) —
   confirms every accumulated pending update, on the 30s auto-save tick, dashboard-switch, or
   "Save now," is flushed via `dispatch(updatePanelsBatch(buildBatchRequest(pending)))` —
   i.e. the **batch** endpoint, not `PATCH /api/panels/:id`.
3. `frontend/src/features/panels/state/panelsSlice.ts:254-270` (`buildBatchRequest`) — confirms
   `appearance` (title/appearance/type only, per its own comment) is carried straight through into
   each `PanelBatchItem`.
4. `backend/src/main/scala/com/helio/api/routes/PanelRoutes.scala:30-36` — the batch route calls
   `panelService.batchUpdate(request.panels, user)`.
5. `backend/src/main/scala/com/helio/services/PanelService.scala:176-214` (`batchUpdate`) — calls
   `panelRepo.batchUpdate(items, now)` directly. It does **not** call `resolvePatch` or any
   `PanelServiceHelpers` function — `validateBatchTypeMatch` (the only per-item validation it does
   run, `PanelServiceHelpers.scala:58-69`) checks only the panel-type-lock invariant, never
   `chartType`.
6. `backend/src/main/scala/com/helio/infrastructure/PanelMutationRepository.scala:84-93`
   (`batchUpdate`'s `buildItemAction`) — persists `chart = ap.chart.orElse(current.chart)` straight
   to the DB with **zero** call to `validateChartType` (or any validation at all).
7. I confirmed the single-item PATCH-appearance path that D5 actually patches
   (`updatePanelAppearance` in `frontend/src/features/panels/services/panelService.ts:76`, the only
   place that would hit `resolvePatch`'s appearance branch) has **no UI caller** —
   `grep -rn "updatePanelAppearance(" frontend/src --include=*.tsx` returns nothing outside the
   thunk/service files themselves. The batch path (confirmed live and comment-documented as of the
   most recent merged commit, `d39a5ebd` "HEL-304 Flush panel edits width-independently") is the
   one and only path real users hit today when they change a chart's type in the edit UI.

**Consequence:** D5's fix is real (a for-comprehension in `resolvePatch` returning
`Either[String, ResolvedPanelPatch]` can absolutely accept a `validateChartType` check — mechanically
sound), but it protects a dead-from-the-UI path while leaving the actual operative appearance-write
path (`PanelMutationRepository.batchUpdate`, reachable via `POST /api/panels/batch`, invoked by
every panel edit through `PanelDetailModal`) fully permissive. After this change ships exactly as
designed, a user editing an existing chart panel's type through the normal edit UI would still be
able to persist an arbitrary/invalid `chartType` string with no rejection — the asymmetry the
ticket's own repro-widening spirit and D5's stated rationale ("shipping the asymmetry invites
divergent client behavior") set out to close is **not actually closed for the path that matters**.
The `panel-appearance-settings` spec delta's claim "on both panel appearance write paths" is
therefore inaccurate — there are (at least) three appearance-write paths, and the delta both omits
the third and, by implication, would ship an inaccurate requirement statement into the spec of
record.

### Verdict: REFUTE

### Change Requests

1. **D5 / task 1.3 / the `panel-appearance-settings` spec delta must cover the batch-update
   appearance-write path, not only `PanelServiceHelpers.resolvePatch`.** The batch path
   (`PanelService.batchUpdate` → `PanelMutationRepository.batchUpdate`,
   `backend/src/main/scala/com/helio/infrastructure/PanelMutationRepository.scala:84-93`) is the
   one the live edit UI (`PanelDetailModal.tsx` → `usePanelUpdatesFlush.ts` →
   `updatePanelsBatch`) actually exercises for chart-type edits today; the single-item
   `resolvePatch` path that D5 currently targets has no UI caller. Either:
   - (a) extend D5 to add the equivalent `validateChartType` check to
     `PanelMutationRepository.buildItemAction`'s appearance-merge branch (or a validation step in
     `PanelService.batchUpdate` before calling the repository), with a corresponding task and a
     ScalaTest scenario (batch update with invalid `chart.chartType` → rejected, no partial
     write — note the current implementation is a single `transactionally` DBIO sequence, so
     validation should happen before the DBIO action runs, not inside it, to fail cleanly with a
     400 rather than a DB-transaction exception); or
   - (b) explicitly narrow the D5/spec claim to state precisely which paths are and are not
     covered (name the batch endpoint as a known, explicitly out-of-scope gap, optionally with a
     spinoff-ticket note) — mirroring how the `collection` schema-enum gap is already handled in
     Non-Goals. **Silently leaving the spec's "on both panel appearance write paths" as-is fails
     the design gate: it's a factually inaccurate completeness claim given the batch endpoint
     exists, is live, and is the path real edits use.**
   Given D5's own stated rationale (closing exactly this kind of asymmetry to avoid divergent
   client behavior), option (a) is more consistent with the change's own logic, but either is
   acceptable as long as it is an explicit, recorded decision rather than an unexamined gap.

### Non-blocking notes

- D1's revised narrative, the Risks section split (wire-shape reuse vs. new validation), and the
  create/single-PATCH parity decision (D5's actual code content, independent of path-selection) are
  all now accurate and well-evidenced — round-1 CR1 is resolved cleanly.
- No existing backend test asserts the batch endpoint currently accepts an invalid chartType
  (`grep -rn "chartType" backend/src/test/` — no batch-path hits), so tightening it (per CR1 above)
  would not need to un-teach any existing accepted behavior, consistent with D5's own "no
  stored-data migration needed" note for the single-PATCH tightening.
