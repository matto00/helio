# HEL-157: Persist zoom level as user preference via batch endpoint

## Description

Add a `user_preferences` table (or equivalent) to store per-user global preferences. Wire the `PATCH /api/users/me/update` stub (scaffolded in HEL-155) to actually persist preferences. On app load, restore saved preferences for the current user.

## Preferences to persist

| Preference | Storage key (current) | Scope |
| -- | -- | -- |
| Zoom level | — (not yet stored) | per-user per-dashboard |
| Accent color | `localStorage "helio-accent"` | per-user global |

Both are currently client-side only. This ticket moves them to the backend so they survive across devices and browser clears.

## Backend

* Flyway migration: create `user_preferences` table (or JSONB column on `users`)
* Implement `PATCH /api/users/me/update` — currently a 204 noop, needs to write to the table
* `GET /api/auth/me` (or a new preferences endpoint) should return saved preferences so the frontend can restore them on load

## Frontend

* Zoom level: dispatch `updateUserPreferences` on zoom change (thunk scaffolded in HEL-155); restore on dashboard load
* Accent color: dispatch `updateUserPreferences` on accent change (currently writes to `localStorage` in `ThemeProvider.tsx`); restore from backend response on app load, falling back to `localStorage` then default

## Endpoint

`PATCH /api/users/me/update` with `{ fields: ["zoomLevel"], user: { zoomLevel: 1.25 } }` or `{ fields: ["accentColor"], user: { accentColor: "#f97316" } }`

## Acceptance Criteria

1. A `user_preferences` table (or JSONB column) exists in the database with at least `zoom_level` (per-dashboard) and `accent_color` (global) fields.
2. `PATCH /api/users/me/update` with `{ fields: ["zoomLevel"], user: { zoomLevel: 1.25 } }` persists the zoom level and returns 200.
3. `PATCH /api/users/me/update` with `{ fields: ["accentColor"], user: { accentColor: "#f97316" } }` persists the accent color and returns 200.
4. `GET /api/auth/me` returns the user object with `preferences` field containing saved `zoomLevel` (per-dashboard) and `accentColor`.
5. On app load, accent color is restored from backend (with fallback to localStorage then default).
6. On dashboard load, zoom level is restored from backend preferences for that dashboard.
7. On zoom change, `updateUserPreferences` is dispatched to persist the change.
8. On accent color change, `updateUserPreferences` is dispatched instead of writing to localStorage directly.
