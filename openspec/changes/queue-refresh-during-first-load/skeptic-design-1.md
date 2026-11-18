## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD f2358c16d0fcd87a7bac9bebbd80e02a61855ad0 (branch has no commits beyond main; change dir untracked).

### What I verified (with evidence)

- **Premise (ticket sites).** `usePanelData.ts:140-149` `refresh()` returns at once on `inFlightRef`; `pullRefreshRegistry.ts:105` seeds an in-flight slot `seen: entry.isRefreshing`, `:111` calls every `refresh()`, `:87-96` ends the slot on the committed true-to-false. `MobilePanelStack.tsx:72-80` is the only registrant, passing `insightChrome ? insightChrome.refetch : panelData.refresh` and `panelData.isRefreshing`. Matches design Context.
- **D3 "no false gap" holds, by trace.** `setRefreshing` is called from a `useEffect` on committed `isRefreshing` (`pullRefreshRegistry.ts:211-213`), so only committed renders matter.
  (a) Press: `queueRefresh` runs in a discrete handler, so `setQueued(true)` commits before any network-driven fulfilled.
  (b) First load lands: `fetchPanelPage.fulfilled` updates the store (react-redux uSES, sync lane, flushed in a microtask queued at dispatch time) before the thunk promise's `.unwrap().then().catch().finally()` chain runs (several microtask hops later). That render sees `isLoadingMore=false` but `queued=true`, so the result is true. For the mountOwnership path the drain runs inside the `store.subscribe` listener (`:171-182`), which is synchronous with the fulfilled dispatch and earlier still. Same result.
  (c) Drain sets `refreshToken` and `prevFetchKey=null` (`:143-148`); the next effect run takes the fullReplay path straight to `dispatch` (`:241` skips the reuse checks). `fetchPanelPage` has no `condition` (`panelThunks.ts:330`), and `.pending` sets the entry's loading state synchronously inside `dispatch` (`panelsSlice.ts:352+`).
  (d) `setQueued(false)` is called after that `dispatch` returns. Any render that applies it reads the live store through useSelector, so it sees `isLoadingMore=true`.
  The invariant holds as long as the clear stays strictly after the dispatch call. Batching across lanes (uSES SyncLane vs the passive-effect DefaultLane for `setQueued`) can only reorder in the safe direction.
- **Queue over Feedback (D1).** Justified. Feedback already half-exists (the slot is seen-at-start and the button goes busy), so a Feedback fix cannot be falsified by request count. Queue can be, and its cost is bounded at one request per mid-load panel. No new product call: the ticket delegates the choice.
- **"Desktop" reading.** Defensible. `mobile-dashboard-pull-refresh` "Desktop has no button" (spec line 78) and "Desktop unchanged" (line 52) forbid the control above 768px. The phone shell is a container-width boundary (`MobilePanelStack.tsx:1-2`), so a mouse/non-touch desktop window at 375px gets it. The ticket title and both cited sites are the "Refresh dashboard" path only.
- **Existing specs stay green, by reasoning.** `hel1681-refresh-control.spec.ts:84-90` waits for `inFlight.size === 0` before pressing (HEL-1731), so its rounds meet nothing in flight and keep the 1x counts. `hel1656-pull-to-refresh.spec.ts:61` waits only on spinners and then expects exactly +3 (`:216`, `:223`). With the queue, a pull that lands during a first load also yields +3, so the change makes it more robust. `panel-manual-refresh` "At most one fetch ... in flight" is preserved: the queued request is sequential, not concurrent.
- **Lane overlap.** HEL-1746: its branch diff and working tree touch only `features/ask`, `shared/motion/BottomSheet`, `shared/ui/Modal.tsx`, schemas and fixtures. Nothing under `features/panels`, no `usePanelData`, `MobilePanelStack` or `pullRefreshRegistry`. HEL-1752: `OutputEditorSheet.css` plus a new e2e only. No overlap.

### Verdict: REFUTE

### Change Requests

1. **The spec delta contradicts the requirements it changes. Use MODIFIED, not ADDED.** Two existing requirements say the round calls each panel's refresh "exactly once, **subject to that panel's in-flight guard**":
   - `openspec/specs/mobile-dashboard-pull-refresh/spec.md:35` ("A qualifying release refreshes each output-bound panel once")
   - `:60` ("A visible refresh control is a single-pointer alternative to the pull")

   `specs/mobile-dashboard-pull-refresh/spec.md` only ADDs a new requirement that queues past that guard. After archive, the capability would hold two contradictory SHALLs. The proposal already lists this under "Modified Capabilities". Rewrite the delta as `## MODIFIED Requirements`, restating both requirements in full with the in-flight clause replaced by the queue rule. Keep their existing scenarios and add the new ones.
2. **The e2e plan does not prove the busy cue spans the gap, which is the user-visible half of the fix.** D5 releases the gate and then polls the total to 2x. Nothing holds the *queued* requests, so "button busy until the queued requests settle" cannot be observed. In a real browser, D3's ordering is only proven by the e2e; jest's `act()` flushes differently. Specify:
   - (a) After the first release, hold the queued requests on a second gate.
   - (b) Wait on a real signal that the first loads completed, for example a response-finished count equal to N, not a skeleton or spinner selector.
   - (c) Assert at that point that the button is still `aria-disabled="true"` and the status region has not said "Refreshed".
   - (d) Release, then wait for "Refreshed".
   - (e) After "Refreshed", assert the total is still exactly 2xN. `expect.poll(...).toBe(2N)` alone passes the instant it reaches 2N and cannot catch a third request.
   - Also say how the non-touch desktop context presses. `tap()` and `touchscreen.tap` need `hasTouch`, so it must use click, coordinate `mouse.click` and Enter.
3. **D2's drain/drop points must be enumerated against the actual sites, and the `queued` clear must be specified.** "Every point where `inFlightRef` becomes false because a request settled" is ambiguous. `inFlightRef` goes false at five sites: `usePanelData.ts:167` (immediate-settled `subscribeWait`), `:177` (subscribed settle), `:209` (no-key branch), `:258` (`isReusable` early return) and `:320` (`.finally`). State drain or drop for each. `:258` is unaddressed. A `queued=true` that is never drained or dropped leaves `isRefreshing` stuck true, so every later round waits out `PULL_REFRESH_TIMEOUT_MS`.
   - Say how the effect knows to clear `queued`: clear it after any `dispatch` in the effect while `queuedRef` is clear and `queued` is true. Clear it at all non-dispatch exits only via the drop rule.
   - Say that `queueRefresh` in the not-in-flight case also leaves `queued` false.
   - Add a unit test for the stuck-queued case: queue, then the binding is lost or the result is reusable, and `isRefreshing` returns to false.

### Non-blocking notes

- The type is `PanelDataResult` (`usePanelData.ts:26`), not `UsePanelDataResult` (design D2, tasks 1.1). The early `!currentFetchKey` return (`:335-349`) must also carry `queueRefresh`.
- `.catch`'s CROSS_FILTER_EQ_REJECTED retry (`:297-311`) runs while `.finally` clears `inFlightRef`, so a drain there could overlap the retry. This guard gap already exists, and on the phone stack (no explicit ops) it is reachable only with a replayed `eq`. Note it in Risks or drain after the retry.
- The e2e fixture should have no insight-kind Output. If it has one, "held count == output panel count" and "2x" need to exclude it: its first rows request is made (HEL-1744 D7) but its round entry calls `insightChrome.refetch`.
- Update the registry comment at `pullRefreshRegistry.ts:104` ("its refresh() below is a no-op") and the file header (`:1-4`), as task 2.2 says.
