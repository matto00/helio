## Skeptic Report - design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)
- Round-4 CR1: D1 now marks concatenation SUPERSEDED by D9a-i; cross op is a separate `crossFilterEq` parameter; tasks.md 3.1 rewritten with "NEVER concatenated" and consistent with D9a-i/D9a-ii. Spec delta is mechanism-agnostic and consistent.
- CR2: D9a-ii plumbs `crossFilterEq` through usePanelSortFilter (dispatchFetch via ref, corrective-mount condition, change key), usePanelData (currentFetchKey + dispatches), handleLoadMore, PanelDetailModal. Checked against code: usePanelSortFilter.ts:93,119-134,216,231; usePanelData.ts:61-68,120; PanelCard.tsx:172,231; PanelDetailModal.tsx:192 - all sites named exist and are the ones the design covers.
- CR3: D3a trigger is `arg.crossFilterEq != null` + HTTP 400, status read pre-classifyRequestError.
- ACs all traced to tasks (red-first 1.1, whole-Output count 3.x/5.1, only-Inspect test 5.2, clear/stale 5.1, desktop+mobile 6.1, announcement 4.1).

### Verdict: CONFIRM

### Non-blocking notes
- D9 still says "through the same D1 concatenation"; read it as the D9a-i separate arg (D1 is explicitly superseded). Executor should not follow the stale wording.
- Task 5.6 lists load-more/page-0 classes; 5.7 covers mount/refresh - together cover D3a's three dispatch classes.
- Executor to confirm user sort/filter is persisted so lastQuery replay reconciles (round-4 note).
