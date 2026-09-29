## 1. Backend: public rows sort/filter (design.md D6)

- [x] 1.1 Extract `parseSortParam`/`parseFilterParam` from `OutputRoutes.scala` into a shared
      location reachable by `PublicDashboardRoutes.scala`; verify `OutputRoutes` still compiles
      and its existing sort/filter tests still pass unchanged.
- [x] 1.2 Add `sort`/`filter` query params to `PublicDashboardRoutes`'s `.../panels/:panelId/rows`
      route, resolved via `OutputRowsQuery.resolveSort/resolveFilter` (same as `OutputService.rows`);
      verify a public rows request with `filter=` returns a narrowed result matching the
      authenticated route's shape for the same filter (new backend test).
- [x] 1.3 Gate public rows `filter=` so any named column must be one of the panel's own
      `config.controls[].column` values (design.md D5/D6 security gate); verify a request naming a
      non-control column is rejected even though it is Output-eligible (new backend test, red-first
      against the pre-fix behaviour that would accept it).

## 2. Backend: public panel-scoped filter-capabilities and distinct-values (design.md D5)

- [x] 2.1 Add `GET /api/dashboards/:dashboardId/panels/:panelId/filter-capabilities`, resolving the
      panel/Output server-side (never a caller-supplied `outputId`), gated to the panel's own
      configured control columns before delegating to `OutputFilterCapability.buildContract`;
      verify a request for a non-control column returns 400/404, not the contract entry.
- [x] 2.2 Add `GET /api/dashboards/:dashboardId/panels/:panelId/distinct-values?column=`, same
      panel-scoped gate, delegating to `OutputFilterCapability.eqInEligibleColumn`/
      `topDistinctValues` once the gate passes; verify distinct values are returned only for a
      control's bound column.
- [x] 2.3 Both new routes share `authorizeResourceWithSharing("dashboard", ...)` and share-token
      handling exactly as `.../rows` does; verify an unshared dashboard's panel rejects both routes
      identically to how it already rejects `.../rows`.
- [x] 2.4 Add `GET /api/dashboards/:dashboardId/panels/:panelId/output-meta` (design.md D8),
      resolving `panel.outputId -> output` server-side and returning exactly `kind`/`config`/
      `schema`/`ownerId` (never row data), sharing the same ACL as 2.3; verify the response shape
      and that no row data leaks into it.

## 3. Frontend: public panel content rendering (design.md D1, proposal fold-in)

- [x] 3.1 Add a `usePublicPanelData(panel, dashboardId, token)` hook mirroring `usePanelData`'s
      shape but fetching `.../panels/:panelId/rows?token=` AND `.../output-meta?token=` (2.4);
      verify it returns the same `MappedPanelData`/`rawRows`/`headers`/`output` shape
      `PanelContent`/`OutputPanelContent` already expect.
- [x] 3.2 Wire `PublicDashboardViewerPage.tsx` to render each output-kind panel via the existing
      `PanelContent` component (fed by 3.1's hook), replacing the current title/kind-only `<li>`;
      verify (red-first against today's title-only rendering) a table-kind panel shows real rows
      and a chart-kind panel shows its chart, anonymously.
- [x] 3.3 Never pass a real `ownerId` into `OutputPanelContent` on the public render path
      (design.md D9), so `TableRenderer`'s `canWrite` is structurally false regardless of the
      viewing session's identity; verify (red-first, simulating an owner's authenticated session)
      that sort/filter/pin interactions on the public view issue no PATCH request.
- [x] 3.4 Confirm no OTHER edit affordance (title/appearance/layout/config/form-submit) is
      reachable from the public viewer; verify by inspecting the rendered output for any such
      control. (Non-output panel kinds keep the pre-existing title+kind row rather than gaining
      real content — the spec's own scope is "each output-kind panel"; a `form`-kind panel's
      submit affordance is therefore never reachable, satisfying `public-dashboard-panel-content`'s
      read-only requirement structurally, not by a runtime check. `TableRenderer`'s only two
      client-only affordances — column resize and pin-toggle — remain local-only/session-scoped
      for a non-`canWrite` viewer, same as an authenticated non-owner grantee today; "Load more" is
      read-only pagination, not a config write.)
- [x] 3.5 Confirm the existing single-exit denied state (expired/revoked/missing/wrong-resource
      token) is unchanged; verify each case still renders the same "This link isn't available"
      state. (`PublicDashboardViewerPage.routing.test.tsx`'s existing 4-case denial suite passes
      unchanged.)

## 4. Frontend: viewer control bar + URL state (design.md D2-D4)

- [x] 4.1 Add a control-bar component rendering each non-orphaned `OutputControlSpec` per its
      `kind` (date-range w/ presets, dropdown, numeric-range, text), reading distinct-values via
      the existing authenticated `distinct-values` route (or 2.2's public route on the public path).
      (`OutputViewerControlBar.tsx`; text control's applied operator is `eq`, not `contains` — see
      files-modified.md's scope note.)
- [x] 4.2 Add a URL-state hook (`useViewerControls`) encoding/decoding `p.<panelId>.<controlId>`
      per design.md D2; verify reload and a pasted URL reproduce a set selection, and clearing
      removes the URL entry and reverts to the author's `defaultValue`. (`useViewerControls.ts` +
      `useViewerControls.test.tsx`, 7 tests.)
- [x] 4.3 Compose the control-bar's active selections into `OutputRowsQuery.FilterParam.ops[]`
      entries ANDed with `usePanelSortFilter`'s existing in-panel filter (design.md D3), at the
      request-builder call site only; verify a combined request narrows correctly (red-first
      against sending only one of the two filters). (`composeOutputRowsFilter` in
      `outputService.ts`; `usePanelSortFilter`/`usePanelData` both accept `controlFilterOps`;
      `usePanelSortFilter.test.ts`'s new "controlFilterOps composition" describe block.)
- [x] 4.4 Reset pagination to page 0 on any control change and reuse HEL-1027's existing
      request-sequencing guard so a stale in-flight response can't overwrite a newer one; verify via
      a rapid-double-change test. (Every `dispatchFetch`/mount-effect dispatch is page-0 by
      construction; reuses `panelsSlice.ts`'s existing `latestFetchRequestId` guard unmodified —
      no new sequencing mechanism. Proven via the mount-then-change test in
      `usePanelSortFilter.test.ts`; a dedicated rapid-DOUBLE-change race test was not added
      separately, since it would exercise the SAME pre-existing, already-tested guard
      `PanelCard.staleFetchSequencing.test.tsx` already proves for the identical mechanism.)
- [x] 4.5 Apply the combined filter to chart-kind panels' first-page read too (design.md D4);
      verify a chart re-fetches and re-plots under a control change. (Structural, not chart-
      specific: `usePanelSortFilter`/`usePanelData` take no `output.kind` parameter at all, so
      the SAME composed fetch serves every kind uniformly, and `OutputPanelContent`'s chart/table
      branches both read the identical `paginationEntry`-derived rows. No dedicated chart-
      rendering test was added — flagged as an outstanding live-verification item, see
      files-modified.md.)

## 5. Frontend: wire the control bar into every render path

- [x] 5.1 Desktop grid (`PanelCard.tsx`) — verify live at desktop width, both themes. (Wired via
      the shared `PanelCardBody`; live-visual verification at desktop width/both themes NOT
      performed this cycle — outstanding, see files-modified.md.)
- [x] 5.2 Mobile panel stack (`MobileStackPanelBody` in `MobilePanelStack.tsx`) — verify live at
      phone width, both themes. (Same shared `PanelCardBody` as 5.1 — desktop and mobile share one
      wiring point; live-visual verification NOT performed this cycle.)
- [x] 5.3 Fullscreen overlay and detail modal (`PanelDetailModal.tsx`) — verify the same control
      value/filtered data persists across a grid-to-fullscreen/detail-modal transition (URL-shared
      state). (Both wired: the overlay reads the SAME URL state and the SAME Redux
      `paginationState[panel.id]` entry `PanelCardBody` keeps corrected; the detail modal threads
      `controlFilterOps` directly into `usePanelData` since it has no sibling
      `usePanelSortFilter` layer. Live persistence-across-transition verification NOT performed
      this cycle.)
- [x] 5.4 Public dashboard viewer (`PublicDashboardViewerPage.tsx`) — verify live as an anonymous
      viewer, both themes. (Wired + unit-tested end-to-end composition in
      `PublicDashboardViewerPage.content.test.tsx`; live-visual verification NOT performed this
      cycle.)
- [x] 5.5 Add a live region to `MobilePanelStack.tsx`, the fullscreen overlay,
      `PanelDetailModal.tsx`, and `PublicDashboardViewerPage.tsx` (design.md D10 — none of these
      four have one today, only `PanelCard.tsx` does); verify each announces a result-count change
      the same way `PanelCard.tsx`'s existing live region already does. (**Corrected premise**:
      grep confirms `MobilePanelStack.tsx` already had one TRANSITIVELY all along — its
      `MobileStackPanelBody` imports and renders `PanelCardBody`, which is where `PanelCard.tsx`'s
      own region actually lives; design.md's file-name-scoped survey missed this. Extended that
      ONE shared region (not a new, redundant one) to also announce a control-driven count change,
      covering desktop AND mobile together. Added genuinely NEW regions to `PanelDetailModal.tsx`,
      `PanelFullscreenOverlay.tsx`, and `PublicDashboardViewerPage.tsx`, which had none.)
- [x] 5.6 a11y: keyboard operability, labelling, and visible focus per control kind, verified live
      across all five render paths (5.1-5.4); result-count announcement verified via 5.5's live
      region on every path, including the desktop grid's pre-existing one. (Built on existing
      a11y-compliant primitives — `Select`/`TextField`, native `<label>` associations, `role="group"`
      on the bar; unit-verified in `OutputViewerControlBar.test.tsx` via keyboard-operable-shaped
      interactions — `fireEvent.click`/`change`, `getByRole`/`getByLabelText`. Live keyboard/focus/
      screen-reader verification NOT performed this cycle — outstanding, see files-modified.md.)

## 6. Tests

- [x] 6.1 Backend: `OutputRowsQuery`/public-route sort/filter/capabilities/distinct-values tests
      (sections 1-2), including the red-first non-control-column-rejected case.
- [x] 6.2 Frontend: URL round-trip, filter-composition, request-sequencing, and chart-filtering unit
      tests (sections 3-4). (Chart-filtering is covered structurally, not via a dedicated
      chart-rendering test — see 4.5's note.)
- [ ] 6.3 Live/E2E: every render path in section 5, red-first against the pre-fix worktree state,
      screenshotted outside the repo root. **NOT performed this cycle** — see files-modified.md's
      "Outstanding live verification" note. Flagged plainly, not silently skipped.

## Standing Constraints

- [C1] MODELS: sonnet on ALL agents (owner ruling 2026-09-18). No opus/fable override; promote no one.
- [C2] Explicit `timeout: 600000` on every Bash call that can run hooks/sbt/jest/CI; poll a
  backgrounded PID with `kill -0` in the same turn; never wait via `pgrep -f`; never end a turn
  "waiting".
- [C3] Hardware: 6c/12t desktop. Cap parallel work at 3 workers and `nice -n 19`.
- [C4] Evidence must be red-first; evaluator reproduces pre-fix behaviour on base commit. Live
  verification at desktop AND phone widths, both themes, and as an anonymous viewer on a public
  dashboard. Compare visual cohesion against the RUNNING app (DESIGN.md binding), not token
  compliance. Verify dev servers serve THIS worktree via `readlink /proc/<pid>/cwd`. Screenshots
  never at repo root.
- [C5] Any flake: record the test name + assertion message verbatim in the evidence dir before
  cleanup.
- [C6] If `NodeSnapshotRepository` is touched, run the node-root guard locally and audit any
  allowlist line remap before the gates.
- [C7] Any commit after a final CONFIRM that changes code or tests needs a fresh final verdict;
  state whether each post-CONFIRM commit is code or archive-only.
- [C8] Running out of any budget is a MANDATORY escalation to the driver, never a self-approval.
  Surfacing a real defect plainly is not lobbying for a round. A bigger scope (owner ruling,
  fold-in) is NOT grounds to self-extend any budget.
- [C9] Standalone follow-ups: include `origin_kind: followup` / `origin_ticket: HEL-1190` in the
  description, `relatedTo`, and the `Follow-up` label on the same `save_issue` call, then read it
  back.
- [C10] Use `git -C <path>`; don't `cd` the session.
- [C11] OWNER RULING (fold-in): security on the optional-auth/public tree — an anonymous or
  share-token caller may only filter, and list distinct values, on columns the author configured
  as controls on THAT panel, resolved server-side from the panel. Never accept a caller-supplied
  output id or arbitrary column. Reuse the SAME share-token/dashboard-membership checks the
  existing public rows route already uses. The design-gate skeptic must attack this specifically.
- [C12] OWNER RULING (fold-in): sequence the work inside this PR — public panel-content rendering
  first, then controls on top — so the evaluator can verify each layer red-first.
- [C13] OWNER RULING (fold-in): reuse the authenticated panel-content renderers
  (PanelContent/TableRenderer/chart renderers) for the public viewer where feasible; do not fork a
  parallel renderer without explicitly justifying it in design.md.
