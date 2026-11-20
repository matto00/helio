## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed tree: `febb2013bd8b41704084192749535c3c4249576f` (the change dir is untracked). I checked every code claim against
the file it names. I used the earlier skeptic reports only as pointers.

### What I verified (with evidence)

**D1 (backend): sound.**
- `DashboardChangesRepository.scala:41-42` runs `contentQuery(ids).zip(dataQuery(ids))` in one `withUserContext`.
  `dataQuery` inner-joins `outputs` (`:34`), so under RLS a dashboard-only grantee gets no data rows. The Why is correct.
- Splitting into content (user context) then data (`withSystemContext`, over step 1's ids only) is the right shape.
  `DbContext.scala:54-63` requires an inline justification at every call site, and D1 plans one.
- `p.kind = 'output'` changes nothing for owners. `PanelRowMapper` writes `outputId` only for `OutputPanel` (base
  `outputId = None` at `:70`, set at `:87`), and V108 dropped the `kind IS NULL` disjunct.
- Public grant: `helio_can_access_dashboard` (V36:42-85, never redefined; V40 only changes its owner) admits an
  authenticated caller as owner or named grantee only. The `grantee_id IS NULL` branch is for anonymous callers only. So
  D5's case "an authenticated stranger with a public grant gets no item" holds through step 1, as the design says.
- Disclosure is limited to Output ids the panel list already gives the caller, plus capture times `panel-status` already
  gives. m1 and m2 hit different faults.

**D2/D3 (capture and scope gate): sound.**
- `captureTab` skips non-owned dashboards today (`warmCapture.ts:107`).
- `showDashboardPanels.ts:85-88` gates on `!isKnownNonOwnedDashboard`, and `restoreFromMemory` unscopes every Output
  (`:65`).
- `fetchPanels` scopes non-owned Outputs and unscopes owned ones (`panelThunks.ts:83-89`). Factoring that into
  `applyPanelReadScopes` is a clean single seam.
- `applyWarmEntry` has two callers: `showDashboardPanels.ts:105` and `hydrateTabs.ts:111`. Putting the scope check
  inside it covers both.
- `isKnownNonOwnedDashboard` treats a dashboard missing from the store as owner. D3 changes that to "unknown → cold",
  which is the safe direction. `hydrateTabs` prunes against `dashboards.items`, so this costs owners nothing in practice.

**D4 (seed): sound as specified.**
- `panelStatusStore.ts:60-70` makes the first snapshot a pure baseline.
- `release` (`:123-131`) drops the entry with its last consumer. So the planned separate seed/pending map is needed, and
  D4(c) says so.
- Semantics (a)-(c) cover three cases: a read in flight before the seed, an advance before the listener subscribes, and
  reset.

**D3b on the memory and hydrate paths: sound.** Scoped Output metadata is still servable on a memory restore. The
`outputMetaCache.ts:93-99` servability checks are: scope flag matches, generation unchanged, and the tab hold retained.
So `usePanelSortFilter` (child) decides first whenever a sort or filter is active, and `usePanelData` defers through
`mountOwnership`. Consuming the marker on mount works there. The m10a/m10b cases now pin consumption (closes design-4 CR1).

**D3b on the stored-copy path (reload, or a lazy restore with no memory copy): the stated ordering is false.**
1. D2 writes `outputMeta: {}` for a `panel` entry, so after a reload no metadata is held for a restored shared Output.
   The card has to read it through `.../panels/:panelId/output-meta` (`outputMetaCache.ts:118-131`) after mount.
2. `usePanelData` (parent, `PanelCard.tsx:116`) does not wait for metadata. Its outputId comes from the panel
   (`usePanelData.ts:109`), so it decides on the first effect pass.
3. `usePanelSortFilter`'s mount correction returns early while `seededOutputId === null`
   (`usePanelSortFilter.ts:276`). It only runs once the scoped metadata resolves, after the parent has already decided.
4. At the parent's decision, `mountOwnership` is still false, so the parent calls `isReusable`. It sees the marker,
   reuses the window and consumes the marker.
5. Then the metadata lands. Suppose the Output has a persisted `columnSort`/`columnFilters` (the scoped stub carries
   `config`, `outputFromPublicMeta` at `:59-71`), or the URL carries a control or cross-filter. The child then calls
   `isReusable` (`:303`) with no marker left. It returns false and the child dispatches a rows fetch.

The result: after a reload, every shared panel with a default sort or filter (or an active control) re-requests rows.
The spec says "Activating a warm tab SHALL render its panels without requesting … any panel's rows". The owner path does
not have this problem, because `applyWarmEntry` seeds metadata synchronously, so the child decides first. The data is
never stale, but the warm-reload requirement fails for a common panel configuration.

Nothing in D5 catches it:
- e2e (d) uses a plain table Output.
- No jest case restores a stored `panel` copy whose metadata resolves after mount.
- m10a/m10b do not touch the two-decision case.

D3b also tells the implementer the opposite: "stays visible to the single `isReusable` call that decides it
(`usePanelSortFilter` in the child decides before `usePanelData` …)". An implementer who follows that text exactly
ships the regression with every gate green.

**Other checks.**
- `SIGNALS_VISIBLE_MIN_GAP_MS = 30_000` exists (`tabsBrowserTriggers.ts:30,82`). The e2e trigger plan is realizable.
- `changeRule.hasChangedSince` has no role check (`changeRule.ts:9-21`).
- `isWindowFresh` (`warmValidity.ts:34-42`) uses `signal.outputs`, so it depends on D1 as the design says.
- `e2e/shard-weights.tsv` defaults an unlisted spec to the median (`scripts/e2e-shard.mjs:56-70`). The new e2e needs no
  HEL-1778 file.
- `git diff febb2013b daf40bfbf` touches none of the files this change plans to edit.

### Verdict: REFUTE

D1, D2, D3 and D4 are sound, and the round-4 consumption gap is closed. One planned path is wrong: on a stored-copy panel
restore, D3b's stated ordering of `isReusable` decisions is false. The design as written gives a warm reload that
re-reads rows for shared panels with a default sort or filter, and no listed test or mutation would notice. The fix is
small, and it is cheaper to make now than at the final gate.

### Change Requests

1. **D3b: define the marker's lifetime so both decisions of the first mount see it.**
   - Replace the sentence "stays visible to the single `isReusable` call that decides it (`usePanelSortFilter` in the
     child decides before `usePanelData` …)". The new text must say that on a stored-copy `panel` restore the scoped
     Output metadata is not held at mount. `usePanelSortFilter`'s correction (`usePanelSortFilter.ts:276`) therefore
     runs after `usePanelData` has decided.
   - The marker must stay visible to every `isReusable` call made during the panel's FIRST mount after the restore.
     That includes a child correction that runs once the metadata resolves.
   - The marker must still be gone for any later mount, whatever the first mount decided. One way: consume it when that
     first mount unmounts, and also when it fetches. The executor chooses the mechanism and names it in
     files-modified.md.
   - Within that mount, a status-poll advance and a generation bump still force a fetch, so there is no stale path.
2. **D5 and tasks 3.4a/4.2: add the case and a mutation.**
   - New jest case: a stored-copy (reload) `panel` restore of a card whose scoped Output metadata resolves after mount,
     with a persisted default `columnSort` (and separately, a URL control filter). The window matches the query. The
     test asserts no rows request after the metadata resolves.
   - **m11:** the marker is consumed by the first `isReusable` call. This case must turn red, and the m10a/m10b cases
     must stay as they are.
   - Optional: give e2e (d)'s Output a persisted default sort, so the browser path covers it too.

### Non-blocking notes

- **D4 seed precision.** The history `captured_at` is the `Instant.now()` taken before the write transaction
  (`PipelineRunSucceededWrites.scala:84,140`), not the commit time. A window's `capturedAt` is a client estimate of
  server time at request start (`panelThunks.ts:470`).
  - Suppose a run's `now` precedes the rows read and its commit follows the read's snapshot. The window holds the old
    rows, and both `isWindowFresh` and the seed compare `H ≤ capturedAt`. No refresh fires until the next run.
  - HEL-1786's cold baseline has the same race class, and owners are covered by run baselines.
  - The window is narrow, and closing it would need a snapshot time on the rows response (a contract change, out of
    scope). Record it under Risks rather than claiming the seed "never misses" a run.
- **Never-mounted panels.** A marker on a panel that never mounts lingers until expire or reset. Also clear markers when
  a different dashboard's panels are restored or fetched, so a lingering marker cannot outlive its restore.
- **Pagination.** "Every `outputs[].outputId` appears in B's panel-list response" should compare against the full list
  (all pages) if the panel list is paginated.
- Rebase onto `main` (`daf40bfbf`) before the final gate. The HEL-1784 diff does not overlap.
