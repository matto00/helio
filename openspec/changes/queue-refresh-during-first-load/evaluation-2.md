## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed: def6d92a9e55ea8d27a3d6fc0fbc0137ef6c284b. Base: f2358c16d, resolved live with resolve-review-base.sh. This cycle's delta is 688efb260..def6d92a9.

### Phase 1: Spec Review — PASS

All five cycle-1 change requests were addressed.

- **CR1/CR2: the deleted drains.** The executor deleted the M1 and M3 drains as unreachable, with the argument recorded in design.md D2. I checked that argument against the code myself.
  - **M1: the subscribeWait "already settled" branch.** It is reached three ways:
    1. `waitForOwnedRequest` on the mount-ownership path. This is the first mount decision, so no queue can exist yet.
    2. The `isPendingFor` path. `settled()` is evaluated synchronously right after `isPendingFor` returned true, so the entry is still pending and the branch is not taken.
    3. The re-subscribe effect, keyed on `[store, panel.id, drain]`. `drain` and `store` are stable. `panel.id` cannot change on a live instance, because `MobilePanelStack.tsx:238/259/285` key each body by `panel.id`.
    So no queue can exist when this branch runs. The argument holds.
  - **M3: the `isReusable` return.** `isReusable` needs a settled entry. Any queue sits behind this hook's in-flight request, and that request's `.finally` drains it. The argument holds, with the one exception in Phase 2 below: that exception does not route through `isReusable`, so restoring the M3 drain would not fix it.
- **CR3/CR4:** covered by the new `usePanelData.queueRefresh.test.tsx`.
- **CR5:** `red-first-evidence.md` was updated.
- The cycle-1 suggestions were also taken: `queueRefresh` is now required and the `??` fallback is gone, and the 1280 e2e now asserts 3 requests.
- The non-retired CONSTRAINTS C1-C14 are honoured.

### Phase 2: Code Review — FAIL

**Gates, run fresh by me in WORKTREE_PATH:**
- lint: OK
- format:check: OK
- typecheck: OK
- `npm test`: root 66/66 suites (579 tests); frontend 813/813 suites (9857 tests); exit 0
- `npm --prefix frontend run build`: exit 0
- `usePanelData*` jest files: 51/51

**Mutations, re-run by me** in a throwaway detached worktree at def6d92a9 (since removed). Each was run against the `usePanelData*` jest files:

| Mutation | Result |
|---|---|
| M2: remove the store-listener `drain()` (:225) | red (1 failed) |
| M4: drop the `latestFetchRequestId === lastRequestId` guard (:383) | red (1 failed) |
| M5: `return;` instead of `return retry;` (:369) | red (1 failed) |
| M9: remove `dropQueued()` in the no-key branch (:258) | red (1 failed) |
| M7: `setQueued(false)` at drain time | red (2 failed) |
| M8: `isRefreshing` without `\|\| queued` | red (2 failed) |

**New defect: a queue strands when another same-panel request supersedes the one it waits on.** I found this while checking the M3 reachability argument. It was already present in cycle 1, and I missed it then.

`.finally` drains only if this hook's request is still `latestFetchRequestId[panel.id]` (`usePanelData.ts:383`). In the phone stack, `PanelCardBody` (rendered by `MobilePanelStack.tsx:97`) runs `usePanelSortFilter`. Its `dispatchFetch` (`usePanelSortFilter.ts:143`) sends `fetchPanelPage` for the same panel whenever the table is sorted or filtered, or when the control-filter/cross-filter change key changes. That request becomes the latest. It is not this hook's request, so nothing ever drains the queue.

Sequence:
1. A poll, SSE or round refresh is in flight.
2. "Refresh dashboard" is pressed, so `queueRefresh` queues.
3. The user sorts the table before that request settles.

Result:
- the queued refresh is never sent;
- `queued` stays true, so `isRefreshing` is stuck true;
- the round holds the button busy until `PULL_REFRESH_TIMEOUT_MS` (15 s);
- the next press finds `inFlightRef` false, dispatches, and does not clear `queued` (`queuedRef` is still set). Its `.finally` then drains, so that press sends two requests.

Probe, a jest test I wrote and ran against def6d92a9 (persisted ref below). The first load settles, then `refresh()` (in flight), then `queueRefresh()`, then a store-dispatched sort `fetchPanelPage` for `p1`, then both settle. Output: `requests after both settled: 3 isRefreshing: true` (expected 4 and false). The test failed.

Probe source: /home/matt/Development/helio/.concertino/runs/HEL-1738/evidence/.concertino/scratch/HEL-1738/eval2/probeStrand.test.tsx.txt

Everything else in the cycle-2 diff is clean:
- **Host prop types** omit `queueRefresh` correctly: `PanelCardBody.tsx`, `PanelFullscreenOverlay.tsx`.
- **Test-double additions** are one-line `queueRefresh: jest.fn()`.
- **Comments at the deleted sites** state the reason, not a restatement of the code.

### Phase 3: UI Review — PASS

Servers ran through start-servers.sh on 7170/10077, with the backend on `helio_hel1738` only (checked in the log). assert-phase: PASS.

**Full e2e run** of `e2e/hel1738-refresh-during-first-load.spec.ts`, `e2e/hel1681-refresh-control.spec.ts` and `e2e/hel1656-pull-to-refresh.spec.ts` (2 workers): 38 passed, 1 failed.
- The failure was `hel1656-pull-to-refresh.spec.ts:340` ("an upward drag scrolls the page and never engages", 390). At :361, `scrollTop` was 0. That run overlapped my full jest run (3 workers).
- I re-ran the whole hel1656 file twice with nothing else running: 17/17 passed both times.
- The test checks native scroll timing for an upward drag, which never starts a round, and this diff does not touch scrolling. I am treating it as a load-induced timing flake, not a regression.
- All 7 hel1738 tests (touch 375/430 and mouse 375, light and dark, plus the 1280 check) and all of hel1681 passed.
- The fixture deleted the throwaway users by recorded id.

**Screenshots** from my run were checked visually: the busy spinner shows in both themes and the layout holds. Persisted:
- /home/matt/Development/helio/.concertino/runs/HEL-1738/evidence/.concertino/scratch/HEL-1738/eval2/busy-touch-430-dark.png
- /home/matt/Development/helio/.concertino/runs/HEL-1738/evidence/.concertino/scratch/HEL-1738/eval2/busy-mouse-375-light.png
- /home/matt/Development/helio/.concertino/runs/HEL-1738/evidence/.concertino/scratch/HEL-1738/eval2/settled-touch-375-dark.png

### Overall: FAIL

### Change Requests
1. **Never strand a queue when this hook's request is superseded by a request it did not send.** The site is `usePanelData.ts` `.finally` (:381-383).
   - Today, when `latestFetchRequestId[panel.id] !== lastRequestId` and `queuedRef` is set, the queue is simply left.
   - Instead, hand it to the newer request. If the panel's entry is still `isLoadingMore`, wait for that request through the existing `subscribeWait` mechanism, with `waitedId` = the current latest id; its store-listener settle already drains. Otherwise drain at once.
   - This keeps the skeptic's rule (never drain over a pending newer request) and removes the stranding.
   - Add a jest test in `usePanelData.queueRefresh.test.tsx` modelled on the probe: own request in flight, then `queueRefresh()`, then a store-dispatched sort `fetchPanelPage` for the same panel, then both settle. Assert exactly one more rows request and `isRefreshing` ending false. The existing M4 test (rebind to out-2) must stay green.
   - Record red-before-fix and the mutation in `red-first-evidence.md`.
2. **Make a stuck `queued` impossible to carry into the next dispatch.** At the D3 clear (`if (!queuedRef.current) setQueued(false)`, around :340), a stale `queuedRef` makes the next press send two requests. Once CR1 is fixed this should be unreachable. Either state that in a comment, or assert it in the CR1 test: one press after the round, one request.

### Non-blocking Suggestions
- `hel1656-pull-to-refresh.spec.ts:340` failed once under concurrent jest load and passed 2/2 alone. It is worth adding to the known-flake list if it recurs.
- `usePanelData.ts` is still about 490 lines. Propose a split in the PR description (CONTRIBUTING ~400-line rule).

### Critical Path (cycle 2 of 3; included because the next cycle is the last)
- CR1 is the only substantive item. It is a contained change to one `.finally` plus one test.
- Everything else is green: ACs, e2e in all six theme/pointer contexts, hel1681, and the mutation coverage of every drain/drop site.
- Recommendation: if cycle 3 cannot land CR1 cleanly, the human should decide whether to ship with this edge (sorting a table while a refresh is in flight and a round is queued) filed as a follow-up. Its impact is a 15 s busy button, a lost queued refresh, and one double request on the next press.
