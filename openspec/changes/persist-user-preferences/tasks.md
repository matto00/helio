## 1. Backend

- [x] 1.1 Add Flyway migration V18: nullable `preferences` JSONB column on `users`, plus `user_dashboard_zoom` table with composite PK and FK constraints
- [x] 1.2 Extend `UserPreferencePayload` in `JsonProtocols.scala` with `accentColor: Option[String]` and `dashboardId: Option[String]`
- [x] 1.3 Add `UserPreferences` response case class to `JsonProtocols.scala` with `accentColor: Option[String]` and `zoomLevels: Map[String, Double]`
- [x] 1.4 Extend `UserResponse` in `JsonProtocols.scala` with `preferences: Option[UserPreferences]`; update `UserResponse.fromDomain` accordingly
- [x] 1.5 Create `UserPreferenceRepository.scala` with `getPreferences`, `upsertGlobalPrefs`, and `upsertDashboardZoom` methods using Slick
- [x] 1.6 Update `Main.scala` to instantiate `UserPreferenceRepository` and pass it to `ApiRoutes`
- [x] 1.7 Update `PATCH /api/users/me/update` in `ApiRoutes.scala`: write to DB via `UserPreferenceRepository`, return 200 with updated `UserPreferences`
- [x] 1.8 Update `GET /api/auth/me` in `ApiRoutes.scala`: load preferences via `UserPreferenceRepository` and include in `UserResponse`

## 2. Frontend

- [x] 2.1 Extend `User` type in `models.ts` with optional `preferences: UserPreferences` field; add `UserPreferences` interface
- [x] 2.2 Extend `UserPreferencePayload` in `models.ts` with `accentColor?: string` and `dashboardId?: string`
- [x] 2.3 Update `updateUserPreferencesRequest` in `authService.ts` to handle 200 response and return `UserPreferences`
- [x] 2.4 Update `updateUserPreferences` thunk in `authSlice.ts` to accept the returned preferences and update `currentUser.preferences` in state
- [x] 2.5 Update `rehydrateAuth`, `login`, `register`, and `handleOAuthCallback` reducers in `authSlice.ts` to call `setAccentColor` with `preferences.accentColor` when present
- [x] 2.6 Add a `zoomLevel` state (per-dashboard) to `PanelList.tsx`; restore from `currentUser.preferences.zoomLevels[dashboardId]` on dashboard change
- [x] 2.7 Add zoom in/out/reset controls to the `PanelList` header; clamp zoom to [0.5, 2.0]; dispatch `updateUserPreferences` on change
- [x] 2.8 Wrap `<PanelGrid>` in `PanelList.tsx` with a scale-transform container; pass `zoomLevel` as prop or via CSS variable
- [x] 2.9 Update `ThemeProvider.tsx` to accept an `onAccentChange` callback prop; call it in the `accentColor` effect so the parent can dispatch to Redux
- [x] 2.10 Wire `onAccentChange` in `App.tsx` (where ThemeProvider is rendered) to dispatch `updateUserPreferences` when authenticated

## 3. Tests

- [x] 3.1 Add `ApiRoutesSpec` cases for `PATCH /api/users/me/update` returning 200 with preferences body
- [x] 3.2 Add `ApiRoutesSpec` case for `GET /api/auth/me` returning preferences field
- [x] 3.3 Add Jest test for `authSlice` — `updateUserPreferences.fulfilled` updates `currentUser.preferences`
- [x] 3.4 Add Jest test for `authSlice` — `rehydrateAuth.fulfilled` calls `setAccentColor` when preferences present
- [x] 3.5 Add Jest test for `PanelList` — zoom controls appear when a dashboard is selected; clicking +/− changes displayed zoom
- [x] 3.6 Add Jest test for `ThemeProvider` — `onAccentChange` callback is invoked when `setAccentColor` is called
