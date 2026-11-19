## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD 62df9ff487cf7dbf08b3e51ccbc8804ccf77a73a. The change directory is untracked, so the artifacts were read from disk: ticket.md, proposal.md, design.md, tasks.md, specs/dashboard-grantee-access/spec.md and skeptic-design-1.md.

### Round-1 change requests: are they actually addressed?

- **CR1 (capabilities keyed by panel): addressed.** D5 keys per-panel capabilities by `(dashboardId, panelId)` and never shares the `outputId` key. It routes the `CROSS_FILTER_EQ_REJECTED` invalidation to the key of whichever scope made the request. Task 3.3 now has the two-panels/one-Output jest case. I confirmed the 400 path that needs this: it is `invalidateCapabilities(outputId)` at `panelThunks.ts` ~441.
- **CR2 (split enforced in the thunk): addressed.**
  - D4 puts `splitForPanelScope` inside `fetchPanelPage`'s panel-scope branch, using the scoped panel's `config.controls`.
  - It names all four dispatch sites. I re-grepped them: `usePanelData.ts:326` and `:360`, `usePanelSortFilter.ts:143`, `PanelCardBody.tsx:200`. There are no others outside tests.
  - `crossFilterEq` is folded into the request only for a control column and dropped otherwise.
  - `paginationState` keeps the full intent.
  - A panel missing from state sends no sort or filter.
  - Task 3.2 has one jest case per dispatch site.
- **CR3 (one routing rule): mostly addressed.**
  - The single fail-closed `panelReadScopeFor` decides routing, and `dashboardId` becomes a required thunk argument. That replaces the fail-open `isKnownNonOwnedDashboard` + `items.find` at `panelThunks.ts:393-394`.
  - The jest case for an absent dashboard is in task 2.1.
  - `outputMetaCache.panelScopes` is knowingly left alone, with a reason I accept.
  - `insightChromeStore` was handed to the executor as an either/or, and one of the two options conflicts with D7 (see CR1 below).
- **Round-1 non-blocking notes: all reflected.** The S1 wording is corrected. D6 drops the `?? ""` fallback. The D10 attribution now uses both Output ids and pipeline ids, on disjoint fixtures. The m7 fallback to a jest red proof is stated. D9 assigns the fixture users. The spec delta has a quick-search scenario.
- **Spec delta header.** "Non-owned dashboards read panel data only through per-panel routes" matches the live requirement at `openspec/specs/dashboard-grantee-access/spec.md:69` exactly, so the MODIFIED block applies.

### Fresh review: what I verified against the live tree

- **In-body "Update insight" is safe as is.** It renders only when `!isPublic && data?.canRefresh` (`InsightPanelBody.tsx` ~line 161). `useInsightRefresh` calls `refreshOutputInsight`/`fetchOutputInsight` only on click. So the public variant reused in panel scope never touches `/api/outputs/*` from the body.
- **The insight chrome is not fed for the public variant.** `InsightPanelBody.tsx:91-96` has `if (isPublic) return;` before `setInsightChrome`.
- **`PanelCard` does not know the Output kind.** `PanelCard.tsx:119-120` decides `refresh = insightChrome ? insightChrome.refetch : panelData.refresh`, and the store's own doc says "The chrome renders before the Output's kind is known" (`insightChromeStore.ts:3-5`). `MobilePanelStack.tsx:76-80` does the same.
- **Today's paginated table path is server-only for sort and has no sort disclosure.**
  - `useTableRows.ts:195`: `displayRows = usingPagination && onSortChange != null ? filteredRows : sortedRows`. With `onSortChange` wired, the client never re-sorts.
  - `LoadedScopeDisclosure.tsx`: `if (!filtering) return null`. The HEL-448 sort note was removed in HEL-1027.
  - `TableRenderer.tsx` ~line 150: the empty-filter text is "No rows match your filter." with no loaded-rows qualifier, because HEL-1027 D10 relies on filtering being server-side.
  - `showTruncationWrapper` requires `!isEmpty`.
- `usePanelSortFilter(panelId, ...)` takes no `dashboardId`. Its only caller, `PanelCardBody.tsx:145`, has the panel, so making `dashboardId` a required thunk argument is a mechanical change to thread through. This is not a defect.

### Defects found in the plan

**F1. S1 (hide the insight Refresh) has no detection signal, and D1 allows the option that removes the only one.**
- D7 says "`PanelCardHeader` hides the Refresh control for an insight panel in `panel` scope", but does not say how the card chrome knows the panel is an insight panel.
- In the live code the chrome learns this only from `insightChromeStore`. That store is fed by `InsightPanelBody` only when `!isPublic`, and D7 makes panel scope use the public variant.
- D1's `insightChromeStore` disposition offers "or shows it is not fed in panel scope". If the executor takes that option, the header falls back to `panelData.refresh` with no insight signal at all. That re-reads per-panel rows for an insight Output, which is exactly the do-nothing button the AC calls out. S1 then cannot be implemented without inventing a mechanism (for example, reading `kind` from the per-panel `output-meta`, which is cached but which `PanelCard` does not read today).
- The e2e mutation m8 would catch the result, but only after an execution cycle. This needs settling in the design.

**F2. R4's client part claims an "existing" client sort path and disclosure that do not exist for a paginated table.**
- D4 says the client part "is applied to the loaded rows by the existing client sort/filter path in `TableRenderer`" and that "the loaded-scope disclosure shows whenever `client` is non-empty".
- The spec delta requires: "Sort on another column ... the loaded rows are sorted in the browser, and the loaded-scope disclosure is shown".
- In the live tree:
  - (a) with `onSortChange` wired, `useTableRows.ts:195` never sorts client-side;
  - (b) `LoadedScopeDisclosure` renders nothing when only a sort is active;
  - (c) a client filter that matches zero loaded rows of a truncated table shows "No rows match your filter." with no loaded-rows qualifier, because the disclosure wrapper is suppressed when `isEmpty`.
- (c) is the "confidently wrong answer" that HEL-451 and HEL-1027 designed against. HEL-1027 removed the loaded-rows wording only because filtering became server-side, and R4 makes that premise false again for grantees.
- The design leaves an implementer to guess three things: the copy for a sort-only disclosure, whether the zero-match empty state gets a loaded-rows qualifier, and how `useTableRows` sorts client-side while `onSortChange` is wired. These are user-visible copy and state decisions under DESIGN.md. Here "existing" is a false premise, not a deferrable detail.

### Verdict: REFUTE

Both fixes are small edits to design.md and tasks.md. Neither one reopens an owner ruling (R1-R4, S1 and S2 all stand).

### Change Requests

1. **D7/D1: name the signal that hides the insight Refresh, and remove the conflicting option (fixes F1).**
   - State how `PanelCard`/`MobilePanelStack` know a panel-scope panel is an insight panel. Two acceptable mechanisms:
     - (a) `InsightPanelBody` publishes chrome in panel scope too, keyed so it cannot collide with an owner-scope entry for the same Output (for example by `(dashboardId, panelId)`), with a flag the header reads to hide Refresh;
     - (b) the card reads `kind` from the already-cached per-panel `output-meta`.
   - Delete the "or shows it is not fed in panel scope" option from D1's `insightChromeStore` bullet, unless D7 names a different signal.
   - State whether a grantee sees the card footer's "Updated <date>".
   - Add to task 3.5 a jest case that renders `PanelCard` (and `MobilePanelStack`) for an insight panel in panel scope and asserts that no "Refresh <title>" button exists. The test must be red against today's code.
2. **D4: specify the panel-scope client sort/filter behaviour and disclosure instead of calling them "existing" (fixes F2).** State:
   - (a) how `useTableRows` applies a client sort on a non-control column while `onSortChange` is wired, for example a `clientSort`/`clientFilter` input or a panel-scope flag replacing the `onSortChange != null` test at `useTableRows.ts:195`;
   - (b) the disclosure copy shown when only a client sort is active (for example "Sorted within N loaded rows."), and where it lives (`LoadedScopeDisclosure` with a new prop, so owner behaviour is unchanged);
   - (c) the empty state when a client filter or quick search matches zero loaded rows of a truncated panel-scope table. It must say the search covered only the loaded rows (and offer Load more when present), never a bare "No rows match your filter.";
   - (d) that owner-scope rendering is byte-for-byte unchanged.
   - Add jest cases for (a)-(c) to task 3.2 and an e2e assertion on the sort-only disclosure text. Then run the C10 grep for the altered disclosure and empty-state strings.

### Non-blocking notes

- Task 2.1 should mention that `usePanelSortFilter`'s signature gains `dashboardId` (threaded from `PanelCardBody.tsx:145`). This is mechanical.
- `outputMetaCache` scope stays fail-open in `fetchPanels` (`panelThunks.ts:81`). That was accepted in HEL-1773 and is stated in D1. If the executor finds a non-owned dashboard whose `fetchPanels` runs before its role is in the store, that would break the C11 invariant through `/api/outputs/:id` meta, and the e2e invariant should catch it.
- D9's stranger is "B or C against a second, ungranted dashboard". Pick one and state it in the spec header, so the stranger case is not accidentally a dual-grant user who holds a pipeline grant on that dashboard's Output's pipeline.
