# Files modified (HEL-1575, through frontend phase A)

## Backend (commit e01ddfc08)

- `backend/src/main/scala/com/helio/api/protocols/auth/DashboardTabsPrefs.scala`, `AuthProtocol.scala`, `JsonProtocols.scala` -- `dashboardTabs` preference key (`DashboardTabsPref`/`DashboardTabPref`).
- `backend/src/main/scala/com/helio/api/routes/auth/UserPreferencesRoutes.scala`, `infrastructure/persistence/auth/UserPreferenceRepository.scala`, `services/auth/UserResponseAssembler.scala` -- allow-list, validation, merge write, delivery on every auth response.
- `backend/src/main/scala/com/helio/api/routes/dashboards/DashboardChangesRoutes.scala`, `api/protocols/dashboards/DashboardChangesProtocol.scala`, `domain/model/DashboardChange.scala`, `infrastructure/persistence/dashboards/DashboardChangesRepository.scala`, `services/dashboards/DashboardChangesService.scala`, `api/ApiRoutes.scala` -- `GET /api/dashboard-changes`.
- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRepository.scala` -- panel delete bumps `dashboards.last_updated`.
- `backend/src/test/scala/...` -- `UserPreferencesRoutesSpec`, `DashboardChangesRoutesSpec`, `AuthServiceSpec`.
- `schemas/auth/*preferences*.schema.json`, `schemas/dashboards/dashboard-change*.schema.json`.

## Frontend: tab model, persistence, hydration, change signals

- `frontend/src/features/dashboards/tabs/dashboardTabsSlice.ts` -- tab set, active id, change signals, D1/D3 reducers.
- `frontend/src/features/dashboards/tabs/dashboardTabsListeners.ts` -- selection state-transition sync, hydration trigger, prune, last-viewed stamping/capture, persistence, signal refresh, warm sweep, sign-out reset.
- `frontend/src/features/dashboards/tabs/hydrateTabs.ts` -- D1 hydration plan and thunk (deep link > saved active > auto-select; bounded warm restore).
- `frontend/src/features/dashboards/tabs/tabsPersistence.ts` -- 1000 ms coalesced `dashboardTabs` PATCH and the keepalive flush.
- `frontend/src/features/dashboards/tabs/tabsBrowserTriggers.ts` -- hidden/pagehide, visible and 2-minute signal refresh, minute sweep (started from `main.tsx`).
- `frontend/src/features/dashboards/tabs/dashboardChangesService.ts`, `refreshChangeSignals.ts`, `dashboardTabsSelectors.ts`, `serverClock.ts`, `tabTypes.ts` -- change signals, server-time clock, the changed-dot rule and accessible-name suffix.

## Frontend: warm cache

- `frontend/src/features/dashboards/tabs/warm/warmConfig.ts`, `warmValidity.ts` -- constants (15 min / 8 tabs) and the pure validity rules.
- `.../warm/warmStore.ts`, `boundedWarmStore.ts` -- `WarmStore` interface, IndexedDB and memory adapters, the epoch/size/TTL/user-bounded handle.
- `.../warm/warmCache.ts`, `clearWarmHook.ts`, `warmCapture.ts`, `warmRestore.ts`, `warmSweep.ts`, `showDashboardPanels.ts` -- in-memory lists, own writes, retentions, `clearWarmState`, capture on leave/hide, restore, `showDashboardPanels`.
- `.../warm/warmListeners.ts` -- fetch bookkeeping, the own-write table, warm drops on Output/pipeline/source delete, `clearAuth` clearing.
- `frontend/src/features/panels/state/panelsSlice.ts`, `panelThunks.ts`, `types/panel.ts` -- `panelsRestored`, `paginationHydrated`, restore flag, `clearSentPendingPanelUpdates`, per-window `capturedAt` (server time, via `getPendingMeta`).
- `frontend/src/features/panels/state/outputMetaCache.ts`, `services/pipelineRunFanout.ts` -- `seedOutputMeta`/`peekOutputMeta`, `seedObservedRun`/`getObservedRunId`.
- `frontend/src/features/panels/hooks/usePanelUpdatesFlush.ts` -- C7: unmount flush; batch success clears only the keys sent.
- `frontend/src/features/panels/ui/PanelList.tsx` -- skeleton while a lazy warm restore reads the browser store (task 4.5(6)).
- `frontend/src/app/App.tsx` -- panel effect gated on `hydrated`, dispatching `showDashboardPanels`.
- `frontend/src/features/auth/state/authSlice.ts`, `services/authService.ts`, `types/user.ts` -- logout awaits the warm clear (bounded 1 s); `patchDashboardTabsRequest`; `dashboardTabs` on `UserPreferences`.
- `frontend/src/store/store.ts`, `frontend/src/main.tsx` -- reducer, listeners and browser triggers wired in.
- `frontend/src/features/dashboards/README.md` -- the new `tabs/` directory.

## Frontend tests and harness

- `frontend/src/features/dashboards/tabs/**/*.test.ts` -- slice, listeners, persistence, hydration plan, change signals, selectors/dot rule, browser triggers, warm store/validity/restore/show/capture/own-write table/clear.
- `frontend/src/features/panels/ui/grid/PanelGrid.unmountFlush.test.tsx` -- C7 red-first tests (evidence in `evidence-red-first.md`).
- `frontend/src/features/panels/state/panelsSlice.warm.test.ts`, `frontend/src/features/panels/ui/PanelList.test.tsx`, `frontend/src/app/AppShell.tabsHydration.test.tsx`.
- `frontend/src/test/renderWithStore.tsx`, `tabsTestStore.ts`, `warmFixtures.ts`; `frontend/src/app/App.test.tsx`, `AppShell.rail.test.tsx`, `ShareDialogFocusRestore.test.tsx` (the new `dashboardTabs` slice, hydrated, in their hand-built stores).

## Frontend phase B: tab bar, palette, ask handoff

- `frontend/src/features/dashboards/tabs/ui/DashboardTabBar.tsx`, `DashboardTabBar.css`, `tabDomIds.ts`, `useTabDrag.ts`, `backgroundTabClick.ts` -- the tablist, roving focus, keys, drag, close sibling, "+" and the box; the list's middle/meta-click helpers.
- `frontend/src/app/App.tsx`, `App.css`, `CommandBar.tsx`, `shell/AppRail.css`, `shell/ContextList.css` -- tab bar grid row, tabpanel wrapper, palette provider wrapping the shell, breadcrumb hiding.
- `frontend/src/features/dashboards/ui/DashboardList.tsx` -- middle-click / Cmd-Ctrl-click opens a background tab.
- `frontend/src/features/panels/ui/PanelList.tsx` -- empty state retitled "No dashboard open".
- `frontend/src/features/commandPalette/ui/PaletteSearchBox.tsx`, `.css` -- the "Search, jump, or ask" box.
- `frontend/src/features/commandPalette/CommandPaletteProvider.tsx`, `hooks.ts`, `ui/CommandPalette.tsx`, `model/builtInActions.ts`, `useAskAssistantAction.ts`, `useOpenTabActions.ts` -- `open({intent})`, the Ask section/action, the open-tab mode.
- `frontend/src/features/assistant/state/startConversationWithMessage.ts`, `ui/MessageComposer.tsx`, `ui/ChatPage.tsx` -- shared first-message send path and the `/chat` autoSend hand-off.
- Tests: `DashboardTabBar.test.tsx`, `CommandPalette.askAndTabs.test.tsx`, `ChatPage.autoSend.test.tsx`, additions to `DashboardList.test.tsx`, `AppShell.rail.test.tsx`, `CommandPalette.test.tsx` (ask action adds one option), `PanelList.test.tsx`, the elevation/motion guards' file counts.
- `openspec/changes/persistent-dashboard-tabs-palette/ui-decisions.md` -- the UI decisions.

## Phase C: e2e, measurement, screenshots, docs

- `e2e/hel1575-dashboard-tabs.spec.ts` -- the 17 Playwright cases of design D12 (tabs, reload, second context, deep link, delete, warm switch, expiry, logout wipe, own edits, dot, palette box, ask handoff).
- `e2e/hel1575-switch-measurement.spec.ts` -- opt-in (`HEL1575_MEASURE=1`) warm vs cold switch timing on a 12-panel dashboard.
- `frontend/src/features/panels/hooks/usePanelRunRefresh.ts`, `usePanelRunRefresh.test.ts` -- a succeeded run also re-reads the Output metadata so a tab return stays warm (found red by the e2e; see `evidence-red-first.md`).
- `frontend/src/features/dashboards/tabs/ui/DashboardTabBar.css` -- the bar keeps its height with no tabs (no page shift when the last tab closes).
- `DESIGN.md` (section 9: tabs and the box shipped, replace vs new tab, warm numbers, dot token, keyboard and the tablet limit), `CLAUDE.md` (`GET /api/dashboard-changes`).
- `openspec/changes/persistent-dashboard-tabs-palette/e2e-run.txt`, `measurements.md`, `ui-decisions.md`, `evidence-red-first.md`, `tasks.md`.

## Final gate round 1 (skeptic-final-1.md)

- `frontend/src/features/dashboards/tabs/activeTabSnapshot.ts`, `activeTabSnapshot.test.ts` -- the active tab's debounced snapshot, rate-limited last-view stamp (at most one per 60 s, so at most one coalesced PATCH per window).
- `frontend/src/features/dashboards/tabs/dashboardTabsListeners.ts` -- listener: snapshot the active tab 1.5 s after its panel list / row windows settle.
- `frontend/src/features/dashboards/tabs/tabsBrowserTriggers.ts` -- 60 s visible heartbeat; pagehide kept as a best-effort extra.
- `frontend/src/features/assistant/ui/ChatPage.tsx`, `ChatPage.autoSend.test.tsx` -- the hand-off is per navigation (`location.key`), not per mount.
- `e2e/hel1575-dashboard-tabs.spec.ts` -- never-left reload e2e, ask-from-/chat e2e (shared `stubConverse`/`askFromPalette` helpers).
- `frontend/src/features/dashboards/tabs/ui/DashboardTabBar.css` -- no hairline under the active tab.
- `DESIGN.md` -- close size 24px fine / 28px coarse. `ui-decisions.md`, `evidence-red-first.md`, `skeptic-final-1.md`.

Final gate round 2 (idle heartbeat clobbered another device's tab set):
- `frontend/src/features/dashboards/tabs/activeTabSnapshot.ts`, `warm/warmCapture.ts`, `tabsBrowserTriggers.ts` -- the heartbeat and while-open snapshot write only the IndexedDB copy (local `viewedAt`), never `tabViewed`; no preferences PATCH.
- `frontend/src/features/dashboards/tabs/hydrateTabs.ts` -- the copy's `lastViewedAt` is honoured for the reload target's TTL check.
- `activeTabSnapshot.test.ts`, `hydrateTabs.test.ts`, `e2e/hel1575-dashboard-tabs.spec.ts` -- idle 0-PATCH unit test, stamp-adoption test, two-device e2e. `design.md`, `evidence-red-first.md`, `skeptic-final-2.md`.

## Complete declaration (orchestrator, Delivery; generated from `git diff --name-only <merge-base>..HEAD`)

- `CLAUDE.md`
- `DESIGN.md`
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala`
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala`
- `backend/src/main/scala/com/helio/api/protocols/auth/AuthProtocol.scala`
- `backend/src/main/scala/com/helio/api/protocols/auth/DashboardTabsPrefs.scala`
- `backend/src/main/scala/com/helio/api/protocols/dashboards/DashboardChangesProtocol.scala`
- `backend/src/main/scala/com/helio/api/routes/auth/UserPreferencesRoutes.scala`
- `backend/src/main/scala/com/helio/api/routes/dashboards/DashboardChangesRoutes.scala`
- `backend/src/main/scala/com/helio/domain/model/DashboardChange.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/auth/UserPreferenceRepository.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/dashboards/DashboardChangesRepository.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRepository.scala`
- `backend/src/main/scala/com/helio/services/auth/UserResponseAssembler.scala`
- `backend/src/main/scala/com/helio/services/dashboards/DashboardChangesService.scala`
- `backend/src/test/scala/com/helio/api/routes/auth/UserPreferencesRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardChangesRoutesSpec.scala`
- `backend/src/test/scala/com/helio/services/auth/AuthServiceSpec.scala`
- `e2e/hel1575-dashboard-tabs.spec.ts`
- `e2e/hel1575-switch-measurement.spec.ts`
- `frontend/src/app/App.css`
- `frontend/src/app/App.test.tsx`
- `frontend/src/app/App.tsx`
- `frontend/src/app/AppShell.rail.test.tsx`
- `frontend/src/app/AppShell.tabsHydration.test.tsx`
- `frontend/src/app/CommandBar.tsx`
- `frontend/src/app/ShareDialogFocusRestore.test.tsx`
- `frontend/src/app/shell/AppRail.css`
- `frontend/src/app/shell/ContextList.css`
- `frontend/src/features/assistant/state/startConversationWithMessage.ts`
- `frontend/src/features/assistant/ui/ChatPage.autoSend.test.tsx`
- `frontend/src/features/assistant/ui/ChatPage.tsx`
- `frontend/src/features/assistant/ui/MessageComposer.tsx`
- `frontend/src/features/auth/services/authService.ts`
- `frontend/src/features/auth/state/authSlice.ts`
- `frontend/src/features/auth/types/user.ts`
- `frontend/src/features/commandPalette/CommandPaletteProvider.tsx`
- `frontend/src/features/commandPalette/hooks.ts`
- `frontend/src/features/commandPalette/model/builtInActions.ts`
- `frontend/src/features/commandPalette/ui/CommandPalette.askAndTabs.test.tsx`
- `frontend/src/features/commandPalette/ui/CommandPalette.test.tsx`
- `frontend/src/features/commandPalette/ui/CommandPalette.tsx`
- `frontend/src/features/commandPalette/ui/PaletteSearchBox.css`
- `frontend/src/features/commandPalette/ui/PaletteSearchBox.tsx`
- `frontend/src/features/commandPalette/useAskAssistantAction.ts`
- `frontend/src/features/commandPalette/useOpenTabActions.ts`
- `frontend/src/features/commandPalette/useResourceIndexing.test.tsx`
- `frontend/src/features/dashboards/README.md`
- `frontend/src/features/dashboards/tabs/activeTabSnapshot.test.ts`
- `frontend/src/features/dashboards/tabs/activeTabSnapshot.ts`
- `frontend/src/features/dashboards/tabs/dashboardChangesService.ts`
- `frontend/src/features/dashboards/tabs/dashboardTabsListeners.test.ts`
- `frontend/src/features/dashboards/tabs/dashboardTabsListeners.ts`
- `frontend/src/features/dashboards/tabs/dashboardTabsSelectors.test.ts`
- `frontend/src/features/dashboards/tabs/dashboardTabsSelectors.ts`
- `frontend/src/features/dashboards/tabs/dashboardTabsSlice.test.ts`
- `frontend/src/features/dashboards/tabs/dashboardTabsSlice.ts`
- `frontend/src/features/dashboards/tabs/hydrateTabs.test.ts`
- `frontend/src/features/dashboards/tabs/hydrateTabs.ts`
- `frontend/src/features/dashboards/tabs/refreshChangeSignals.test.ts`
- `frontend/src/features/dashboards/tabs/refreshChangeSignals.ts`
- `frontend/src/features/dashboards/tabs/serverClock.ts`
- `frontend/src/features/dashboards/tabs/tabTypes.ts`
- `frontend/src/features/dashboards/tabs/tabsBrowserTriggers.test.ts`
- `frontend/src/features/dashboards/tabs/tabsBrowserTriggers.ts`
- `frontend/src/features/dashboards/tabs/tabsPersistence.test.ts`
- `frontend/src/features/dashboards/tabs/tabsPersistence.ts`
- `frontend/src/features/dashboards/tabs/ui/DashboardTabBar.css`
- `frontend/src/features/dashboards/tabs/ui/DashboardTabBar.css.test.ts`
- `frontend/src/features/dashboards/tabs/ui/DashboardTabBar.test.tsx`
- `frontend/src/features/dashboards/tabs/ui/DashboardTabBar.tsx`
- `frontend/src/features/dashboards/tabs/ui/backgroundTabClick.ts`
- `frontend/src/features/dashboards/tabs/ui/tabDomIds.ts`
- `frontend/src/features/dashboards/tabs/ui/useTabDrag.ts`
- `frontend/src/features/dashboards/tabs/warm/boundedWarmStore.test.ts`
- `frontend/src/features/dashboards/tabs/warm/boundedWarmStore.ts`
- `frontend/src/features/dashboards/tabs/warm/clearWarmHook.ts`
- `frontend/src/features/dashboards/tabs/warm/clearWarmState.test.ts`
- `frontend/src/features/dashboards/tabs/warm/showDashboardPanels.test.ts`
- `frontend/src/features/dashboards/tabs/warm/showDashboardPanels.ts`
- `frontend/src/features/dashboards/tabs/warm/warmCache.sweep.test.ts`
- `frontend/src/features/dashboards/tabs/warm/warmCache.ts`
- `frontend/src/features/dashboards/tabs/warm/warmCapture.ts`
- `frontend/src/features/dashboards/tabs/warm/warmConfig.ts`
- `frontend/src/features/dashboards/tabs/warm/warmListeners.test.ts`
- `frontend/src/features/dashboards/tabs/warm/warmListeners.ts`
- `frontend/src/features/dashboards/tabs/warm/warmRestore.test.ts`
- `frontend/src/features/dashboards/tabs/warm/warmRestore.ts`
- `frontend/src/features/dashboards/tabs/warm/warmStore.ts`
- `frontend/src/features/dashboards/tabs/warm/warmSweep.ts`
- `frontend/src/features/dashboards/tabs/warm/warmValidity.test.ts`
- `frontend/src/features/dashboards/tabs/warm/warmValidity.ts`
- `frontend/src/features/dashboards/ui/DashboardList.test.tsx`
- `frontend/src/features/dashboards/ui/DashboardList.tsx`
- `frontend/src/features/panels/hooks/usePanelRunRefresh.test.ts`
- `frontend/src/features/panels/hooks/usePanelRunRefresh.ts`
- `frontend/src/features/panels/hooks/usePanelUpdatesFlush.ts`
- `frontend/src/features/panels/services/pipelineRunFanout.ts`
- `frontend/src/features/panels/state/outputMetaCache.ts`
- `frontend/src/features/panels/state/panelThunks.ts`
- `frontend/src/features/panels/state/panelsSlice.ts`
- `frontend/src/features/panels/state/panelsSlice.warm.test.ts`
- `frontend/src/features/panels/types/panel.ts`
- `frontend/src/features/panels/ui/PanelList.test.tsx`
- `frontend/src/features/panels/ui/PanelList.tsx`
- `frontend/src/features/panels/ui/grid/PanelGrid.unmountFlush.test.tsx`
- `frontend/src/main.tsx`
- `frontend/src/store/store.ts`
- `frontend/src/test/renderWithStore.tsx`
- `frontend/src/test/tabsTestStore.ts`
- `frontend/src/test/warmFixtures.ts`
- `frontend/src/theme/elevationTokenGuard.css.test.ts`
- `frontend/src/theme/motionTokenGuard.css.test.ts`
- `schemas/auth/update-user-preferences-request.schema.json`
- `schemas/auth/user-preferences.schema.json`
- `schemas/dashboards/dashboard-change-item.schema.json`
- `schemas/dashboards/dashboard-change-output.schema.json`
- `schemas/dashboards/dashboard-changes-response.schema.json`
