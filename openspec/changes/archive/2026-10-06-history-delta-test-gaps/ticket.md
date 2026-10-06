# HEL-1327: History/delta test gaps: old-baseline identity, public historySource, e2e no-reload + layout-settle

## Description

origin_kind: followup
origin_ticket: HEL-1275

The HEL-1275 (L5) lane noted these test gaps:

1. **Old-baseline identity.** A baseline older than the 30 history points returned can't be identity-checked on the
   client against the current metric config. Check this in L3's resolver on the server side, with a route test.
2. **Public historySource.** No page-level test covers `PublicDashboardViewerPage` passing `historySource`, which
   selects the public, summary-only route. Add an RTL test that fails if the authenticated route is used.
3. **No-reload check.** The e2e step that goes from the editor back to the dashboard doesn't assert that no reload
   happened. Add a navigation-count or no-reload assertion.
4. **Layout-settle wait.** Make the e2e wait sharper: poll until the card's width changes, then wait for it to stop
   changing. The current wait only covers the resize precondition.

Each new test must be shown to fail against a mutation that removes the behaviour it guards.

## Restated scope (owner ruling, 2026-10-06)

The owner answered the ticket-drift escalation `HEL-1327-1791295552636-017bc4` with `proceed-with-restated-scope`.
**Item 1 is OUT of scope.** It moved into HEL-1326 design D4, which is running now. This change must not touch
`OutputHistoryService` or the history schemas. This change delivers items 2-4 only.

## Acceptance Criteria

- AC2: A page-level RTL test renders `PublicDashboardViewerPage` with a metric output panel and asserts that the public
  history route (`fetchPublicOutputHistory`, called with the page's dashboardId + token) is used and the authenticated
  route (`fetchOutputHistory`) is never called. It must be red against a mutation that removes the `historySource`
  prop from the page.
- AC3: The e2e step from the editor back to the dashboard in `e2e/hel1275-metric-delta-sparkline.spec.ts` asserts that
  no full document load happened. It must be red against a mutation that makes that navigation a full load.
- AC4: The e2e layout-settle wait after a viewport resize first polls until the card's width differs from its
  pre-resize width, then waits for the box to stop changing. It must be red against a mutation where the grid does not
  reflow on that resize, which the old wait passes vacuously.
- Every new test has recorded red (mutation) and green (real code) evidence.
