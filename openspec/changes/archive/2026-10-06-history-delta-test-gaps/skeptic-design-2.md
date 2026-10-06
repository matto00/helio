## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD f4601ba2ee9300f7ecb2775a56559f234c966431. The worktree is clean apart from the untracked change dir. This review was read-only. No Jest,
Playwright or servers were needed, because every claim was checkable statically.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/history-delta-test-gaps/HEL-1327`.
- **Scope:** ticket.md restates the scope as items 2-4 only (owner ruling). Each AC maps to a design decision and tasks: AC2 to D1 / 2.1-2.2, AC3 to D2 / 2.3-2.4,
  AC4 to D3 / 2.5-2.6. C1 excludes OutputHistoryService, the schemas and PublicDashboardRoutes. There are no placeholders and no TBDs.
  The design and the tasks agree with each other.
- **Round-1 CRs, re-derived from code rather than taken from the prior report:**
  - CR1 (panel-id argument): `useOutputHistory.ts` fetcher calls
    `fetchPublicOutputHistory(publicDashboardId, panelId, publicToken ?? "")`. D1 now asserts `("dash-1","panel-1","tok")`,
    requires `panel.id` to differ from `outputId`, and forbids `expect.any(String)`. This is correct and discriminating.
  - CR2 (cache reset): `outputHistoryCache.ts:95 resetHistoryCache` and `metricComparisonStore.ts:61 resetComparisonStore`
    both exist. D1 now names both, plus `mockReset`. That closes the test-order dependency on `publicHistoryKey("dash-1","panel-1")`.
  - CR3 (D3 mutation site): `PanelList.tsx:76` `useContainerWidth({ initialWidth: panelGridConfig.initialWidth })` produces
    `gridContainerWidth`, which is passed as `width` at `:406` and `:417`. `grid/PanelGrid.tsx:33` receives it as a prop. D3 now names
    this site and defines the freeze as pinning to the first ResizeObserver-measured value, not 1280. This is resolved.
- **D1 wiring and mutation:** the `PublicDashboardViewerPage.tsx:79-82` memo is passed at `:134`. `PanelContent.tsx:314` passes it
  to `MetricOutputPanel`. `MetricOutputPanel.tsx:46-53` calls `useOutputHistory(..., historySource, true, configCompare(config))`, so the fetch
  is ungated apart from the cache. Deleting `:134` makes `source` undefined, so the authenticated route is taken
  (`fetchOutputHistory(outputId)`) and the public one is never called. The mutation removes real product behaviour, and both new call
  assertions flip. `frontend/tsconfig*.json` has no `noUnusedLocals`, so the mutation compiles and the red comes from the assertions.
  The harness in `PublicDashboardViewerPage.content.test.tsx` (module-mocked `publicDashboardService`, MemoryRouter, real
  store, optional preloaded auth) supports both the anonymous and the owner cases as designed.
- **D2 target link:** `.getByRole("link", {name: "Dashboards"}).first()` at spec `:273`. The breadcrumb in `CommandBar.tsx:139-164`
  is all `<span>`s, and the logo link is named "Helio home". The first "Dashboards" link at 1440px is therefore the `Sidebar.tsx:35` `NavLink`, which is rendered
  from `sections.ts` (`path: "/"`, `end: true`). A `reloadDocument` mutation there actually affects the clicked element. The new window
  sentinel is lost on any document replacement, so the test goes red. The existing text assertions stay green, because a fresh load of `/` with one dashboard reselects it
  and the server compare is already `1d`. The step is therefore vacuous today, as claimed.
- **D3 geometry:** `.app-sidebar` is `width: 240px` (`App.css:282`), the breakpoints key off container width (`panelGridConfig.ts`), and
  `containerPadding` is `[0,0]`. Viewport 1440 gives a container of about 1200, and viewport 1100 gives about 860, so the card's px width differs on real code. The
  first loop pass (viewport already 1440, spec `:78`) skips the change-poll as designed. Under the freeze mutation the card width never changes:
  the new poll is red, and the old `layoutSettled` (`:52-64`, four identical reads) passes vacuously. D3 requires both to be recorded.
- **D4:** `e2e/support/isolateLivePage.ts` is exactly `page.goto("about:blank")`, so it is equivalent to spec `:83`.

### Verdict: CONFIRM

All three designs are now precise and correct against the code. Each mutation removes product behaviour, and each new assertion is
red under its mutation and plausibly green on real code. Execution will show the green.

### Non-blocking notes

- D1: in the mutation case, the "delta derived only from the PUBLIC response" assertion only discriminates if the `fetchOutputHistory` stub returns
  a different payload, or none. The call assertions are already the discriminator, so this is optional hardening.
- D1: `MetricOutputPanel` shows the server headline and delta only when `selectMetricHistoryView` accepts the history for the current
  config. The fixture's mocked public history must match the output meta's metric config, or the delta assertion will be red on real code
  for the wrong reason. D1 already tells the executor to verify the gating inputs.
- D2: the main-frame filter should compare `req.frame() === page.mainFrame()`. Also note in the evidence which hops reloaded under the
  mutation (a Sidebar-wide `reloadDocument` also hits "Data Pipelines").
- D3: under the freeze mutation, the first measured width must come from the real 1440 container, not a transient value. If a transient 0 or a skeleton
  width is observed first, record that in the evidence, so that the old-wait-green result stays like-for-like.
