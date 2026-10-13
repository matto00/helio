## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: HEAD 67cf9e0e0451b781be463e82db25c57a8c8795bf (= origin/main after `git fetch`). The change dir is untracked planning artifacts only.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/layout-save-unloaded-panel-items/HEL-1527`.

#### Prior change requests

- **R2-CR1 (ghosts): addressed.** D2 now sends `resolved + kept` as is, with no client-side unsendable path. The server premise holds on the live code:
  - `DashboardService.update` → `DashboardWrites.applyUpdate` (L42-55) → `LayoutPolicy.resolveOnLive(read.layout, fields.layoutPatch, panelIds, Validate)` (LayoutPolicy.scala L91-106).
  - That call runs `onlyPanels(patch, panelIds)` BEFORE `apply` → `violations`. `panelIds` comes from `dashboardRepo.panelIdsInternal(dashboardId)`, so ghost items (deleted panels, other boards' ids) are dropped before any overlap or bounds check.
  - The route-level test already pins this: `DashboardLayoutGhostWriteSpec.scala` L63, "accept a write that places a live panel over the ghost's cells instead of rejecting the overlap", plus L69 for the live-overlap 400.
  - The false "only way invalid" sentence and the "Still-invalid substitution is not sent" scenario are gone. Task 4.2 adds the delete-then-fill test.
- **R2-CR2 (400 only): addressed.** D3 requires an HTTP 400 for the conflict copy. Task 4.4 covers 500 + ghost → generic copy. The spec scenario "Rejection caused by an unloaded panel" now says `400`.
- **R2-CR3 (seam): moot.** No unsendable path survives, and the `persistLayout` seam is removed.
- **R1-CR1/CR2 (partial patch / silent omission): moot.** Nothing is omitted any more: every changed bp is sent (`buildLayoutPatch` keeps its `continue`-only-when-equal shape).
- **R1-CR3 (stale/failed predicates): still covered.** D3 lists the stale, failed, other-dashboard and re-sync-failed states; task 4.4 lists each.

#### The revision, traced against live code

- **Pending / baseline / undo:** unchanged from today. `persistLayout` (useLayoutSave.ts L242-305) and `.then` are untouched by D1/D2. On success, the reducer adopts the response when store == `sentLayout`. Ghosts come back stripped, the same as today's resolved-only send.
- **I1: holds.** No version ref or `baseVersion` handling changes. The baseline and version still pair from one response (L291-292).
- **Delete-then-fill:**
  - After a delete, `deletePanel.fulfilled` filters only `panels.items` (panelsSlice.ts L227). The ghost stays in the authored layout.
  - `DesktopPanelGrid.tsx` L345 keeps it in `next[bp]`, and the drag makes that bp invalid.
  - The substitution is `resolved` (valid; `liveEntries` drops the ghost, dashboardLayout.ts L108-118) plus the ghost.
  - The server drops the ghost and validates `resolved`, so the save is accepted. Task 4.2 pins the client half (PATCH sent).
- **D3 mechanics are implementable:**
  - `dashboardsSlice.ts` already types `RootState` (L25, L86).
  - `fetchPanels.pending` keeps `items` and sets `loadedDashboardId` (panelsSlice.ts L184-188), so the refetch-gap predicate works.
  - `showServerLayout` (L196-205) swallows fetch errors. The executor must surface success/failure from it so the "re-sync failed → generic" rule is decidable. D3 already requires this state and a test for it.
- **Scope:** AC1 is covered by tasks 2.1/4.1 and AC2 by 3.1/4.3/4.4. No new copy. No backend, schema or migration change.

#### Defect: the spec delta's normative sentence contradicts its own scenarios

The modified requirement still opens with the unnarrowed base sentence (base spec `openspec/specs/dashboard-layout-validation/spec.md` L62, carried over verbatim): "The web client SHALL NOT send a layout breakpoint that differs from the last server-acknowledged layout and is invalid; it SHALL send the breakpoint as displayed … instead."

Under D2 the client now knowingly sends an invalid changed breakpoint in two cases the delta itself specifies:

- **"Filling a deleted panel's slot still saves":** the sent bp is `resolved + ghost`, and the ghost overlaps the moved panel.
- **"Overlap with a live unloaded panel is rejected visibly":** the sent bp overlaps a live panel, and the server 400s it.

design.md D2 states the narrowed guarantee ("never sends a changed breakpoint that is invalid AMONG THE PANELS IT HAS LOADED, and never drops an item it cannot see"). That narrowing never reached the spec. The archived contract would therefore assert a guarantee the implementation deliberately breaks, which is exactly the "narrowed guarantee is honest" question this round was asked to check.

There is also a precedence gap between two scenarios:

- "Overlap with a live unloaded panel is rejected visibly" has THEN = conflict copy.
- "Rejection with no proof of an unloaded panel" covers a failed re-sync, with THEN = generic copy.

Both apply when the re-sync fails, and they give contradictory THENs.

### Verdict: REFUTE

### Change Requests

1. **Spec delta (`specs/dashboard-layout-validation/spec.md`), requirement paragraph sentence 1:** narrow the guarantee to match D2. For example: "The web client SHALL NOT send a layout breakpoint that differs from the last server-acknowledged layout and is invalid among the panels this tab has loaded; it SHALL send the breakpoint as displayed … instead." Optionally add "items of panels this tab has not loaded are sent unchanged and adjudicated by the server" to the existing second sentence. Leave the requirement title alone (the server still never persists an invalid breakpoint), or adjust it consistently.
2. **Same file, scenario "Overlap with a live unloaded panel is rejected visibly":** make its THEN conditional on the conditions D3 actually requires. For example, add to the WHEN: "and the re-sync succeeds and this tab's panel list is loaded for the dashboard". Alternatively, reword its THEN to "the user sees human-readable copy with no raw ids". Either way it must no longer contradict "Rejection with no proof of an unloaded panel" when the re-sync fails.

Both are wording-only fixes to the spec delta. design.md, proposal.md and tasks.md need no change for them.

### Non-blocking notes

- design.md D3, first sentence: the parenthetical string is spliced mid-clause ("…HTTP `400` (…) and ("This dashboard's…") when…"). Tidy it so the predicate reads cleanly.
- Kept items are filtered only by "not in `resolved`". An authored item with a blank `panelId` would be kept and trip the server's pre-filter `"layout panelId is required"` 400 (DashboardServiceValidation.scala L171). Two authored entries for the same unloaded id would also both be kept. Neither is reachable from stored data today (the server rejects blank ids on write; `liveEntries` already defends against both). Mirroring `liveEntries`' blank/duplicate guard in the kept filter is cheap.
- Carried from round 1: read `getState()` for the D3 predicate immediately after the re-sync dispatch, and note in a comment that a completed `fetchPanels` would turn the copy generic (benign).
- Task 4.2 can only assert that the PATCH is sent with the ghost. Acceptance is server-side and already pinned by `DashboardLayoutGhostWriteSpec` L63. The task's "and accepted" should cite that spec rather than imply jest proves it.
