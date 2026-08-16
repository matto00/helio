## 1. ### Frontend — types + service

- [x] 1.1 Add `frontend/src/features/settings/types/preferences.ts`: `AgentPreferences`
      (`defaultSeriesColors: string[] | null`, `defaultPanelStyle: Record<string, unknown> | null`,
      `namingConventions: Record<string, unknown> | null`, `extras: Record<string, unknown>`) and
      `PutAgentPreferencesRequest`, mirroring the backend's `AgentPreferencesResponse`/
      `PutAgentPreferencesRequest` field-for-field.
- [x] 1.2 Add `frontend/src/features/settings/types/agentMemory.ts`: `AgentMemoryEntry` mirroring
      `AgentMemoryEntryResponse` (`id`, `kind`, `content`, `createdAt`, `lastUsedAt: string | null`).
- [x] 1.3 Add `frontend/src/features/settings/services/settingsService.ts`: `getPreferences()` (→
      `GET /api/preferences`), `putPreferences(req: PutAgentPreferencesRequest)` (→
      `PUT /api/preferences`), `listAgentMemory()` (→ `GET /api/agent/memory`),
      `deleteAgentMemoryEntry(id: string)` (→ `DELETE /api/agent/memory/:id`),
      `clearAgentMemory()` (→ `DELETE /api/agent/memory`) — using `httpClient`, following
      `pipelineService.ts`'s typed-function shape.

## 2. ### Frontend — Redux slice

- [x] 2.1 Add `frontend/src/features/settings/state/settingsSlice.ts`: state for preferences
      (`data: AgentPreferences | null`, `status`, `error`, `saveStatus`, `saveError`) and agent
      memory (`items: AgentMemoryEntry[]`, `status`, `error`, `deleteStatus`/`deleteError` keyed by
      id, `clearStatus`/`clearError`), with `createAsyncThunk`s: `fetchPreferences`,
      `savePreferences`, `fetchAgentMemory`, `deleteAgentMemoryEntryThunk`, `clearAgentMemoryThunk`
      — following `pipelinesSlice.ts`'s per-operation status/error pattern and
      `extractErrorMessage`'s existing error-extraction convention.
- [x] 2.2 Register `settingsReducer` as `settings` in `frontend/src/store/store.ts`.

## 3. ### Frontend — UI

- [x] 3.1 Add `frontend/src/features/settings/ui/SettingsPage.tsx` (routed at `/settings`):
      fetch-on-mount for both preferences and agent memory, loading/error/empty states following
      `MetricsPage.tsx`'s shape, rendering `PreferencesEditor` and `AgentMemoryList`, with its own
      page heading (per `DESIGN.md`'s page-header conventions — `App.tsx`'s `breadcrumbLabel()`
      helper has no `/settings` case and falls through to "Dashboards"; add one if a breadcrumb
      ends up rendered for this route).
- [x] 3.2 Add `frontend/src/features/settings/ui/PreferencesEditor.tsx`: a `defaultSeriesColors`
      list editor (add/remove/edit hex swatches), a `defaultPanelStyle` background/text-color/
      transparency editor (three concrete fields per design.md Decision 2), and a
      `namingConventions` generic key/value rows editor that is **string-values-only**: only keys
      whose fetched value is a JSON string are listed as editable rows; any key whose fetched
      value is not a string is never rendered as a row and is carried through untouched (design.md
      Decision 2). Add an explicit "Save" button. On save, shallow-merge the edited/recognized
      `defaultPanelStyle`/`namingConventions` keys onto the full fetched objects (never a
      wholesale replace of either), and pass `extras` through unchanged — design.md Decision 4:
      never drop or coerce `extras`, unexposed `defaultPanelStyle` keys, or non-string
      `namingConventions` values.
- [x] 3.3 Add `frontend/src/features/settings/ui/AgentMemoryList.tsx`: a table of
      kind/content/last-used per entry, per-entry delete using the inline confirm/cancel pattern
      (mirrors `MetricListTable.tsx`'s `confirmDeleteId` state shape), and a "Clear all" action
      using the same inline confirm/cancel shape at the list level, plus an empty state.
- [x] 3.4 Add co-located CSS for the three new components per `DESIGN.md` (tokens, BEM-ish class
      naming, no new styling system).
- [x] 3.5 Add the `/settings` route to `frontend/src/app/App.tsx`, inside the existing
      `ProtectedRoute`/`AppShell` route tree.
- [x] 3.6 Add a "Settings" menu item to `frontend/src/features/auth/ui/UserMenu.tsx` (navigates to
      `/settings`), matching the existing theme/sign-out items' `role="menuitem"` shape.

## 4. ### Tests

- [x] 4.1 Add `settingsSlice.test.ts` covering each thunk's success/failure path (fetch
      preferences, save preferences, fetch/delete/clear agent memory) and the resulting
      status/error state transitions.
- [x] 4.2 Add `PreferencesEditor.test.tsx` covering: populated render, empty-defaults render, edit
      + save persists the edited fields, `extras`/unexposed-`defaultPanelStyle`-key preservation
      on save (assert the dispatched save payload still carries the originally-fetched `extras`
      and any unedited `defaultPanelStyle` keys), and a non-string `namingConventions` value
      (e.g. `{"titleCase": true}`) survives an edit-and-save cycle unchanged — asserting it is
      neither dropped nor coerced to a string in the dispatched save payload.
- [x] 4.3 Add `AgentMemoryList.test.tsx` covering: populated render, empty state, never-used entry
      renders without a fabricated last-used value, delete requires confirm (cancel leaves the
      entry, confirm removes it), and "Clear all" requires confirm (cancel leaves all entries,
      confirm removes all).
- [x] 4.4 Add `SettingsPage.test.tsx` covering loading/error states and that both child sections
      render once their fetches succeed.
- [x] 4.5 Run `npm run lint` (zero warnings), `npm run format:check`, and `npm test`; confirm no
      unjustified `any` in any new file.
