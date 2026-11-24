## Context

`PATCH /api/users/me/preferences` merges per top-level key server-side (`UserPreferenceRepository.mergePrefs`: `prefs || patch`, `motion: null` removes `motion`). Four client writers call it independently, with no ordering:

| Writer | File | Keys |
| --- | --- | --- |
| `saveAppearancePreferences` (via `handleAppearanceChange`, `main.tsx`) | `features/auth/state/authSlice.ts` | `typeStyle`, `density`, `motion` |
| `saveShellPreferences` | `features/auth/state/authSlice.ts` (called from `app/shell/useContextListLayout.ts`) | `contextListWidth`, `contextListCollapsed` |
| `saveAssistantModelPreference` | `features/settings/state/saveAssistantModelPreference.ts` | `assistantModel` |
| `flushTabsWrite` (1000 ms debounce; `keepalive` `fetch` on page hide) | `features/dashboards/tabs/tabsPersistence.ts` via `patchDashboardTabsRequest` | `dashboardTabs` |

Accent colour goes through a different route (`PATCH /api/users/me/update`) and is out of scope; it writes a different key into the same merged column, so it cannot clobber these keys.

## Goals / Non-Goals

**Goals:**
- One serialiser for every writer of the route: at most one request in flight, one coalesced trailing request.
- The stored value equals the user's last choice for every key, including across writers.
- Sign-out drops a pending patch (HEL-1634); nothing queued by user A is sent after A signs out.
- Red-first jest proof with a held first PATCH, and the HEL-1572 e2e toggling rapidly again.

**Non-Goals:**
- Backend change (merge semantics already per key).
- Retrying a failed save (existing behaviour: local value kept, next change or load reconciles).
- The accent-colour route.

## Decisions

**D1 — One module, one queue.** New `frontend/src/features/auth/services/preferencesSaveQueue.ts` exports `queuePreferencesPatch(patch, options?: { keepalive?: boolean }): Promise<PreferencesSaveOutcome>` where the outcome is `{ status: "saved" | "failed" | "dropped"; sent: PreferencesPatch | null }` — `sent` is the exact body of the request that carried the caller's patch (`null` when dropped), so a caller can see the value that actually reached the server. Callers are resolved in the order they queued. Module state: the in-flight marker, the pending merged patch, the pending callers' resolvers, a pending `keepalive` flag, and a generation counter. `patchShellPreferencesRequest` / `patchDashboardTabsRequest` remain the low-level senders used only by the queue (or are folded into it); no other module may call the route directly. Alternative rejected: per-writer queues — they would still race each other (ticket: "one serialiser for all of them").

**D2 — Merge rule.** Pending patch = shallow spread of queued patches in call order, so the latest value per top-level key wins, and an explicit `null` (motion "follow OS", assistant "server default") is preserved as a value, never dropped. `dashboardTabs` is a whole value and is replaced, matching its existing semantics.

**D3 — Drain on settle; outcomes.** When the in-flight request settles (success OR failure), if a pending patch exists it is sent immediately as the single next request. Every caller whose patch was merged into a request resolves with that request's outcome, including a caller whose key was superseded by a later caller in the same pending patch (it resolves with the trailing request's outcome). A failed request is not retried.

**D3a — Failure coupling across writers: accepted, no split (round-2 decision).** The server validates the whole body all-or-nothing (`UserPreferencesRoutes.validate`): one invalid key makes the request `400`, so a coalesced request that also carries an invalid key loses the valid keys it carried too. We accept this rather than re-sending per writer, because: (1) a `400` needs the client to send a value the server rejects — every writer sends values from closed client-side sets (the Appearance radios, the clamped shell width, the assistant model list the server itself returned, the tabs wire built by `toTabsWire`), so it takes a client bug or a mid-session server change (e.g. `CLAUDE_SELECTABLE_MODELS` narrowed by a redeploy); (2) the outcome is the same as any failed save today: the local value is kept and the next change or the next load reconciles; (3) a split path would add requests beyond the AC's "at most one in flight, plus one trailing" and needs its own ordering rules. Every caller whose patch rode a failed request resolves `"failed"`; no request is ever re-sent.

**D4a — Keepalive responses are classified.** `fetch` resolves on 4xx/5xx; the queue treats a keepalive response with `!response.ok` (and a rejected `fetch`) as `"failed"`, exactly like an axios rejection. Only `response.ok` is `"saved"`. One jest case covers a keepalive `400` resolving `"failed"`.

**D4 — Keepalive.** `queuePreferencesPatch(..., { keepalive: true })` (the page-hide tabs flush) sends with `fetch(..., { keepalive: true, credentials: "include", CSRF header })` when nothing is in flight; when a request is in flight it marks the trailing request keepalive and waits (ordering is never broken). Residual risk: a page that actually unloads within the in-flight window loses that trailing patch; this is accepted (the window is one request round-trip; local tab state survives and the next sign-in reconciles) and preferred over an unordered keepalive that could land before the in-flight one and be overwritten.

**D5 — Session reset (HEL-1634).** The module registers `registerSessionReset("preferencesSaveQueue", { covers: [...every module-level identifier...], reset })`. `reset` drops the pending patch (resolving their callers `"dropped"`), clears the keepalive flag, clears the in-flight marker and bumps the generation. A request carries the generation it was sent in; when a request from an OLDER generation settles it resolves its own callers and does nothing else: it never drains and never clears or replaces the current generation's in-flight marker. So nothing queued by user A is sent after A signs out, user B's first save is sent at once (not held behind A's request), and B still never has more than one request in flight. "Signs out" means "after `clearAuth`" (the HEL-1634 cut point): `logout` awaits `logoutRequest()` and the warm clear before `clearAuth`, so a request settling inside that window may still drain A's pending patch to A's own account; that never crosses users. Any new identifier must be accounted for by `sessionResetGuard.test.ts`/the allowlist.

**D6 — Assistant model rollback.** `saveAssistantModelPreference` gives each call a sequence number and tracks the last server-confirmed `assistantModel` (initialised from the store's value when no assistant-model save is outstanding; updated to the sent value on every successful request that carried `assistantModel`). Confirmed is updated only from a `"saved"` outcome, and only to the `assistantModel` value in that outcome's `sent` body (when `sent` carries the key) — never to the caller's own requested value, so a superseded caller cannot record a value the server never stored. On failure it rolls back ONLY when this call is the newest assistant-model save (its sequence number is the latest issued), and it restores the last server-confirmed value, never the optimistic `previous`. The existing session-epoch check stays (it also covers a `"dropped"` outcome, which only happens at sign-out, after the epoch bump: nothing is rolled back into the next session), and this module state registers a session reset too (D5). Cases this must get right (jest): (a) P stored; X in flight, then Y, then X queued (trailing carries X); the first X fails → no rollback (not newest); trailing X succeeds → local and server both X. (b) P stored; X in flight, Y queued; X fails → no rollback; Y fails → local restored to P (the last confirmed), never to X.

**D7 — Writers keep their optimistic local apply.** Thunks still apply locally first and never write the response back. `saveAppearancePreferences`/`saveShellPreferences` await the queue and swallow failure as today.

**D8 — Tests.**
- Red first, through the EXISTING public APIs (the queue module does not exist yet, so a module-not-found failure is not a red): dispatch `saveAppearancePreferences` Mono, Sans, Serif with the first `httpClient.patch` held and a fake server applying merge semantics in arrival order; expect stored `"serif"` and at most 2 requests with at most 1 in flight, and on unpatched code see `"mono"` / 3 requests / 3 in flight. Same for the cross-writer case (`saveAppearancePreferences` + `saveAssistantModelPreference` queued behind an in-flight request → one trailing request carrying both keys, both stored); its red is on request count / concurrency only (per-key server merge means different keys cannot overwrite each other), and it is described that way. The red run is committed as `.txt` and must show assertion failures, not import errors.
- After the module exists, queue-level jest: burst coalescing (latest per key, explicit `null` kept); failure of the in-flight request still drains the trailing one; a multi-writer `400` resolves every rider `"failed"` with no re-send (D3a); a keepalive `400` resolves `"failed"` (D4a); outcomes carry the sent body and resolve in queue order; D6 cases (a) and (b), plus (c): X in flight, Y queued, X succeeds with `sent.assistantModel = X`, then Y fails as newest → restored to X (the confirmed value), and a superseded caller's `"saved"` never records its own value; sign-out with a pending patch sends nothing more; and the generation sequence: (1) A's request in flight, (2) reset, (3) B save #1 sent at once, (4) B save #2 queued, (5) A's request settles → B #2 is NOT sent until B #1 settles (at most one B request in flight).
- Mutations, each must turn a named test red: drop drain-on-failure; drop the merge (send only the last patch); drop the generation check (caught by the generation-sequence test); treat a keepalive `!ok` response as saved (D4a); D6 restore `previous` instead of the confirmed value; D6 value-equality instead of sequence.
- E2E: `e2e/hel1572-appearance-preferences.spec.ts` toggles type style rapidly without waiting per save (and holds the first PATCH via `page.route` in one variant to force the HEL-1826 ordering), then asserts the stored value read back via `GET /api/auth/me` equals the last choice, and that at most one preferences PATCH was in flight at any time. Red first against unpatched app code (held variant stores Mono). Run 20× in a row (`--repeat-each=20`), and 20× under 4× CPU throttling, switched on by an env-gated `page.context().newCDPSession(page)` + `Emulation.setCPUThrottlingRate({ rate: 4 })` in the spec (precedent: `e2e/hel1683-regex-main-thread.spec.ts`), e.g. `HEL1829_CPU_THROTTLE=4`; throttled and unthrottled transcripts kept separate.

## Risks / Trade-offs

- [Unload during an in-flight request] The `dashboard-tabs` requirement "flushed when the page is hidden" is still met: on hide the page keeps running JS, so the trailing (keepalive) request is sent as soon as the in-flight one settles. The keepalive `fetch` bypasses the axios 401 interceptor, as it does today.

- [A slow in-flight request delays later saves] → one round-trip at most; local state is already applied optimistically.
- [A writer bypassing the queue reintroduces the race] → `patchShellPreferencesRequest`/`patchDashboardTabsRequest` are only used by the queue; a grep-based or unit check that no other module calls the route directly is encouraged.
