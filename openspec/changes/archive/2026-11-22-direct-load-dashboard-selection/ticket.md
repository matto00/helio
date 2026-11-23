# HEL-1624: On load the app briefly selects the most recent dashboard before the URL's dashboard

## Description

origin_kind: followup
origin_ticket: HEL-1575

### Why

On a page load, `fetchDashboards.fulfilled` selects the most recent dashboard (`getMostRecentDashboardId`). Only afterwards is the dashboard from the URL (`/dashboards/:id`) or the saved active tab applied. For a moment the app holds the wrong dashboard selection.

During HEL-1575 this was enough to trigger a react-grid-layout 2.2.4 defect. A bare `Responsive` grid loops forever ("Maximum update depth exceeded") when one render changes both its `layouts` and its breakpoint. On reload the loading skeleton's grid got exactly that: the dashboard switched while the width was still being measured.

HEL-1575 worked around it the way the owner approved: the skeleton's grid is keyed by dashboard id, as `PanelGrid` already is. The transient wrong selection itself was not removed.

### What

* On load, select the URL's dashboard, or the saved active tab, directly. Never select the most recent dashboard first and then switch.
* Check every consumer of the selection on first load: panel fetch, recents, tabs hydration and document title.

### Evidence

* Bare react-grid-layout repro with no Helio code: `.concertino/runs/HEL-1575/evidence/rgl-repro/rgl-bare-repro.test.tsx.txt` (local evidence in the main checkout). Owner ruling: no upstream issue is filed.
* HEL-1575 fix cycle 3 record: `ci-fix-cycle.md` in `openspec/changes/archive/2026-10-15-persistent-dashboard-tabs-palette/`.

## Acceptance criteria

- [ ] On a fresh load of `/dashboards/:id`, `selectedDashboardId` never holds a different dashboard. Proven by a test that records every selection value on load.
- [ ] No regression in the deep-link, saved-active-tab and no-saved-tabs cases from HEL-1575.

## Driver-added acceptance criteria (claims verified at Planning)

- [ ] The selection-recording test is red on main first (committed red run), and also covers the saved-active-tab load: `selectedDashboardId` never holds a dashboard other than the saved active tab.
- [ ] Shared-dashboard (grantee) case: a grantee loading `/dashboards/:id` of a dashboard shared with them never transiently selects a different dashboard.
- [ ] No request for the wrong dashboard's panels on load (asserted from a request log, e2e).
- [ ] Consumers of the first selection checked: panel fetch, recents, tabs hydration, document title, HEL-1783 warm cache and change dots, HEL-1634 session reset on sign-out, HEL-1782 viewer shell.
- Frontend only; no migration.
