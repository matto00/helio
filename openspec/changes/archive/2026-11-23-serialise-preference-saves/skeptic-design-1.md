## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 71e2802bbc1acb3b59c60291c6f16431fb404165 (change dir untracked, artifacts read from the working tree).

### What I verified (with evidence)

- **Writer enumeration: complete.** `grep "me/preferences"` over `frontend/src` (non-test) finds only `authService.ts:61` (`patchShellPreferencesRequest`), `authService.ts:68` (`patchDashboardTabsRequest`) and `tabsPersistence.ts:55` (the keepalive `fetch`). Callers of the two senders are `authSlice.ts:180` (`saveShellPreferences`), `authSlice.ts:195` (`saveAppearancePreferences`), `saveAssistantModelPreference.ts:18` and `tabsPersistence.ts:63`. `useContextListLayout.ts` reaches the route only through `saveShellPreferences`. Outside `frontend/src`, `git grep` finds only docs, schemas and e2e/test helpers. `/api/preferences` (agent preferences, `settingsService.ts`) is a different route. The design's table matches.
- **Merge semantics: confirmed.** `UserPreferenceRepository.patchPrefs` (l.120-135) builds the fields and `cleared` lists (`motion`, `assistantModel`). `mergePrefs` (l.155-169) does `jsonb || patch` minus the cleared keys. `dashboardTabs` replaces the whole value. A coalesced patch carrying several keys, including two `null` clears, is therefore stored correctly.
- **Validation is all-or-nothing.** The design does not mention this. In `UserPreferencesRoutes.validate` (l.45-93), one for-comprehension over every field means one invalid key makes the whole request `400`. This affects the cross-writer merge (CR 2).
- **The HEL-1634 registry exists as described.** `shared/session/sessionReset.ts` provides `registerSessionReset` / `declareSessionResetCoverage`. `sessionResetGuard.test.ts` detects column-0 `let` declarations and similar. `tabsPersistence.ts` declares `timer` and `pending` via `clearAuthListener`. Resets run on `clearAuth`, and the 401 interceptor (`httpClient.ts:42`) dispatches `auth/clearAuth`.
- **Hide/pagehide flow.** `tabsBrowserTriggers.ts:61` calls `flushTabsWrite({ keepalive: true })` on hidden/pagehide. The `dashboard-tabs` spec says "flushed when the page is hidden" (l.81). Under D4 that still holds when the page is only hidden, because JS keeps running and the trailing request is sent once the in-flight one settles. The only loss is a real unload inside one in-flight round-trip. That case was never a SHALL, and the "Reload restores tabs" scenario only matters inside that narrow window. I accept D4 as a reasoned trade-off; it does not regress HEL-1575 D2's written requirement.
- **E2E feasibility.** The current `hel1572-appearance-preferences.spec.ts` serialises clicks with `selectTypeStyle` (HEL-1826 workaround). A `page.route` hold on the first PATCH makes the unpatched app store Mono, so the e2e can be red first. The config runs Chromium only, with `retries: 0` and 2 workers (`playwright.config.ts:190,202`). A precedent for CDP `setCPUThrottlingRate` exists (`e2e/hel1683-regex-main-thread.spec.ts`). Twenty repeats under 2 workers is feasible.
- **No contract change needed.** No schema or API change; the spec delta (ADDED requirement on `user-ui-preferences`) fits.

### Verdict: REFUTE

### Change Requests

1. **D6 rollback rule is wrong under coalescing.** "Restore `previous` only when local `assistantModel` still equals the value it tried to save" fails in two concrete cases:
   - **A→B→A.** P is stored. The user picks X (in flight), then Y, then X again. The trailing patch carries X. If the first X request fails, local equals X, so it rolls back to P. The trailing X then succeeds, leaving the server on X and the UI on P.
   - **Rollback to a value never stored.** X is in flight and Y is queued (its `previous` is the optimistic X). X fails, and there is no rollback because local is Y. Then Y fails, and it rolls back to X, which never reached the server (it still holds P).

   Revise D6 to:
   - roll back only when this call is the newest `assistantModel` save (a per-call sequence token, not value equality);
   - restore the last server-confirmed value, not the optimistic `previous`.

   Add both cases to the D8 jest list.
2. **Failure coupling across writers is unaddressed.** Validation is all-or-nothing (`UserPreferencesRoutes.validate`, l.84-91). If one trailing request merges `typeStyle` with an `assistantModel` the catalog no longer allows (`CLAUDE_SELECTABLE_MODELS` narrowed mid-session), or with a `dashboardTabs` value that fails `DashboardTabsPrefs.parse`, the whole request gets a `400`. The appearance key is then lost silently: D3 says failures are not retried. Today these are separate requests and fail independently.

   The design must decide and state the rule, then cover it with a test. Two options:
   - on a `400` of a merged request whose keys came from more than one writer, re-send each writer's keys separately (still one in flight at a time);
   - accept the coupling explicitly in Risks, with a reason.

   Either way, D3 must say which callers resolve `"failed"`.
3. **The D8 "drop the generation check" mutation has no test that would catch it.** In the listed sign-out test, `reset` already clears the pending patch, so nothing drains with or without the generation check. That mutation stays green.

   D5 must also say what an old-generation settle does to the in-flight marker: it must not clear or replace the new generation's marker. Add a test for this sequence:
   1. A's request is in flight.
   2. Reset runs.
   3. B's save #1 is sent at once (proving "B is not blocked").
   4. B's save #2 is queued.
   5. A's request settles.

   Assert that B #2 is not sent until B #1 settles, so at most one B request is ever in flight. That test is the one the generation-check mutation must turn red.
4. **The red-first evidence must fail on assertions, not imports.** Task 1.1 asks for the `preferencesSaveQueue` tests to run red against unpatched code. That module does not exist yet, so those tests can only fail with module-not-found, which proves nothing. State in 1.1 that the committed red `.txt` must come from tests driving the existing APIs, and show an assertion failure. For example:
   - dispatch `saveAppearancePreferences` Mono, Sans, Serif with the first `httpClient.patch` held, plus a fake server applying merges in arrival order;
   - expect `"serif"` and see `"mono"`, with 3 requests where at most 2 are allowed.

   Apply the same to the cross-writer case (`saveAppearancePreferences` with `saveAssistantModelPreference`). Queue-unit tests can be added after the module exists.
5. **The regression scope misses the rerouted writers' e2e and jest suites.** Task 5.1 lists only the HEL-1572 spec. All four writers change transport, and several existing specs depend on PATCH timing or counts:
   - `e2e/hel1574-shell-rail.spec.ts` (`writes` exactly `["PATCH"]` l.151-166; `waitForResponse` on the first PATCH, then reload, l.130-135 and l.176-182);
   - `e2e/hel1575-reload-after-edit.spec.ts`, `hel1575-dashboard-tabs-warm-and-palette.spec.ts`, `hel1575-dashboard-tabs-idle-device.spec.ts` (expects zero PATCHes), `hel1575-delayed-restore-no-update-loop.spec.ts`, `hel1783-shared-dashboard-tabs.spec.ts`.

   Add these to 5.1, at the 2-worker cap. Also add the jest suites for `tabsPersistence`, `tabsBrowserTriggers`, `saveAssistantModelPreference`/`AssistantModelSection`, `authSlice`, `sessionResetGuard` and `signOutReset.*`.

### Non-blocking notes

- **D4 alternative.** Sending the keepalive at once when the in-flight request shares no key with the pending patch would be safe for ordering, but it breaks the "at most one in flight" AC. Keep D4 as written. Consider one sentence in design.md saying that the `dashboard-tabs` "flushed when the page is hidden" requirement is still met.
- **Logout window.** `logout` awaits `logoutRequest()` and `awaitWarmClear()` before `clearAuth` (`authSlice.ts:147-159`). An in-flight request that settles in that window drains A's pending patch to A's own account. That does not leak across users and matches the existing HEL-1634 cut point (`clearAuth`). Say so in D5 so the "signs out" scenario is read as "after `clearAuth`".
- **D3 outcomes.** Spell out the outcome for a caller whose key was superseded by a later caller in the same pending patch (it resolves with the trailing request's outcome).
- **D8 throttle mechanism.** State how the 4x CPU throttle is switched on (for example an env-gated `newCDPSession` in the spec) so the run can be reproduced. Keep the throttled and unthrottled transcripts separate.
- **Unchanged keepalive behaviour.** The keepalive `fetch` bypasses the axios 401 interceptor, as it does today.
