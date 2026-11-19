## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed tree: HEAD 62df9ff487cf7dbf08b3e51ccbc8804ccf77a73a (the change directory is untracked; artifacts read from disk: ticket.md, proposal.md, design.md, tasks.md, specs/dashboard-grantee-access/spec.md, skeptic-design-1..4.md).

### Earlier change requests: are they actually addressed?

- **Round 4 CR1 (no server dispatch for a client-only change): addressed, substantively.** D4(e) now states the rule, names the enforcement point (`usePanelSortFilter`'s `dispatchFetch`), defines "equal" as the normalized split server query compared like `normalizeQuery` (`panelRowsReuse.ts:28`), records the full intent with a synchronous reducer action so replay and Load more carry the client terms, states Load-more behaviour, keeps owner scope unchanged, and adds the jest cases (two pages loaded; non-control sort, quick search, non-control cross-filter each dispatch nothing and keep rows; a control-column change still dispatches) plus mutation m10. Verified against the live hook: every dispatch path the round-4 finding named goes through `dispatchFetch` — `debouncedRefetch` from `handleSortChange`/`handleFilterChange` (lines 285-300), the `controlFilterOpsKey` cross-filter effect (line 279) and the mount correction (line 258) — so enforcing there covers all three. `lastQuery` is written only by a page-0 `.pending` and carried forward by `.fulfilled`/load-more (`panelsSlice.ts:376-382, 429`), so a reducer action that rewrites it is compatible with the stale-response guard (`latestFetchRequestId`) and with `isReusable` on remount (which compares the full intent, now updated). D10's "quick search narrows loaded rows with no request" is now consistent with D4.
- **Round 3 CR1-CR2, round 2 CR1-CR2, round 1 CR1-CR3:** still present and not walked back (fail-closed `panelReadScopeFor`, `dashboardId` a required thunk arg, seeding-only planned fixture migration under a named heading with no auto-seed in `renderWithStore`; disclosure precedence D4(b2); insight kind from per-panel meta D7; `clientOps`/`clientScope`/empty-state copy D4(a)-(c); capabilities keyed by `(dashboardId, panelId)` D5; split enforced in the thunk D4).

### Fresh review against the live tree

- `useCanUseOutputRoutes` non-test call sites: exactly the nine D1 lists plus the definition (`dashboardAccessContext.tsx:36`).
- Non-test `fetchPanelPage(` dispatch sites: still four (`usePanelData.ts:326`, `:360`, `usePanelSortFilter.ts:143`, `PanelCardBody.tsx:200`), matching D4.
- `useTableRows.ts:155` filters unconditionally and `:195` suppresses the client sort only when `onSortChange` is wired, so D4(a)'s `clientOps` change is local and owner scope stays byte-identical as D4(d) requires.
- Owner rulings R1-R4, S1, S2 are not contradicted anywhere in the design, tasks or spec delta. No undecided product question remains. Out-of-scope items (HEL-1786, HEL-1783, R3 binding) are kept out.
- Spec delta: MODIFIED header matches the live requirement; ADDED requirements map to D4/D5/D1/D6/D7 and each has a scenario.

### Verdict: CONFIRM

No blocking defect. Nothing in the plan forces the executor to guess a product or routing decision; the remaining items are refinements the executor and evaluator can settle.

### Non-blocking notes

1. **m10 bookkeeping.** D4(e) and task 3.2 introduce mutation m10, but D10 and task 4.2 still say "m1-m9". The executor should run and record m10 with the others; the final gate should expect it.
2. **D4(e) edge cases to settle in code and jest:** (a) with no window for the panel (`lastQuery` absent), a change must dispatch, never skip; (b) when the current window's last page-0 failed (`lastFetchOk === false`), a client-only change should not silently keep the error window — dispatching is the safe choice; (c) a client-only change while a page-0 is in flight compares against the in-flight `lastQuery` and, when equal, the sync action updates `lastQuery` without touching `latestFetchRequestId`.
3. **D1 fixture migration size.** The named grep matches 73 test files today (the design's "about 28" is after filtering to those that render a panel with no seeded dashboard). Many are service-level tests that will not need seeding. The final gate will check each listed diff is seeding-only; keep it mechanical, and any test needing more than seeding is reported separately as D1 says.
4. **`TableRenderer` client part.** `clientOps` must be derived from the same intent `usePanelSortFilter` holds (TableRenderer's local sort/filter mirrors it today); make sure the panel's `config.controls` and the read scope are threaded to `TableRenderer` from `OutputPanelContent`, not re-derived from the selected dashboard.
5. **HEL-1776:** keep `ProvenanceTrigger` changes to props/fetcher, as already stated.
