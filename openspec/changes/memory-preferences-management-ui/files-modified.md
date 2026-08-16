# Files Modified — HEL-525 (memory-preferences-management-ui)

## New — `frontend/src/features/settings/`

- `types/preferences.ts` — `AgentPreferences` / `PutAgentPreferencesRequest`, mirroring the
  backend's `AgentPreferencesResponse`/`PutAgentPreferencesRequest` field-for-field.
- `types/agentMemory.ts` — `AgentMemoryEntry`, mirroring `AgentMemoryEntryResponse`.
- `services/settingsService.ts` — typed `httpClient` calls for all 5 operations
  (`getPreferences`, `putPreferences`, `listAgentMemory`, `deleteAgentMemoryEntry`,
  `clearAgentMemory`); normalizes spray-json's `Option=None`-omission gotcha
  (`defaultSeriesColors`/`defaultPanelStyle`/`namingConventions`/`lastUsedAt`) to `null` at the
  service boundary, mirroring `pipelineService.ts`'s `normalizeSchedule` precedent.
- `services/settingsService.test.ts` — regression coverage for the Option-omission normalization
  above (mirrors `pipelineService.test.ts`'s schedule-timestamp test shape). Not in tasks.md's
  explicit test list but added for the same reason `pipelineService.test.ts` exists — direct
  coverage of a load-bearing wire-shape normalization.
- `state/settingsSlice.ts` — `settingsSlice` with `preferences`/`agentMemory` as two sibling
  sub-trees (design.md Decision 1) and 5 `createAsyncThunk`s (`fetchPreferences`,
  `savePreferences`, `fetchAgentMemory`, `deleteAgentMemoryEntryThunk`, `clearAgentMemoryThunk`),
  following `pipelinesSlice.ts`'s per-operation status/error pattern (delete status/error keyed
  by entry id).
- `state/settingsSlice.test.ts` — per-thunk success/failure + reducer transition coverage.
- `ui/SettingsPage.tsx` + `.css` — `/settings` page shell: fetch-on-mount for both preferences
  and agent memory, combined loading/error gate, own page heading, renders
  `PreferencesEditor`/`AgentMemoryList` once both fetches succeed.
- `ui/SettingsPage.test.tsx` — loading/error states, both sections render together on success.
- `ui/PreferencesEditor.tsx` + `.css` — `defaultSeriesColors` add/remove/edit swatch list;
  `defaultPanelStyle` background/text/transparency concrete-field editor (mirrors
  `AppearanceEditor.tsx`'s color/range-input recipe); `namingConventions` string-values-only
  generic key/value rows editor (design.md Decision 2 — non-string-valued keys are never
  rendered as rows and are carried through untouched). Explicit "Save preferences" button that
  shallow-merges the edited/recognized `defaultPanelStyle`/`namingConventions` keys onto the full
  fetched objects and passes `extras` through unchanged (design.md Decision 4).
- `ui/PreferencesEditor.test.tsx` — populated/empty render, edit+save, `extras`/unexposed-key
  preservation, and the round-1/round-2 skeptic regression test: a non-string `namingConventions`
  value (`{"titleCase": true}`) survives an edit-and-save cycle unchanged in the dispatched save
  payload.
- `ui/AgentMemoryList.tsx` + `.css` — kind/content/last-used table; per-entry delete and
  list-level "Clear all", both using the inline confirm/cancel pattern mirroring
  `MetricListTable.tsx`'s `confirmDeleteId` state shape exactly (never `window.confirm`,
  design.md Decision 5); empty state via the shared `EmptyState` component. **Cycle 2
  (skeptic-final-1.md #1, blocking):** surfaces `state.settings.agentMemory.deleteError[id]` via
  `<InlineError>` per row, positioned so it outlives the ephemeral confirm/cancel affordance
  (which always reverts to the plain Delete button on confirm, success or failure) — a failed
  delete (e.g. a stale row racing a real 404) is no longer silent.
- `ui/AgentMemoryList.test.tsx` — populated/empty render, never-used-entry rendering (no
  fabricated last-used value), delete confirm/cancel, clear-all confirm/cancel — using a small
  store-connected harness so a fulfilled delete/clear-all thunk's reducer update is actually
  observed in the re-rendered list. **Cycle 2:** new regression test — a rejected
  `deleteAgentMemoryEntry` shows the inline error and leaves the entry in the list.

## Modified

- `frontend/src/store/store.ts` — registers `settingsReducer` as `settings`.
- `frontend/src/app/App.tsx` — adds the `/settings` route inside the existing
  `ProtectedRoute`/`AppShell` tree; adds a `/settings` case to `breadcrumbLabel()`; passes a new
  `onNavigateToSettings` callback to `UserMenu`.
- `frontend/src/features/auth/ui/UserMenu.tsx` + `.css` — new "Settings" `role="menuitem"` entry
  (navigates to `/settings`, closes the popover), matching the existing theme/sign-out items'
  shape.
- `frontend/src/features/auth/ui/UserMenu.test.tsx` — adds the new `onNavigateToSettings` prop to
  the test render helper and a test for the new menu item.
- `frontend/src/test/renderWithStore.tsx` — registers `settingsReducer` in the shared test-store
  helper (required so any component reading `state.settings.*` doesn't crash under this helper).
- `frontend/src/features/toasts/state/toastListeners.ts` — **Cycle 2 (skeptic-final-1.md #2):**
  registers `deleteAgentMemoryEntryThunk.fulfilled/.rejected` and
  `clearAgentMemoryThunk.fulfilled/.rejected`, matching this file's existing pattern for every
  other destructive delete action (`deleteDashboard`/`deletePanel`/`deleteSource`/`deleteDataType`/
  `deletePipeline`). Also documents `fetchPreferences`/`fetchAgentMemory`/`savePreferences` in the
  header comment's "Silent" list for completeness (fetch-on-mount / explicit-save-with-inline-UI,
  same analogues as the existing `fetchDashboards`/`updatePanelAppearance` entries) — no wiring
  added for those, as the skeptic confirmed is correct.

## Backend

None — `GET/PUT /api/preferences` and `GET/POST/DELETE /api/agent/memory[/:id]` already exist
(420-A/HEL-472, 420-B/HEL-478, merged) and are unmodified by this ticket.
