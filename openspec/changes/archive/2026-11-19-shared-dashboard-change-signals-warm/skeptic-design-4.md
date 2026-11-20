## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed tree: `febb2013bd8b41704084192749535c3c4249576f` (the change dir is untracked). I judged the artifacts on their
own merits and checked every code claim against the file it names.

### What I verified (with evidence)

**D1 (backend).** `DashboardChangesRepository.scala:42` still runs `contentQuery(ids).zip(dataQuery(ids))` in one
`withUserContext`. `dataQuery` inner-joins `outputs` (`:34`), so a grantee's data side is empty under RLS. The planned
split (content query under user context, then a data query under system context over step 1's ids only, with
`p.kind = 'output'`) is sound. m1 and m2 hit distinct faults. Round 3 found nothing wrong here, and the tree has not
changed since.

**D3b: the marker rule, path by path.** `isReusable` (`panelRowsReuse.ts:52-59`) has two call sites:
- `usePanelSortFilter.ts:303`, in `PanelCardBody`, the child.
- `usePanelData.ts:308`, in `PanelCard:116` and `MobilePanelStack:74`, the parent.

Child effects run first. When a sort or filter is active, `usePanelSortFilter` sets `mountOwnership`, and
`usePanelData` then defers (`usePanelData.ts:292-296`). So one `isReusable` call decides each mount. StrictMode is on
(`main.tsx:113`). Its second effect pass returns early through `prevFetchKey` and `appliedPersistedDefaultRef`, so
consuming the marker on mount does not break the warm reuse. Here is each remount path:
- **Memory restore (DA → DB → DA).** `showDashboardPanels` runs `restoreFromMemory`. It sets markers and seeds for the
  kept windows, then `panelsRestored`. All cards mount (no virtualization in `PanelGrid` or `MobilePanelStack`) and
  reuse the window. The seed then catches any advance the change signals had not reported yet: D4(a) on the first
  snapshot, and D4(b) if that snapshot lands before the listener subscribes. This is correct.
- **Lazy stored restore and hydrate restore.** `applyWarmEntry` hydrates only the fresh windows and calls `retainTab`
  (`warmRestore.ts`). `restoreFromMemory` follows (`showDashboardPanels.ts:110`). The hydrate path reaches
  `restoreFromMemory` through the memory branch once the target is selected. This is correct.
- **A restore while not on the dashboard view.** `App.tsx:173-179` runs `showDashboardPanels` on a selection change on
  any route. In that case markers and seeds wait, because no `panel-status` consumer exists off the dashboard view
  (`dashboardChrome.ts:17`, plus the card hooks). After more than 30 s, `isRetained` fails and the card re-reads. Within
  30 s, the card reuses and the waiting seed catches any advance. This is correct.
- **Leaving for another route after the restore was consumed, then returning within 30 s (no restore runs).** No marker
  exists, so the card re-reads. This is correct, **provided the marker was actually consumed by the first mount**.
- **A same-view remount (breakpoint change, phone shell swap).** No marker exists, so the card re-reads, as it does
  today. This is correct.
- **A dual-role user (an Output scoped from another dashboard).** On an owned card, the scoped branch with no marker
  re-reads. That is the safe direction, and D5's dual-grant jest assertion covers it.

**The warm half of AC2, end to end.** I checked each gate a restored shared card passes:
- `isKnownNonOwnedDashboard` is replaced by the D3 scope match.
- `isContentValid` passes, because the grantee already gets `contentUpdatedAt`.
- `isWindowFresh` checks the populated `signal.outputs`, so it depends on D1.
- `releaseTab` starts the 30 s retention grace.
- `paginationHydrated` restamps the generation, and a scoped Output registers no pipeline, so the generation does not
  move.
- `isReusable` takes D3b's scoped branch.
- `fetchPanelPage` routes by `panelReadScopeFor` (`panelThunks.ts:401`), so a stale window re-reads through the
  per-panel route.

The capture side is D2 plus `sanitizeEntry`. `capturedAt` is the server-time instant the request started
(`panelThunks.ts:470`), so D4's seed comparison errs toward one extra read and never misses one. Every gate is
passable, and m3, m4, m6, m7 and m8 each sit on a distinct gate.

**Mutation coverage: one failure mode is not caught.** D3b's safety for "leave via another route after a restore, then
return" depends entirely on the marker being consumed on the first mount. D5 lists two remount cases:
- "a mounted card after a `panel` restore makes no rows request". It passes even if the marker is never consumed.
- "a shared card remounted … after every status consumer unmounted and its data advanced re-reads its rows (no
  marker)". The text never says the card was restored first. The natural setup is a card loaded by `fetchPanels` that
  never had a marker. That setup also passes when the marker is never consumed.

So an implementation whose marker is never consumed passes every listed test and every mutation (m9 removes the marker
check, which is a different fault). The same holds for a marker that is consumed only when the reuse succeeds: a
restored card whose query differs, refetches, and keeps a stale marker. Either implementation ships exactly the
round-3 regression: stale rows after a restore, then a short visit to `/home` while a run finishes. Each of the two
cases above can be read two ways, and only one reading proves anything. That is a plan defect, not a nit.

### Verdict: REFUTE

D1 through D4 are sound. D3b's rule, as written, cannot serve stale rows on any remount path I traced: restore and
non-restore, memory, stored and hydrate, on-route and off-route, and dual-role. The warm half of AC2 passes every gate.
The one gap is in D5/m-list: nothing proves the marker is consumed. That consumption is the guard that closes
skeptic-design-3 CR1, and an executor could leave it out with every gate green. The fix is small.

### Change Requests

1. **D5 + tasks 3.4a/4.2: prove the marker is consumed by the first mount, whatever that mount decides.**
   - Restate the route-level remount jest case so its setup starts from a `panel` restore. The steps are:
     1. Restore the card (it reuses its window, with no rows request).
     2. Unmount every `panel-status` consumer and the card.
     3. The status reports a later `dataUpdatedAt`.
     4. Remount within `REMOUNT_GRACE_MS`, with no restore in between.
     5. The rows must be re-read through the per-panel route.
   - Add a second case for the restored card whose first mount does not reuse (for example, its query differs, so it
     fetches). A later non-restore remount within the grace, after the data advanced, must also re-read. The marker
     must not survive a mount that fetched.
   - Add **m10: the marker is not consumed on mount**, and separately, it is consumed only when the reuse succeeds. Each
     must turn the matching case red. Add m10 to tasks.md 4.2 (it lists m1-m9 today).
   - State in D3b where consumption happens: on the panel's first mount after the restore, regardless of the reuse
     outcome. It must stay visible to whichever single `isReusable` call decides that mount (`usePanelSortFilter` in
     the child runs before `usePanelData` in the parent when a sort or filter is active). StrictMode's second effect
     pass must not turn a reuse into a fetch. The existing e2e (a)/(d) cover that last point.

### Non-blocking notes
- `isReusable(entry, query)` has no panel id today. The marker check needs one, either as a new parameter or by holding
  the marker on the `PanelPaginationState` entry itself. The executor can choose, but should name the choice in
  files-modified.md.
- The worktree base is `febb2013b`. `main` has since moved to `daf40bfbf` (HEL-1784, which changes form-panel files
  only). Rebase before the final gate. I expect no overlap with this change.
