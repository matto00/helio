# HEL-1634 client-state inventory (re-verified in the worktree, task 1.1)

## Re-verification (executor, 2026-11-20)

Every row of the tables below was re-checked against the worktree with the commands in "Reproduce".
Findings:

- 23 slices in `store/store.ts`; exactly 7 handle `clearAuth` (auth, dashboardFolders, homeSummary, dashboardTabs, onboarding, scheduledItems, sourceSamples). Confirmed by `rg -l clearAuth`.
- The 8 un-reset per-user module caches are confirmed present with no production clearAuth reset: provenanceCache, outputHistoryCache, useSavedOutputRows, filterCapabilitiesStore, insightChromeStore, metricComparisonStore, usePipelineOwnership, useContextListLayout `keyWriteTimer`.
- Storage keys confirmed: `helio.recentVisits`, `helio.dashboardSeen`, `helio.refinement.conversationId.*`, `helio.pipelineDraft.*`, `helio.signedIn`, `helio.auth.returnTo`, `helio.telemetry.*`, `helio-onboarding-dismissed-<userId>`, `helio-theme`, `helio-accent`, `helio-appearance`, `helio.sidebarCollapsed` (legacy, read-and-remove), IndexedDB `helio-warm`.
- Additions or corrections to the table (all non-user-data, allowlist `MODULE_STATE_NOT_USER_DATA` in D5): `telemetry/track.ts` lets (`queue`, `flushTimer`, `flushing`, `warned`, `rejectionLogged`, `listenersInstalled`, `currentUserId`) are user-keyed by design; `rowDeleteFocus.ts` (`mode`, `pin`, `pinFrame`, `mounted`, `timer`), `contextListLayout.ts#pendingFocus`, `useShortcut.ts#listenerAttached`, `panelFit.ts#safeAreaProbe`, `chartPanelModule.ts#pending`, `panelStatusStore.ts#visibilityHooked`, `exactSum.ts` / `scalaGroup.ts` typed-array scratch buffers, `draftPreviewCaps.ts#encoder`, `draftPreviewTestSupport.ts#encoder` are UI wiring or scratch, no user data.
- Redux reset hole confirmed: after `clearAuth` nothing resets the 15 slices in Table 1.
- Late-write hole confirmed: `provenanceCache` and `outputHistoryCache` reset only via `generations.clear()` test seams (generation returns to 0).
- Post-await plain dispatch enumeration is appended at the end (command plus output). Lifecycle dispatches (`logout`'s `clearAuth`, `rehydrateAuth`'s `setAuth`/`clearAuth`) are exempt from `dispatchIfSameSession`. Component `.then` continuations that only touch component state are an accepted limit (design Non-Goals).

Worktree: `.claude/worktrees/bug/logout-resets-per-user-caches/HEL-1634`, scope `frontend/src` minus tests. All paths below are relative to `frontend/src`.

## Reproduce (run from `frontend/src`)

```bash
EX='--glob=!*.test.* --glob=!*.spec.* --glob=!**/__tests__/** --glob=!test/**'
# 1. slices + who handles clearAuth / logout
sed -n 1,80p store/store.ts
rg -n "clearAuth|logout|logoutUser" $EX .
for f in features/*/state/*Slice.ts features/*/tabs/*Slice.ts; do echo "$f: $(grep -c 'clearAuth\|logout' $f)"; done
# 2. module-level state
rg -n "^(export )?(const|let|var) \w+(: [^=]+)? = (new (Map|Set|WeakMap|WeakSet)|\[\]|\{\}|null|new \w+)" $EX .
rg -n "^(export )?let " $EX .
rg -n "^(export )?const \w+\s*:\s*[^=]*(Map|Set|Record)<[^=]*=\s*(new |\{\})" $EX .
rg -ln "useSyncExternalStore" $EX .
rg -n "^(export )?const \w+ = (new \w+Store|new \w+Cache|create\w*Store|new \w+Client|axios\.create)" $EX .
rg -n "^(export )?(const|let) " $EX features/ask features/assistant
rg -ln "AbortController\(\)" $EX .
rg -n "onFreshnessReset|resetOutputFreshness|clearWarmState|resetServerClock|clearKeptDrafts|cancelTabsWrite" $EX .
rg -n "resetPipelineOwnership|clearSavedOutputRows|resetInsightChrome|resetCapabilitiesStoreForTests|resetProvenanceCache|resetHistoryCache|resetComparisonStore|resetCsvLimitsCache|setTelemetryIdentity" $EX .
# 3. browser storage
rg -n "localStorage|sessionStorage|indexedDB" $EX .
rg -n "STORAGE_KEY\s*=|_KEY\s*=|_PREFIX\s*=|StorageKey\s*=|storageKey\s*=|dismissedStorageKey|DB_NAME" $EX .
rg -n "BroadcastChannel|serviceWorker|caches\.|StorageEvent" $EX .      # none found
rg -n "urlPattern|cacheName" pwaConfig.ts                                # SW caches only Google Fonts, no API data
```

## How sign-out reaches state today

- Two sign-out paths: the `logout` thunk (`features/auth/state/authSlice.ts:149`) and the 401 interceptor (`services/httpClient.ts:42`, dispatches `{type:"auth/clearAuth"}` then `navigate("/login")`, an SPA navigation, no reload). A failed `rehydrateAuth` also dispatches `clearAuth` (authSlice.ts:72).
- `clearAuth` reducer (authSlice.ts:263) only nulls `currentUser`, sets `status`, clears `mfaChallenge`.
- Listener middleware: `store/listenerMiddleware.ts` exports `startAppListening` (`createListenerMiddleware().startListening.withTypes<RootState, AppDispatch>()`). Registered in `store/store.ts:34-46`: `addToastListeners`, `addRecentVisitsListeners` (record + prune only, NO clear), `registerSignedInHintListener`, `registerKeptDraftClearListener`, `addDashboardTabsListeners` (which also registers the warm listeners).
- Existing reset precedents:
  - `features/dashboards/tabs/warm/warmListeners.ts:215-220`: on `clearAuth` runs `resetOutputFreshness()` + `clearWarmState()` (warmCache.ts:193: store.clear -> deletes IndexedDB `helio-warm`, `lists`, `ownWrites`, `fetchStarts`, restore markers, retentions, `resetServerClock()`).
  - `resetOutputFreshness()` (`features/panels/state/outputFreshness.ts:100`) runs `resetHooks`; siblings register with `onFreshnessReset(hook)`. Registered today: `outputMetaCache` (cache, knownKinds, panelScopes), `panelStatusStore` (clearAll), `pipelineRunFanout` (lastObservedRunIdByPipeline). Also called directly from the `logout` thunk (authSlice.ts:156), so logout runs it twice (idempotent).
  - `features/pipelines/state/keptDraftListeners.ts`: `clearKeptDrafts()` on `clearAuth` (also called in the logout thunk, authSlice.ts:158).
  - `features/dashboards/tabs/dashboardTabsListeners.ts:191-196`: on `clearAuth` resets `hydratingFor`, `cancelTabsWrite()`.
  - `features/auth/state/signedInHint.ts`: listener on `auth.status` transitions removes `helio.signedIn` on unauthenticated.
  - `theme/useAppearanceState.ts:57`: `clearAppearanceCache()` when `preferred === null` (signed out), render-time hook, not a clearAuth listener.
  - `sourceSamplesSlice` has an `epoch` bumped by `clearAuth`, to discard in-flight responses (the only in-flight-race guard in the codebase).
- Caveat that applies to every row marked RESET: an async thunk / fetch started by the old user can resolve AFTER `clearAuth` and repopulate a slice or cache for the next user. Only `sourceSamples` (epoch) and the warm store (epoch) guard against this. A generic reset should either bump a session epoch checked in `.fulfilled`/loaders, or accept the race and document it.
- In-component state (`useState`, hook-local, `useAsk`, AuthoringChat/Refinement drawers, assistant composer) dies when the route unmounts at `/login`; not inventoried as persistent state. `features/ask/**` and `features/assistant/**` have NO module-level mutable state (only constants/pure helpers); their server data lives in the `assistantConversations` / `assistantModels` slices.

## Table 1: Redux slices (23 registered in `store/store.ts:56-80`)

| Slice (state key) | File:line | Holds | User-specific? | Existing reset fn | Reset on clearAuth today? | Recommended |
|---|---|---|---|---|---|---|
| auth | features/auth/state/authSlice.ts:263 | currentUser (id, email, preferences), status, mfaChallenge | yes, it is the identity | `clearAuth` reducer | YES (is the action) | RESET (already) |
| assistantConversations | features/assistant/state/assistantConversationsSlice.ts:64 | the user's conversation summaries, selected id, errors | yes: server list of the user's chats | none | NO | RESET |
| assistantModels | features/assistant/state/assistantModelsSlice.ts:9 | model list + `defaultModel` resolved for this caller (per-user default, tier gated) | yes: caller-resolved default and tier gating | none | NO | RESET |
| auditEvents | features/audit/state/auditEventsSlice.ts:18 | audit event rows, total | yes: owner-tier audit data | none | NO | RESET |
| connectors | features/connectors/state/connectorsSlice.ts:21 | connector list, delete conflicts | yes: owned connectors | none | NO | RESET |
| dashboardFolders | features/dashboards/state/dashboardFoldersSlice.ts:134 | folders + dashboard->folder assignments | yes | `clearAuth` case -> initialState | YES (slice:134) | RESET (already) |
| dashboards | features/dashboards/state/dashboardsSlice.ts:35 | dashboard list, selectedDashboardId, layout flags | yes: owned/shared dashboards | none | NO | RESET |
| homeSummary | features/home/state/homeSummarySlice.ts:102 | home summary data, receivedAt | yes | `clearAuth` case | YES | RESET (already) |
| dashboardTabs | features/dashboards/tabs/dashboardTabsSlice.ts:155 | open dashboard tabs, activeId, hydrated | yes | `clearAuth` case | YES | RESET (already) |
| layoutHistory | features/layout/state/layoutHistorySlice.ts:21 | per-dashboard layout undo/redo stacks, edit-mode ids | yes: layout of the user's dashboards | none | NO | RESET |
| onboarding | features/onboarding/state/onboardingSlice.ts:82 | active flag, per-user `dismissed` | yes | `clearAuth` case | YES | RESET (already) |
| panels | features/panels/state/panelsSlice.ts:32 | panel list of loaded dashboard, pending updates, pagination, selections | yes | none | NO | RESET |
| patchSets | features/patchSets/state/patchSetsSlice.ts:28 | patch-set preview + apply/undo status | yes (proposal contents) | none | NO | RESET |
| pipelines | features/pipelines/state/pipelinesSlice.ts | pipeline list/detail, steps, run history | yes | none | NO | RESET |
| outputs | features/pipelines/state/outputsSlice.ts:60 | Outputs by pipeline, capabilities, preview cache by key | yes | none | NO | RESET |
| scheduledItems | features/pipelines/state/scheduledItemsSlice.ts | scheduled pipelines/sources list, fetchedAt | yes | `clearAuth` case | YES | RESET (already) |
| combinedProposals | features/proposals/state/combinedProposalsSlice.ts:8 | `applying` flag + error string only | weak: transient flag/error, no data | none | NO | RESET (cheap; error text could echo content) |
| settings | features/settings/state/settingsSlice.ts:59 | agent preferences, agent memory entries, API tokens incl. shown-once `createdToken`, MFA backup codes | yes, and sensitive | none | NO | RESET (highest priority: secrets) |
| shareTokens | features/dashboards/state/shareTokensSlice.ts:41 | per-dashboard share tokens + shown-once created token | yes, sensitive | none | NO | RESET (high priority: secrets) |
| sources | features/sources/state/sourcesSlice.ts:35 | source list, selection, references summary | yes | none | NO | RESET |
| datasetRows | features/sources/state/datasetRowsSlice.ts:58 | per-source dataset schema + rows + cursors | yes: actual row data | none | NO | RESET (high priority: row data) |
| sourceSamples | features/sources/state/sourceSamplesSlice.ts:124 | engine-loaded source sample rows | yes: row data | `clearAuth` case (+epoch) | YES | RESET (already) |
| toasts | features/toasts/state/toastsSlice.ts:25 | transient toast queue | mostly no: UI notices (text may name a resource, lifetime seconds) | none | NO | ALLOWLIST-NON-USER (transient; a "signed out" toast may be wanted to survive) |

Redux counts: 23 slices. Already reset: 7 (auth, dashboardFolders, homeSummary, dashboardTabs, onboarding, scheduledItems, sourceSamples). Per-user and NOT reset: 15. Allowlist: 1 (toasts).

## Table 2: Module-level state (non-slice)

| Name | File:line | Holds | User-specific? | Existing reset fn | Reset on clearAuth today? | Recommended |
|---|---|---|---|---|---|---|
| outputFreshness maps (outputGeneration, pipelineGeneration, pipelineOfOutput, retention, globalGeneration) | features/panels/state/outputFreshness.ts:19-25 | run/invalidate generations, retention counts | ids only, derived from server | `resetOutputFreshness` (:100) | YES (warmListeners.ts:218, logout thunk) | RESET (already) |
| outputMetaCache (cache, panelScopes, knownKinds) | features/panels/state/outputMetaCache.ts:29,41,74 | `GET /api/outputs/:id` metadata, per-panel scope, kinds | yes: Output config/schema | `onFreshnessReset` hook (:75) | YES via resetOutputFreshness | RESET (already) |
| panelStatusStore (entries, seeds) | features/panels/state/panelStatusStore.ts:42,47 | polled `panel-status` snapshots, 15 s timers | yes | `clearAll` via `onFreshnessReset` (:222) | YES | RESET (already) |
| pipelineRunFanout `lastObservedRunIdByPipeline` | features/panels/services/pipelineRunFanout.ts:49 | last terminal run id per pipeline | ids from server | `onFreshnessReset` (:51) | YES | RESET (already) |
| pipelineRunFanout `entries` | features/panels/services/pipelineRunFanout.ts:41 | live SSE subscriptions (AbortController, listeners), ref-counted by mounted cards | live connections, not cached data | closed by last unsubscribe | indirect (cards unmount at `/login`) | ALLOWLIST-NON-USER (verify SSE closes when cards unmount; no data held) |
| warmCache (lists, ownWrites, fetchStarts, retentions, `store`) | features/dashboards/tabs/warm/warmCache.ts:28-33 | warm copies of dashboard panel lists + IndexedDB store | yes | `clearWarmState` (:193) | YES (warmListeners.ts:219; logout awaits via clearWarmHook) | RESET (already) |
| restoreMarkers (markers) | features/panels/state/restoreMarkers.ts:14 | warm-restore markers per dashboard/panel | ids | `clearRestoreMarkers` | YES, called inside `clearWarmState` | RESET (already) |
| serverClock `serverOffsetMs` | features/dashboards/tabs/serverClock.ts:7 | client/server clock offset | no (clock) | `resetServerClock` | YES inside `clearWarmState` | ALLOWLIST-NON-USER (harmless either way) |
| clearWarmHook `hook` | features/dashboards/tabs/warm/clearWarmHook.ts:7 | registered fn pointer | no | n/a | n/a | ALLOWLIST-NON-USER (plumbing) |
| dashboardTabsListeners `hydratingFor` | features/dashboards/tabs/dashboardTabsListeners.ts:32 | user id the tab hydration ran for | yes (id guard) | reset in clearAuth listener | YES (:191-196) | RESET (already) |
| tabsPersistence `timer`/`pending` | features/dashboards/tabs/tabsPersistence.ts:30-31 | queued tabs wire for `PATCH /users/me/preferences` | yes | `cancelTabsWrite` (:70) | YES (listener :195) | RESET (already) |
| provenanceCache (promises, values, generations, inFlightStatus, listeners) | features/panels/provenance/provenanceCache.ts:8-14,89 | per-Output / per-panel provenance + assertion status | yes: lineage, source names | `resetProvenanceCache` (:77, "test seam", no prod caller) | NO | RESET (needs wiring to clearAuth; keep subscriber `listeners` sets, clear only data maps) |
| outputHistoryCache (promises, values, generations, retryTimers) | features/panels/history/outputHistoryCache.ts:8-12 | run history points, sparkline, deltas | yes | `resetHistoryCache` (:95, test seam) | NO | RESET (also clear retry timers) |
| useSavedOutputRows `cache`/`version` | features/pipelines/hooks/useSavedOutputRows.ts:17-19 | saved Output row pages (`GET /outputs/:id/rows`) | yes: row data | `clearSavedOutputRows` (:33; called on run settle/unmount only) | NO | RESET |
| filterCapabilitiesStore `entries` | features/panels/state/filterCapabilitiesStore.ts:30 | per-panel filter capabilities (TTL) | yes (Output schema/columns) | `resetCapabilitiesStoreForTests` (:101) | NO | RESET |
| insightChromeStore `entries` | features/panels/insight/insightChromeStore.ts:18 | updated-at + refresh action published by mounted insight bodies | yes while mounted (render time, callbacks) | `resetInsightChrome` (:49) | NO | RESET (also re-registered by mounted bodies, low risk) |
| metricComparisonStore `slots` | features/panels/history/metricComparisonStore.ts:11 | published baseline text per panel | yes: baselines derived from run history | `resetComparisonStore` (:61) | NO | RESET |
| usePipelineOwnership `ownerByPipeline` | features/panels/insight/usePipelineOwnership.ts:11 | promise of `Pipeline.ownerId` per pipeline id (a 403 for the old user is cached as `null`/false, which then WRONGLY applies to the next user) | yes: result depends on the caller | `resetPipelineOwnership` (:13) | NO | RESET (correctness bug as well as leak: cached `false`) |
| telemetry track queue (`queue`, flush state, `currentUserId`) | features/telemetry/track.ts:27-33 | queued events, each tagged `userId`; `flush` drops events whose userId differs from the current user and sends nothing when signed out | yes, but user-keyed | `resetTelemetryForTests` | no, by design (events must survive to be flushed) | USER-KEY (already: flush filters foreign events) |
| firstDashboardFlag `pending` | features/telemetry/firstDashboardFlag.ts:6 | set of user ids with an undelivered event | user-keyed | `resetFirstDashboardStateForTests` | no | USER-KEY (already) |
| DashboardChipRow `sessionOrder` | features/dashboards/ui/DashboardChipRow.tsx:17 | `{userId, ids}` chip order | yes, but user-keyed (ignored when userId differs) | `resetDashboardChipOrderForTests` | no | USER-KEY (already) |
| useContextListLayout `keyWriteTimer` | app/shell/useContextListLayout.ts:37 | pending debounced `saveShellPreferences` (keyboard width nudge) | yes (a write): if it fires after sign-in as another user it PATCHes that user's prefs with the old user's width | private `cancelKeyWrite` | NO | RESET (cancel on clearAuth; tiny window, low severity) |
| dashboardFoldersSlice `previousFilings` | features/dashboards/state/dashboardFoldersSlice.ts:126 | requestId -> prior folder, only between a move's pending and settle | ids, transient | none | NO | ALLOWLIST-NON-USER (self-cleaning bookkeeping; reducer already resets) |
| csvSourceCreate `csvLimitsPromise` | features/sources/utils/csvSourceCreate.ts:19 | backend CSV caps (`GET /api/data-sources/csv-limits`, server config, not tier-dependent) | no | `resetCsvLimitsCache` | no | ALLOWLIST-NON-USER (global server config) |
| useFirstMountForToken `seen` | shared/motion/useFirstMountForToken.ts:3 | `scope -> tokens` ("panel-grid-entrance": `dashboardId:loadId`) for entrance animation | opaque ids only, UI | `resetFirstMountRegistryForTests` | no | ALLOWLIST-NON-USER (animation gate; at worst skips one entrance animation) |
| useNow `tickers` | hooks/useNow.ts:15 | interval tickers | no | test reset | no | ALLOWLIST-NON-USER |
| Toast `toastLife` | shared/ui/Toast.tsx:38 | toast timers | no | none | no | ALLOWLIST-NON-USER |
| draftPreviewRequest `frameIds`/`encoded` WeakMaps, `nextFrameId` | features/pipelines/state/draftPreviewRequest.ts:14,15,27 | WeakMap memo keyed by frame object identity | derived from row data but weakly held, unreachable once frames are dropped | none | no | ALLOWLIST-NON-USER (WeakMap; frames come from slice state that IS reset) |
| draftEvaluation `columnTypeCache` | features/pipelines/state/draftEvaluation.ts:140 | WeakMap Frame -> schema | same as above | none | no | ALLOWLIST-NON-USER |
| sourceSamplesSlice `decoded` | features/sources/state/sourceSamplesSlice.ts:143 | WeakMap SourceSample -> Frame | same | none | no | ALLOWLIST-NON-USER |
| draftPreviewScheduler closure state (`pending`, `inFlight` AbortController, timers) | features/pipelines/services/draftPreviewScheduler.ts:56-63 | per-hook-instance request queue | per instance, `disposed` on unmount | `dispose` | n/a (unmounts) | ALLOWLIST-NON-USER |
| draftPreviewClient, stepNarrowing `stepCounter`, nodeCapabilities, panelControlColumns, formUploadConfig, viewerControlValues | features/pipelines/services/draftPreviewClient.ts:28,37; features/pipelines/state/stepNarrowing.ts:379; others | constant sets, id counters | no | n/a | n/a | ALLOWLIST-NON-USER (constants / counters) |
| evaluator caches (`compile.ts:35` expression cache, `javaRegex.ts:284`, `scalaGroup.ts`, `exactSum.ts`) | features/pipelines/evaluator/** | memoised parsed expressions / regexes, scratch buffers | keyed by expression text, no row data | none | no | ALLOWLIST-NON-USER (pure computation) |
| chart/format helpers (`chartTimeAxis.ts:65-67`, `chartAppearance.ts:128`, collators in `inspectColumnOrder.ts`, `tableRendererModel.ts`, `DataGrid.tsx`) | utils/**, features/panels/ui/** | regexes, Intl objects | no | n/a | n/a | ALLOWLIST-NON-USER |
| chartPanelModule `pending` | features/panels/ui/renderers/chartPanelModule.ts:8 | lazy-loaded chart chunk promise | no | n/a | n/a | ALLOWLIST-NON-USER |
| UI registries: `shared/chrome/useShortcut.ts:37`, `shared/chrome/rowDeleteFocus.ts:18-22`, `shared/ui/modalDialogRegistry.ts:6-8`, `app/shell/contextListLayout.ts:23`, `shared/ui/panelFit.ts:56`, `features/commandPalette/model/commandRegistry.ts`, `features/panels/ui/grid/pullRefreshRegistry.ts`, `hooks/useNow.ts` | various | shortcut/modal/focus/pull-refresh registrations, DOM refs | no (UI wiring, owned by mounted components) | n/a | n/a | ALLOWLIST-NON-USER |
| id counters: `FieldDeclarationTable.tsx:27`, `PreferencesEditor.tsx:48`, `useFormEditorState.ts:197`, `toastsSlice.ts:33`, `useRunHistory.ts:12`, `useSavedOutputRows` `version` | various | monotonic counters | no | n/a | n/a | ALLOWLIST-NON-USER |
| httpClient (axios instance + interceptors) | services/httpClient.ts:12 | cookie-credential axios instance, 401 interceptor | no data (session is an HttpOnly cookie) | n/a | n/a | ALLOWLIST-NON-USER |
| features/ask/**, features/assistant/** | n/a | no module-level mutable state found | n/a | n/a | n/a | n/a (state is hook-local or in the slices above) |

Module-level counts: already reset on clearAuth 8 (outputFreshness, outputMetaCache, panelStatusStore, fanout lastObserved, warmCache, restoreMarkers, hydratingFor, tabsPersistence); user-keyed already 3 (telemetry queue, firstDashboardFlag, chip order); per-user NOT reset 8 (provenanceCache, outputHistoryCache, useSavedOutputRows, filterCapabilitiesStore, insightChromeStore, metricComparisonStore, usePipelineOwnership, useContextListLayout timer); the rest ALLOWLIST-NON-USER.

## Table 3: Browser storage

| Key / DB | Store | File:line | Holds | User-keyed? | Cleared on clearAuth today? | Class | Recommended |
|---|---|---|---|---|---|---|---|
| `helio.auth.returnTo` | sessionStorage | features/auth/utils/postLoginReturnTo.ts:14 | pre-login return path, consumed once (read removes it) | no | removed on read; not on clearAuth | SESSION-MECHANICS | ALLOWLIST-NON-USER (must survive the OAuth redirect; consumed immediately) |
| `helio.signedIn` | localStorage | features/auth/state/signedInHint.ts:9 | "1" hint for the static landing page | no (no identifier) | YES: listener removes it on `unauthenticated` | SESSION-MECHANICS | ALLOWLIST-NON-USER (already managed by auth.status listener) |
| `helio.dashboardSeen` | localStorage | features/commandPalette/model/dashboardSeenStore.ts:13 | dashboardId -> `{viewedAt, ownWriteAt}`, read by `homeSummarySlice` / `useChangedDashboardIds` for the "changed" dot | NO (one global key) | NO (store has no clear fn) | PER-USER | RESET (preferred: remove key + notify store on clearAuth) or USER-KEY (suffix with userId) |
| `helio.recentVisits` | localStorage | features/commandPalette/model/recentHistoryStore.ts:32 | recent dashboard/source/pipeline ids AND TITLES (shown in palette + `ScheduledContextList`) | NO | NO (listeners only record/prune; prune runs after the next user's lists load, so titles are visible until then and any id shared between users stays) | PER-USER | RESET (clear key + store snapshot on clearAuth) or USER-KEY |
| `helio.pipelineDraft.<pipelineId>` | sessionStorage | features/pipelines/state/keptDraft.ts:9 | unsaved pipeline draft per pipeline id | no (per pipeline id) | YES (`clearKeptDrafts` via keptDraftListeners + logout thunk) | PER-USER | RESET (already) |
| `helio.refinement.conversationId.<dashboardId>` | sessionStorage | features/dashboards/ui/RefinementChatDrawer.tsx:35 | refinement/authoring conversation id for a dashboard | no (per dashboard id) | NO (only cleared on error/reset in the drawer) | PER-USER | RESET (prefix sweep like `clearKeptDrafts`); a next user opening the same shared dashboard would try to rehydrate the old user's conversation (server authz decides, but it is a needless cross-user fetch) |
| `helio.telemetry.queue.v1` | localStorage | features/telemetry/track.ts:22 | queue of events each tagged `userId` | in-record userId; flush only sends the current user's and drops foreign ones | no, by design | PER-USER, user-keyed | USER-KEY (already; do not clear on logout or undelivered events are lost) |
| `helio.telemetry.firstDashboardRendered.<userId>` | localStorage | features/telemetry/firstDashboardFlag.ts:1 | "1" once first-dashboard event delivered | YES | no | PER-USER, user-keyed | USER-KEY (already) |
| `helio-onboarding-dismissed-<userId>` | localStorage | features/onboarding/state/onboardingStorage.ts:4 | onboarding dismissed flag | YES | no (slice resets; storage kept for the owner) | PER-USER, user-keyed | USER-KEY (already) |
| `helio-warm` (IndexedDB, store `entries`, key `${userId}:${dashboardId}`) | IndexedDB | features/dashboards/tabs/warm/warmStore.ts:141 | warm copies of dashboards' panel lists + metadata | YES, and also deleted | YES (`clearWarmState`, awaited by logout, bounded 1 s) | PER-USER | RESET (already) |
| `helio-theme` | localStorage | theme/theme.ts:3 (read), theme/ThemeProvider.tsx:101 (write) | "light"/"dark" | no | no | DEVICE-PREFERENCE | ALLOWLIST-DEVICE-PREF |
| `helio-accent` | localStorage | theme/theme.ts:4, theme/ThemeProvider.tsx:120 | accent colour, mirrors the signed-in user's server `preferences.accentColor` but is also the pre-login default | no | no | DEVICE-PREFERENCE with a per-user cache component | ALLOWLIST-DEVICE-PREF (low sensitivity; next user's server value overwrites it on login, `ThemeProvider` adopts `preferredAccentColor`) |
| `helio-appearance` | localStorage | theme/appearancePrefs.ts:17 | pre-paint cache `{typeStyle, density, motion}` mirroring server prefs | no | YES (`clearAppearanceCache` when signed out, `useAppearanceState.ts:57`; not a clearAuth listener but fires on `preferred === null`) | DEVICE-PREFERENCE (server-synced) | ALLOWLIST-DEVICE-PREF (already cleared on sign-out by design) |
| `helio.sidebarCollapsed` | localStorage | app/shell/useContextListLayout.ts:12 | retired legacy flag: read once, migrated to the server preference, then removed (app/App.tsx:65 comment) | no | removed on first read | DEVICE-PREFERENCE (legacy) | ALLOWLIST-DEVICE-PREF (migration-only; nothing writes it any more) |
| context-list width / collapsed | server `users.preferences` (Redux `auth.currentUser.preferences`) | app/shell/useContextListLayout.ts | not browser storage | n/a | YES with `auth` slice | n/a | n/a |
| (unused / not applicable) | n/a | features/connectors/ui/InlineConnectorSetup.tsx:8, features/sources/state/sourceSamplesSlice.ts:13, services/httpClient.ts:6, features/dashboards/ui/AuthoringChatDrawer (none found) | comments only: InlineConnectorSetup and sourceSamples explicitly persist nothing; httpClient comment says it used to use sessionStorage for tokens (now an HttpOnly cookie); usePipelineDraft only uses keptDraft; no sessionStorage in AuthoringChatDrawer | n/a | n/a | n/a | n/a |
| Service worker / Cache API | n/a | pwaConfig.ts (`pwaRuntimeCaching`) | only Google Fonts stylesheets/webfonts; no API responses cached | n/a | n/a | n/a | n/a (no per-user data) |
| BroadcastChannel / `storage` event listeners | n/a | none found | | | | | |

Storage counts: PER-USER keys needing action: 3 (`helio.dashboardSeen`, `helio.recentVisits`, `helio.refinement.conversationId.*`); PER-USER already handled: 4 (`helio.pipelineDraft.*` reset, `helio-warm` reset, `helio.telemetry.*` x2 and `helio-onboarding-dismissed-*` user-keyed = 3 user-keyed); DEVICE-PREFERENCE: 4 (`helio-theme`, `helio-accent`, `helio-appearance`, `helio.sidebarCollapsed`); SESSION-MECHANICS: 2 (`helio.auth.returnTo`, `helio.signedIn`).

## Summary of the gap (what a fix must cover)

Not reset, per-user data (26 items):
- Redux (15): assistantConversations, assistantModels, auditEvents, connectors, dashboards, layoutHistory, panels, patchSets, pipelines, outputs, combinedProposals, settings, shareTokens, sources, datasetRows.
- Module-level (8): provenanceCache, outputHistoryCache, useSavedOutputRows cache, filterCapabilitiesStore, insightChromeStore, metricComparisonStore, usePipelineOwnership (`ownerByPipeline`), useContextListLayout `keyWriteTimer`.
- Browser storage (3): `helio.dashboardSeen`, `helio.recentVisits`, `helio.refinement.conversationId.*`.

Suggested mechanism (not implemented here): the `onFreshnessReset` hook registry already exists and already runs on every `clearAuth` via `warmListeners.ts:216`; the module-level stores could register there (or a sibling `onSessionReset` registry), and the slices could add `builder.addCase(clearAuth, () => initialState)` as the seven existing slices do. A test can enumerate `store.getState()` keys and assert each is in `{reset-on-clearAuth set} U {allowlist}` so new slices fail loudly. Open design point: in-flight thunk results landing after `clearAuth` (only `sourceSamples` has an epoch guard).

## Appendix A: post-await dispatch enumeration (D2b)

Command (script committed beside this file as `post-await.sh`), run from `frontend/src`:

```bash
bash post-await.sh . > post-await.out
```

It lists every `dispatch(` line with an `await` or `.then(` in the preceding 30 lines, in non-test files. The raw output is below. Triage:

- Thunk bodies and listener effects that dispatch a PLAIN action after an await, gated with `dispatchIfSameSession`:
  `settings/settingsSlice.ts:345` (`redeemInviteCodeThunk` `setAuth`), `proposals/combinedProposalsSlice.ts:35-36` (`dashboardUpserted`, `setSelectedDashboardId`), `dashboards/dashboardsSlice.ts:258` (`updateDashboardLayout` `dashboardUpserted`), `sources/datasetRowsSlice.ts:203` (`pushCursorStack`), `dashboards/tabs/hydrateTabs.ts:160` and `refreshChangeSignals.ts:24` (`changeSignalsReceived`), `pipelines/outputsSlice.ts:206,229` (`bumpPreviewToken`), `settings/saveAssistantModelPreference.ts:18-23`, `assistant/startConversationWithMessage.ts:35-37`, `panels/panelThunks.ts` (`markDashboardPanelsStale` plus `fetchPanels`, the second is a gated thunk).
- Exempt lifecycle dispatches: `auth/authSlice.ts:70,72` (`rehydrateAuth`), `:162` (`logout`).
- Component continuations that dispatch plain actions after an await: `onboarding/useFirstRunBuild.ts:88-90`, `useFirstRunTemplate.ts:43-46` (gated by the epoch helper), `panels/usePanelUpdatesFlush.ts:97`, `useLayoutSave.ts:288-300` (act on state that the root reset has already emptied; accepted limit, the component unmounts at `/login`).
- Everything else is a thunk dispatch whose `fulfilled`/`rejected` is gated by the epoch middleware (D2a).
- Corrections after reading each site (the script is a 30-line proximity heuristic, so it over-reports): `outputsSlice.ts:206,229` (`bumpPreviewToken`) is dispatched BEFORE the await, so it needs no gate. `panelThunks.ts` gates the whole post-await block with an epoch check (`createPanel`, `swapPanelOutput`, `deletePanel`, `duplicatePanel`; `adoptPlacedLayouts` is inside it). Also gated: `showDashboardPanels` (`stillWanted`), `DatasetRowGrid.tsx` handleNext `.then`. Accepted limits (pipeline page components belong to sibling lane HEL-1661, or the dispatch only clears what was sent): `usePipelineDraftSave`, `usePipelinePageLoad`, `usePipelineStepStructure`, `useLayoutSave`, `usePanelUpdatesFlush`, `MfaEnrollModal`, toast copy buttons.

```
./app/shell/AppRail.tsx:41:     await dispatch(logout());
./app/shell/AssistantContextList.tsx:124:         await dispatch(renameConversation({ id: item.id, title })).unwrap();
./features/ask/hooks/useAskPin.ts:40:         ? await dispatch(
./features/ask/hooks/useAskPin.ts:57:         await dispatch(
./features/assistant/state/startConversationWithMessage.ts:35:     dispatch(conversationCreated(created));
./features/assistant/state/startConversationWithMessage.ts:37:     dispatch(setSelectedConversationId(id));
./features/assistant/state/startConversationWithMessage.ts:38:     await dispatch(converse({ id, message, idempotencyKey, model: model ?? undefined })).unwrap();
./features/assistant/ui/MessageComposer.tsx:129:         await dispatch(
./features/assistant/ui/MessageComposer.tsx:140:         await dispatch(converse({ id: conversationId, message: trimmed, idempotencyKey })).unwrap();
./features/auth/state/authSlice.ts:70:       dispatch(setAuth({ user }));
./features/auth/state/authSlice.ts:72:       dispatch(clearAuth());
./features/auth/state/authSlice.ts:162:   dispatch(clearAuth());
./features/auth/ui/LoginPage.tsx:47:     const result = await dispatch(login({ email, password }));
./features/auth/ui/MfaVerifyPage.tsx:38:     const result = await dispatch(verifyMfa({ code }));
./features/auth/ui/OAuthCallbackPage.tsx:33:       void dispatch(handleOAuthCallback({ code, state })).then((result) => {
./features/auth/ui/RegisterPage.tsx:68:     const result = await dispatch(
./features/connectors/ui/ConnectorsPage.tsx:143:       void dispatch(fetchConnectors());
./features/connectors/ui/ConnectorsPage.tsx:148:     const result = await dispatch(
./features/connectors/ui/CreateConnectorModal.tsx:70:     const result = await dispatch(
./features/connectors/ui/EditConnectorModal.tsx:42:     const result = await dispatch(
./features/connectors/ui/InlineConnectorSetup.tsx:83:     const result = await dispatch(
./features/connectors/ui/RotateCredentialModal.tsx:44:     const result = await dispatch(
./features/dashboards/hooks/useCreateDashboardAction.tsx:38:       await dispatch(createDashboard({ name: "Untitled dashboard" })).unwrap();
./features/dashboards/state/dashboardsSlice.ts:258:         dispatch(dashboardsSlice.actions.dashboardUpserted(fresh));
./features/dashboards/tabs/hydrateTabs.ts:160:         const got = await dispatch(refreshChangeSignals(plan.tabs.map((t) => t.id)));
./features/dashboards/tabs/refreshChangeSignals.ts:24:     dispatch(changeSignalsReceived({ items: result.items, serverOffsetMs }));
./features/dashboards/tabs/warm/showDashboardPanels.ts:112:       await dispatch(fetchPanels(dashboardId));
./features/dashboards/tabs/warm/showDashboardPanels.ts:124:         dispatch(restoreStarted(dashboardId));
./features/dashboards/tabs/warm/showDashboardPanels.ts:143:         dispatch(restoreFinished());
./features/dashboards/tabs/warm/showDashboardPanels.ts:149:     await dispatch(fetchPanels(dashboardId));
./features/dashboards/ui/DashboardAppearanceEditor.tsx:194:       await dispatch(
./features/dashboards/ui/DashboardFolderGroup.tsx:61:       await dispatch(renameDashboardFolder({ folderId: folder.id, name: trimmed })).unwrap();
./features/dashboards/ui/DashboardFolderGroup.tsx:80:       await dispatch(deleteDashboardFolder({ folderId: folder.id })).unwrap();
./features/dashboards/ui/DashboardList.tsx:108:       await dispatch(createDashboardFolder({ name: trimmed })).unwrap();
./features/dashboards/ui/DashboardList.tsx:120:       await dispatch(moveDashboardToFolder({ dashboardId, folderId })).unwrap();
./features/dashboards/ui/DashboardList.tsx:138:       await dispatch(createDashboard({ name: normalizedName })).unwrap();
./features/dashboards/ui/DashboardList.tsx:177:       await dispatch(renameDashboard({ dashboardId, name: trimmed })).unwrap();
./features/dashboards/ui/DashboardList.tsx:200:       await dispatch(deleteDashboard(dashboardId)).unwrap();
./features/dashboards/ui/DashboardList.tsx:213:       await dispatch(duplicateDashboard(dashboardId)).unwrap();
./features/dashboards/ui/DashboardList.tsx:222:       await dispatch(exportDashboard({ dashboardId, dashboardName })).unwrap();
./features/dashboards/ui/DashboardList.tsx:240:         await dispatch(importDashboard(snapshot)).unwrap();
./features/dashboards/ui/DashboardShareDialog.tsx:70:     const result = await dispatch(createShareTokenThunk({ dashboardId, expiresAt: isoExpiresAt }));
./features/dashboards/ui/DashboardShareDialog.tsx:77:     void dispatch(revokeShareTokenThunk({ dashboardId, tokenId }));
./features/dashboards/ui/DashboardShareDialog.tsx:84:       dispatch(pushToast({ variant: "success", message: "Share link copied to clipboard." }));
./features/dashboards/ui/DashboardShareDialog.tsx:86:       dispatch(pushToast({ variant: "error", message: "Copy failed — select and copy manually." }));
./features/dashboards/ui/ProposalReviewPage.tsx:127:       await dispatch(applyProposal(edited)).unwrap();
./features/onboarding/hooks/useFirstRunBuild.ts:82:           void dispatch(fetchSources());
./features/onboarding/hooks/useFirstRunBuild.ts:88:         if (landed) dispatch(dashboardUpserted(landed));
./features/onboarding/hooks/useFirstRunBuild.ts:89:         dispatch(setSelectedDashboardId(result.dashboardId));
./features/onboarding/hooks/useFirstRunBuild.ts:90:         dispatch(dismissOnboarding());
./features/onboarding/hooks/useFirstRunTemplate.ts:43:         if (landed) dispatch(dashboardUpserted(landed));
./features/onboarding/hooks/useFirstRunTemplate.ts:44:         void dispatch(fetchSources());
./features/onboarding/hooks/useFirstRunTemplate.ts:45:         dispatch(setSelectedDashboardId(result.dashboardId));
./features/onboarding/hooks/useFirstRunTemplate.ts:46:         dispatch(dismissOnboarding());
./features/panels/hooks/useLayoutSave.ts:288:           dispatch(setLayoutPending(true));
./features/panels/hooks/useLayoutSave.ts:300:         dispatch(setLayoutPending(pending));
./features/panels/hooks/usePanelData.ts:383:             const retry = dispatch(
./features/panels/hooks/usePanelUpdatesFlush.ts:97:         dispatch(clearSentPendingPanelUpdates(pending));
./features/panels/state/panelThunks.ts:129:       dispatch(markDashboardPanelsStale(dashboardId));
./features/panels/state/panelThunks.ts:130:       await dispatch(fetchPanels(dashboardId));
./features/panels/state/panelThunks.ts:165:       dispatch(markDashboardPanelsStale(dashboardId));
./features/panels/state/panelThunks.ts:166:       await dispatch(fetchPanels(dashboardId));
./features/panels/state/panelThunks.ts:181:     dispatch(markDashboardPanelsStale(dashboardId));
./features/panels/state/panelThunks.ts:198:       dispatch(markDashboardPanelsStale(dashboardId));
./features/panels/state/panelThunks.ts:199:       await dispatch(fetchPanels(dashboardId));
./features/panels/ui/DatasetStep.tsx:65:       await dispatch(
./features/panels/ui/editors/DividerEditor.tsx:57:             await dispatch(
./features/panels/ui/editors/FormEditor.tsx:180:           await dispatch(updatePanelForm({ panelId: panel.id, config: editor.config })).unwrap();
./features/panels/ui/editors/ImageEditor.tsx:99:           await dispatch(
./features/panels/ui/editors/MarkdownEditor.tsx:37:             await dispatch(updatePanelMarkdownContent({ panelId: panel.id, content })).unwrap();
./features/panels/ui/editors/OutputControlsEditor.tsx:80:             await dispatch(
./features/panels/ui/editors/TextContentEditor.tsx:37:             await dispatch(updatePanelTextContent({ panelId: panel.id, content })).unwrap();
./features/panels/ui/OutputPicker.tsx:134:         await dispatch(swapPanelOutput({ panelId: swapPanelId, outputId, dashboardId })).unwrap();
./features/panels/ui/OutputPicker.tsx:139:         await dispatch(
./features/panels/ui/OutputPicker.tsx:163:       await dispatch(createPanel({ dashboardId, type: kind })).unwrap();
./features/patchSets/ui/PatchSetReviewPage.tsx:77:     dispatch(previewPatchSet(patchSet))
./features/patchSets/ui/PatchSetReviewPage.tsx:105:       const response = await dispatch(applyPatchSet(stampFingerprints(patchSet, preview))).unwrap();
./features/patchSets/ui/PatchSetReviewPage.tsx:126:               dispatch(dismissToast(toastId));
./features/patchSets/ui/PatchSetReviewPage.tsx:127:               dispatch(undoPatchSet({ applicationId, patchSet }))
./features/pipelines/hooks/useOutputImmediateActions.ts:32:         const created = await dispatch(createOutput({ pipelineId, payload })).unwrap();
./features/pipelines/hooks/useOutputImmediateActions.ts:35:         void dispatch(previewOutput({ pipelineId, outputId: created.id }));
./features/pipelines/hooks/useOutputImmediateActions.ts:38:         await dispatch(updateOutput({ outputId: output.id, payload })).unwrap();
./features/pipelines/hooks/useOutputImmediateActions.ts:41:         await dispatch(deleteOutput({ outputId: output.id, pipelineId })).unwrap();
./features/pipelines/hooks/usePipelineDraftSave.ts:160:         dispatch(draftSaveRunPending({ pipelineId: id }));
./features/pipelines/hooks/usePipelineDraftSave.ts:169:           dispatch(draftSaveRunSettled({ pipelineId: id, outcome: "failed" }));
./features/pipelines/hooks/usePipelineDraftUndo.ts:57:         void dispatch(fetchPipelineById(id));
./features/pipelines/hooks/usePipelinePageLoad.ts:67:     void dispatch(fetchPipelineSteps(id)).then((action) => {
./features/pipelines/hooks/usePipelinePageLoad.ts:70:     void dispatch(analyzePipeline(id));
./features/pipelines/hooks/usePipelinePageLoad.ts:71:     void dispatch(fetchPipelineSchedule(id));
./features/pipelines/hooks/usePipelinePageLoad.ts:75:     void dispatch(fetchOutputs({ pipelineId: id })).then((action) => {
./features/pipelines/hooks/usePipelinePageLoad.ts:103:     loadRunHistoryWhenTruncated(id, dispatch(fetchPipelineById(id)));
./features/pipelines/hooks/usePipelinePageLoad.ts:142:     void dispatch(fetchPipelineSteps(id)).then((action) => {
./features/pipelines/hooks/usePipelinePageLoad.ts:146:       if (ok && analyzeStatusRef.current === "failed") void dispatch(analyzePipeline(id));
./features/pipelines/hooks/usePipelinePreviewCache.ts:27:     await dispatch(previewOutput({ pipelineId, outputId }));
./features/pipelines/hooks/usePipelinePreviewCache.ts:41:     await dispatch(previewUnsavedOutputStep({ pipelineId, stepId }));
./features/pipelines/hooks/usePipelineRootAndToggleActions.ts:64:         if (mountedRef.current) void dispatch(fetchPipelineById(id));
./features/pipelines/hooks/usePipelineRootAndToggleActions.ts:87:           await Promise.all([dispatch(fetchPipelineById(id)), syncStepsFromServer()]);
./features/pipelines/hooks/usePipelineRunAndSaveActions.ts:69:       await dispatch(submitPipelineRun({ pipelineId: id })).unwrap();
./features/pipelines/hooks/usePipelineRunAndSaveActions.ts:82:       await dispatch(submitPipelineRun({ pipelineId: id, dryRun: true })).unwrap();
./features/pipelines/hooks/usePipelineRunAndSaveActions.ts:106:       await dispatch(updatePipeline({ id, name: outputName })).unwrap();
./features/pipelines/hooks/usePipelineStepStructure.ts:59:     const { steps: freshSteps } = await dispatch(fetchPipelineSteps(id)).unwrap();
./features/pipelines/hooks/usePipelineStepStructure.ts:132:         void dispatch(fetchOutputs({ pipelineId: id }));
./features/pipelines/hooks/usePipelineStepStructure.ts:136:         void dispatch(previewOutput({ pipelineId: id, outputId: output.id }));
./features/pipelines/hooks/useRunHistory.ts:106:           void dispatch(fetchPipelineRunHistory({ pipelineId, openId: bootOpenId }));
./features/pipelines/state/outputsSlice.ts:206:     dispatch(outputsSlice.actions.bumpPreviewToken({ key, token: requestToken }));
./features/pipelines/state/outputsSlice.ts:229:     dispatch(outputsSlice.actions.bumpPreviewToken({ key, token: requestToken }));
./features/pipelines/ui/CreatePipelineModal.tsx:90:       const result = await dispatch(
./features/pipelines/ui/PipelinesPage.tsx:52:       await dispatch(deletePipeline(pipeline.id)).unwrap();
./features/pipelines/ui/proposalReview/PipelineProposalReviewPage.tsx:83:       const response = await dispatch(applyPipelineProposal(proposal)).unwrap();
./features/pipelines/ui/schedule/PipelineScheduleDialog.tsx:230:       await dispatch(savePipelineSchedule({ pipelineId, request })).unwrap();
./features/pipelines/ui/schedule/PipelineScheduleDialog.tsx:243:       await dispatch(deletePipelineSchedule(pipelineId)).unwrap();
./features/proposals/state/combinedProposalsSlice.ts:35:     dispatch(dashboardUpserted(response.dashboard.dashboard));
./features/proposals/state/combinedProposalsSlice.ts:36:     dispatch(setSelectedDashboardId(response.dashboard.dashboard.id));
./features/proposals/ui/CombinedProposalReviewPage.tsx:87:       await dispatch(applyCombinedProposal(proposal)).unwrap();
./features/settings/state/saveAssistantModelPreference.ts:18:       dispatch(applyAssistantModelPreference(previous));
./features/settings/state/saveAssistantModelPreference.ts:21:     await dispatch(fetchAssistantModels());
./features/settings/state/saveAssistantModelPreference.ts:23:     if (activeId !== undefined) await dispatch(selectConversation(activeId));
./features/settings/state/settingsSlice.ts:345:       dispatch(setAuth({ user }));
./features/settings/ui/ApiTokensSection.tsx:44:     const result = await dispatch(createApiTokenThunk(name.trim()));
./features/settings/ui/ApiTokensSection.tsx:51:     void dispatch(revokeApiTokenThunk(id));
./features/settings/ui/ApiTokensSection.tsx:58:       dispatch(pushToast({ variant: "success", message: "Token copied to clipboard." }));
./features/settings/ui/ApiTokensSection.tsx:60:       dispatch(pushToast({ variant: "error", message: "Copy failed — select and copy manually." }));
./features/settings/ui/AssistantModelSection.tsx:47:     const ok = await dispatch(
./features/settings/ui/BetaAccessSection.tsx:48:       await dispatch(redeemInviteCodeThunk(trimmed)).unwrap();
./features/settings/ui/MfaEnrollModal.tsx:45:       void dispatch(startMfaEnrollment());
./features/settings/ui/MfaEnrollModal.tsx:54:     dispatch(
./features/settings/ui/MfaEnrollModal.tsx:65:     await dispatch(confirmMfaEnrollment(code));
./features/settings/ui/MfaEnrollModal.tsx:92:             onClick={() => void dispatch(startMfaEnrollment())}
./features/settings/ui/MfaSecuritySection.tsx:60:     await dispatch(regenerateMfaBackupCodes(reauthCode));
./features/settings/ui/MfaSecuritySection.tsx:65:     const result = await dispatch(disableMfa(reauthCode));
./features/settings/ui/MfaSecuritySection.tsx:68:       dispatch(pushToast({ variant: "info", message: "Two-factor authentication disabled." }));
./features/settings/ui/MfaSecuritySection.tsx:75:       dispatch(pushToast({ variant: "success", message: "Backup codes copied to clipboard." }));
./features/settings/ui/MfaSecuritySection.tsx:77:       dispatch(pushToast({ variant: "error", message: "Copy failed — select and copy manually." }));
./features/settings/ui/PreferencesEditor.tsx:188:     const result = await dispatch(savePreferences(request));
./features/sources/state/datasetRowsSlice.ts:197:     dispatch(resetCursorStack({ sourceId }));
./features/sources/state/datasetRowsSlice.ts:200:       const result = await dispatch(fetchDatasetRowsPage({ sourceId, cursor })).unwrap();
./features/sources/state/datasetRowsSlice.ts:203:       dispatch(pushCursorStack({ sourceId, cursor }));
./features/sources/state/sourcesSlice.ts:208:     void dispatch(fetchSourceReferences());
./features/sources/ui/AddSourceModal.tsx:196:       const created = await dispatch(
./features/sources/ui/AddSourceModal.tsx:215:       const created = await dispatch(createSqlSource({ name: sourceName, config })).unwrap();
./features/sources/ui/DatasetRowGrid.tsx:533:         dispatch(popCursorStack({ sourceId }));
./features/sources/ui/DatasetRowGrid.tsx:556:     void dispatch(fetchDatasetRowsPage({ sourceId, cursor: nextCursor }))
./features/sources/ui/DatasetRowGrid.tsx:559:         dispatch(pushCursorStack({ sourceId, cursor: nextCursor }));
./features/sources/ui/DatasetSchemaEditor.tsx:202:       void dispatch(fetchDatasetSchemaThunk({ sourceId }));
./features/sources/ui/DatasetSchemaEditor.tsx:203:       void dispatch(fetchDatasetRowsPage({ sourceId }));
./features/sources/ui/EmptySchemaAffordance.tsx:52:       await dispatch(fetchSources());
./features/sources/ui/EmptySchemaAffordance.tsx:68:     const result = await dispatch(deleteSource(source.id));
./features/sources/ui/forms/SqlTab.tsx:61:     const result = await dispatch(inferSqlSource(buildConfig()));
./features/sources/ui/SourceDetailPanel.tsx:116:       await dispatch(updateSource({ id: source.id, name: trimmed })).unwrap();
./features/sources/ui/SourcesPage.tsx:62:     const result = await dispatch(deleteSource(source.id));
./shared/chrome/BottomNav.tsx:83:     await dispatch(logout());
./shared/chrome/SidebarItemList.tsx:224:       // RTK's `dispatch(thunk(...)).unwrap()` (the documented `onRename` shape, design.md D5)
```
