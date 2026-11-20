## Why

Logout and the 401 sign-out both dispatch `clearAuth`, then navigate to `/login` without a page reload. Most client state survives that: 15 of 23 Redux slices, 8 module-level caches and 3 browser storage keys still hold the previous user's dashboards, panels, rows, history, provenance, API tokens and recents. If user B signs in on the same tab, the app can serve user A's data to B. Each past fix added one more scattered reset call, so every new cache is a fresh chance to forget one.

## What Changes

- One central sign-out reset, run on every `clearAuth`:
  - Every Redux slice returns to its initial state unless it is on a named list of slices that handle `clearAuth` themselves.
  - One registry of module-level cache reset hooks. Every per-user module cache registers a hook, and one listener runs all of them.
  - A session epoch, bumped on `clearAuth`. A thunk or cache load started before the bump cannot write its result after it.
- Every per-user cache found by the inventory (committed as `client-state-inventory.md` in this change and persisted to `.concertino/runs/HEL-1634/evidence/`) is reset or registered. That includes the ticket's named caches and everything added since it was filed.
- Per-user browser storage is cleared on sign-out: `helio.recentVisits`, `helio.dashboardSeen` and `sessionStorage` `helio.refinement.conversationId.*`. Device preferences (theme, accent, appearance) and session mechanics are named in an allowlist with a reason, and the reset never touches them.
- A guard test fails when a new module-level mutable cache or browser storage key is added without either registering a reset or being allowlisted with a reason.
- A unit test per cache and slice, plus one e2e: A signs in and opens a dashboard, history and provenance, then signs out. B signs in on the same tab with no reload. Nothing of A's appears and no request uses A's ids.
- Frontend only. No backend change and no migration.

## Capabilities

### New Capabilities
- `sign-out-client-state-reset`: what the web client must discard when a session ends without a reload, what it must keep (device preferences), and how a new piece of per-user client state is kept from escaping the reset.

### Modified Capabilities
- `palette-recent-navigation`: recent visits no longer survive a sign-out. They are cleared on logout and on the 401 sign-out.

## Impact

- `frontend/src/store/store.ts` (root reducer wrapper and epoch middleware), a new shared session-reset module, `features/auth/state/authSlice.ts` (the logout thunk's direct reset calls move into the registry), and every per-user module cache in the inventory.
- The command palette's recents and the dashboard-seen store, which feeds the Home shelf "changed" dot and the viewed-ids parameter of the Home summary request. A returning user starts with empty recents, and the Home shelf shows no dots until they next view a dashboard. The tab "changed" dot reads server preferences and is unaffected.
- Every root-reducer slice is reset, including toasts. Sticky toasts carry the previous user's data and Undo closures.
- New jest tests, a guard test and a new e2e spec. No API, schema or backend change.
