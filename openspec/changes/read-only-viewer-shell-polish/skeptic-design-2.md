## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: main d8cdfb460f65d130af533770aeadc798dbe30daf (change dir untracked, planning only).
Artifacts read: ticket.md (Owner rulings binding), proposal.md, design.md, tasks.md, specs/dashboard-grantee-access/spec.md, skeptic-design-1.md.

### Round-1 change requests: resolution

- **CR1 (D1 "View only" recipe): RESOLVED.** D1 now pins (a) type: inherited `--font-mono` / `--text-xs` / `--app-text-muted`, sentence case, no tracking or uppercase. Verified these are the actual values of `.dashboard-meta-row__left` (`DashboardMetaRow.css:4-9`) and `.dashboard-refresh-line` (`DashboardMetaRow.css:92-103`), so no new token is introduced. (b) Explicitly no background, border or radius. (c) `Eye` at `ICON_SIZE.sm` on both surfaces, `aria-hidden`. `ICON_SIZE.sm === 14` is confirmed (`shared/ui/iconSize.ts:4`), and the slot is `calc(var(--text-xs) * 1.6)`. (d) "View only" must not sit inside an `aria-hidden` element. The `aria-hidden` moves to an inner empty placeholder. On main, the reserved state puts `aria-hidden` on the `.dashboard-refresh-line__text` span itself (`DashboardRefreshLine.tsx:91`), so the instruction is accurate and necessary.
- **CR2 (seeded undo/redo test): RESOLVED.** D2 and D8 require a `pushLayoutSnapshot` seed for the viewer's dashboard id, assertions on `defaultPrevented === false` and an unchanged layout, an editor companion with the same seed that asserts undo applies, and the "revert the `when` guard" mutation turning both red. D2 names the case being guarded: an editor downgraded mid-session who keeps history. `pushLayoutSnapshot({dashboardId, layout})` exists with that signature (`layoutHistoryThunks.test.ts:63`).
- **CR3 (inverted / kept tests): RESOLVED.** D8 names `dashboardsSlice.accessRole.test.ts:46` and says it is rewritten to cite owner ruling 1. The test at that line on main is the "selects nothing when every listed dashboard is shared" case, as stated. `PanelList.test.tsx:313` stays unchanged as the owner control. Task 1.1 repeats both.
- Round-1 non-blocking notes were folded in: the D4 audit now lists "Not run yet" and the insight refresh, D6 has the `onStepByStep` / `!stepByStep` wiring and the "do not fix reload" note, and the C16 floor list is extended.

### New checks on the revised artifacts

- **First-child placement: sound.** `DashboardMetaFacts` (`DashboardMetaFacts.tsx:46`) renders `.dashboard-meta-row__facts` with the count first. The CSS clips last-first (`flex-wrap` plus a one-line `height: 1.5em; overflow: hidden`). A "View only" first child survives `countOnly`.
- **The meta row already mounts facts for non-owners** (`DashboardMetaRow.tsx:95-97,167`, shared meta via HEL-1786). The indicator therefore has a host on viewer dashboards. `selectDashboardAccessRole` exists (`dashboardAccess.ts:25`).
- **Slice:** `getMostRecentDashboardId` (`dashboardsSlice.ts:60-62`) is the single helper used by `fetchDashboards.fulfilled` (l.483), `dashboardRemoved` (l.458) and the delete case. D6's one-function change covers all three, as claimed. `setSelectedDashboardId` accepts `string | null` (l.397), so the "Build your own" path is implementable without new reducers. `fetchDashboards.fulfilled` re-auto-selects when the selection is null, which confirms the D6 refetch risk is real and correctly scoped as a probe.
- **`usePickerSelection` is also consumed by `App.tsx:130` and `CommandBar.tsx:104`.** Those read only `heading` / `activeItemName`. A new optional field rendered only by `MobileNavSheet` does not affect them.
- **Spec delta:** the MODIFIED landing requirement keeps the original scenario and adds the shared-only one. Each ADDED requirement maps to an AC, and every AC has a task. Owner rulings 1 and 2 are both encoded, and none is relitigated. No placeholders or TBDs were found.

### Verdict: CONFIRM

### Non-blocking notes

- design.md Risks, bullet 1, says "the role does not change mid-view". D2's guarded case is a mid-session downgrade. Both can hold, because a downgrade arrives through a list refetch, which is rare: only on mount, or on a failed list when the palette opens. The executor should still make sure the phone line tolerates a role flip by rendering from the role, not by latching it. Optionally reword the Risks bullet.
- For a viewer on a non-pipeline-fed dashboard, the always-present phone line will also render `RefreshButton` whenever `usePullRefreshControl().available` is true (`DashboardRefreshLine.tsx:27-29`). The button is fixed-width and `flex: none`, so there is no height change. The evaluator should confirm it is either absent or functional there, and that it does not appear late in a way that shifts the text.
- Consider adding "View only" to `DashboardMetaFacts`'s `title={fullText}`, so the hover text stays complete.
- The "beside the create action" placement of the sheet row is loose. The create action is the sheet HEADER action (`MobileNavSheet.tsx:129`). A list-footer row would match the sidebar footer row better. This is the executor's call, to be judged at the final gate in both themes.
