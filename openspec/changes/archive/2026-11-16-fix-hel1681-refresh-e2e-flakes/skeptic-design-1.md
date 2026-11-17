## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 1d2fa5ab1c8a7e84a7e662a6181a893c52d6236d (change dir untracked).

### What I verified (with evidence)

- **Line numbers re-located correctly.** The design cites main after HEL-1723, and its numbers match the live
  `e2e/hel1681-refresh-control.spec.ts`: `openDashboard` :50-74 (waits at :68/:69), Full-motion test :289 with the bare
  `.mobile-panel-stack__item` `.first().boundingBox()!` read at :308, 1280 test :325 with the count-0 check at :332
  before `waitForPanelGrid` at :333, the shift test :244 (`querySelectorAll(...).length >= 3` at :255), and the
  refresh-button tests at :129 (poll at :155) and :164 (busy assertion at :175).
- **Root cause for D1/D2 is real, and worse than stated.** `MobilePanelStackSkeleton.tsx` renders its own
  `.mobile-panel-stack` with `.mobile-panel-stack__item--metric` stubs. So `.first()` at :308 can be a stub (null box,
  which is the CI TypeError), and the `.mobile-panel-stack` count-1 wait at :68 can be satisfied by the skeleton alone.
  The stubs never carry `--output`, so the design's "output count is a real-content anchor" holds. Replacing both waits
  with `waitForPanelStack(page, 4)` is sound. Markdown renders as a `.mobile-panel-stack__item--markdown` (spec :282),
  so 4 = 3 output + 1 markdown is plausible, and D1 requires a live check of that count anyway.
- **D3 vacuity is real.** `PanelList.tsx` keeps `.panel-list__zoom-container` mounted for the whole life of
  `PanelList` (the comment at ~:408-435, element at :434). So the :331 anchor is NOT a content anchor, and the :332
  count-0 check runs before anything mounts. Moving it after `waitForPanelGrid(page, 3)` with a stack-forcing mutation
  is a valid way to show it can fail.
- **`waitForPanelStack` / `LIVE_STACK_ITEMS` exist** in `e2e/support/panelGridReady.ts` (:41-61), with the documented
  two-step order.
- **The D4 registry model matches the code.** In `pullRefreshRegistry.ts`, `start()` returns false when a round is
  running or there are no entries (:101). Unregister removes the panel from the round and settles (:82). In-flight
  panels are seeded `seen` (:105). `refresh()` is a no-op while in flight (`usePanelData.ts` :131). The button renders
  `aria-disabled` from a `useSyncExternalStore` busy flag (`DashboardRefreshLine.tsx`). Candidates (a)-(c) are real
  orderings this code allows, and none is assumed.
- **The driver's axios hypothesis has a real code path.** `frontend/node_modules/axios` is 1.21.1, and
  `lib/adapters/xhr.js:23` / `lib/helpers/cookies.js:61` read `window.cookieStore`. That makes it plausible, not
  confirmed. The design correctly treats it as a candidate that may widen a race, not as the root cause.
- **No placeholders or contradictions.** Proposal, design and tasks agree. Every ticket scope item and AC, plus the
  driver's :128 and red-first additions, maps to a task: 2.1-2.5 and 3.1. `skip_specs` is justified because this is
  test-only and no contract changes.

### Verdict: CONFIRM

### Non-blocking notes

- **D4 has no stated fallback if the CI symptom cannot be reproduced.** CI e2e is `retries: 0` with
  `trace: retain-on-failure`. I did not confirm that the main `ci.yml` e2e job uploads those traces: I only saw a report
  upload in `e2e-slow.yml`. If neither the traces nor a forced local ordering reproduce "0 requests" or
  "aria-disabled never true", the outcome must be an ESCALATION or a recorded not-reproduced finding, never a
  speculative wait. Task 2.4's "or ESCALATION" covers this; say it explicitly in `root-cause.md`.
- **What the :128 symptom implies.** "0 requests" points at `start()` never fanning out (for example the
  button/entries remounting, or the click landing on a detached node) more than at a slow XHR. `page.on("request")`
  fires before routing or the axios delay could matter, unless the delay exceeds 5 s. Make the probe log the `start()`
  return value and the `register`/`unregister` timeline first.
- **D5 sweep, two specific hits.** The :244 shift-test sampler (:254-255) can count skeleton stubs. While both layers
  are mounted, `querySelector(".mobile-panel-stack")` may pick the skeleton stack, which can give two distinct tops.
  That is the same race class, and AC1's wording arguably reaches it, so give it an explicit FIX or SAFE verdict with a
  reason. After D1 the strict-mode `.mobile-panel-stack` locator at :118 is safe, and so are :359/:364, which follow a
  positive grid anchor. Record them as such.
- **D3 wording.** The phrase "green against the pre-fix ordering only where that demonstrates vacuity" means: run the
  same mutation on the old order (green, which proves vacuity) and on the new order (red). Record both transcripts.
