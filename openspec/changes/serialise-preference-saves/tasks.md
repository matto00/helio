## Standing Constraints

- [C101] Red-first evidence must be assertion failures from tests driving the existing code paths (never module-not-found), committed as .txt before implementation.
- [C102] Regression scope covers every rerouted writer: the jest suites and e2e spec files listed in tasks 5.2/5.3, full files, at the 2-worker cap.

## 1. Red first

- [x] 1.1 Write jest tests that drive the EXISTING APIs (design D8 red bullet: `saveAppearancePreferences` Mono→Sans→Serif with the first `httpClient.patch` held and a merge-applying fake server; cross-writer `saveAppearancePreferences` + `saveAssistantModelPreference`), run them against unpatched code, and commit the red output as `.txt` evidence before any implementation. The red must be assertion failures (stored `"mono"`, 3 requests, 3 in flight), not module-not-found.
- [x] 1.2 Make the HEL-1572 e2e rapid-toggle (held-first-PATCH variant) and record its red run against unpatched app code as `.txt`.

## 2. Serialiser

- [x] 2.1 Add `frontend/src/features/auth/services/preferencesSaveQueue.ts` per design D1-D4 (D3a: no split, riders of a failed request resolve `"failed"`; D4a keepalive classification; outcomes carry `sent`).
- [x] 2.2 Register its session reset (D5) and update the HEL-1634 guard accounting.
- [x] 2.3 Queue-level jest tests per D8 (coalescing, drain on failure, D3a no-split, D4a keepalive, sign-out drop, the generation sequence).

## 3. Route every writer through it

- [x] 3.1 `saveAppearancePreferences` and `saveShellPreferences` (`authSlice.ts`).
- [x] 3.2 `saveAssistantModelPreference.ts`, with the D6 rollback rule (sequence token, restore last server-confirmed value), cases (a), (b) and (c) tested; confirmed value only from an outcome's `sent` body.
- [x] 3.3 `tabsPersistence.ts` (`flushTabsWrite`, both the normal and `keepalive` paths).
- [x] 3.4 Confirm no other caller of `PATCH /api/users/me/preferences` remains in `frontend/src` outside the queue.

## 4. E2E

- [x] 4.1 Update `e2e/hel1572-appearance-preferences.spec.ts`: rapid toggling without per-save waits (including a held-first-PATCH variant), assert last choice stored via the server, assert at most one PATCH in flight.
- [x] 4.2 Run the guard 20× in a row and 20× under 4× CPU throttling; keep the transcripts as evidence.

## 5. Gates

- [x] 5.1 Mutation runs (every D8 mutation) recorded with the test each turns red; lint, typecheck, format.
- [x] 5.2 Jest regression: full frontend suite, explicitly including `tabsPersistence`, `tabsBrowserTriggers`, `saveAssistantModelPreference`/`AssistantModelSection`, `authSlice`, `sessionResetGuard`, `signOutReset.*`.
- [x] 5.3 E2E regression at the 2-worker cap, full spec files: `hel1572-appearance-preferences`, `hel1574-shell-rail`, `hel1575-reload-after-edit`, `hel1575-dashboard-tabs-warm-and-palette`, `hel1575-dashboard-tabs-idle-device`, `hel1575-delayed-restore-no-update-loop`, `hel1783-shared-dashboard-tabs`.
