# Root cause: hel1681 :129 (Enter -> 0 rows requests) and :164 (tap -> aria-disabled never "true")

## Verdict

A TEST-SIDE race, not a product race. `openDashboard` returns while the three output panels' INITIAL rows loads are
still in flight. A panel with a request in flight ignores `refresh()` (`usePanelData.refresh`: `if (inFlightRef.current)
return`), so a button press made in that window fans out to nothing.

## Mechanism (from the code, then confirmed by the probe)

- `openDashboard` waits for `.mobile-panel-stack__item--output` x3, `seen.urls >= 3` (requests STARTED) and
  `.mobile-panel-stack__item--output .ui-spinner` count 0. The output card shows no `.ui-spinner` while its first load is
  pending, so the spinner check passes with the loads still in flight.
- `PullRefreshRegistry.start()` seeds each panel's round slot with `seen: entry.isRefreshing` (true for an in-flight panel),
  calls `refresh()` on each (a no-op for an in-flight panel: no new request), and the round ends as soon as the in-flight
  load settles. Consequences:
  - Enter (:129): all three panels in flight -> 0 new GETs -> `expect.poll(urls - before).toBe(3)` sees 0. Matches CI
    (`Expected: 3 / Received: 0`, #1133 attempt 1, key430).
  - tap (:164): the round starts, then ends the moment the in-flight loads land, so `aria-disabled="true"` is true for a
    few ms or not at all; the poll misses it. Matches CI (`aria-disabled` never `"true"`).
- Every CI occurrence is a slow initial load (CI latency) at the moment of the press; locally a load takes ~200 ms and has
  finished by then, so 32/32 local runs of the two tests were green before any forcing.

## Probe

Temporary `PROBE(...)` logging in `PullRefreshRegistry` (register / unregister / start / setRefreshing / end), reverted.
Registry timeline of a healthy local run: panels register ~1240 ms, `setRefreshing true` at 1263 (initial load), `false` by
~1490, `start(button) round=false entries=3` at ~1999, round `end` ~3039. No unregister/remount between gate exit and the press
(candidate (b) ruled out); `start()` returned true with 3 entries (candidate "start() false" ruled out).

Forced repro: delay every rows response 1500 ms before `goto` (route registered before navigation), un-delayed afterwards.
At `openDashboard` gate exit the registry log shows all three panels at `setRefreshing ... true` with no `false` yet (loads
in flight). Then Enter/tap: `reqs=0`, `start(button) round=false entries=3` then `end` 1 s later with zero new requests.

## Red first (OLD spec, forced)

- Initial rows held/delayed 800-1300 ms: keyboard test 6/6 red at each delay, `Expected: 3 / Received: 0` (CI text).
  At 150-500 ms 12/12 green (the load finishes before the gate exits: the window is real but narrow).
- :164, initial loads held and released 0 ms after the tap: red, `Expected string: "true" / Received string: ""` for
  `aria-disabled` (the CI text). Released 100 ms after: red at `expect.poll(...).toBe(3)` with `Received: 0`. Released 30 ms
  after: green (the busy cue was observed in time), so the window is timing-dependent exactly as the CI flake is.

## Fix

`openDashboard` now waits for every rows GET to finish (`requestfinished`/`requestfailed` bookkeeping in `countRequests`)
and two animation frames so the settled state has flushed, before returning. No product change. No timeout was lengthened.

## Green after (NEW spec, same forcing)

Delay 1500 ms: 39/39 green (all 13 `refresh button` tests x3). Hold-until-1500 ms: 39/39 green. Delay 800 ms: 38/39, one
`single tap` failure that did not reproduce in 16 further forced runs (see the final repeat-each result in the report).

## The axios 1.21 / cookieStore hypothesis

Not needed and not tested: the mechanism above is independent of how long a request takes, and reproduces with a route
delay. Slower XHRs on CI (any cause, including this) only widen the same window. Recorded as unverified, not as the cause.

## Env

`frontend/node_modules/axios` = 1.21.1 in this worktree (checked before measuring).
