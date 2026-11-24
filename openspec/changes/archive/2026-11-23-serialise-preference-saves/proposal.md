## Why

Every write to `PATCH /api/users/me/preferences` is an independent, unordered request. Two quick Appearance changes (Mono then Serif) can land in the wrong order, leaving the server on the older choice while the UI shows the newer one (HEL-1826 CI trace). The same race exists between any two writers of the route (appearance, shell layout, assistant default model, dashboard tabs).

## What Changes

- Add one client-side preferences save serialiser that every writer of `PATCH /api/users/me/preferences` goes through: at most one request in flight; while one is in flight, queued patches are merged (latest value per key) into a single trailing request sent when the in-flight one settles.
- Route `saveAppearancePreferences`, `saveShellPreferences`, `saveAssistantModelPreference` and the dashboard-tabs writes (`patchDashboardTabsRequest` and the hide/pagehide `keepalive` flush) through it.
- Register the serialiser's module state with the HEL-1634 session-reset registry so a sign-out drops any queued patch; a patch queued by user A is never sent after A signs out.
- Restore rapid toggling (no per-save wait) in the HEL-1572 appearance e2e and assert the last choice is stored, read back from the server.
- No backend change: the server already merges per top-level key. A coalesced request is validated all-or-nothing server-side; a request rejected because of one writer's key loses the other keys it carried (accepted, design D3a): failed saves are never re-sent, so the AC's "at most one in flight, plus one trailing" holds on every path.

## Capabilities

### New Capabilities

### Modified Capabilities
- `user-ui-preferences`: adds a requirement that the client serialises and coalesces its preference saves so the stored value always equals the user's last choice.

## Impact

- Frontend: new `frontend/src/features/auth/services/preferencesSaveQueue.ts` (name indicative); `authSlice.ts`, `authService.ts`, `saveAssistantModelPreference.ts`, `tabsPersistence.ts`; session-reset allowlist/guard accounting.
- Tests: new jest unit tests (red first), updated `e2e/hel1572-appearance-preferences.spec.ts`.
- No API, schema or migration change.
