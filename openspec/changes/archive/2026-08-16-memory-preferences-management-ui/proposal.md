## Why

Durable agent memory + preferences (420-A/HEL-472, 420-B/HEL-478, both merged, now wired into
grounding by 420-C/HEL-521) are only trustworthy if the user can see and control what is stored.
Without a management UI, memory is an opaque black box — a non-starter for user trust and a
prerequisite for the privacy controls in 420-E (HEL-531).

## What Changes

- Add the app's first settings surface: a new `settings` feature folder (service + Redux slice +
  UI), a `/settings` route, and a "Settings" entry in the existing account menu (`UserMenu.tsx`).
- **Preferences editor**: default series colors (add/remove/edit hex swatches), default panel
  style (background/text color + transparency — the three fields HEL-472's own ticket named as
  the `defaultPanelStyle` example), and naming conventions (a generic key/value editor, since no
  concrete sub-fields are defined anywhere in the codebase). An explicit "Save" action, not
  auto-save. Any keys already present in `defaultPanelStyle`/`extras` that this editor doesn't
  expose are preserved verbatim on save (read-modify-write), never silently dropped.
- **Agent memory list**: kind/content/last-used per entry, per-entry delete and "Clear all", both
  using this codebase's established **inline confirm** pattern (`MetricListTable.tsx`) — never
  `window.confirm`, which was deliberately removed from every other delete flow in this app.
- Typed service functions (`GET`/`PUT /api/preferences`, `GET`/`DELETE /api/agent/memory[/:id]`)
  and typed wire-mirroring interfaces; no `any`.

## Capabilities

### New Capabilities

- `settings-preferences-ui`: the preferences view/edit surface (fetch, form state, save,
  reload-persistence).
- `settings-agent-memory-ui`: the agent-memory list/delete/clear-all surface.

### Modified Capabilities

(none — additive; no existing capability's requirements change)

## Impact

- Affected code: `frontend/src/features/settings/` (new: `services/settingsService.ts`,
  `state/settingsSlice.ts`, `types/preferences.ts`, `types/agentMemory.ts`,
  `ui/SettingsPage.tsx`, `ui/PreferencesEditor.tsx`, `ui/AgentMemoryList.tsx`, plus CSS),
  `frontend/src/store/store.ts` (register `settingsReducer`), `frontend/src/app/App.tsx` (new
  `/settings` route), `frontend/src/features/auth/ui/UserMenu.tsx` (new "Settings" menu item).
- No backend changes — `GET/PUT /api/preferences` and `GET/POST/DELETE /api/agent/memory[/:id]`
  already exist (420-A/420-B, merged).
- No changes to any existing route, slice, or component beyond the two small, additive wiring
  points above (`store.ts`, `UserMenu.tsx`).
