## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `eafa7f40b7a616a393e28bbafc2955a291f8e3c6` against the live-resolved base `71e2802bbc1acb3b59c60291c6f16431fb404165` (`resolve-review-base.sh`). Commits: `5dfc7fa29` (red evidence), `eafa7f40b` (implementation).

### Phase 1: Spec Review — PASS

- AC1 (a red-first test, earlier PATCH held, last choice read back from the server): met. Jest `preferenceSaveOrdering.test.ts` drives the existing writers (`saveAppearancePreferences`, `saveAssistantModelPreference`). The e2e held variant reads `GET /api/auth/me`. I re-ran the red myself: I made a throwaway detached worktree at `5dfc7fa29` (unpatched app, red tests committed), ran the jest file and got 2 assertion failures (`Expected "serif" / Received "mono"`; `Expected length: 2 / Received length: 3`). Neither is an import error, so C101 holds. The committed e2e red transcript is also an assertion failure (held variant `Received: "mono"`).
- AC2 (at most one request in flight, plus one trailing): met. Jest checks `maxInFlight() === 1` and `bodies.length <= 2`. The e2e held variant checks `peakInFlight <= 1` and `styleRequests <= 2`.
- AC3 (20 passes in a row, also under 4x CPU throttling): met. I ran it myself with `HEL1829_CPU_THROTTLE=4 --repeat-each=20` on the rapid tests: 40/40 passed. The executor's unthrottled 20x transcript also shows 40/40.
- Ticket "Do" items: one serialiser shared by all four writers; merge semantics confirmed as per-key (design Context section); the HEL-1572 spec now toggles rapidly again. No AC was reinterpreted.
- Every task is checked and matches the diff. No scope creep: frontend only, no backend or schema change.
- Spec delta `specs/user-ui-preferences/spec.md` matches the implemented behaviour.
- CONSTRAINTS: C101 honoured (see above). C102 honoured: I re-ran the full jest suite and every e2e file listed in task 5.3, at 2 workers.

### Phase 2: Code Review — PASS

Gates, run fresh by me in WORKTREE_PATH:
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0
- `npm test`: exit 0 (root 76 suites / 683 tests; frontend 932 suites / 10825 tests)
- `npm --prefix frontend run build`: exit 0
- Backend untouched, so `sbt testFull` was not run.

Writer routing: `grep -rn "users/me/preferences|patchShellPreferencesRequest|patchDashboardTabsRequest" frontend/src` (non-test files) finds the route only in `authService.ts:61` (the low-level sender), whose only caller is `preferencesSaveQueue.ts:44`, plus the queue's own keepalive `fetch` at `preferencesSaveQueue.ts:35`. `patchDashboardTabsRequest` was removed, and `tabsPersistence.ts` sends both its normal and keepalive flushes through the queue. No writer bypasses the queue.

Design conformance:
- D2 merge (`{ ...pendingPatch, ...patch }`): keeps an explicit `null` and replaces `dashboardTabs` as a whole value.
- D3 drain on success or failure: correct.
- D4/D4a keepalive: a `!response.ok` response and a rejected `fetch` both resolve `"failed"`.
- D5 generation: a request from an older generation resolves its own callers and returns before touching `inFlight` or draining.
- D6 rollback: sequence token; `confirmed` is updated only from a `"saved"` outcome's `sent.assistantModel`; a failure restores `confirmed`, never `previous`; the epoch check comes first.
- Session-reset registration: both modules call `registerSessionReset`, and their `covers` lists name every module-level `let`. The guard discovers registrations by scanning, and `sessionResetGuard.test.ts` passed in the full run.

Mutation spot-check (4 of the 6 claims reproduced, in the throwaway worktree at `eafa7f40b`; every mutation was reverted and the worktree removed):
- M3, generation check dropped: red on "A in flight, reset, B#1 sent at once, B#2 queued...". Matches the claim.
- M2, merge dropped: red on coalesce, D3a and the cross-writer ordering test. Matches.
- M6, value-equality instead of sequence: red on D6 (a). Matches.
- M1, no drain on failure: red on drain-on-failure and D6 (a)/(b). Matches.

Canonical standards: no mechanical violations found. DESIGN.md does not apply, because no visual or styling code changed.

### Phase 3: UI Review — PASS

I started servers with `start-servers.sh` (READY on 7261/10168; `assert-phase servers` PASS) and stopped them with `stop-servers.sh` afterwards.
- `hel1572-appearance-preferences.spec.ts`, full file: 17/17 passed. This includes the 375/768/1280 tap-target and clipping sweeps.
- Rapid tests at 4x CPU, 20 repeats each: 40/40 passed.
- Regression files from task 5.3 (`hel1574-shell-rail`, `hel1575-reload-after-edit`, `hel1575-dashboard-tabs-warm-and-palette`, `hel1575-dashboard-tabs-idle-device`, `hel1575-delayed-restore-no-update-loop`, `hel1783-shared-dashboard-tabs`): 40/40 passed.
- The diff changes no rendered UI (only the save path), so I did not run a separate interactive breakpoint or console sweep. The failure path (local value kept, nothing shown) is unchanged from before and is covered by jest.

### Scrutiny point: the dropped request-count assertion (unheld e2e variant)

- **The correction is legitimate.** Without a hold, the first save can settle before the next click. Three sequential, non-overlapping requests then satisfy "at most one in flight, plus one trailing", so a `<= 2` count would be a false requirement on correct code.
- **The unheld variant cannot go red on the bug.** The committed red transcript `red-e2e-unpatched.txt` shows the no-hold variant failing only at line 278, the count assertion. So on unpatched code the line-277 `peakInFlight <= 1` check passed and "serif" was stored. With the count line removed, this variant would pass on unpatched code. It is a smoke check, not a guard.
- **The AC still has a red-capable guard.** The held variant has a demonstrated red (stored "mono" on unpatched code) and keeps both bounds. Together with the jest red this covers AC1 and AC2, so the guard was not weakened where it matters.
- The variant's label is still misleading; see the suggestions below.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `e2e/hel1572-appearance-preferences.spec.ts:247-281`: say in a comment (or in the no-hold test title) that the unheld variant is a smoke check that also passes on unpatched code, and that the held variant is the guard. Otherwise a later reader may cite it as red-capable.
- `e2e/hel1572-appearance-preferences.spec.ts` held variant: add `expect(trace.styleRequests()).toBeGreaterThanOrEqual(1)`, so a route glob that silently stops matching cannot pass the `<= 1` / `<= 2` bounds vacuously. The red run shows the glob matches today.
- `evidence/red-jest-unpatched.txt`: the second test's title ("...an assistant-model save and a motion save") differs from the committed test ("...a density save and an assistant-model save"), so the transcript came from an earlier title. The assertions and line numbers match, and I re-ran the committed red with the same two failures. Re-capture it if the evidence must match the commit byte for byte.
- `authService.ts:58`: `patchShellPreferencesRequest` now sends every preference key. Consider renaming it (e.g. `patchPreferencesRequest`) and reusing `QueuedPreferencesPatch` for its parameter type, to avoid the duplicated `PreferencesPatch & { dashboardTabs?: unknown }`.
- `preferencesSaveQueue.test.ts:118`: `global.fetch` is replaced and never restored. This is harmless under per-file jest isolation, but a restore in `afterEach` is tidier.
