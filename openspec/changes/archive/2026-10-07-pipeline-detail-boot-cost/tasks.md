## Standing Constraints

- [C1] The hel910 8x before/after comparison uses HEL-1298's exact configuration: 8x CDP throttle, 3 niced burners killed only by recorded PID, --workers=2 under nice -n 19, 1-min load < 2 before each batch, n=20 per side, loadavg before/after each batch.

## 1. Probe and baseline (before any code change)

### Frontend
- [x] 1.1 Build the D1 boot-request probe (headless Playwright, own context, initiator stacks) and capture one page open; verify the log lists every `/api/` boot request with initiators
- [x] 1.2 Confirm the duplicate run-history GET's root cause by flipping it both ways with the same harness; verify both logs are in `measurements.md`
- [x] 1.3 Record "before" numbers per D5 (request count n>=3, Outputs-tab TTI idle and 6x n>=10, hel910 at HEL-1298's exact 8x config n=20 per C1, post-create-navigation TTI) with loadavg and SHA; verify the table is in `measurements.md`
- [x] 1.4 Write `boot-audit.md`: each boot call, its first-paint consumer, timing, and the defer/keep decision per D4; verify every call has a decision

## 2. Implementation

### Frontend
- [x] 2.1 Add per-pipeline `runHistoryStatus`/`runHistoryRequestId`/`runHistoryOpenId`, `openId`+`force` args, latest-request-wins and the in-flight `condition` per D2; migrate `pipelinesSlice.test.ts` ~481-511 (bare-string arg, fulfilled without pending) deliberately, never by weakening assertions; verify slice tests pass
- [x] 2.2 Move run history off the boot path per D3 (per-page-open `openId` unique per mount and per `id` change, `runHistoryLoadedOpenId`, stale-while-revalidate, truncated-only boot fetch chained off this open's `fetchPipelineById`, fetch on modal open, freshness = succeeded + same openId, `force` on post-run callers, no cleanup reset, click-time `openRunHistory`, modal closes on id change, hook-exposed pipeline retry); verify the probe shows 0 run-history GETs on a non-truncated open and 1 on a truncated one
- [x] 2.3 Give `RunHistoryModal` loading and error states with a count-free title; verify RTL tests in 3.2
- [x] 2.4 Apply any further D4 deferral the audit justifies (or none, stated in `boot-audit.md`); verify with the probe

## 3. Tests

### Tests
- [x] 3.1 Slice tests: concurrent dispatches for one pipeline fetch once; other pipelines are not deduped; after completion fetches again; `force` bypasses; an older response never overwrites a newer one; verify each red by mutation
- [x] 3.2 RTL tests: no run-history fetch on a non-truncated open; one fetch plus banner on a truncated open; fetch on modal open; open/leave/return/reopen issues a new GET; a response landing after unmount does not make the next visit fresh; a StrictMode-wrapped revisit to a truncated pipeline issues exactly one GET; in-router A -> B -> A then modal open issues a second A GET (red against a `<mount>:<id>` token); modal open on A then in-router navigation to B closes the modal (never shows A's runs on B); error state calls `fetchRunHistory` exactly once until Retry, once more per Retry; loading and error states with count-free titles; migrate the existing tests (PipelineDetailPage.test.tsx ~2183 persisted banner via the chained boot fetch, ~2291-2345, 3361, 3500, 3521 modal, ~3061-3080 call count re-derived) by mocking `fetchRunHistory` and awaiting it, never by seeding a succeeded status, and rewrite the ~2352 'dispatches on mount' test as the no-fetch assertion; verify each is red against the pre-change code or the round-2 cleanup-reset design by mutation
- [x] 3.3 RTL test: a run finishing while a modal-open fetch is in flight still issues a forced refresh and the list shows its result even when the earlier response lands last; verify red against a bare-`condition` version
- [x] 3.4 Record "after" numbers per D5 and C1 on the final head, delete every `e2e/zz-hel1354-*` file, and verify `npm test`, lint, typecheck and the hel910 spec pass
