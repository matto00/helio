## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD 67cf9e0e0451b781be463e82db25c57a8c8795bf. The change dir is untracked planning artifacts only.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/layout-save-unloaded-panel-items/HEL-1527`.

#### Round-1 change requests

- **CR1: addressed in substance.** D2 now takes option (a): if any changed breakpoint's combination is still invalid, nothing is sent. No partial patch exists, so the reducer can no longer adopt the response over an omitted edit (`dashboardsSlice.ts` L422-436). The "multi-breakpoint edit not half-saved" test is in task 4.2.
- **CR2: addressed in substance.** The unsendable save toasts and re-syncs. A class-4 re-baseline calls `refetchPanelsIfLayoutNamesUnknown` (`useLayoutSave.ts` L224-226). This is terminal when the re-sync succeeds.
- **CR3: addressed.** D3 requires `loadedDashboardId === dashboardId`. It uses the generic copy for the stale, failed, other-dashboard and re-sync-failed states, and task 4.4 lists slice tests for each.
- **CR4: addressed.** The "Substitution keeps…" WHEN now includes "…is valid". "Still-invalid…" now says "sends no layout save".

#### The revision, traced against live code

- **I1: holds.** An unsendable save sends nothing and touches no version ref. A successful re-sync goes through `dashboardUpserted(fresh)`. That is a class-4 re-baseline, which takes the store's layout and `layoutVersion` together (`useLayoutSave.ts` L224-225).
- **Undo history:** the undo/redo stacks survive the re-sync, the same as after today's server 400. This is not a new defect.

#### NEW DEFECT: ghost items make D2 refuse saves the server would accept

1. **Deleting a panel leaves its item in the stored layout.**
   - Server: `PanelService.delete` calls `deleteRow`, which calls `PanelRepository.delete` (L230-231). That deletes the panel row only.
   - Nothing strips the item from `dashboards.layout`. Ghosts are dropped only on the next layout or appearance write (`DashboardWrites.applyUpdate` L52-60, `LayoutPolicy.onlyPanels`).
2. **The client store keeps it too.**
   - `deletePanel.fulfilled` only filters `panels.items` (`panelsSlice.ts` L227-238).
   - No reducer in `features/dashboards` handles `deletePanel` (grep: zero hits).
   - So after a delete in this tab, the authored layout and the baseline still hold the deleted panel's item. It is "not loaded" because it is absent from `panels`.
3. **What happens when the user then drags another panel into the gap:**
   - `DesktopPanelGrid` builds `next[bp] = [...items, ...kept]`, and `kept` includes the ghost (`DesktopPanelGrid.tsx` L342-346). `next[bp]` overlaps, so it is invalid.
   - Today, `buildLayoutPatch` substitutes `resolved[bp]`. `liveEntries` drops the ghost (`dashboardLayout.ts` L108-118), the save is valid, and the server accepts it.
   - Under D1+D2, `resolved + kept` re-adds the ghost, which overlaps the dragged panel. The save is unsendable. The user gets "This dashboard's layout was changed elsewhere; your last layout change was not saved." and the edit is reverted.
   - The re-sync GET returns the same stored ghost, so **every later drag into that slot fails the same way**. This lasts until some other write strips ghosts.
4. **Two claims in the plan are false because of this:**
   - The server would have accepted this PATCH. It filters ghosts from the patch before validating (`resolveOnLive` → `onlyPanels(patch)`, and the existing spec scenario "A PATCH carrying a deleted panel's item stores no ghost").
   - D2's claim "the only way `resolved + kept` is invalid is an item of a panel this tab has not loaded… changed-elsewhere copy is accurate" is false. A panel deleted in this same tab produces it.

Deleting a panel and filling its gap is a common flow. The bug fix turns it into a false conflict and lost edits.

#### Mechanism ambiguity: D2 reuse of the thunk's re-sync

- `showServerLayout` is a closure inside the `updateDashboardLayout` payload creator (`dashboardsSlice.ts` L196-205), not an exported function.
- The toast fires only from `updateDashboardLayout.rejected` (`toastListeners.ts` L170).
- `persistLayout` cannot reach either without a new seam. Two readings, with different behaviour:
  - (i) Dispatch `updateDashboardLayout` with an "unsendable" arg, so the thunk skips the request, re-syncs and rejects. The toast and the `.finally` in-flight clearing come for free.
  - (ii) Use a separate re-sync helper or thunk. The toast does not fire unless a listener is added.
- Task 2.3 states the outcome but not the seam. This is minor next to the ghost defect, but it should be pinned.

#### D3: conflict copy on any non-409 status

- D3 applies to every non-conflict failure: 400, 403, 404, 500, network.
- The re-synced layout routinely holds ghost ids after a delete (above). So a 500 or 403 after any delete would toast "changed elsewhere" when nothing changed elsewhere.
- For a 400, the server has already filtered ghosts, so an overlap there really does involve a live panel this tab has not loaded. The copy is accurate only in that case.

#### Other checks

- **Re-sync failure:** if the re-sync fetch fails, nothing re-baselines and pending stays true. Each 30 s auto-save tick then recomputes the same unsendable save and toasts again. The design's "terminal (no retry loop)" does not hold in that state. A server 400 with a failed re-sync behaves similarly today, so this is noted below, not a CR.

### Verdict: REFUTE

### Change Requests

1. **D2 / D1 must not treat ghost items as another writer's panel.**
   - The client cannot tell a ghost (deleted panel) from a panel created elsewhere. The server can, and it filters ghosts before validating.
   - Choose and state one of these in design.md:
     - (a) Send `resolved + kept` even when the combination looks invalid client-side. The server either accepts it (ghost) or answers 400 (a live unloaded panel), and the existing rejection path with D3 copy handles the 400. This also removes the need for a client-side unsendable path.
     - (b) Keep a client-side guard, but make it unable to fire on a ghost. For example, refetch the panel list and re-evaluate before declaring the save unsendable.
     - Or another option that provably does not regress delete-then-fill.
   - Add a hook- or grid-level test: delete panel P in this tab (panels list without P, store layout still holding P's item), drag panel Q onto P's former slot, flush. Assert the PATCH is sent (or the edit is saved) and no conflict toast appears. The test must fail against the round-2 design.
   - Remove or correct D2's sentence "the only way `resolved + kept` is invalid is an item of a panel this tab has not loaded", and fix the matching spec scenario "Still-invalid substitution is not sent".
2. **D3: restrict the conflict copy to a 400 response.** Every other non-409 failure (403/404/5xx/network) gets the generic "Failed to save dashboard layout." even when the re-synced layout holds unknown ids, because those are routinely ghosts. Add a slice test: 500 plus a ghost id in the re-synced layout gives the generic copy. Update the spec scenario "Rejection caused by an unloaded panel" so its WHEN says `400`.
3. **If any client-side unsendable path survives CR1, name the seam in task 2.3.** Either a thunk arg, so `updateDashboardLayout.rejected` drives the existing toast, or an explicit new listener or dispatch. Also say what happens when the re-sync fetch fails: pending stays true, and the 30 s tick would re-toast.

### Non-blocking notes

- The round-1 note about reading `getState()` before any await still applies to D3's predicate.
- `proposal.md` still says "the client does not send that breakpoint". It should match the design once CR1 is settled.
