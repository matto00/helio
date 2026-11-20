## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/sign-out-client-state-reset/spec.md,
specs/palette-recent-navigation/spec.md, and the scratch inventory
(`.concertino/scratch/HEL-1634/client-state-inventory.md`). I spot-checked the inventory against
`frontend/src` at HEAD 917c89172c1644a0bc08a4f55ec8bf413633bbff. The change dir is untracked, so there
is no diff yet.

### What I verified (with evidence)

- **Sign-out paths.** `logout` (authSlice.ts:149-162) calls `resetOutputFreshness()`, `clearKeptDrafts()`
  and `await awaitWarmClear()`, then dispatches `clearAuth`. The 401 interceptor (httpClient.ts:42-43)
  dispatches `{type:"auth/clearAuth"}` and then calls `navigate("/login")`. A failed `rehydrateAuth`
  also dispatches `clearAuth` (authSlice.ts:72). Rehydrate is skipped on the public viewer route
  (App.tsx:400,421-427), and `PublicDashboardViewerPage` uses no Redux, so a boot-time `clearAuth` doesn't
  hurt the anonymous public view. Context claims confirmed.
- **23 slices, 7 handling `clearAuth`.** Confirmed in store.ts:44-68.
- **Generation-reset hole.** Confirmed. In outputHistoryCache.ts:36-41 `loadHistory` captures
  `generations.get(key) ?? 0`, and `resetHistoryCache` (:95-102) calls `generations.clear()`. An in-flight
  load from generation 0 therefore passes the check after a reset. provenanceCache.ts:35-41,77-84 has the
  same shape.
- **D2: `unwrap()` survives a dropped action.** Confirmed in
  `frontend/node_modules/@reduxjs/toolkit/src/createAsyncThunk.ts:725-734`. `dispatch(finalAction)` is
  skipped only for condition rejections, and `return finalAction` does not depend on the reducer.
  Middleware order is sound: prepending before the listener middleware means the listeners never see a
  dropped `fetchPanels.fulfilled`. `warmListeners.ts:152-170` fetchStart bookkeeping is wiped by
  `clearWarmState` anyway. No RTK Query is in use (grep for `createApi`/`fetchBaseQuery` found only an
  unrelated identifier).
- **D1 and the state-transition listeners.** recentVisitsListeners.ts: the visit listener returns on a
  `null` selection, and the prune listeners fire only on a transition *into* `succeeded`, so a reset to
  initial state triggers neither. dashboardTabsListeners.ts:41-196: every tab predicate requires
  `dashboardTabs.hydrated`, and the C1 snapshot listener requires `activeTabIsLoaded`. Both are false
  after the reset, which is already true today because `dashboardTabs` resets on `clearAuth`. I found no
  listener that misfires on the root reset.
- **D4 tab dot.** Checked changeRule.ts, dashboardTabsSelectors.ts, useChangedDashboardIds.ts and
  homeSummarySlice.ts:42-58. See CR6.
- **Toasts.** Checked toastsSlice.ts:45-51, PatchSetReviewPage.tsx:118-135 and
  deniedPipelinesToast.ts:35-41. A grep for any "Signed out" toast found none in frontend/src; the only
  hit is an audit-label string. See CR1.
- **Plain actions dispatched inside thunks after an await.** grep over the `createAsyncThunk` files
  found: settingsSlice.ts:339-345 (`redeemInviteCodeThunk` dispatches `setAuth({user})`),
  combinedProposalsSlice.ts:35-36 (`dashboardUpserted` + `setSelectedDashboardId`),
  dashboardsSlice.ts:258 (`dashboardUpserted`), datasetRowsSlice.ts:203 (`pushCursorStack`) and
  hydrateTabs.ts. See CR2.
- **Declaration shapes the guard will meet.** recentHistoryStore.ts:173 and dashboardSeenStore.ts:110 are
  `export const x = createXStore()` (closure state). modalDialogRegistry.ts:6 is a mutable module-level
  array. The other target caches are column-0 `new Map`/`new Set`. See CR5.

### Verdict: REFUTE

The architecture is right: root-reducer reset, one hook registry and a session epoch. But four of the
design's load-bearing claims are false against the code, and the guard has holes that defeat its
purpose (AC: "a guard test fails when a new module-level cache ... is added without registering").

### Change Requests

1. **D1 keeps `toasts` on a false premise, and points to a task that doesn't exist.**
   - The reason "transient UI notices, not user data" is wrong. Sticky toasts (`duration: 0`, never
     auto-dismissed, exempt from eviction under toastsSlice.ts:45-51) carry the previous user's data and
     live closures:
     - PatchSetReviewPage.tsx:118-135 ("Applied." + Undo). Its `onClick` dispatches
       `undoPatchSet({applicationId, patchSet})`. If B clicks it, a request goes out with A's ids.
     - deniedPipelinesToast.ts:35-41 ("Run to update"). Its message lists A's pipeline names.
   - No "Signed out" toast exists to preserve.
   - D1 says "Task 2.x verifies whether any toast carries user data", but tasks.md has no such task.
   - Required: reset `toasts` like every other slice (drop `KEEP_ACROSS_SIGN_OUT`, or leave it empty with
     the reason recorded). Add a unit test: a sticky action toast is gone after `clearAuth`.
2. **D2 doesn't cover plain actions that a thunk dispatches after an await, so the spec's
   "a load started before sign-out cannot repopulate state" is not met.**
   - The middleware gates only `fulfilled`/`rejected`. These thunks dispatch ordinary actions after their
     request settles, and those actions pass through untouched:
     - `settings/redeemInviteCode` → `setAuth({user: A})` (settingsSlice.ts:345). If it lands after B
       signs in, it replaces B's `currentUser` with A. That is the worst case in this ticket.
     - `combinedProposals` → `dashboardUpserted(A's dashboard)` + `setSelectedDashboardId(A's id)`
       (combinedProposalsSlice.ts:35-36). B's list then shows A's dashboard, and B's client fetches panels
       by A's id.
     - `dashboards/updateDashboardLayout` → `dashboardUpserted` (dashboardsSlice.ts:258).
     - `datasetRows` → `pushCursorStack` (datasetRowsSlice.ts:203).
     - hydrateTabs.
   - Required:
     - Enumerate, by script (committed with the inventory), every post-await `dispatch(` in thunk bodies
       and listener effects.
     - Make each one epoch-checked: capture `getSessionEpoch()` at start and skip the dispatch when it has
       changed, or use a shared helper.
     - Add late-response tests for `redeemInviteCodeThunk` (B's `currentUser` survives) and the combined
       proposal apply.
     - Correct D2's claim to match whatever is actually covered.
3. **D2's blanket `auth/` exemption lets a stale `auth/updateUserPreferences.fulfilled` land.**
   - That reducer (authSlice.ts:385-390) merges `action.payload` into whatever `currentUser` exists. A's
     late preferences response would be merged into B's user, including whatever preferences it carries
     (accent, zoom levels, tabs).
   - Required: narrow the exemption to the lifecycle thunks that must always land:
     `auth/rehydrateAuth`, `auth/login`, `auth/register`, `auth/handleOAuthCallback`, `auth/verifyMfa`
     and `auth/logout`.
   - Add a test that a late `updateUserPreferences.fulfilled` is dropped.
4. **D3 says to register each cache's "existing reset function", but those are test seams that destroy
   live subscriptions.**
   - `resetHistoryCache` clears `listeners`; `resetProvenanceCache` clears `listeners` and
     `invalidationListeners`. Both do it without notifying anyone. Any surviving subscriber
     (`useSyncExternalStore`) would silently stop receiving updates, and would never be told its data was
     dropped.
   - Required: the production hooks clear the data maps (values, promises, in-flight status, retry
     timers), notify subscribers, and keep the subscription sets intact. This matches the inventory's own
     recommendation. State it in D3 and test it: a subscriber registered before the reset is notified, and
     still receives updates from a load started after it.
5. **D5: the guard as designed is not reliably failable.**
   - (a) **Existing per-user files that reset by another mechanism don't fit either guard bucket.**
     - Files: outputMetaCache, panelStatusStore, pipelineRunFanout (via `onFreshnessReset`); warmCache,
       restoreMarkers (via `clearWarmState`); tabsPersistence, dashboardTabsListeners `hydratingFor` (via
       a `clearAuth` listener).
     - None of them calls `registerSessionReset`, and listing them under `MODULE_STATE_NOT_USER_DATA`
       would be a false reason.
     - Specify one of two options: migrate them to `registerSessionReset`, or make the guard recognize
       named alternative registrations as a third, explicit category.
   - (b) **The keep list is used for keys that are actually cleared.** `STORAGE_KEYS_KEPT` lists
     `helio-warm` and the pipeline-draft key "because they are cleared by their own registered hook".
     That contradicts the spec ("every key left behind is one the keep list names"), and it stops the
     runtime half from noticing if their clearing breaks. Put them in a separate cleared-by-hook category,
     and have the runtime half assert they are gone.
   - (c) **The scan misses whole declaration shapes.**
     - Factory singletons: `export const recentHistoryStore = createRecentHistoryStore()` and
       dashboardSeenStore.ts:110 both hold state in a closure with no column-0 `new Map` or `let`. They
       are caught today only because they touch localStorage, so a new in-memory store built the same way
       would pass.
     - Module-level mutable arrays and objects (modalDialogRegistry.ts:6).
     - Required: extend the scan to module-level `= create\w*(`, `= new \w+(` and mutable
       `: T[] = []` / `= {}` declarations, with allowlist entries for frozen constants such as `NO_PANELS`.
   - (d) **File-level accounting is too coarse.** Under "every hit file must call `registerSessionReset`",
     adding a second unregistered `new Map()` to a file that already registers (e.g. provenanceCache.ts)
     passes.
     - Required: account per identifier (`file#identifier`) for both the allowlist and the registered
       coverage. For example, a registered module declares the identifiers its hook covers, and the guard
       fails on any detected identifier not covered.
     - Add a third mutation to task 3.3: a new Map in an already-registered file must turn the guard red,
       naming the identifier.
6. **D4, task 3.2 and the proposal's Impact misidentify what `helio.dashboardSeen` feeds.**
   - It doesn't feed the tab "changed" dot. That dot is `selectTabHasChanged` over
     `dashboardTabs.tabs[].lastViewedAt` (from server preferences; dashboardTabsSelectors.ts:8-15).
   - The seen store feeds:
     - the Home shelf dot (`useChangedDashboardIds.ts:11-25`), where a missing view stamp is never a
       dot, so an empty map can't flag anything falsely;
     - `loadHomeSummary`'s `viewedDashboardIds()` request parameter (homeSummarySlice.ts:42-58). Today
       that sends A's viewed dashboard ids in B's Home summary request, which is a direct case of the
       spec's "no request carries A's ids".
   - The conditional ESCALATION in D4/3.2 therefore can never fire, and the test it asks for targets the
     wrong UI.
   - Required:
     - Correct the premise in proposal Impact, D4 and task 3.2.
     - Test the Home shelf dot with an empty map: no dot, and no regression for a returning user beyond
       losing dots until the next view.
     - Make the e2e (D6) assert that B's Home summary request carries none of A's dashboard ids. That is
       a guaranteed red-first signal on current code.

### Non-blocking notes

- The inventory location is stated three ways: proposal (`.concertino/runs/.../evidence/`), design
  ("committed as" the evidence path) and task 1.1 (change dir + persist). Task 1.1 is the operative one;
  align the other two.
- recentHistoryStore and dashboardSeenStore keep an in-memory snapshot as well as localStorage. Their
  reset must clear and notify the in-memory store, not only `removeItem`. D6's "read returns nothing"
  test would catch this, but say so in D4.
- dashboardFoldersSlice.ts:126 `previousFilings` (keyed by requestId) is cleaned in the
  fulfilled/rejected reducers. A dropped action leaves its entry behind, which is a trivial leak. Either
  clear it on reset or note it in its allowlist reason.
- `.then(result => X.fulfilled.match(result) && ...)` continuations in components still run after
  sign-out, even when the reducer action is dropped. Most callers have unmounted. CR2's enumeration
  should include component-level post-await dispatches it can find cheaply, or name this as an accepted
  limit.
