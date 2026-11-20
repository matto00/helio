## Context

See proposal.md for why. The facts below come from the inventory, which was produced by script over `frontend/src`. Task 1.1 re-verifies it, commits it as `openspec/changes/reset-per-user-state-on-logout/client-state-inventory.md` and persists it to `.concertino/runs/HEL-1634/evidence/`. Rows are claims to re-verify.

- Sign-out triggers:
  - `clearAuth` is dispatched by three paths: the `logout` thunk (after its direct `resetOutputFreshness()`, `clearKeptDrafts()` and `await awaitWarmClear()`), the 401 interceptor (`services/httpClient.ts`, followed by `navigate("/login")`, an SPA navigation with no reload), and a failed `rehydrateAuth`.
  - The public viewer route skips rehydrate and uses no Redux, so a boot-time `clearAuth` does not touch it.
- Slices:
  - 7 of 23 slices handle `clearAuth`.
  - `sourceSamples` keeps an `epoch` that it increments on `clearAuth`. Resetting it to `undefined` would break its own late-load guard.
- Existing sign-out reset paths:
  - `warmListeners.ts` runs `resetOutputFreshness()` and `clearWarmState()` on `clearAuth`. `resetOutputFreshness()` fans out to `onFreshnessReset()` subscribers: outputMetaCache, panelStatusStore and pipelineRunFanout. `clearWarmState` covers warmCache and restoreMarkers.
  - `tabsPersistence` and `dashboardTabsListeners`' `hydratingFor` reset through a `clearAuth` listener.
- **Generation-reset hole.** `resetHistoryCache()` and `resetProvenanceCache()` call `generations.clear()`. An in-flight load captured generation `0`, and after the clear the generation is `0` again, so the late response repopulates the cache.
- **Those reset functions are test seams.** They also clear the `listeners` / `invalidationListeners` sets without notifying anyone, which would silently orphan a live subscriber.
- **Post-await plain dispatches.** Several thunks dispatch ordinary actions after their request settles:
  - `settings/redeemInviteCode` → `setAuth({user})`
  - the combined-proposal apply → `dashboardUpserted` and `setSelectedDashboardId`
  - `updateDashboardLayout` → `dashboardUpserted`
  - `datasetRows` → `pushCursorStack`
  - `hydrateTabs`
- **Toasts carry user data.** Sticky toasts carry the previous user's data and live closures: the patch-set "Applied. Undo" toast calls `undoPatchSet` with A's ids, and the denied-pipelines toast lists A's pipeline names.
- **`helio.dashboardSeen` feeds two things.** It feeds the Home shelf "changed" dot (`useChangedDashboardIds`; a missing view stamp is never a dot) and the `viewedDashboardIds()` parameter of `loadHomeSummary`. Today that parameter sends A's viewed dashboard ids in B's Home summary request. It does **not** feed the tab "changed" dot, which is `selectTabHasChanged` over `dashboardTabs.tabs[].lastViewedAt` from server preferences.

## Goals / Non-Goals

**Goals:**
- One place defines what sign-out discards: a root reducer reset, one registry of module reset hooks, and one session epoch that every late async write checks.
- A guard, accounted per identifier, that makes forgetting a new cache or storage key fail the tests.
- Behaviour-preserving for everything other than sign-out.

**Non-Goals:**
- Component-local React state (`useState`). Both sign-out paths navigate to `/login`, which unmounts the authenticated shell, and the e2e covers this end to end.
- Accepted limit: a component's own `.then(result => ...)` continuation after an await still runs after sign-out if that component is still mounted. Task 1.1's enumeration lists any such continuation that dispatches or writes a cache, and each one gets the epoch check. Continuations that only touch component state are named as an accepted limit in the inventory.
- Multi-tab sign-out propagation and backend or cookie changes.

## Decisions

### D1. The root reducer resets every slice except a named self-resetting set

`store.ts` wraps `combineReducers(...)`. On `clearAuth.match(action)`, a slice on `SELF_RESETTING_SLICES` receives its previous state and resets itself through its own `clearAuth` case. Every other slice receives `undefined` and falls back to its initial state.

`SELF_RESETTING_SLICES` holds `auth` and `sourceSamples`, each with a reason: auth clears its own user; sourceSamples must increment its epoch, not restart it.

`toasts` resets like every other slice. Sticky toasts carry the previous user's data and closures, and no sign-out toast exists to preserve.

Existing `addCase(clearAuth)` lines in other slices are left in place to avoid churn.

`dashboardFolders`' `previousFilings` (keyed by requestId) is emptied by the reset, so an action the epoch middleware drops leaves no leak.

A test asserts that every `RootState` key except those on `SELF_RESETTING_SLICES` equals its initial state after `clearAuth`. A new slice is therefore covered by default.

*Alternative:* `addCase(clearAuth)` in 15 more slices. Rejected because it repeats the scatter.

### D2. A session epoch drops every async write that crosses a sign-out

`shared/session/sessionEpoch.ts` exports `getSessionEpoch()` and `bumpSessionEpoch()`.

**(a) Thunk lifecycle middleware.** It is prepended before the listener middleware. It records `meta.requestId → epoch` on every async-thunk `pending` action (`meta.requestStatus === "pending"`). On the matching `fulfilled` or `rejected` action it always deletes the entry, and it drops the action (never calls `next`) when the epoch has changed.

Exempt by exact type prefix are the lifecycle thunks that must always land: `auth/rehydrateAuth`, `auth/login`, `auth/register`, `auth/handleOAuthCallback`, `auth/verifyMfa` and `auth/logout`. Every other `auth/*` thunk, including `auth/updateUserPreferences`, is epoch-gated.

`unwrap()` callers are unaffected. RTK's thunk returns `finalAction` whether or not the reducer received it (`createAsyncThunk.ts` 725-734).

**(b) Post-await plain dispatches.** Task 1.1 enumerates by script every `dispatch(` that follows an `await` inside a thunk body or a listener effect, and every component `.then` continuation that dispatches. The enumeration is committed with the inventory. Each one goes through a shared helper, `dispatchIfSameSession(dispatch, startEpoch, action)` (or an equivalent epoch check), where `startEpoch` is captured when the thunk or effect begins.

At minimum this covers:
- `redeemInviteCodeThunk`'s `setAuth`. If it lands late, it would replace B's `currentUser` with A.
- the combined-proposal `dashboardUpserted` / `setSelectedDashboardId`
- `updateDashboardLayout`'s `dashboardUpserted`
- `datasetRows`' `pushCursorStack`
- `hydrateTabs`

**(c) Module caches.** Every registered cache that loads asynchronously captures `getSessionEpoch()` when the load starts and discards the result if the epoch has changed when it settles. This closes the generation-reset hole. Generation maps stay in place for in-session invalidation.

### D3. One registry of module reset hooks, whose hooks keep subscriptions alive

`shared/session/sessionReset.ts` exports three functions:
- `registerSessionReset(name, { covers: string[], reset })`: idempotent by name. `covers` lists the module-level identifiers the hook resets, for the guard.
- `runSessionResets()`: runs every hook with per-hook exception isolation.
- `listSessionResets()`.

A single `clearAuth` listener in `store.ts` calls `bumpSessionEpoch()` and then `runSessionResets()`.

**Production hooks are not the test seams.** A hook clears the DATA (values, promises, in-flight status, retry timers, pending write timers) and notifies current subscribers so they re-read an empty state. It keeps the subscriber sets (`listeners`, `invalidationListeners`) intact. The existing `resetHistoryCache` / `resetProvenanceCache` stay test-only. Each cache gets a separate exported `clearForSessionEnd()` (or equivalent).

For in-memory stores backed by browser storage (`recentHistoryStore`, `dashboardSeenStore`), the hook clears the in-memory snapshot and notifies, as well as calling `removeItem`.

**Existing alternative registrations migrate into the registry**, so the guard sees one mechanism:
- `resetOutputFreshness` (and through it outputMetaCache, panelStatusStore and pipelineRunFanout via `onFreshnessReset`) registers as one hook, `outputFreshness`. Its `covers` lists those modules' identifiers. Each subscriber module also declares its identifiers with `declareSessionResetCoverage(file, identifiers, via: "outputFreshness")`, so the per-identifier accounting has an explicit owner.
- warmCache and restoreMarkers declare coverage via `clearWarm`.
- tabsPersistence and dashboardTabsListeners' `hydratingFor` declare coverage via their `clearAuth` listener.
- Kept drafts register `keptDrafts`.

The logout thunk keeps `await awaitWarmClear()`, because its bounded wait before navigation is deliberate (HEL-1575 D5). Its direct `resetOutputFreshness()` and `clearKeptDrafts()` calls are removed, since `clearAuth` reaches the same hooks.

*Alternative:* call each reset from `logout`. Rejected: the 401 path misses them, which is how this ticket arose.

### D4. Per-user browser storage is cleared, not re-keyed

`helio.recentVisits`, `helio.dashboardSeen` and `sessionStorage` `helio.refinement.conversationId.*` are cleared by registered hooks. For the sessionStorage keys, the hook iterates the keys and removes every one with that prefix.

Clearing matches the HEL-1575 warm IndexedDB and HEL-1631 kept-draft precedent: nothing of a signed-out user stays on the device. Keying by user would leave A's dashboard titles readable in B's storage and would need a legacy-key migration.

The effect for a returning user:
- Recents start empty.
- The Home shelf dot shows nothing until the next view. A missing view stamp is never a dot, so nothing is falsely flagged.
- `loadHomeSummary` sends no stale viewed ids.
- The tab "changed" dot is unaffected, because it reads server preferences.

Tests assert:
- the Home shelf dot with an empty seen map is no dot;
- B's Home summary request carries none of A's dashboard ids.

User-keyed keys stay as they are: `helio.telemetry.queue.v1` (events carry a userId and the flush drops other users' events; clearing it would lose undelivered events), `helio.telemetry.firstDashboardRendered.<userId>` and `helio-onboarding-dismissed-<userId>`.

### D5. The keep lists and the guard

`shared/session/sessionStateAllowlist.ts` holds four lists, each entry with a one-line reason:
- `STORAGE_KEYS_KEPT`: keys that legitimately survive sign-out.
  - Device preferences: theme, accent, appearance (left exactly as today's appearance code handles them), and the legacy sidebar-collapsed key.
  - Session mechanics: `helio.auth.returnTo`, `helio.signedIn`.
  - User-keyed by design: the telemetry and onboarding keys above.
- `STORAGE_KEYS_CLEARED_BY_HOOK`: `helio.recentVisits`, `helio.dashboardSeen`, the refinement prefix, the pipeline-draft prefix and the `helio-warm` IndexedDB, each with the hook name that clears it.
- `MODULE_STATE_NOT_USER_DATA`: `file#identifier` entries for module state that holds no user data, each with a reason. Examples: regex and parser memos, focus, shortcut and modal registries, counters, and frozen constants such as `NO_PANELS`.
- Registered coverage: the union of every hook's `covers` and every `declareSessionResetCoverage`.

**Static half (`sessionResetGuard.test.ts`).** It scans non-test files under `frontend/src` for column-0 module-level declarations of these shapes:
- `new Map/Set/WeakMap/WeakSet(`
- top-level `let`
- `= create\w*(` factory singletons
- `= new \w+(`
- mutable arrays and objects: `: T[] = []`, `= []`, `= {}`, with `as const` / `Object.freeze` / `readonly` excluded

Accounting is **per identifier** (`file#identifier`). Every detected identifier must be in registered coverage or in `MODULE_STATE_NOT_USER_DATA`. A second unregistered Map in an already-registered file fails, and the failure names the identifier.

Every `localStorage` / `sessionStorage` key literal or prefix, and every `indexedDB.open` name, must appear in `STORAGE_KEYS_KEPT` or `STORAGE_KEYS_CLEARED_BY_HOOK`.

**Runtime half.** It seeds every key in both storage lists, dispatches `clearAuth` and awaits the hooks. It then asserts:
- every `STORAGE_KEYS_KEPT` key is unchanged;
- every `STORAGE_KEYS_CLEARED_BY_HOOK` key is gone;
- no other key remains.

**Failability.** Prove it red by three mutations:
- an unregistered `new Map()` in a new file;
- an unlisted `localStorage.setItem` key;
- a second unregistered `new Map()` in an already-registered file such as provenanceCache.ts.

Each failure must name the identifier or key.

### D6. Proof

- One jest test per reset slice, cache and storage key: seed A's data, `clearAuth`, then assert the read returns nothing of A's.
- Late-response tests, each starting the load, dispatching `clearAuth`, then resolving:
  - every async module cache: not stored;
  - one real gated thunk, `fetchPanels`: dropped;
  - `auth/updateUserPreferences.fulfilled`: dropped, B's preferences unchanged;
  - `redeemInviteCodeThunk`: B's `currentUser` survives;
  - the combined-proposal apply: B's dashboards and selection unchanged.
- Subscriber-preservation test per registered cache: a subscriber registered before the reset is notified, and still receives a load started after it.
- Toast test: a sticky action toast is gone after `clearAuth`.
- Home shelf dot and Home summary request tests (D4).
- e2e `e2e/hel1634-logout-user-switch.spec.ts`. It creates two users.
  - A signs in, opens a dashboard, a panel's history and provenance, and the palette.
  - A signs out, and B signs in on the same page with no full-document reload.
  - It asserts A's dashboard name, panel titles, palette recents and history values are absent.
  - It records every request URL and body in B's session and asserts none carries A's dashboard, panel, Output or pipeline ids. That includes the Home summary request's viewed ids, which is red on current code.
- Red first: the jest tests and the e2e run red against unmodified code, and that run is committed before implementation.

## Risks / Trade-offs

- [A non-user slice such as the `assistantModels` catalog loses state on sign-out.] → It costs only a refetch.
- [A late action from a lifecycle thunk is wrongly dropped.] → The exempt list is explicit and tested.
- [A post-await dispatch is missed by the enumeration.] → The enumeration is by script and committed, the e2e request assertion is the end-to-end net, and the spec scenario names the property.
- [The static guard reports false positives.] → Each allowlist entry is one line with a reason.
- [The guard never runs in CI.] → It is a jest test under `frontend/src`, and the three mutation runs prove it can fail.
