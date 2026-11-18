## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD fd370e5e5abbfa3451133c8a2db97edc22970be8. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

**Round-1 CR1 (D2 forcing contradiction) is resolved.**
- D2 and task 3.1 now pick option (a). Only the FIRST fonts.googleapis.com request in the context is stalled. The
  later ones continue normally, which matches the trace (1 of 912 requests unanswered).
- Red is defined: unmodified `uiLogin` times out at `goto("/login")`. Green is defined: the same forcing with the
  fix passes.
- The residual risk is now stated plainly: a stall that persists past login, or that lands on a spec's own later
  `goto`, still fails. hel813's `goto("/dashboards")` at :104 is named. That risk is recorded as a named candidate
  and a follow-up.
- The overclaim "covers every spec that logs in through the helper" is gone. The design now says the change
  removes the fonts dependency "from the login navigation only".
- Path checked: hel813 surface 1 goes through `registerAndLogin` (`e2e/support/auth.ts:82-89`), which calls `uiLogin`
  (`e2e/support/isolateLivePage.ts:26-35`, `page.goto("/login")` with the default `load` wait). So the first fonts
  request in the context is the `/login` document's own. The first-request forcing really does land on the path
  that failed in CI.

**Round-1 non-blocking notes were taken up.**
- D1 now decides the signal: re-read the current location and re-run `planHydration`. It also states that a bare
  selection write is not a navigation.
- D5 now pins `DEV_PORT=7186 BACKEND_PORT=10093` and adds `nice -n 19`.
- The `waitForURL` default-`load` check is kept in both D2 and task 3.1.

**D1 fix still matches the code.**
- `hydrateTabs.ts` reads the deep link from `window.location.pathname` when no option is passed.
- Its only production caller (`dashboardTabsListeners.ts:52`, `hydrateTabs()`) passes no option, so re-reading the
  location after the await uses the same source.
- The Home shelf card is a `Link to={"/dashboards/" + id}` (`features/home/ui/DashboardShelf.tsx:76`), so the click
  in the failing spec really does change the location. `planHydration`'s deep-link branch already opens or
  activates the tab with `openTabActivate`, which is the "open it like a normal open does" behavior. The fix is
  implementable as designed.
- Tasks 1.1 and 1.3 test the two spec scenarios: red first, plus the no-navigation path.

**D3 and D4 are unchanged from round 1, where they were verified against the traces.** Both are probe-first, with an
AC4 fallback and a stop-and-report rule for Popover/ActionsMenu (HEL-1750).

**AC coverage.**
- AC1: a root cause from a trace (D1, D2) or a probe (D3, D4).
- AC2: forced red, then 40/40 at `--workers=2` (D5, task 3.4).
- AC3: D1 is a product fix with a failing-first jest test (1.1). Task 2.3 covers a product defect a probe might find.
- AC4: tasks 2.1, 2.2 and 3.3.
- No retries, sleeps or longer timeouts are proposed anywhere. The settle waits are `getAnimations()` finished
  promises and route gates, which are state waits.

### Verdict: CONFIRM

### Non-blocking notes

- D1, under "Fix (decided)", has a broken sentence: "...; the dashboard the user opened (and becomes the active
  tab: ...". The intent is still clear, because `planHydration` with the fresh deep link yields that dashboard as
  the target and the active tab. The executor should implement exactly that, and should not add a separate
  selection-compare path.
- The spec delta says hydration "SHALL NOT replace a dashboard the user selected or navigated to". D1 deliberately
  treats only a location change as a navigation. Every listed trigger (a Home card, the dashboard list, a URL) is
  routed, so the two agree. If the executor finds an unrouted user selection that can happen before `hydrated`, it
  should record that, not widen the fix silently.
- The warm restore during hydration is still computed for the original target (B). After a re-plan to A, B's warm
  entry may already have been applied to the store. That is harmless, because only A is displayed. A's own content
  goes through the signal validity check, so it falls back to a cold fetch when A's signal is missing. The
  executor should confirm this in the jest test rather than assume it.
