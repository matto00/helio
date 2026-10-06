## Context

See proposal.md (Why). The facts below were verified on main at f4601ba2.

- `PublicDashboardViewerPage.tsx:79-82` builds `historySource = {variant: "public", dashboardId, token}` and passes
  it to `PanelContent` (`:134`). `PanelContent` threads it to `MetricOutputPanel` (`PanelContent.tsx:314,490`), which
  picks `fetchPublicOutputHistory` vs `fetchOutputHistory` (`features/panels/history/outputHistoryService`).
- Only `PanelContent.metricHistory.test.tsx:233` covers the public route, and it injects the prop directly. No page
  test exercises the page's own wiring. The existing page tests (`PublicDashboardViewerPage.*.test.tsx`) mock
  `../services/publicDashboardService` at module level and render through `MemoryRouter` + a real store.
- `e2e/hel1275-metric-delta-sparkline.spec.ts:260-278` performs dashboard -> "Data Pipelines" -> pipeline -> Outputs
  -> editor Save -> "Dashboards" via link clicks, with no assertion that the document was not reloaded.
- `layoutSettled` (`:52-64`) passes on four identical bounding-box reads. Right after `setViewportSize`, four
  pre-reflow reads at the OLD size satisfy it, so it can pass before the grid has reflowed.
- Grid breakpoints (lg 1440 / md 1100, `panelGridConfig.ts`) key off the CONTAINER width. The container is the
  viewport minus the fixed sidebar, and no media query applies between 768 and 1440. The 1440 -> 1100 -> 1440 viewport
  resizes therefore change the container width, and with it the card's px width. The first loop iteration (1440) does not resize, because the
  viewport is already 1440 (`:78`).
- `e2e/support/isolateLivePage.ts` (HEL-1300) is the canonical form of the spec's inline `page.goto("about:blank")`.

## Goals / Non-Goals

**Goals:** three new assertions (AC2-AC4). Each is red under a mutation of PRODUCT behaviour (never only a test
edit) and green on real code, with the evidence recorded.

**Non-Goals:** item 1 (HEL-1326 D4). Any product-code change. `OutputHistoryService`, the history schemas,
`PublicDashboardRoutes*`, the L7 scrubber files, `ci.yml`, `playwright.config.ts`, `.gitignore`.

## Decisions

**D1 - Page-level public-history test (AC2): a new `PublicDashboardViewerPage.history.test.tsx`.**
- Render the real page at `/dashboards/dash-1/panels?token=tok`, using the same harness style as
  `PublicDashboardViewerPage.content.test.tsx`.
- Mock `publicDashboardService` with one metric output panel. Its rows and output meta must make `MetricOutputPanel`
  mount, with a `compare` config so that a history fetch actually happens. The executor verifies which inputs gate
  the fetch, and must not assume them.
- Mock `features/panels/history/outputHistoryService` (`fetchOutputHistory`, `fetchPublicOutputHistory`) and
  `pipelineRunFanout`, as the PanelContent history test does.
- Add a `beforeEach` that calls `resetHistoryCache()` (`outputHistoryCache.ts`) and `resetComparisonStore()`, and
  `mockReset()`s both history mocks before re-stubbing them. The cache is module-level, and both cases share the public
  key `publicHistoryKey("dash-1", "panel-1")`. Without the reset, the second case's fetch assertion depends on test
  order.
- Assert that `fetchPublicOutputHistory` is called with `("dash-1", "panel-1", "tok")`. The second argument is the PANEL
  id (`outputHistoryService.ts` signature `(dashboardId, panelId, token)`; `useOutputHistory.ts` passes `panelId`). The
  fixture's `panel.id` (`panel-1`) MUST differ from its `config.outputId` (`out-1`), so the argument tells panel-scoped
  from output-scoped reads apart. `expect.any(String)` is forbidden in that position. Also assert that
  `fetchOutputHistory` is never called. Also assert that a delta string derived only from the mocked PUBLIC response renders, so the
  response provably flows to the DOM.
- Run it twice: once anonymous, and once with an authenticated owner preloaded in `auth`. The realistic regression is
  an auth-gated route choice, and a signed-in owner opening their own share link must still read the public route.
- Mutation: delete `historySource={historySource}` at the page's `PanelContent` call. Expected red: the authenticated
  route is called and the public one is not.
- Alternative rejected: extending the content test file. It is already broad, and a dedicated file makes the guard
  greppable.

**D2 - No-reload assertion (AC3): count document requests and keep a window sentinel.**
- Immediately before the "Data Pipelines" click, start counting `page.on("request")` events whose `resourceType()` is
  `"document"` on the main frame. Also set `window.__hel1327NoReload = <random token>` via `page.evaluate`.
- After the "vs 1d" assertion, require zero document requests and the sentinel still equal to that token.
- The window is the WHOLE round trip. The history cache that the step proves only survives if no hop reloads.
- Two signals. The sentinel catches any new document, including one served from bfcache/memory with no network request.
  The request count turns a failure into a navigation count and names the URLs. Under the mutation, the evidence
  records which hops reloaded.
- Detach the listener after the assertion.
- Mutation: make the sidebar "Dashboards" nav entry (rendered from `shared/chrome/sections.ts`) a full document load,
  for example `reloadDocument` on its router link. The executor locates the exact component. Expected red: count >= 1
  and the sentinel is gone, while today's text assertions still pass.

**D3 - Resize then settle (AC4): `resizeAndSettle(page, card, width)` replaces the bare resize + `layoutSettled`.**
- Read the card box. If `width` differs from `page.viewportSize().width`, call `setViewportSize` and then `expect.poll`
  until the card width differs from the pre-resize width (15 s timeout, message naming both widths). Otherwise skip
  the change-poll.
- Then reuse `layoutSettled` (four identical reads).
- Used for the 1440/1100 loop and the restore to 1440. The provenance-button `layoutSettled` calls stay, now after a
  real settle.
- Mutation: the width is measured in `PanelList.tsx` (`useContainerWidth({ initialWidth: 1280 })` ->
  `gridContainerWidth`) and passed via `PanelGrid`'s `width` prop to `DesktopPanelGrid`. `PanelGrid` does not measure it.
  Freeze that value at the first width that ResizeObserver actually MEASURES, not at `initialWidth` 1280. Under the
  mutation the 1440 baseline is then the real one, and the old-wait-green evidence is like-for-like. Expected red: "card width never changed". The OLD wait must be shown GREEN under
  the same mutation (vacuous pass), and that is recorded too.
- Alternative rejected: polling for the RGL breakpoint class. It is not exposed stably, and width is what the
  geometry asserts read.

**D4 - Small hygiene in the same spec.** Use `isolateLivePage(page)` instead of the inline `about:blank`, which is
equivalent. Log the registered user id (`[HEL-1275 e2e] user id: ...`) so residue can be recorded by exact id. Users
are not deleted, because no delete route exists (HEL-1301, pending owner ruling).

## Risks / Trade-offs

- [The D3 mutation also breaks later geometry asserts] -> The red under test must come from the new change-poll. The
  failure message must name it, and the evidence records that line.
- [A document request from a prefetch/iframe] -> Count main-frame requests only.
- [e2e cost] -> Mutation reds run one theme (`--grep light`), and greens run both. Local Playwright runs with at most 2
  workers under `nice -n 19`, on this run's own ports.

## Planner Notes

- Self-approved: D1-D4 (test-only, no dependency, no API change). Scope is restated per the owner ruling (escalation
  `HEL-1327-1791295552636-017bc4`, `proceed-with-restated-scope`).
