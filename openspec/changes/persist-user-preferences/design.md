## Context

HEL-155 scaffolded `PATCH /api/users/me/update` as a 204 noop. `UserPreferencePayload` and
`UpdateUserPreferenceRequest` already exist in `JsonProtocols.scala`. `UserPreferencePayload` carries
only `zoomLevel: Option[Double]` — accent color has not been added to the payload yet.

The frontend has `updateUserPreferences` thunk, `updateUserPreferencesRequest` service, and
`UserPreferencePayload` type. The `ThemeProvider` currently writes accent color exclusively to
localStorage. Zoom level has no UI yet.

## Goals / Non-Goals

**Goals:**
- Persist accent color and per-dashboard zoom level in the database.
- Return persisted preferences on `GET /api/auth/me` so the frontend can restore them without an extra round-trip.
- Add a zoom level control UI in `PanelList` / `PanelGrid`.
- Wire `setAccentColor` in `ThemeProvider` to dispatch `updateUserPreferences` (keep localStorage as fallback).

**Non-Goals:**
- Dark/light theme preference stored in backend.
- Migration of existing localStorage accent values automatically.
- Multi-tenant admin view of preferences.

## Decisions

### D1: Storage shape — single JSONB column on `users` vs. separate `user_preferences` table vs. join table for zoom

**Decision**: Two structures — a nullable `preferences` JSONB column on the `users` table (for global
prefs: `accent_color`), plus a separate `user_dashboard_zoom` table for the per-dashboard zoom mapping.

**Rationale**: The `users` table already exists and a JSONB column minimises schema churn for a small,
flat global preference bag. Per-dashboard zoom is an N:M relationship (user × dashboard) that doesn't
fit a single column cleanly; a join table with `(user_id, dashboard_id, zoom_level)` and a composite PK
is the cleanest normalised representation, and UPSERT on the composite key is straightforward with
Slick's `insertOrUpdate`.

**Alternatives considered**:
- Single `user_preferences` table with columns per field: rigid, every new field is a migration.
- Separate `user_preferences` table with JSONB: adds a table with nearly the same JSONB semantics as
  a column on `users`; unnecessary indirection for a 1:1 relationship.

### D2: `PATCH /api/users/me/update` response — 204 vs. 200 with updated preferences

**Decision**: Change from 204 to 200 and return `{ preferences: { accentColor, zoomLevels } }`.

**Rationale**: The frontend needs the canonical saved value (e.g. after server-side normalization) to
keep Redux state consistent. A 200 with the updated object avoids a follow-up GET. This is a breaking
change from the HEL-155 spec (which required 204), but we self-approve it because the endpoint is not
yet used by any released client.

### D3: Zoom UI — where to render and how to apply

**Decision**: Zoom controls (+/-/reset) in `PanelList`'s header; apply the zoom as a CSS
`transform: scale(zoomLevel)` wrapper div around `<PanelGrid>` with `transform-origin: top left` and
compensated height (`height / zoomLevel`) so the parent scroll container sizes correctly.

**Rationale**: Scale transform is the simplest approach that doesn't require re-laying out the grid.
Putting controls in `PanelList` is consistent with how the add-panel action is already there.

### D4: Accent color — keep localStorage write alongside backend write

**Decision**: ThemeProvider continues to write to localStorage on every accent change (for fast restore
before auth completes), but also dispatches `updateUserPreferences` via Redux if the user is
authenticated. On rehydration, backend value takes precedence over localStorage.

**Rationale**: Avoids a flash of wrong color on first paint — localStorage is synchronous and applied
before the auth thunk resolves.

## Risks / Trade-offs

- [Risk] `users` table JSONB column addition requires a migration on a table that may have rows in
  prod → Mitigation: column is nullable with no default, so no lock-contention or backfill needed.
- [Risk] Zoom transform can cause subpixel rendering artefacts at non-integer scales →
  Mitigation: clamp zoom to two decimal places; document as cosmetic limitation.
- [Risk] Dispatching `updateUserPreferences` from `ThemeProvider` (a Context-level component) creates
  a coupling from the theme layer to Redux → Mitigation: accept it — AccentPicker already receives
  `setAccentColor` from App.tsx; we'll pass dispatch-capable wrapper down the same prop chain.

## Migration Plan

1. Add Flyway migration V18 (preferences JSONB on `users` + `user_dashboard_zoom` table).
2. Update `UserRepository` and add `UserPreferenceRepository`.
3. Update `JsonProtocols`: extend `UserPreferencePayload` with `accentColor: Option[String]`;
   add `UserPreferences` response type; extend `UserResponse` with `preferences: Option[UserPreferences]`.
4. Update `ApiRoutes`: make PATCH handler write to DB and return 200 with preferences; make GET /me
   load and include preferences.
5. Update frontend types, auth slice, ThemeProvider, PanelList/PanelGrid.
6. Update tests.

## Planner Notes

Self-approved: the 204→200 response change is the only breaking API change, but HEL-155 was merged
only for scaffolding and the endpoint has no shipped consumers outside this codebase.
