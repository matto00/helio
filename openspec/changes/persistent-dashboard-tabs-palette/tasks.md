## Standing Constraints

- [C1] Owner 2026-10-15 (client-persistent-15m): warm = client memory + a per-user browser-stored copy surviving reload within a 15 min TTL; it respects outputFreshness generations/invalidation, is cleared on logout (and 401 sign-out), is per-user, size-bounded, and holds no secrets. Tab set/order/active/last-viewed saved server-side in users.preferences.
- [C2] Owner (scroll-cap20-lru): the strip scrolls sideways; the saved set is capped at 20 and a 21st closes the LRU inactive tab; only the 8 most recently used tabs are warm.
- [C3] Owner (new-chat-send): palette free text adds `Ask the assistant: "<text>"` → a new Assistant conversation with the text sent once as the first message.
- [C4] Owner (data-or-edit): the dot = content edit or new pipeline data since the tab was last viewed, with the exact signals in design D6/D7.
- [C5] Preferences and change-signal reads/writes are proven in a NOBYPASSRLS session as the app role (`TwoUserRlsApiFixture`); no new table (extend users.preferences); no Flyway migration unless a design-gate decision adds one.
- [C6] No new motion tokens and no new dependencies; tab motion is static; tokens only (every accent preset, both themes).

- [C7] Owner (proceed-round-3): keep the own-edit exclusion and flush pending panel edits on leave; the fix of the pre-existing 30s panel-edit save delay is a behaviour change, proven red-first (the test fails on the pre-fix code) and called out in the PR.

## 1. Backend: preferences key

- [x] 1.1 Add `DashboardTabPref(id, lastViewedAt, ownWriteAt)`/`DashboardTabsPref` and `dashboardTabs: Option[...]` to `UserPreferencesData` and `UserPreferences` (+ JSON formats). Update `getPreferences` (drop an invalid stored value wholesale) and `UserResponseAssembler`, and every positional construction site (grep `UserPreferences(`). Verify: `sbt compile` passes in this worktree.
- [x] 1.2 Extend `UserPreferencesRoutes` (allow-list `dashboardTabs`; validate the cap of 20, non-empty ids of at most 64 chars, unique ids, ISO-8601 `lastViewedAt` or null, `activeId` null or among the ids) and the repository patch to write it via the existing merge. Verify: new `UserPreferencesRoutesSpec` cases (accumulate with width/accent, each 400 case unchanged (incl. a malformed `ownWriteAt`), byte-identical isolation for another user, invalid stored value read as unset) pass.
- [x] 1.3 Update `schemas/auth/user-preferences.schema.json` and `schemas/auth/update-user-preferences-request.schema.json`. Verify: `node scripts/check-schema-drift.mjs` passes.
- [x] 1.4 Assert the key on login/me responses in `AuthServiceSpec`/`ApiRoutesSpec` (or the existing preferences-delivery tests). Verify: those specs pass.

## 2. Backend: change signals

- [x] 2.1 Make panel delete bump `dashboards.last_updated` in the same transaction as the delete. Verify: a repository/route test shows `last_updated` advancing on delete, and layout repair still not advancing it (existing HEL-1233 test still green).
- [x] 2.2 Add the two repository queries in the exact D6 shape (LATERAL LIMIT 1 per Output) on the caller's RLS context, plus a service and `GET /api/dashboard-changes?ids=` (≤20, non-empty, 400 otherwise, 401 unauthenticated), with protocols `DashboardChangeItem`/`DashboardChangesResponse` incl. `serverNow`, and `schemas/dashboards/dashboard-changes-response.schema.json`. Verify: drift check passes.
- [x] 2.3 `DashboardChangesRoutesSpec` on `TwoUserRlsApiFixture` (NOBYPASSRLS app pool), covering: owned; shared-grantee; another user's private (omitted); unknown (omitted); 0/21 ids (400); 401; `dataUpdatedAt` from a seeded `output_snapshot_history` row; `contentUpdatedAt` from a panel edit. Verify: the spec passes, the testFull transcript shows this worktree's paths and a non-zero test count, and EXPLAIN (ANALYZE, BUFFERS) on the dev DB (12 Outputs x 500+ points, seeded and removed by exact id) shows index scans and under 20ms as the owner AND as a dashboard-only grantee (no per-history-row access-function evaluation), recorded in measurements.md.

## 3. Frontend: tab model and persistence

- [x] 3.1 `features/dashboards/tabs/dashboardTabsSlice.ts` + selection listener + state-transition listener implementing D1/D3 for all eight writing reducers (removal → neighbour rule overriding the reducer's pick; new dashboard → new tab; open → activate; else replace), inert until hydrated; explicit actions; cap-20 LRU eviction; prune on every `dashboards.items` change. Verify: unit tests for every D1/D3 rule.
- [x] 3.2 Persistence (D2): 1000ms coalesced PATCH, keepalive flush on hidden/pagehide, failure keeps local state, `lastViewedAt` in server time. Verify: unit tests with fake timers (one PATCH per burst, flush on hidden).
- [x] 3.3 (unit tests done and green; the e2e reload and deep-link cases are task 8.1) `hydrateTabs` (D1): deep link > saved activeId > auto-select; awaits the warm restore decision (bounded 3s); `App.tsx` panel effect gated on `hydrated`. Verify: unit tests (no fetchPanels for the auto-selected dashboard before hydration; deep-link precedence) plus the e2e reload and deep-link cases.

## 4. Frontend: warm cache

- [x] 4.0 Unmount flush of pending panel updates in the grid (mirroring `useLayoutSave.ts:332`); `noteOwnDashboardWrite` on every client content-write success path (enumerated by grep, listed in a test table; batch updates attribute each panel's own dashboardId); `ownWriteAt` persisted per tab in the server pref and patched into the IndexedDB entry and per-window `capturedAt` set in `fetchPanelPage.pending` (server time). Verify: unit tests incl. "run while active, leave, return: warm", "deferred flush after leave: no dot, warm", and "own edit, leave, run: dot shows". The unmount panel-update flush test is red-first: run it against the pre-fix code, record the failing output, then the fix (C7).
- [x] 4.1 Warm module (D4): `WARM_TTL_MS`, `WARM_MAX`, the in-memory store, `showDashboardPanels` thunk + `panelsRestored` reducer replacing the `App.tsx` `fetchPanels` effect, tab-level `retain`/`release` of bound outputs, minute sweep, `invalidateOutput` on newer `dataUpdatedAt`. Verify: unit tests (warm restore makes no fetch, expiry fetches, beyond-8 fetches, content change fetches).
- [x] 4.2 `WarmStore` interface with IndexedDB and memory adapters (D5): keys, 1 MiB/8-entry bounds, TTL purge, other-user purge, allow-listed entry fields. Verify: unit tests on the memory adapter, incl. a test asserting no unexpected keys are stored.
- [x] 4.3 Restore on reload (D5): only the target before hydrated, others lazily on activation (bounded 500ms), never clobbering an existing window or a loaded/in-flight list; in the stated order: changes → panels → `seedOutputMeta` (registers output→pipeline) → `seedObservedRun` → `paginationHydrated` restamping generations → retention; hidden/pagehide stamp the active tab's lastViewedAt. Verify: unit tests for each validity branch and that a run after capture bumps the generation after restore.
- [x] 4.4 (unit tests done and green; the logout-clears-IndexedDB e2e is task 8.1) `clearWarmState` on `clearAuth` (logout + 401): epoch bump + cancel pending writes, in-flight writes check epoch/user, clear memory/ownWriteAt/retentions, close the IDB connection, then deleteDatabase; logout awaits (bounded 1s); Output/pipeline/source delete thunks call `dropWarmForOutputs`. Verify: unit tests (cancel, wrong-user write dropped) plus e2e.

- [x] 4.5 Design-gate r3 executor notes: (1) the unmount flush lives in `usePanelUpdatesFlush` (covers the phone picker too), not `DesktopPanelGrid`; (4) on reload take the later of the IndexedDB and server `ownWriteAt`; (5) a successful batch save clears only the pending keys it sent (an edit made on the next dashboard during the round trip survives) — red-first test; (6) the panel area shows the skeleton during the lazy-restore wait (≤500ms). Verify: unit tests for 4/5/6.

## 5. Frontend: change signals and dot

- [x] 5.1 Changes service + slice state with `serverOffsetMs`; refresh triggers per D7. Verify: unit tests (no panel/row request issued by refresh).
- [x] 5.2 Dot rule + accessible name suffix; clears on activation. Verify: unit tests incl. "own edits do not mark".

## 6. Frontend: tab bar UI

- [x] 6.1 `DashboardTabBar` (tablist, roving focus, Enter/Space, Delete/Backspace, Alt+Shift+Arrows, close control as an aria-hidden, tabIndex -1, titled SIBLING of the tab inside a presentation wrapper, `aria-keyshortcuts="Delete"` + description, "+", horizontal overflow with active scrolled into view, native drag with drop indicator, tabpanel wiring, accent top-edge indicator, non-accent dot token). Mounted per D8 on the rail-shell dashboard view only, with the CommandBar dashboard breadcrumb hidden there and the sr-only h1 kept. Verify: RTL tests for roles/keys; `npm run lint`, `npm run typecheck`, the token checks pass.
- [x] 6.2 Context list middle-click and ⌘/Ctrl-click → `openTabInBackground` (no navigation, no selection change). Verify: unit test.
- [x] 6.3 Retitle the existing PanelList "Select a dashboard" EmptyState to "No dashboard open" with description "Choose a dashboard from the list, or press ⌘K." (no second empty state); a stored empty tab set stays empty on reload. Verify: unit test.

## 7. Palette and Assistant

- [x] 7.1 `PaletteSearchBox` (D9) in the tab bar. Verify: RTL test (opens palette, `aria-keyshortcuts`, platform kbd text).
- [x] 7.2 Ask action (D10) + `Ask` section last; `startConversationWithMessage` thunk shared by `MessageComposer` and the `/chat` `autoSend` handoff (once under StrictMode; free tier gets request-access and no send). Verify: unit tests incl. existing MessageComposer tests still green.
- [x] 7.3 Palette `intent: "open-tab"` (D11). Verify: unit tests (dashboards only, empty query lists all, ask hidden, result opens and activates a new tab).

## 8. End-to-end, measurement and docs

- [x] 8.1 `e2e/hel1575-dashboard-tabs.spec.ts` covering every Playwright case in design D12 (network-log assertions; `page.clock` for expiry; second browser context; logout clears IndexedDB). Verify: run with at most 2 workers; the transcript shows this worktree's paths and non-zero counts.
- [x] 8.2 Measure warm vs cold switch on a 12-output-panel dashboard (median of 5) and record the method and numbers in `openspec/changes/persistent-dashboard-tabs-palette/measurements.md` for the PR.
- [x] 8.3 Screenshots of the tab bar (several tabs, a dotted tab, an overflowing strip, the palette with the ask action) at 1280/820/768/375 in both themes, saved under `.concertino/runs/HEL-1575/evidence/`. Verify: files exist and show the running app.
- [x] 8.4 Update DESIGN.md §9 (tabs/⌘K now shipped: replace-vs-new-tab semantics, dot token, TTL and warm cap numbers) and CLAUDE.md's key-endpoints list (`GET /api/dashboard-changes`). Verify: the diff shows both.
