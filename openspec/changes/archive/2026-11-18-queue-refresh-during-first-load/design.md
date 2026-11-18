## Context

See proposal.md (Why). Ground truth on main f2358c16d:

- `usePanelData.refresh()` (`frontend/src/features/panels/hooks/usePanelData.ts`) returns at once when `inFlightRef` is
  true. `inFlightRef` is set by the first-load dispatch, by `refresh()`, and while waiting on an owned request
  (`subscribeWait`); it clears in the dispatch's `.finally`, in `subscribeWait`'s settle, and on binding loss.
- `isRefreshing` is `paginationEntry.isLoadingMore` (true from `fetchPanelPage.pending`, including a first load).
- `PullRefreshRegistry.start` (`ui/grid/pullRefreshRegistry.ts`) builds a round whose slot for an in-flight panel starts
  `seen: true`, calls every entry's `refresh()`, and ends the round when every slot saw `isRefreshing` go true then
  false (`setRefreshing`), on unregister, or after `PULL_REFRESH_TIMEOUT_MS`.
- Only `MobilePanelStack` registers panels (`usePullRefreshRegistration`), passing `panelData.refresh` (or an insight
  panel's `insightChrome.refetch`, HEL-1744) and `panelData.isRefreshing`. The button renders only in the phone shell.

So today a press during a first load starts a round that only mirrors the load the user did not cause, sends nothing,
and ends when that load lands.

## Goals / Non-Goals

**Goals:** a round (button or pull) that meets an in-flight panel sends exactly one refresh for it after the load
settles, stays busy until then, and never multiplies requests.

**Non-Goals:** cancelling the in-flight load; any change to the per-panel Refresh control, interval polling or the SSE
run fan-out (they keep dropping a call while in flight, `panel-manual-refresh` spec unchanged); insight panels'
stored-render refetch; any control above 768px.

## Decisions

### D1. Queue, not Feedback

Feedback is already half there: `start()` turns the button busy for an in-flight panel and holds it until the load
lands. What the user lacks is the thing the press means: rows fetched after the press. A Feedback-only fix would make
the existing mirror more visible and still fetch nothing, and it is not falsifiable by request count, so an e2e that
"fails first" would rest on timing of a cue. Queue gives the press its own request, keeps the existing cue honest (it
now tracks a request the press caused) and is measured by counting rows GETs. The cost is one extra request per panel
that was mid-load, bounded at one by D2/D4.

### D2. The queue lives in `usePanelData`, as a separate opt-in member

Add `queueRefresh: () => void` to `PanelDataResult` (`usePanelData.ts:26`) next to `refresh`, and to the early
no-key return too. Not an options argument on `refresh`: `refresh` is passed straight to `onClick`-style props
(`PanelCard.tsx`, `MobilePanelStack.tsx`), where an argument would receive the click event.

- Not in flight: `queueRefresh()` behaves exactly like `refresh()`; `queued` stays false.
- In flight: set a synchronous `queuedRef = true` (repeat calls are no-ops, so the queue holds at most one) and set a
  `queued` React state to true. No request is sent.
- `drain()` = if `queuedRef` is set and the hook is mounted: clear `queuedRef` and run the `refresh()` body synchronously
  (so `inFlightRef` is true again before any other caller can enter). `queued` state is NOT touched by `drain()`.
- `drop()` = clear `queuedRef` and set `queued` false, no request.
- Every site on main where `inFlightRef` becomes false, and what it does:
  - `:167` `subscribeWait`, entry already settled: no drain (cycle 2: it runs synchronously on mount, before any `queueRefresh()` can exist; a drain there is unreachable and was deleted).
  - `:177` `subscribeWait`, store listener settle: `drain()`.
  - `:209` effect no-key branch (binding lost, or an insight Output): `drop()`.
  - `:258` effect `isReusable` early return (a non-refresh re-run, e.g. a key change mid-flight): no drain (cycle 2: `isReusable` needs a settled entry, so any queue exists behind an in-flight request whose own `.finally` still drains it; the drain was redundant and untestable, and was deleted).
  - `:320` dispatch `.finally`: `drain()`, except when the `.catch` CROSS_FILTER_EQ_REJECTED branch dispatched its retry:
    then the drain moves to that retry's own settlement (`.finally` on the retry dispatch), so the queued request never
    overlaps the retry.
  - `.finally` when the panel's latest request is not this one (cycle 3, evaluation-2.md CR1):
    - the latest is this hook's own newer request (an Output rebind): no drain here; that request's `.finally` drains.
    - the latest is a request this hook did not send (a sort/filter refetch via `usePanelSortFilter`, a load-more page, a second `usePanelData` instance such as the detail modal's): that request has no `.finally` of ours, so hand the queue to it. If the entry is still `isLoadingMore`, wait with `subscribeWait` (no `waitedId`, so the foreign request's error is not surfaced as this hook's) and drain at its listener settle; if it already settled, drain at once. Never drain over a pending newer request.
  - Unmount (a cleanup effect): `drop()` (sets a mounted ref false first, so a late `.finally` cannot drain).
- Clearing `queued`: in the effect, immediately after any `dispatch(fetchPanelPage(...))` call, if `queuedRef` is clear
  and `queued` is true, set `queued` false. No other exit clears it except `drop()`.

Alternative rejected: queueing inside `refresh()` for every caller. That changes poll and SSE semantics
(`panel-manual-refresh` "At most one fetch... no second fetch is dispatched") for no user benefit.

### D3. `isRefreshing` covers the queued gap, with no false in between

`isRefreshing = (paginationEntry?.isLoadingMore ?? false) || queued`. `queued` is cleared in the effect immediately
after the queued refresh's `dispatch(fetchPanelPage(...))` call (whose `pending` sets `isLoadingMore` true in the same
synchronous block), never at drain time: clearing it at drain would render one frame with both false, the registry
would mark the slot done and the round would end before the queued request. The invariant is: from the moment
`queueRefresh()` queues until the queued request settles, every `isRefreshing` value the hook reports is true. A unit
test records every value passed to the registry and asserts it.

### D4. The registry keeps its round logic; the stack registers `queueRefresh`

`MobilePanelStack` passes `insightChrome ? insightChrome.refetch : panelData.queueRefresh` to
`usePullRefreshRegistration`. With D3 the existing slot logic already spans load plus queued refresh (`seen` from the
start, `done` only on the final true to false). `start()`'s "busy round ignores a second activation" rule is unchanged,
which with D2's single-slot queue keeps repeated presses at one extra request per panel. Only the registry's comments
change (file header `:1-4` and `:104` "its refresh() below is a no-op" become "queues one refresh"). Pull and button both go through `start()`, so
both queue; the spec delta names the round, not the button.

### D5. Verification

- e2e `e2e/hel1738-refresh-during-first-load.spec.ts`. Fixture: `seedWorld` (no insight-kind Output; the spec asserts
  the output-card count N before counting) plus one markdown panel. `page.route(ROWS)` is registered before `goto` and
  holds every rows GET on gate A; once A is released, later rows GETs are held on gate B. No sleeps, no skeleton or
  spinner selectors. Steps:
  1. Readiness: held-on-A count equals N (real network signal) and the "Refresh dashboard" button is visible by role.
  2. Press three times (phone: `tap()`, a `touchscreen.tap` at the button centre, Enter; desktop-browser context:
     `click()`, a `mouse.click` at the centre, Enter). Assert the rows GET total is still N.
  3. Release A. Wait until N rows responses have finished (`requestfinished` count, a real signal).
  4. Assert the button is still `aria-disabled="true"` and the status region has not said "Refreshed" (a
     MutationObserver log as in hel1681), and the held-on-B count reaches exactly N, never two concurrent per Output.
  5. Release B, wait for status "Refreshed" and the button to leave `aria-disabled`; then assert the total is exactly 2N
     (an equality read after the round ended, not a poll that passes at the first 2N), no pipeline-run POST, and the
     status log is exactly ["Refreshing", "Refreshed"].
  Contexts: 375 and 430 (`isMobile`, `hasTouch`), and a non-touch desktop-browser context at 375; each in light and dark
  (`helio-theme`), with screenshots of the busy and settled states via `evidencePath("HEL-1738", ...)`. At 1280: no
  button. Fails on main (step 4 sees 0 held on B, and the round ends at step 3). Mutation recorded: register
  `panelData.refresh` again in `MobilePanelStack`, spec goes red; and clear `queued` at drain time, spec goes red at
  step 4 (or the unit test does, if the browser hides it; say which).
- jest `usePanelData`: queue in flight sends nothing; three calls coalesce to one; drain after `.finally`, after both
  `subscribeWait` settles and at the `isReusable` return; every `isRefreshing` value from queue to the queued request's
  settle is true (records each value); `drop` on unmount and on binding loss returns `isRefreshing` to false (the
  stuck-queued case); `queueRefresh` with nothing in flight leaves `queued` false; plain `refresh()` still a no-op in
  flight. `pullRefreshRegistry`: a round spans an entry that stays refreshing through a queued refresh.
- `e2e/hel1681-refresh-control.spec.ts` and `e2e/hel1656-pull-to-refresh.spec.ts` run in full and stay green.

## Risks / Trade-offs

- [A render ordering produces a false gap] → D3 invariant plus its unit test; the registry timeout still bounds a
  stuck round at 15 s.
- [Queued request after unmount] → drain checks a mounted ref; unmount clears the queue.
- [CROSS_FILTER_EQ_REJECTED retry overlaps a drain] → D2 moves the drain to the retry's settlement.
- [Extra request per mid-load panel] → bounded at one per round, only for panels actually in flight.
- [Concurrent lanes] HEL-1746 / HEL-1752 → executor rebases onto origin/main before delivery and re-checks
  `usePanelData.ts`/`MobilePanelStack.tsx` for overlap.

## Planner Notes

- Self-approved: Queue (the ticket delegates the choice). Desktop reading of the AC per ticket.md orchestrator notes.
- Owner-ruled scope only; no new product call made.
