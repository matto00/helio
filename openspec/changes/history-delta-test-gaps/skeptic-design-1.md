## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD f4601ba2ee9300f7ecb2775a56559f234c966431 (worktree clean apart from the untracked change dir).
Read-only. No Jest, Playwright or servers were needed.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/history-delta-test-gaps/HEL-1327`.
- **Scope vs ticket:** ticket.md says items 2-4 only, and item 1 is out of scope (owner ruling). proposal.md, design.md and tasks.md touch
  only a new RTL test plus `e2e/hel1275-metric-delta-sparkline.spec.ts`. No `OutputHistoryService` or schema edits.
  AC2 maps to D1/2.1-2.2, AC3 to D2/2.3-2.4 and AC4 to D3/2.5-2.6. Every AC is covered and nothing is beyond them, except the D4 hygiene (minor, see notes).
- **Page wiring (D1 context): confirmed.** `PublicDashboardViewerPage.tsx:79-82` builds the `historySource` memo, and `:134` passes it to
  `PanelContent`. `PanelContent.tsx:314` threads it to `MetricOutputPanel` (and `:490` too). `MetricOutputPanel` passes it to
  `useOutputHistory`. `useOutputHistory.ts` uses `source !== undefined` to choose between
  `fetchPublicOutputHistory(publicDashboardId, panelId, token)` and `fetchOutputHistory(outputId)`. The fetch is gated only by
  `enabled`, which `MetricOutputPanel` hardcodes to `true`, and by the cache key not being cached yet. `MetricOutputPanel` itself only mounts on
  the `kind === "metric"` branch, after output meta resolves.
- **D1 mutation is genuine.** Deleting `historySource={historySource}` at `:134` makes `source` undefined, so the authenticated
  route is called and the public route is not. This removes product behaviour; it is not a test edit. Under ts-jest the unused memo is not a compile
  error (`frontend/tsconfig.json` has no `noUnusedLocals`), so the red comes from the assertion and not from compilation.
- **D1 asserted argument is WRONG.** `outputHistoryService.ts`: `fetchPublicOutputHistory(dashboardId, panelId, token)`, which hits
  `/api/dashboards/:dashboardId/panels/:panelId/history`. `useOutputHistory.ts` passes `panelId`. design.md D1 says to assert
  `("dash-1", <outputId>, "tok")`. The existing content-test harness uses `panel.id = "panel-1"` and `outputId = "out-1"`, so a literal
  implementation is red on real code. The obvious "fix" is `expect.any(String)`, which is what `PanelContent.metricHistory.test.tsx:233`
  already does. That fix loses the only thing that tells panel-scoped from output-scoped public reads apart. See CR1.
- **Cache isolation:** `outputHistoryCache.ts` is module-level, and `resetHistoryCache()` exists at `:95`. D1 runs two cases (anon + owner)
  that use the same public key `publicHistoryKey("dash-1", panelId)`. If the cache is not reset, the second case's real-code
  `fetchPublicOutputHistory` call never happens. The design says to mock "exactly as the PanelContent history test does" but never names the reset.
  See CR2.
- **D2 (no reload):** the "Dashboards" nav entry is `sections.ts` `path: "/"`. `app/Sidebar.tsx:35` renders it as a `NavLink`
  (react-router-dom ^7.18.3, which supports `reloadDocument`). Under a full load of `/`, `getMostRecentDashboardId` picks `dashboards[0]`
  (`dashboardsSlice.ts:47-48`). The fresh registered user owns exactly one dashboard, and the server compare is now `1d`, so the existing
  "vs 1d" text assertion would still pass under the mutation. The mutation is genuine and the old step is vacuous on the reload property,
  as claimed. The pipeline links on that path have no raw `<a href>` (grep of `features/pipelines/ui/*.tsx`, `SidebarItemList.tsx`
  found no hits), so a zero-document-request green is plausible on real code. Using a document-request count plus a window sentinel on the
  main frame is sound.
- **D3 (resize/settle):** breakpoints are lg 1440 / md 1100 / sm 768 (`panelGridConfig.ts`), and they apply to the CONTAINER width, not the viewport.
  The design's "therefore" is a non sequitur, but its conclusion holds. No app/sidebar media query sits between 768 and 1440 (`App.css`
  only has `max-width: 768px` blocks), so the container width and the RGL px card width do change between viewports 1440 and 1100. The first loop
  iteration skips the resize (spec `:78` already sets 1440), as stated.
- **Old `layoutSettled` vacuity:** `:52-64` returns true on 4 identical reads at intervals of 0/50/100/100 ms. A pre-reflow pass needs a
  reflow delayed by about 250 ms or more after `setViewportSize`. That can happen on a loaded CI runner, but it is not the typical case. The stronger, deterministic
  argument is the one the AC states: under a no-reflow mutation the card box never changes, so the old wait passes and so do the downstream
  containment asserts. D3's plan to record the OLD wait GREEN under the same mutation is the correct proof, and the new change-poll
  is necessarily red under it. Sound.
- **D3 mutation location is misattributed.** The width is measured in `PanelList.tsx:76` (`useContainerWidth({ initialWidth: 1280 })`) and
  passed down through `PanelGrid` (prop `width`, `PanelGrid.tsx:33`) to `DesktopPanelGrid`. `PanelGrid` does not measure it. "Freeze at its first
  value" is also ambiguous: the first value is `initialWidth` 1280, not the first measured value. See CR3.
- **D4:** `e2e/support/isolateLivePage.ts` is exactly `page.goto("about:blank")`, so the swap is equivalent. Confirmed.

### Verdict: REFUTE

All three designs are fundamentally sound, and each mutation removes real product behaviour. One stated assertion is factually wrong
against the code, and it fails in a direction that invites a weaker guard. Two smaller precision gaps should be closed before
execution.

### Change Requests

1. **design.md D1:** correct the public-route assertion to `fetchPublicOutputHistory("dash-1", <panel.id>, "tok")`. The second argument is the
   PANEL id (`useOutputHistory.ts` fetcher; `outputHistoryService.ts` signature `(dashboardId, panelId, token)`). Require the fixture panel
   to use a `panel.id` distinct from `config.outputId` (e.g. `panel-1` / `out-1`), so the argument is discriminating. Forbid
   `expect.any(String)` in that position.
2. **design.md D1:** specify a `beforeEach` that calls `resetHistoryCache()` (`outputHistoryCache.ts:95`) and `resetComparisonStore()`, and
   `mockReset()`s both history mocks. Without it, the anon and owner cases share the module-level public cache key, and the second case's
   fetch assertion depends on test order.
3. **design.md D3 (and tasks 2.6):** name the real mutation site, `PanelList.tsx:76` `useContainerWidth` / `gridContainerWidth`. It is
   passed via `PanelGrid` to `DesktopPanelGrid`. Define "freeze" as pinning to the first ResizeObserver-MEASURED width (not
   `initialWidth` 1280), so the 1440 baseline under mutation is the real one and the old-wait-green evidence is like-for-like.

### Non-blocking notes

- D3: the claim "breakpoints 1440/1100 therefore change container width" should say that breakpoints key off the container width. The width change
  comes from the viewport minus the fixed sidebar, not from the breakpoint values.
- D2: "catches a reload that happens to land on the same window (it cannot)" reads oddly. Consider rewording. The two-signal rationale itself is fine.
- D2 mutation: adding `reloadDocument` to the `Sidebar.tsx` `NavLink` unconditionally also makes the "Data Pipelines" hop a full load.
  That is fine, because the window covers the whole round trip, but the evidence should state which hops reloaded.
- D4's user-id log is outside the ticket's ACs but supports C3 residue recording. Acceptable.
