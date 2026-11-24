## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `eafa7f40b7a616a393e28bbafc2955a291f8e3c6`. The diff base was resolved live by `resolve-review-base.sh` (origin/main): `71e2802bbc1acb3b59c60291c6f16431fb404165`. The branch has 2 commits: 5dfc7fa29 (red evidence) and eafa7f40b (fix).

### What I verified (with evidence)

**(1) Red-first test, reproduced by me.** I made a throwaway `git worktree add --detach` at the base SHA and copied only HEAD's `preferenceSaveOrdering.test.ts` into it (node_modules symlinked, no .env touched). Then I ran jest against the unpatched writers:
- `Expected: "serif" / Received: "mono"` (rapid Mono, Sans, Serif with the first PATCH held).
- `Expected length: 2 / Received length: 3`, `[{"typeStyle":"mono"},{"density":"compact"},{"assistantModel":"claude-opus-5-5"}]` (cross-writer).
- `Tests: 2 failed, 2 total`. These are assertion failures, not module-not-found, so C101 holds.

At HEAD the same file passes (see the targeted jest run below). The fake server applies the merge rule in arrival order, and the test checks its stored state. The e2e reads the stored value back from the real server with `GET /api/auth/me` polling, so AC1's "read back from the server" is met in the e2e.

The held e2e variant is unchanged between the red commit 5dfc7fa29 and HEAD except for the now-conditional `styleRequests` line, which I checked with `git diff 5dfc7fa29 eafa7f40b -- e2e/...`. So `evidence/red-e2e-unpatched.txt` (`Expected "serif" / Received "mono"`) is a valid red for the held variant. Throwaway worktree removed afterwards.

**(2) At most one in flight, plus one trailing.** In `preferencesSaveQueue.ts`, `queuePreferencesPatch` sends only when `!inFlight`. Otherwise it shallow-merges into `pendingPatch` and appends the caller's resolver. `send` drains exactly one merged patch when the request settles, on success or failure. The invariant "`pendingPatch` is null whenever `!inFlight` in the current generation" holds:
- `send` sets `inFlight = true`.
- Settle clears it and then `drain()` sets it again if anything is pending.
- `reset` clears both.

Checked by: the jest `peak in flight` and body-count assertions; the e2e `peakInFlight() <= 1` (both variants); and `styleRequests() <= 2` (held variant).

**(3) E2E guard, run by me** with servers from `start-servers.sh` on 7261/10168 against `helio_hel1829`, 2 workers, nice 19:
- `-g "rapid type-style" --repeat-each=20`: `40 passed (2.1m)`, 0 failures. That is 20x held plus 20x unheld, each about 5.8 s.
- Same with `HEL1829_CPU_THROTTLE=4`: `40 passed (2.9m)`, 0 failures, each about 8.4 s. The longer per-test times show the CDP throttle was actually applied.
- Full files `hel1572-appearance-preferences.spec.ts` and `hel1574-shell-rail.spec.ts`: `35 passed (1.4m)`.

**(4) Every writer goes through the one queue.** I grepped `frontend/src` (non-test) for `users/me/preferences`, `me/preferences` and `patchShellPreferencesRequest`. The only route call is `authService.ts:61` (`patchShellPreferencesRequest`), and its only importer is `preferencesSaveQueue.ts:10`. The only `fetch` to the route is `preferencesSaveQueue.ts:35`, the keepalive path.

Through the queue: `saveAppearancePreferences`, `saveShellPreferences`, `saveAssistantModelPreference`, and `flushTabsWrite` (normal and keepalive).

`patchDashboardTabsRequest` is deleted. `updateUserPreferencesRequest` goes to `/api/users/me/update` (accent colour, out of scope per design.md). `/api/preferences` is the separate agent-preferences route.

**(5) Sign-out (HEL-1634).** `store.ts:53` runs `runSessionResets()` from the single `clearAuth` listener, after `sessionEpochMiddleware` has bumped the epoch. The queue's reset:
- drops the pending patch and resolves its callers `dropped`;
- clears `inFlight` and bumps `generation`.

An older-generation request that settles afterwards only resolves its own callers. It never drains and never touches the new in-flight marker. Jest covers both cases: "drops a pending patch: it is never sent" and the A/reset/B#1/B#2 generation sequence.

`saveAssistantModelPreference` registers its own reset, which covers `latestSequence`, `outstanding` and `confirmed`, and it checks the epoch before touching module state. Every new module-level `let` is listed in a `covers` entry. `sessionResetGuard.test.ts` passes, and its static half scans for exactly these top-level `let`s.

**D6 rollback logic.** I read it against cases (a), (b) and (c):
- Rollback happens only when the call is newest by sequence.
- It restores `confirmed`.
- `confirmed` is updated only from a saved outcome's `sent.assistantModel`.

The mutation transcript (`evidence/mutations.txt`) maps each D8 mutation to a named red test. I accepted it as pasted output, and it is consistent with the tests I read.

**Gates, run fresh by me:**
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `prettier --check` on the touched dirs and the spec: clean.
- Full frontend jest (`--maxWorkers=3`): `Test Suites: 932 passed`, `Tests: 10825 passed`, exit 0.
- Targeted run (queue, ordering, assistant model, tabsPersistence, activeTabSnapshot, sessionResetGuard, signOutReset, authSlice, AssistantModelSection, tabsBrowserTriggers): `12 suites, 137 tests passed`.

**Is the held variant plus jest enough as the guard?** Yes.
- The held e2e is deterministic. It holds the first type-style PATCH in `page.route` before it reaches the server, and it went red on base with "mono".
- The jest ordering test goes red on base, as reproduced above.
- The unheld variant is only a smoke test of the real timing path. Its red in `red-e2e-unpatched.txt` came from the now-removed unconditional `styleRequests` assertion. On base, the current unheld variant can only go red by chance, through `peakInFlight`.

**UI / design judgment.** Not applicable. The diff changes no rendering, styling or components; it only changes the save transport behind unchanged Settings radios. The e2e run exercised the Appearance view with no failures.

### Verdict: CONFIRM

### Non-blocking notes
- `httpClient` (axios) has no request timeout. With serialisation, a single hung preferences PATCH now holds back every later preference save (tabs, shell, appearance, model) until the browser gives up. Before this change, later independent saves still landed. The local optimistic state is unaffected. Consider a timeout for queued requests in a follow-up.
- `evidence/red-jest-unpatched.txt` names the second test "...an assistant-model save and a motion save", but the committed test (identical in 5dfc7fa29 and HEAD) says "...a density save...". The transcript was captured from an earlier, uncommitted draft. I reproduced the red myself on the committed file, so the claim stands; only the transcript's provenance is imprecise.
- `red-e2e-unpatched.txt`'s unheld-variant failure comes from an assertion that HEAD no longer makes for the unheld case. The label should say so if the transcript is cited later.
- `saveAssistantModelPreference` returns `false` for a superseded failed call even when a newer call for the same key is still pending. That is fine as long as the section only reflects its latest call.
