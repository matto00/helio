## Skeptic Report — design gate (round 6, skeptic-design-6.md)

Reviewed tree: `febb2013bd8b41704084192749535c3c4249576f` (the change dir is untracked). `git diff febb2013b daf40bfbf`
touches none of the files this change plans to edit. I re-derived the round-5 defect from the code rather than from
skeptic-design-5.md, and that re-derivation found the round-5 diagnosis was incomplete.

### What I verified (with evidence)

**Unchanged parts, spot-checked.**
- `DashboardChangesRepository.scala:42` still runs `contentQuery(ids).zip(dataQuery(ids))` inside one `withUserContext`.
  The D1 premise holds.
- `warmCapture.ts:107` still skips known non-owned dashboards. The D2 premise holds.
- `warmRestore.ts:55-75` still seeds `runBaseline` and restores `lastQuery` per window, and it is gated by
  `isWindowFresh`. The D3 and D4 premises hold.
- D1, D2, D3 and D4 text is unchanged in substance from round 5, which confirmed them. I found nothing new against them.

**The named defect (design-5 CR1/CR2): the text is fixed, but only part of the scenario is fixed.**

The text now says what round 5 asked for:
- D3b says the marker is visible to every `isReusable` call in the panel's first mount, including the late child
  correction.
- The marker is consumed when that first mount fetches or unmounts.
- The executor must name the StrictMode mechanism.
- D5 adds the stored-copy case (persisted `columnSort`, and separately a URL control filter) and m11.

But the parent's first decision does not go the way round 5 assumed. Here is what happens on a stored-copy `panel`
restore, traced through the code:

1. Metadata is missing at mount. D2 writes `outputMeta: {}`, so after a reload the child has `output` undefined.
   `usePanelSortFilter.ts:128-133` seeds `activeSort`/`activeFilter` only once `output` resolves, and the correction
   effect returns early while `seededOutputId === null` (`:276`). The child therefore does not set `mountOwnership`
   at mount.
2. The parent builds a stripped query. In `usePanelData.ts:290-319`, `mountOwnership.current` is false, so the parent
   builds its query from `replayableQuery(..., full=false)` (`:495-503`). On a mount that function deliberately drops
   `sort` and the column filter (`quick`/`columns`). It replays only `filter.ops` (URL controls) and a still-active
   cross-filter.
3. The restored window does not match that query. The window was captured with the child's corrected query.
   `warmCapture.ts:75` stores `lastQuery` and `warmRestore.ts:74` restores it. So for a panel with a persisted default
   `columnSort` or `columnFilters`, `lastQuery.sort` (or `filter.columns`/`filter.quick`) is set.
   `normalizeQuery(window.lastQuery)` is not equal to `normalizeQuery(stripped query)`, so `isReusable` returns false
   at `panelRowsReuse.ts:52`, before any marker check could matter. `isPendingFor` is also false.
4. The parent then sends the stripped rows request at `:319`, and the window becomes an unsorted pending entry.
5. When the metadata resolves, the child's sorted query matches neither the window nor the pending request
   (`:303`), so `dispatchFetch` sends a second rows request.

So for the persisted-sort or persisted-column-filter case, a warm reload of a shared panel sends two rows requests. The
marker lifetime does not change this, because the marker never gets a chance: the query check fails first. The
URL-control-filter variant does work under the new lifetime: `filter.ops` replays, so the parent reuses under the
marker, and the late child call still sees the marker.

The owner stored path does not have this problem. `applyWarmEntry` seeds Output metadata synchronously, so the child
seeds its state in its first render and its effect runs before the parent's. It sets `mountOwnership`, reuses the
window, and the parent then defers through `waitForOwnedRequest`.

**Would a wrong implementation pass?** Not if the D5 case is written as specified. Any implementation that keeps the
parent's stripped fetch leaves the child needing a second request after the metadata resolves, so "no rows request
after the metadata resolves" goes red. So the test pins the right outcome. But:
- The design gives no mechanism that can make that test green. An implementer who follows D3b exactly hits a red case
  with no planned fix, and the easy way out is to weaken the test.
- The case's wording ("after the metadata resolves") does not forbid the earlier stripped request. That request alone
  already breaks the spec requirement "without requesting … any panel's rows".
- e2e (d) still uses a plain table Output, so the browser path never runs this configuration.
- m11 is only a meaningful mutation if the parent actually reaches the marker check. For the sort variant it does not,
  under the mechanism the design describes.

**No stale-rows or disclosure path found.** Within the first mount, a generation bump or a status-poll advance still
forces a fetch (D3b). The D4 seed covers runs between the last change check and the return. The marker only relaxes the
`hasRunBaseline` requirement for scoped Outputs; the owner branch is unchanged. Nothing in the planned mechanism or the
fix below adds a request to `/api/outputs/*` or `/api/pipelines/*`, or a field to any response.

### Verdict: REFUTE

D3b fixes the marker's lifetime but not the stored-copy ordering it was meant to fix. For the main configuration D5
names (a persisted default `columnSort`, and likewise persisted column filters), the parent's mount query is stripped
and can never match the restored window. The panel re-reads its rows twice, and the planned test cannot pass under the
planned mechanism.

**This can safely be carried as binding execution constraints instead of another design round.** The defect is narrow,
it changes no contract, no disclosure and no owner path, and the D5 test already forces the right outcome. Carry
change requests 1-3 below verbatim into the execution brief.

### Change Requests (binding execution constraints, since there is no further design round)

1. **Parent query under a restore marker.** In `usePanelData` (around `:290-299`, the first-mount, non-refresh
   branch), when the panel holds a restore marker (D3b), build the mount query from the window's full `lastQuery`:
   `sort`, the full `filter` including `quick`/`columns`/`ops`, and `crossFilterEq` subject to the existing
   still-active rule. Do not use the stripped `replayableQuery(full=false)`.
   - Then the parent reuses the window under the marker. The child's late correction then calls `isReusable` with the
     seeded query: equal means reuse (marker still visible), and different (the default changed since capture) means
     fetch.
   - Without a marker, behaviour is unchanged byte for byte.
   - An equivalent alternative is fine: the parent defers like `mountOwnership` while the marker is present and the
     scoped metadata is unresolved. If so, the executor must show that a failed or never-resolving metadata read falls
     back to one fetch and never wedges the card.
   - Persisting the scoped metadata stub instead is NOT acceptable. It would contradict D2 and the `dashboard-tabs`
     spec ("no Output metadata").
   - Name the chosen mechanism in files-modified.md.
2. **Tighten the D5 stored-copy case.** It asserts ZERO rows requests for the panel across the whole first mount
   (before and after the metadata resolves), not only "after the metadata resolves". Keep three variants:
   - persisted default `columnSort`;
   - persisted `columnFilters`;
   - URL control filter.

   Add a fourth: the persisted default differs from the captured window's query. It must make exactly one rows request,
   through the per-panel route.
3. **Mutations and e2e.**
   - Add **m12**: the parent uses the stripped mount query even under a marker. The sort and column-filter variants of
     the case in item 2 must turn red.
   - m11 must be shown red on the URL-control-filter variant, where the parent does reach the marker check.
   - Give e2e (d)'s Output a persisted default `columnSort` (or add a second Output that has one), so the browser path
     asserts no DA rows request on the stored-copy reload for a sorted shared panel.

### Non-blocking notes

- The memory path has the same exposure whenever the scoped metadata is not servable at mount (for example, the
  `outputMetaCache` hold was not retained). CR1 covers this too, because it keys on the marker rather than on the
  restore path.
- Rebase onto `main` (`daf40bfbf`) before the final gate. The HEL-1784 diff does not overlap any planned file.
