## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD fd370e5e5abbfa3451133c8a2db97edc22970be8 (planning artifacts are untracked in the change dir).

### What I verified (with evidence)

**D1 (hel1578:111, hydration overwrites a mid-hydration navigation): CONFIRMED by the traces and the code.**
- Code: `frontend/src/features/dashboards/tabs/hydrateTabs.ts` builds `plan` at the start from
  `deepLinkDashboardId(window.location.pathname)` and the current `selectedDashboardId`. It awaits
  `refreshChangeSignals` plus the warm restore (raced against `HYDRATE_RESTORE_TIMEOUT_MS`), then
  unconditionally dispatches `setSelectedDashboardId(plan.target)` and `tabsHydrated({activeId: plan.target})`.
  `DashboardRoute.tsx` dispatches `setSelectedDashboardId(id)` only when `id` or `known` changes, so it does not
  re-assert A after hydration. The selection-to-tab listener in `dashboardTabsListeners.ts` is gated on `hydrated`,
  so A is never opened as a tab. `App.tsx` defers `showDashboardPanels` until `hydrated`.
- Trace r44141488503 (1-trace): the click on the Dot A card spans 17:57:54.961 to 54.994 (mapped from monotonic
  time via the `context-options` wallTime). `GET /api/dashboard-changes?ids=A,B` started at 54.827 and took 252 ms,
  so it answered at about 55.079, after the click. The only panels fetch that follows is for `c94d7f87` (B) at
  55.292. The error-context shows `tab "Dot B" [selected]` and `tab "Dot A, changed since you last viewed"`.
- Trace r44184688504: the click is at 22:00:35.616. dashboard-changes started at 35.523 and took 232 ms, so it
  answered at about 35.755. The panels fetch at 35.947 is for B again. Error-context: `button "Dot B" [pressed]`.
  The two failures are identical, as claimed.
- Forcing feasibility: the Home card's "changed" name comes from `homeSummary.dashboardChanges`
  (`useChangedDashboardIds.ts`), not from `/api/dashboard-changes`. Gating dashboard-changes therefore does not
  deadlock the spec's pre-click `toHaveAccessibleName` assertions, and the proposed red is sound.
- Fix safety: if the re-planned target is A, A's warm copy is still validated against the signal. A is in
  `plan.tabs`, so its signal is fetched. `isContentValid` returns false when there is no signal, so a stale copy
  cannot be shown. The tests in tasks 1.1 and 1.3 (red first, plus the no-navigation path) cover the spec delta's
  two scenarios.

**D2 (hel813:93, the `load` event blocked by Google Fonts): the evidence is CONFIRMED, but the plan is internally
inconsistent (see CR1).**
- Trace r44048058244 hel813 (1-trace.network): 912 entries. Exactly one has no response:
  `https://fonts.googleapis.com/css2?family=Fraunces...` with status -1. The only other non-2xx entry is the expected
  401 from `/api/auth/me`. The goto in `uiLogin` (`isolateLivePage.ts:30`) failed with `waiting until "load"`.
- `frontend/app.html:47-55` loads that stylesheet with `media="print"` plus `onload`. A stylesheet whose media does
  not match is still fetched and still delays the window `load` event. The mechanism holds.

**D3 (phone-sheet:184): the trace reading is CONFIRMED and the probe plan is sound.** The `Step editor` dialog
expect resolved at 414653. The `N fields` tap call ran from 414667 to 414782 and ended with "tap action done". The
locator resolved while `aria-expanded="false"`, and the `Output schema` expect timed out at 419794.
`usePortalPopover.ts` has an opt-in `focusout` close path (lines 95-108), so hypothesis (a) is plausible. The
fallback test fix waits on `getAnimations()` finished promises, which is a state wait and not a sleep. That is
within the ACs.

**D4 (schema-panel-copy:172): the symptoms are CONFIRMED and the probe plan is sound.** The COMPACT-TONES stdout in
r44184688504 shows the light iteration with select `rgba(0, 0, 0, 0)`, menuImage `none`, menuColor
`rgb(244, 242, 237)` and menuOpacity `0`. The earlier dark iteration in the same run passed. The spec waits on
`getAnimations()` before it reads, so a transition that starts after that wait fits the 0.997824 reading. The plan
calls for a probe first, has an AC4 fallback, and gives a Popover stop-and-report rule. That is appropriate.

**AC compliance:** no retries, sleeps or longer timeouts are proposed. A red-first step exists for each spec, and
40/40 at `--workers=2` is required (D5, task 3.4). Scope stays within the ACs. The spec delta covers the one behavior
change.

### Verdict: REFUTE

### Change Requests

1. **D2 / task 3.1 / D5 step 3 contradict each other. Pin down the forcing, and stop overclaiming coverage.**
   - D2 says to stall `**/fonts.googleapis.com/**` "to a handler that never fulfils" and then to go green with the
     fix "under the same stall". The fix only changes `uiLogin`, and D2's Non-goals exclude other `goto`s.
   - hel813 surface 1 then runs its own `page.goto("/dashboards")` (`e2e/hel813-mobile-touch-target-floor.spec.ts:104`)
     with the default `waitUntil: "load"`. That is a new document, so it makes a new fonts request. Under a permanent
     stall it hangs exactly the same way, and "green under the same stall" cannot be reached without breaking the
     non-goal.
   - Revise D2 and task 3.1 to choose one of these and state it:
     - (a) Force a stall on the first fonts request in the context only. This matches the trace, where 1 of 912
       requests went unanswered. Green means the login path tolerates it. Say explicitly that a stall that persists
       past login still fails at the spec's next `goto`, and name that as residual risk, a follow-up, and a named
       candidate.
     - (b) Widen the fix to a fixture-level treatment of the fonts origin, for example a route that fulfils fast.
       Record the font-metrics consequence for measurement and screenshot specs such as hel813.
   - Also correct the sentence "This covers every spec that logs in through the helper". It only removes the
     dependency from the login navigation itself.

### Non-blocking notes

- D1's "re-read the deep link ... and/or compare the current `selectedDashboardId`" allows two implementations with
  different edge behavior. The planner's own guidance is "re-run `planHydration` with the fresh inputs", so prefer
  the location re-read. A compare on the selection alone would also count a non-user selection write as a
  navigation. Decide which one in task 1.2 so the jest test asserts the chosen signal.
- D1's e2e gate can stay in the committed spec as a deterministic regression test, which is better than a scratch
  copy. Either way, the jest test is what satisfies AC3's failing-first requirement.
- D5's command `npx playwright test ...` should pass the run's pinned `DEV_PORT`/`BACKEND_PORT`.
  `playwright.config.ts:15-17` warns and falls back to 5173 when `DEV_PORT` is unset, which can measure another
  lane's server (CON-165).
- D2: the executor already plans to confirm whether `waitForURL("/home")`'s default `load` wait also blocks after a
  same-document navigation. Keep that check, because if it does, both calls need the change.
