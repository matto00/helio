## Why

Switching dashboards means going back to the context list every time, and the v0.9 shell (DESIGN.md §9) gives a dashboard its identity through tabs and `⌘K` instead of a page title. Tabs also define what to keep warm, so a return to a recently used dashboard is instant instead of a refetch. HEL-1574 shipped the rail and context list this builds on.

## What Changes

- A dashboard tab strip (`role="tablist"`) at the top of the dashboard view's content column on the rail shell: one tab per open dashboard, accent top-edge indicator on the active tab, a "changed since you last viewed" dot, close (×), "+", drag and keyboard reorder. A plain selection replaces the active tab's dashboard (unless it is already open, which activates it); middle-click or `⌘`/Ctrl-click in the context list opens a new background tab.
- Tab persistence server-side per user in the existing `users.preferences` record (new `dashboardTabs` key via `PATCH /api/users/me/preferences`): tab order, active tab and each tab's last-viewed and own-last-write times; capped at 20 with least-recently-used eviction of an inactive tab. Restored on reload and on any device from the auth responses that already carry preferences.
- A warm cache: the 8 most recently used tabs keep their panel list and row data warm for 15 minutes after last use, in memory and in a per-user, size-bounded IndexedDB copy that survives a reload. Warm reuse goes through the existing output freshness generations, so a pipeline run still refreshes a warm panel. Logout clears it.
- A new authenticated `GET /api/dashboard-changes?ids=` endpoint returning, per accessible dashboard, the latest content edit and latest data time; it drives the tab dot and validates the browser-stored copy. Deleting a panel now bumps its dashboard's `last_updated` like creating one already does.
- The "Search, jump, or ask" `⌘K` box in the tab bar opens the existing palette. The palette gains an "Ask the assistant: <text>" action for any typed text that opens a new Assistant conversation with the text sent, and an "open in a new tab" mode used by the tab strip's "+".
- No visible dashboard name in the shell's breadcrumb on the rail-shell dashboard view (the tab carries it); the screen-reader heading stays. The meta row is HEL-1576.

## Capabilities

### New Capabilities

- `dashboard-tabs`: the tab strip, its interaction and accessibility, server persistence, the warm cache with its TTL and browser-stored copy, and the changed dot.
- `dashboard-change-signals`: the endpoint that reports per-dashboard content and data change times, and which writes count as a change.
- `palette-assistant-handoff`: the palette's "Ask the assistant" action and the "Search, jump, or ask" box.

### Modified Capabilities

- `user-ui-preferences`: the partial-update requirement gains the `dashboardTabs` field and its validation.

## Impact

- Frontend: `app/App.tsx`/`App.css` (tab bar mount, panel activation), new `features/dashboards/tabs/` (slice, warm cache, IndexedDB store, tab strip UI), `DashboardList.tsx` (middle/meta click), `panelsSlice` (restore reducers), `outputFreshness`/`outputMetaCache`/`pipelineRunFanout` (retention and seeding hooks), `authSlice` (logout clears), `commandPalette/*` (ask action, open-tab mode), `assistant/*` (auto-send handoff), `CommandBar.tsx` (breadcrumb on the dashboard view).
- Backend: `UserPreferences`/`UserPreferenceRepository`/`UserPreferencesRoutes` (new key), new dashboard-changes route/service/repository query, panel delete bumps `dashboards.last_updated`. No Flyway migration.
- Contract: `schemas/auth/user-preferences.schema.json`, `schemas/auth/update-user-preferences-request.schema.json`, new `schemas/dashboards/dashboard-changes-response.schema.json`.
- No new dependencies.
