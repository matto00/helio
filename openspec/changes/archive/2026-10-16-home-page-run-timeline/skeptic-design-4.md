## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD 60086f02bb5b1ee48f2246bc09e3e66349199585. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/home-page-run-timeline/HEL-1578`.
- **Owner answers:** re-read from `.concertino/runs/HEL-1578/events.jsonl`. The answers are home-at-home,
  four-changed-first, top-8-failures-pinned, stuck-or-missed, keep-24h and build-now-wire-after-1575.
  - The `four-changed-first` option text says "1 column at 375 ... 'All N ->' goes to the dashboard view".
  - HEL-1575 `data-or-edit` reads "since you last had that tab open ... Home, HEL-1578, will reuse the same rule".

**Round-3 required revisions:**

1. **Owner filter and RLS proof: resolved.**
   - D3 adds `pipelines.owner_id = caller` to queries (1) and (2), with C4 recorded.
   - The RLS proof uses raw selects with no owner predicate in a non-bypassing session. That session first asserts
     `rolbypassrls`/`rolsuper` false, and `withSystemContext` is the positive control. A separate test on a bypassing
     connection must fail when the filter is removed.
   - The precedent exists: `TwoUserRlsApiFixture.scala:85-91` creates `helio_app_test NOSUPERUSER NOBYPASSRLS`.
   - The `pipeline_runs` policy (V35:77-84) is owner-only through `EXISTS pipelines.owner_id`. Tasks 3.1 and 1.6 match.
2. **Shelf at 375px is one column: resolved.** D7 says "375 shelf one column (owner answer `four-changed-first`)", and
   task 3.4 requires it.

**Folded-in items:**

- **`inFlight`:** in the spec (attention requirement, "Every item SHALL carry `inFlight`"). Query (1) includes
  queued/running runs regardless of the window, so it can be computed server-side. The "also when that pipeline is not
  among the timeline's rows" scenario covers the round-3 gap. OK.
- **Three retention call sites:** D4 lists `PipelineRunExecutor:172`, `PipelineRunService:245` and
  `SparkJobSubmitter:72`. Grep confirms exactly these three, and all go through `deleteOldRunsInternal`
  (`PipelineRunRepository.scala:483`). OK.
- **`selectTabHasChanged` extraction:** `dashboardTabsSelectors.ts:8-22` (HEL-1575) is a pure comparison behind an
  `activeId` short-circuit, so extracting it is feasible. OK.
- **Home accessible name, no `<h1>`:** D7 names the `<main>` region "Home". See note 1: `<main>` belongs to `App.tsx:243`.
- **Proposal non-goal:** now reads "any server-side visit store (view/own-write stamps are a small keyed client store
  ...)". OK.
- **Restore-stamp risk:** listed in Risks. It is understated; see CR1.
- **Stale "phone own-save gap" bullet:** removed. OK.
- **Migrations:** this branch ends at V134, and HEL-1579 holds V135, so V136 is free today.

**New finding, checked against code (CR1):**

- **HEL-1575's leave stamp.** `dashboardTabsListeners.ts:99-104` handles any `activeId` change. When the previous active
  tab `left` is still in the tab set, it dispatches `tabViewed({id: left, at: serverNowIso()})`.
  - The selection listener at lines 77-84 maps a selection change to `activateTab` when the new dashboard already has a
    tab, and only to `replaceActiveTab` (which drops `left`) when it does not.
- **How a shelf click reaches it.** `DashboardRoute.tsx` sets the selection in a `useEffect` (`if (known)
  dispatch(setSelectedDashboardId(id))`) and renders `<PanelList />` as a child.
- **The resulting sequence:**
  1. A user with saved tabs [Y, X], active Y, signs in. Home is now the default landing, so Y is restored as active but
     never displayed.
  2. On Home, Y's card shows the dot.
  3. The user opens X from the shelf, which triggers `activateTab(X)`, which stamps Y's `tab.lastViewedAt = now`.
  4. Back on Home, Y's dot is gone, although Y was never opened.
- **Phase A has the same failure.** React runs a child's effects before its parent's. A literal "on mount with a
  selected dashboard" stamp in `PanelList` therefore runs before `DashboardRoute`'s effect and stamps the stale
  selection Y, not X.
- **What this contradicts.** The home-page spec requires the dot to "clear once the user opens that dashboard", and the
  view stamp to be written "only when the dashboard view ... shows that dashboard ... never by a selection made off the
  dashboard view".
- **What the plan says instead.** The Risks entry calls the HEL-1575 effect "once per user". This path recurs every
  session that lands on Home with more than one tab.
- **Coverage.** No task tests it: 1.9a covers only arriving on the already-selected dashboard.

### Verdict: REFUTE

### Change Requests

1. **Resolve the "last view" contradiction on the main Home flow: open a different dashboard from the shelf, then
   return.** Edit D5, the home-page shelf requirement, and tasks 1.9a, 2.2 and 3.3.

   - **(a) Phase A stamp target.**
     - Specify that `viewedAt` is written only for the dashboard actually displayed. On `/dashboards/:id` that is the
       route id, after the route's selection has been applied, never the pre-route selection.
     - Specify what a shelf card navigates to (`/dashboards/:id`, or select-then-`/dashboards`).
     - Add a test: Y is selected and changed, the user opens X from the shelf, then returns to Home. Y still shows the
       dot.
   - **(b) Phase B `tab.lastViewedAt`.** HEL-1575 stamps a tab when it is *left*, whether or not it was displayed in
     this session. Choose one of the following and record it:
     - drop `tab.lastViewedAt` from `lastSeen`, and use only `seen.viewedAt`. This loses cross-device view sync, so
       state that.
     - keep HEL-1575's semantics deliberately: reword the spec's "never by a selection made off the dashboard view" to
       match, and rewrite the Risks entry to say the effect recurs. Do not call it "once per user". List it in the PR
       for the owner to confirm, since it hides real changes on the default landing page.

     Either way, make the task 3.3 e2e cover the multi-tab "open X from Home, return" path.

### Non-blocking notes

1. **The `<main>` landmark is the shell's** (`App.tsx:243`, `<main className="app-content" id="app-main-content">`).
   Naming it "Home" means a route-conditional `aria-label` in `App.tsx`, which C2 wants to keep small. Alternatively,
   Home can label an inner `<section>`/region. Say which.
2. **The scoping requirement overstates `pipelines` RLS.** It says the policies on `pipelines`, `pipeline_runs` and
   `pipeline_schedules` "independently enforce the same scoping". `pipelines_select` (V39:79-81,
   `helio_can_access_pipeline`) is sharing-aware, not owner-only. Drop `pipelines` from that sentence so no test tries
   to prove it.
3. **Task 1.6 role.** Task 1.6 runs EXPLAIN under "the non-bypassing role". `helio_app_test` is created by the test
   fixture and may not exist on the dev DB. Say where the measurement runs (test DB with the fixture role, or a
   `SET ROLE` on the dev DB) and how seeded rows are removed by exact id.
