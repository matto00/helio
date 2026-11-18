# Red-first evidence (HEL-1738)

E2E `e2e/hel1738-refresh-during-first-load.spec.ts`, run on a lane-private DB (`helio_hel1738`), phone 375 light and desktop-browser 375 non-touch light.

- Unmodified main sources (stashed): RED at step 4, `expect.poll(() => gates.held.B).toBe(3)` received 0 (no queued request; the round ended with the first load). Both contexts failed.
- Mutation A (register `panelData.refresh` again in `MobilePanelStack`): RED at the same step 4 (held on B = 0). Also red at unit level: `MobilePanelStack.pullRefresh.test.tsx` asserts the round calls `queueRefresh` and never `refresh`.
- Mutation B (clear `queued` at drain time, in `drain()`): RED in the browser, at `aria-disabled` after the queued request was held (the round ended early; button back to enabled). Also red in jest: `usePanelData.test.ts` no-false-gap test (1 failed).
- Unit mutation: `queueRefresh` that only queues nothing (acts as drop-while-in-flight): 3 jest tests red.
- With the fix: all 7 specs green; with hel1681 and hel1656 specs, 39/39 passed. Full jest (812 suites), lint, format:check, typecheck, e2e types, `npm --prefix frontend run build` green.
- Screenshots (busy and settled, touch 375/430 and mouse 375, light and dark): `e2e-evidence/HEL-1738/` (gitignored).

## Cycle 2 (evaluation-1.md CR1-CR5)

New file `usePanelData.queueRefresh.test.tsx` (4 tests). Each mutation applied to `usePanelData.ts` alone, the test file run, then reverted:

| Mutation | Result |
| --- | --- |
| M2: remove `drain()` at the subscribeWait store-listener settle | RED (1 failed) |
| M4: drop the `latestFetchRequestId === lastRequestId` guard before the `.finally` drain | RED (1 failed) |
| M5: CROSS_FILTER retry branch `return;` instead of `return retry;` | RED (1 failed) |
| M9: remove `dropQueued()` in the no-key branch (test now rebinds text panel, then out-2, and asserts out-2 gets one request; the old vacuous binding-loss test was replaced) | RED (1 failed) |
| M1: `drain()` at subscribeWait "already settled" | Unreachable with a queue (runs synchronously on mount, before `queueRefresh` can be called); drain deleted, justified in design.md D2 |
| M3: `drain()` at the `isReusable` return | Unreachable as a sole drain (a reusable entry means no pending request; the in-flight request's own `.finally` drains); drain deleted, justified in design.md D2 |

`queueRefresh` is now a required member of `PanelDataResult`; host prop interfaces (`PanelCardBody`, `PanelFullscreenOverlay`) omit it. `usePublicPanelData` returns its own `PublicPanelDataResult`, so it needs nothing. The `?? panelData.refresh` fallback in `MobilePanelStack` is gone; the unit assertion that a round calls `queueRefresh` and never `refresh` stays.

## Cycle 3 (evaluation-2.md CR1/CR2)

Three tests in `usePanelData.queueRefresh.test.tsx` (a foreign sort/filter refetch, a foreign load-more page, a second `usePanelData` instance with its own filter). Each: a refresh in flight, `queueRefresh()`, a foreign same-panel request, our request settles first (nothing may be sent, `isRefreshing` true), the foreign one settles (exactly one queued request follows, `isRefreshing` ends false, no further request), then one press after the round sends exactly one request (CR2: no stale queue carries over).

| Mutation | Result |
| --- | --- |
| M10: remove the hand-off branch (the behaviour before the fix) | RED, 3 failed (queue strands, 3 requests not 4, `isRefreshing` stuck) |
| M11: hand-off drains at once even while the foreign request is pending | RED, 3 failed |
| M4 rebind test (own newer request, no hand-off) | stays green |

Other interactions of a same-panel request this hook did not send with the queue: load-more and the detail-modal instance are the same `latestFetchRequestId` mismatch and are covered above; a second instance that mounts onto an identical pending request joins it through `subscribeWait` and sends nothing, so it does not touch this queue.
