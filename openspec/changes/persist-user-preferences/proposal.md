## Why

User preferences (zoom level per dashboard, global accent color) are currently stored only in client-side
memory or localStorage, so they are lost on device switch or browser clear. This ticket wires up the
already-scaffolded `PATCH /api/users/me/update` endpoint to actually write preferences to the database,
and makes `GET /api/auth/me` return them on load so the frontend can restore the full UX state without
any round-trip after initial auth.

## What Changes

- **New**: Flyway migration adds a `user_preferences` table with per-user global prefs (`accent_color`)
  and a join table `user_dashboard_zoom` for per-dashboard zoom levels.
- **New**: `UserPreferenceRepository` — Slick repository to upsert and query preferences.
- **Modified**: `PATCH /api/users/me/update` — currently a 204 noop; now writes to the database and
  returns 200 with the updated preferences object.
- **Modified**: `GET /api/auth/me` — augments the `UserResponse` with a `preferences` field containing
  `accentColor` (global) and a map of `zoomLevels` (per dashboard ID).
- **Modified**: Frontend `User` type — add optional `preferences` field.
- **Modified**: Frontend `ThemeProvider` — on mount, seed accent color from authenticated user
  preferences (backend) before falling back to localStorage, then default.
- **New**: Frontend zoom UI — controls to increase/decrease zoom level per dashboard (renders the panel
  grid at a CSS `transform: scale(…)` factor), wired to dispatch `updateUserPreferences`.
- **Modified**: Frontend `authSlice` — `updateUserPreferences` thunk now refreshes the stored user
  object with the returned preferences; `rehydrateAuth` / `login` / `register` carry preferences
  through the auth response.

## Capabilities

### New Capabilities
- `user-preferences-persistence`: Backend storage and retrieval of per-user global and per-dashboard
  preferences (accent color, zoom level). Covers migration, repository, updated endpoint behavior, and
  updated auth/me response shape.

### Modified Capabilities
- `user-preference-update`: The endpoint now persists and returns data (was a noop 204); response
  changes from 204 No Content to 200 OK with updated preferences.
- `workspace-accent-color`: Accent color is now sourced from the backend on app load; localStorage
  remains a fallback but is no longer the primary store.
- `frontend-theme-system`: ThemeProvider initialization order changes to prefer backend-provided accent
  color over localStorage.

## Impact

- Backend: new migration file, new repository class, changes to `ApiRoutes.scala`, `JsonProtocols.scala`,
  and `UserResponse`.
- Frontend: `authSlice.ts`, `ThemeProvider.tsx`, `types/models.ts`, `PanelList.tsx` (zoom controls),
  `PanelGrid.tsx` (apply zoom scale), `authService.ts` (response type for update endpoint).
- Tests: `ApiRoutesSpec.scala` needs new cases for persistence; frontend Jest tests for zoom and
  accent-color restoration.

## Non-goals

- Dark/light theme preference is not moved to the backend in this ticket (localStorage-only for now).
- No pagination or multi-user admin view of preferences.
- No migration of existing localStorage accent values to the backend automatically.
