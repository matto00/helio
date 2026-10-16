## Evaluation Report — Cycle 6 (evaluation-6.md)

I reviewed head `76fca5fa66c627f69b876db070ea9c5de565fe12`. The worktree was clean.
- The review base, resolved live, is `7fd2f4f29` (= `origin/main`). `origin/main` is an ancestor of HEAD.
- This cycle's scope is commit `76fca5fa6`, which answers evaluation-5 Change Request 1.
- Spawn guard: `READY ambient=/home/matt/Development/helio branch=feature/persistent-dashboard-tabs-palette/HEL-1575`.
- Transcripts are in `/home/matt/Development/helio/.concertino/scratch/HEL-1575/eval6/`, called `eval6/` below. Each one starts with this worktree's path and the HEAD sha.
- The DB is the shared `helio` (flyway `max(version)=135`, 135 rows). The backend and Playwright both used `backend/.env`'s `DATABASE_URL`: `DATABASE_URL` was unset in the environment, so `e2e/support/db.cjs` fell back to that file.

**Delta since e07eaaa5c** (`git diff --name-only e07eaaa5c..HEAD`):
- `tabsBrowserTriggers.ts` and its test;
- `ci-fix-cycle.md`, `design.md`, `evaluation-5.md` and `evidence-red-first.md`.

There is no `backend/` file in the delta, so I did not re-run `sbt testFull`. My cycle-5 result on e07eaaa5c stands: 8162 succeeded, 0 failed.

### Phase 1: Spec Review — PASS

**Evaluation-5 CR1: met.**
- `tabsBrowserTriggers.ts:55-59`: the leave capture now passes `viewedAt: serverNowMs()`.
- `buildWarmEntry` stores `lastViewedAt = laterOf(<store stamp>, viewedAt)` (`warmCapture.ts:79`), so the browser copy is stamped "now" on every leave on the dashboard view.
- The server PATCH is still throttled by `LEAVE_STAMP_REFRESH_MS` (`:50-52`), so C1's 15-minute warm TTL is restored with no extra request.
- `design.md` D7 is corrected. It drops "shortens it by at most 5" and the "owner-approved" label, and states that only the server stamp is throttled.

**Red-first: reproduced independently** (`eval6/red-repro.txt`).
- Setup: a throwaway detached worktree at e07eaaa5c (`.concertino/scratch/HEL-1575/eval6-red-wt`), with the new test file copied from HEAD and `frontend/node_modules` hardlink-copied.
- Result: **1 failed, 14 passed, 15 total**. Expected `>= 1792113683639`, received `1792113444637`, which is about 239 s older. That is the stale 4-minute store stamp replacing the heartbeat stamp, as described in CR1.
- After the run I removed the worktree with `git worktree remove --force`. It is absent from `git worktree list`, and the path no longer exists.
- An earlier attempt under `/tmp` failed: hardlinks cannot cross filesystems. I removed that worktree the same way and it ran no tests.

**Claim: "no other capture path can rewind the copy's stamp". Verified by reading every `captureTab` caller:**
- `activeTabSnapshot.ts:43` (the heartbeat) passes `viewedAt: serverNowMs()`.
- `dashboardTabsListeners.ts:108-109` (tab switch) dispatches `tabViewed(serverNowIso())` and only then captures, so the store stamp is already "now".
- `tabsBrowserTriggers.ts:55` (leave) passes `viewedAt: serverNowMs()`.
- Residual (non-blocking, see suggestions): the heartbeat's write is debounced by 400 ms (`WARM_WRITE_DEBOUNCE_MS`), and `viewedAt` is fixed when the write is scheduled. A heartbeat write still pending when the leave writes immediately can therefore land after it, holding a stamp up to about 400 ms older. This does not matter against a 15-minute TTL.

**Claim: "the `left` guard is redundant". Verified** (`eval6/mutant-left.txt`).
- Mutant: I removed `if (left) return;` in a throwaway worktree at HEAD.
- Result: 15/15 tests still pass.
- The executor kept the guard and documented it as belt-and-braces in `evidence-red-first.md`. Evaluation-5 listed "pin it or drop it" as non-blocking, so leaving it in place is acceptable.

**Claim: "the hydrate-refresh timer item was not done".** This was a non-blocking suggestion, and its non-completion is disclosed in `ci-fix-cycle.md`. The cost is at most one extra `dashboard-changes` request per 30 s. It does not block.

**CONSTRAINTS C1-C7 (none retired) are honoured.**
- C1 is now fully restored, as above.
- Nothing in this delta touches C2-C7. There is no CSS, token, dependency, schema or RLS change.

**Scope:** only the CR1 fix, its test, and corrections to the planning artifacts. There is no scope creep.

### Phase 2: Code Review — PASS

**Gates, run fresh on 76fca5fa6:**

| gate | result | transcript |
| --- | --- | --- |
| `npm run lint` | exit 0 | `eval6/static.txt` |
| `npm run typecheck` | exit 0 | `eval6/static.txt` |
| `npm run format:check` | exit 0 | `eval6/static.txt` |
| `npm --prefix frontend run build` | exit 0 (`precache 41 entries`) | `eval6/static.txt` |
| `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npm test` | exit 0: root 55 suites / 485 tests; frontend **641 suites / 7642 tests**. Load 5.1 at start, 6.9 at end | `eval6/jest.txt` |
| `flock e2e.lock nice -n 19 npx playwright test e2e/hel1575-dashboard-tabs.spec.ts --workers=2` (`DEV_PORT=7007`) | exit 0: **21 passed** (5.4 min) | `eval6/e2e-hel1575.txt` |
| `flock e2e.lock nice -n 19 npx playwright test e2e/state-surface-contrast-guard.spec.ts -g overlays --repeat-each 5 --workers=2 --trace=on` | exit 0: **10 passed** (light and dark x5, 2.6 min). Load 1.6 at start, 3.6 at end | `eval6/overlays.txt` |

**Overlays `/api` counts** (`eval6/api-counts.txt`):
- Method: raw resource snapshots per trace, the same method as cycle 5, so same-millisecond StrictMode duplicates are counted.
- dark: 98, 98, 104, 98, 104;
- light: 98, 98, 98, 103, 102;
- `dashboard-changes`: 11 per run;
- preferences PATCH: 1 per run;
- **HTTP 429s: 0 in all 10 runs.**
- Every request host was `localhost:7007`, apart from the Google Fonts hosts.
- This matches the executor's light-only figures of 102-105. All runs are at least 16 requests under the 120/min limit.

**Executor transcripts** (`fix2b/`): `jest-full.txt` (7642), `e2e-hel1575.txt` (21 passed) and `e2e-full.txt` (333 passed, 1 skipped) agree with my numbers. However, `fix2b/e2e-full.txt` and `fix2b/e2e-hel1575.txt` do not print the worktree path or HEAD. I relied only on my own runs, which do.

**Full e2e: not re-run, by choice.**
- The delta is one argument to a local IndexedDB write on hidden/pagehide, plus one unit test. It changes no request, no DOM and no CSS.
- The only observable effect is the warm-reload TTL, which the hel1575 spec exercises (21/21 green). The overlays budget guard is green 10/10.
- No other spec can observe the browser copy's `lastViewedAt`.
- Cycle 5's full run on e07eaaa5c was 333/0, and CI runs the full suite on this exact head.

**Review:**
- The fix is minimal and uses the same mechanism as the D5 heartbeat. The inline comment (`:53-54`) explains why the stamp is needed.
- The new tests use the existing harness helpers. The added imports are sorted, there are no inline FQNs, and there are no new type escape hatches; the test's `as never` follows the file's existing pattern.
- There is no dead code and no TODO.
- The new test is failable: it is red on the pre-fix code, as shown above.

### Phase 3: UI Review — PASS

I started the servers with `start-servers.sh ... 7007 9914 HEL-1575` (`PASS servers`) and stopped them with `stop-servers.sh` (`STOPPED ports=7007,9914`).
- This cycle's change is behavioural only: a local stamp on a browser-storage write. It has no visual or markup change.
- It is covered on port 7007 by the hel1575 spec: warm reload within the TTL, the changed dot, two devices, palette, and breakpoints/touch. The HEL-866 overlay guard passes in both themes.
- No new UI states were introduced.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- **Debounced heartbeat write can land after the leave's immediate write.** A heartbeat write still pending at leave time (400 ms debounce) can overwrite the leave's entry with a stamp up to about 400 ms older. If exactness ever matters, have the immediate write clear the pending timer for that key, as `remove` already does.
- **The `left` dedupe is still unpinned.** Mutant A stays green. Dropping the guard or pinning it (one `captureTab` per hidden+pagehide) would remove an untested branch.
- **Hydrate refresh does not set `lastRefreshAt`.** This is carried over from evaluation-5 and costs at most one extra `dashboard-changes` request per 30 s.
