## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed tree: HEAD 62df9ff487cf7dbf08b3e51ccbc8804ccf77a73a. The change directory is untracked, so the artifacts were read from disk: ticket.md, proposal.md, design.md, tasks.md, specs/dashboard-grantee-access/spec.md, and skeptic-design-1/2/3.md.

### Earlier change requests: are they actually addressed?

**Round 3**
- **CR1 (fail-closed handling and test migration): addressed.**
  - D1 states there is no "absent dashboard means owner" exception in production code.
  - The context default `"owner"` stops influencing read routing, because `useCanUseOutputRoutes` is removed.
  - `isKnownNonOwnedDashboard`'s fail-open is removed from `fetchPanelPage` and knowingly kept only for `outputMetaCache` scoping.
  - Owner-path tests are migrated by explicit seeding through one helper. `renderWithStore` does not auto-seed.
  - The grep that finds the affected files is named. The migration is planned under a "D1 planned fixture migration" heading, limited to seeding only.
  - Production mounts outside `PanelList` are to be listed, with a stop-and-report rule if one would flip.
- **CR2 (disclosure precedence): addressed.** D4(b2) suppresses `totalRowCount` as a match count whenever a client term is active, so exactly one line renders:
  - `loaded < total`: the `clientScope` note.
  - Every row loaded, with a client filter: "{n} results." from the client-filtered count.
  - Every row loaded, sort only: nothing.
  - The 3-of-40 jest case and the one-note truncated case are in task 3.2.
- **Round-3 notes: all reflected.** The e2e waits for meta before asserting Refresh. The dual-grant user's Outputs are disjoint. D9 uses an insight-kind panel for the 200 cases.

**Rounds 1 and 2**
- Round-1 CR1-CR3 and round-2 CR1-CR2 are still present, and nothing in the revision walked them back:
  - Capabilities are keyed by `(dashboardId, panelId)`.
  - The split is enforced in the thunk.
  - There is one fail-closed `panelReadScopeFor`.
  - The insight kind comes from per-panel meta.
  - The `clientOps`/`clientScope` behaviour and copy are specified.

### Fresh review against the live tree
- `grep useCanUseOutputRoutes` (non-test) still returns exactly the nine sites in D1, plus the definition.
- The non-test `fetchPanelPage(` dispatch sites are still exactly four: `usePanelData.ts:326` and `:360`, `usePanelSortFilter.ts:143`, `PanelCardBody.tsx:200`.
- `useTableRows.ts:195` is `displayRows = usingPagination && onSortChange != null ? filteredRows : sortedRows`. Client filtering (`filteredRows`, line 155) already runs unconditionally, so D4(a)'s `clientOps` only has to change the sort suppression and the filter term source. That is consistent with the design.
- The owner rulings are respected. R1-R4, S1 and S2 do not contradict the design. No undecided product question remains other than the one below, which is a mechanics gap rather than a product question.

### Defect found in the plan

**F1. A client-only intent change still fires a page-0 server refetch. That contradicts D10, and it throws away loaded rows.**
- In `usePanelSortFilter.ts`, every change goes to `debouncedRefetch` and then to `dispatchFetch`:
  - `handleSortChange` (~line 290) and `handleFilterChange` (~line 298), which covers every quick-search keystroke;
  - a cross-filter change, through the `controlFilterOpsKey` effect (~line 270).
- `dispatchFetch` dispatches `fetchPanelPage({ page: 0, pageSize: 200, ... })` (line 143). A page-0 fulfilment replaces `rows` wholesale (the hook's own doc comment says so).
- D4 says "Callers keep dispatching the FULL intent" and the thunk strips the client terms. It never says what happens when the stripped server part equals what was already fetched.
- Read literally, this produces three problems:
  1. **Contradiction with D10.** D10 asserts "quick search narrows loaded rows **with no request**". Under D4 each debounced keystroke issues a per-panel rows request; it just carries no `quick`. The same applies to sorting on `amount`, and to a cross-filter on a non-control dimension, where `crossFilterEq` joins the change key, is dropped by the split, and still refetches. The executor has to guess: suppress the dispatch, or weaken the e2e.
  2. **Wrong behaviour.** A grantee clicks Load more (400 rows loaded) and then sorts or quick-searches a non-control column. The redundant page-0 refetch resets the window to 200 rows, so the client sort or search now covers half the rows the user had loaded. The disclosure counts stay truthful, but the user loses work and the view jumps. No task or test covers this.
  3. **Wasted requests.** Each keystroke and each non-control sort click costs a request that returns identical rows, which is not "performance by default".

### Verdict: REFUTE

This is one small, mechanical revision. It does not reopen any owner ruling.

### Change Requests

1. **D4: no server dispatch when only client terms change (fixes F1).**
   - **The rule.** In panel scope, when a sort, filter or cross-filter change leaves the split's `server` part equal to the server part of the panel's current window, no `fetchPanelPage` is dispatched. The loaded rows, including pages added by Load more, are kept, and only the `clientOps` re-derivation runs.
     - "Equal" means the normalized query of the panel's current `lastQuery` after splitting, compared the way `normalizeQuery` in `panelRowsReuse.ts` compares.
     - The rule may be enforced in `usePanelSortFilter.dispatchFetch` or as an early-return in the thunk's panel-scope branch. Name which one.
     - If the rule lives in the thunk, it must still update the recorded full intent, so that replay and Load more carry the current client terms.
   - **Load more.** State that Load more after a client-only change carries the same server part. Since `paginationState` keeps the full intent, this should already hold.
   - **Tests.**
     - Jest (task 3.2), panel scope: load 2 pages, then (i) sort on a non-control column, (ii) quick-search, (iii) cross-filter on a non-control dimension. Each dispatches no `fetchPanelPage` and keeps the 400 loaded rows.
     - Jest (task 3.2): a control-column sort or filter change still dispatches.
     - D10: the e2e's "no request" assertions for the `amount` sort and the quick search stay as written, and are now consistent with D4.
     - Optionally, add a mutation (m10: always dispatch) that turns this red.

### Non-blocking notes
- D7: the unknown-kind fail-closed rule hides Refresh on every panel-scope card until meta resolves. That is accepted. The e2e already waits for meta.
- D1: the planned migration of about 28 test files is large. The final gate will check that each diff is seeding-only, so keep each one strictly mechanical.
- HEL-1776: keep `ProvenanceTrigger` edits to its props and fetcher, as the design already says.
