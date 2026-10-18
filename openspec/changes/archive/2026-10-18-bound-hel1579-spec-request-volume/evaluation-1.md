## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `25ab4ba92279eaf0d0cb1a6862d13eb805516aa5`. The diff base was resolved live with `resolve-review-base.sh` to `08e65e17e12087e42667f0771ed76d8d1d02b45e`. The spawn-cwd guard returned `READY`.

### Phase 1: Spec Review — FAIL

What I verified:

- **AC "measured before and after, worst window ≤ 90".** PASS.
  - Before: the executor's raw `red2.jsonl` agrees with measurements.md.
  - After: I ran the spec myself (results below). Every test's window is ≤ 62.
- **AC "zero 429s across 10 runs".** PASS.
  - The executor's `after10.jsonl` has 140 rows, all passed, with zero 429s and a maximum window of 62. I recomputed these figures from the raw file.
  - My own fresh run of 14 tests also shows 0 x 429.
- **AC "rate limit not raised, users not exempted" (C1).** PASS. The diff does not touch the limiter, its configuration or the test-user setup.
- **AC "red first, observed" (C2/C4).** PASS. I corroborated the red independently of the executor's counter.
  - I unzipped `.concertino/scratch/HEL-1620/pw-red2/.../trace.zip`. It is the Playwright trace of the unmodified "both themes, two presets" test.
  - Its network log has 130 `/api` entries: 97 x 200, 22 x 201, 3 x 404, 2 x 401 and **6 x 429**. The 429s were on steps, schedule, outputs, data-sources, dashboards and sample.
  - So the red is observed, not computed.
- **C5 (counter attaches before login and counts requests).** PASS.
  - `beforeEach` attaches the counter before the test body's `registerAndLogin`.
  - The breakdown shows the post-login page is counted: 5 x `auth/me` for 4 loads, where the extra one is `/login`, and 5 x `dashboards`, where the extra one is `/home`.
  - The counter keys on the `request` event, not on `response`.
  - The `page.request` wrap works. In playwright-core 1.55.1, `lib/client/fetch.js:88-127` shows that `get`, `post`, `put`, `patch`, `delete` and `head` all call `this.fetch(...)`, so replacing the instance's `fetch` counts each call exactly once.
  - The trace (130 requests) and the counter (129) agree to within one.
- **Coverage of the split tests.** PASS. A whitespace-insensitive diff shows only moved lines, and every original assertion survives:
  - all 4 theme/accent pairs, each auditing every `.spine-row__select` (≥ 10 rows), plus the Tab-focus audit;
  - 820/900/1100/1280 in both themes, with the paused schedule and the same screenshot paths;
  - the evidence screenshots at 1440, 1280 and 820 in both themes, with the same `evidencePath` names.
- **Task 3.1, unit test red then green.** Confirmed independently.
  - I made a throwaway detached worktree at HEAD (now removed) with the base `authSlice.ts`, and ran `jest auth/state`.
  - Result: 2 failed, each `Expected number of calls: 1 / Received number of calls: 2`. Both are green at HEAD.
- **D2, "changes no spec requirement", and measurements.md's claim "observable behaviour identical".** FAIL. See CR1. This claim is falsified by a live probe.

Issues: CR1.

### Phase 2: Code Review — FAIL

Gates (all fresh runs in WORKTREE_PATH under `nice -n 19`):

| Gate | Result |
|---|---|
| `npm run lint` | rc 0 |
| `npm run format:check` | rc 0 |
| `npm run typecheck` | rc 0 |
| `npm test`, `HELIO_JEST_MAX_WORKERS=2` | rc 0. Root: 61 suites, 524 tests. Frontend: 728 suites, 9125 tests. |
| `npm --prefix frontend run build` | rc 0 |
| `npx playwright test e2e/hel1579-pipeline-spine-layout.spec.ts --workers=2 --trace retain-on-failure`, under the e2e flock | 14 passed in 1.7 min |

Per-test results of the Playwright run:

| Test | Requests (max 60 s window) |
|---|---|
| 1280x800 | 23 |
| 1440x900 | 23 |
| accent audit, each of 4 | 55 |
| 820/900/1100, each of 2 | 60 |
| select | 36 |
| lanes | 25 |
| flush | 24 |
| evidence, each of 2 | 48 |
| sweep | 62 |

Every test had 0 x 429. Raw data: `.concertino/scratch/HEL-1620/eval1/run.jsonl` and `run.log`.

**Guard failability.**
- The window half was mutated to 50, and the run went red with the count message. The raw transcript `mutation.txt` matches what measurements.md quotes.
- The 429 half was never mutation-run. Its data path, the counter recording `status === 429`, was shown red in the red runs, and the trace corroborates it. That is acceptable.

**The auth `condition` (`frontend/src/features/auth/state/authSlice.ts:70-81`).** I traced every path that dispatches it or changes its status:

- **There is only one dispatch site**, `App.tsx:409-413`, gated on `authStatus === "idle"`. No reducer ever sets `status` back to `"idle"`; it is only the initial state. So:
  - **After logout:** `clearAuth` sets `"unauthenticated"`. App never re-rehydrated here before, and nothing changes now. Live: sign out, then sign in again without a reload, lands on `/home` authenticated.
  - **After login, register or MFA:** the status comes from the thunk's fulfilled reducer, with no rehydrate either before or now.
  - **After a 401:** the interceptor dispatches `clearAuth`, and the app redirects to `/login`. Live: I invalidated the session server-side, clicked Data Sources, and was redirected to `/login`. Nothing is stale.
  - **On the public share viewer:** the dispatch is skipped by `PUBLIC_DASHBOARD_VIEWER_PATH` before the thunk runs, so nothing changes.
  - **On a full load, logged out or logged in:** exactly **one** `GET /api/auth/me` (401 or 200), where the dev build issued two before. The app then renders authenticated, on `/pipelines`.
- **Tests that dispatch while not idle:** `signedInHint.test.ts:82,122` dispatch on fresh stores (idle), and the full jest suite is green.
- **The OAuth callback route has changed behaviour (CR1).**
  - `OAuthCallbackPage` is a child of `App`. Its mount effect runs before App's and dispatches `handleOAuthCallback`, whose `.pending` sets `status = "loading"`.
  - App's effect then dispatches `rehydrateAuth()` from its stale `"idle"` closure, and the new `condition` cancels it.
  - Live probe at HEAD, full load of `/auth/callback?code=bogus&state=x`: the only `/api` request is `GET /api/auth/google/callback` (400). **No `GET /api/auth/me`.**
  - At base, App's effect always dispatched there, because the closure was idle and the thunk had no condition. So the change is not limited to the StrictMode duplicate.
  - The effect is arguably positive. At base the concurrent `auth/me` could resolve last on a fresh OAuth login: its 401 runs `clearAuth`, which can overwrite a just-authenticated status, or wipe the `mfaChallenge` that the MFA branch had just stored.
  - It also has one negative edge, observed live. A user who already holds a valid session and loads a stale or used `/auth/callback?code=...` URL now lands deterministically on `/login?error=oauth_failed` with `status = "unauthenticated"` and a valid cookie. Nothing re-rehydrates until a full reload. At base this depended on response order, and the 200 from `auth/me` could resolve last and recover the session.
  - It is reachable only by revisiting a callback URL, because success navigates with `replace: true`.
- **This contradicts the written spec.** `openspec/specs/frontend-auth-state/spec.md:67-77`, "Session rehydration on app load", says: "On app mount, the application SHALL dispatch `rehydrateAuth()`, which SHALL call `GET /api/auth/me`". Its scenario reads "WHEN `rehydrateAuth()` is dispatched and the browser holds a valid `helio_session` cookie THEN `GET /api/auth/me` is called".
  - With the condition, a dispatch while the status is not idle does not call it.
  - The new jest test "does not re-check once the status has resolved" (`authSlice.test.ts:110-117`) pins exactly that new contract.
  - Design D2 and the proposal say a product fix that changes a spec requirement stops and is re-planned with a spec delta and a design re-gate. measurements.md instead claims "No spec requirement changes (… observable behaviour identical)". That is untrue for `/auth/callback`, and the thunk-level scenario now depends on state.

Other checks:
- **Code quality:**
  - The counter is small, typed and documented.
  - `pathTemplate`/`maxSlidingWindow` are pure.
  - The fetch wrap is correct for the installed Playwright version.
  - No dead code, no `any`.
- **Security and error handling:** nothing new at the boundaries.
- **Design-standard `[mechanical]` rules:** no CSS or markup changed, so N/A.

Issues: CR1 (spec-divergence), and CR2, which follows from it.

### Phase 3: UI Review — PASS (with the CR1 finding above)

Servers came from `start-servers.sh` on 7052/9959, and `assert-phase.sh servers` returned `PASS`. I drove the app with Playwright as `matt@helio.dev`:

- **Logged-out `/login`:** 1 `auth/me` (401). The only console error is that expected 401.
- **Sign in, then a full load of `/pipelines`:** 1 `auth/me` (200), the shell renders, and no console errors or warnings.
- **Sign out, then sign in without a reload:** authenticated `/home`.
- **Server-side session invalidated, then a client navigation:** the 401 interceptor redirects to `/login`.
- **`/auth/callback` with a bad code, logged out and logged in:** both land on `/login?error=oauth_failed`, with no `auth/me` (CR1).
- **The hel1579 page:** happy paths are covered by the 14 green e2e tests, which audit both themes, both accents and the 820–1440 breakpoints.

There is no new UI surface, so the breakpoint and accessibility checks are unchanged from base and are exercised by the spec.

### Overall: FAIL

### Change Requests

1. **Do one of the following for the `rehydrateAuth` `condition` (`frontend/src/features/auth/state/authSlice.ts:80`).** It also suppresses App's mount rehydrate on `/auth/callback`, which contradicts measurements.md's claim that "observable behaviour [is] identical" and the `frontend-auth-state` "Session rehydration on app load" requirement.
   - **(a) Preferred: narrow the fix so only the StrictMode duplicate is removed.**
     - Guard the dispatch in `App.tsx:409-413` with a `useRef` that StrictMode's double-invoke preserves. `OAuthCallbackPage.tsx:15-20` already uses this pattern (`calledRef`) for the same reason.
     - Drop the thunk `condition`.
     - Re-point the red/green unit test to App level. `App.test.tsx` should render under `<React.StrictMode>` and assert `getMeRequest` is called once.
     - Replace the "does not re-check once resolved" test, which pins a contract the spec does not state.
     - This keeps every dispatch-to-call path identical to base, including `/auth/callback`.
   - **(b) Keep the condition, but re-plan as design D2 requires.**
     - Add a spec delta to `frontend-auth-state` "Session rehydration on app load", stating that rehydration runs only while the status is `idle` and is skipped while another auth thunk is in flight (the OAuth callback).
     - Add an App-level test at `/auth/callback` covering the MFA branch and a successful callback: no `auth/me`, and the status resolves from `handleOAuthCallback`.
     - Document the valid-cookie / stale-callback-URL edge (it lands on `/login` unauthenticated until a reload) as accepted.
     - Take the change through a design re-gate.
2. **Correct measurements.md section 2** (the "Only defect: the duplicate `auth/me`…" paragraph).
   - Remove "No spec requirement changes (it is a request-dedup, observable behaviour identical)", or replace it with the analysis for whichever option CR1 takes.
   - If you choose (a), re-measure. The expected `auth/me` count per load should still be 1, and the tests' windows should not change.

### Non-blocking Suggestions

- `e2e/hel1579-pipeline-spine-layout.spec.ts` is now 524 lines, over CONTRIBUTING's ~400-line "propose a split" point. Mention a split in the PR description; for example, the accent audit could move to its own file.
- The `afterEach(async ({ page: _page }, info)` at the spec around line 133 requests the `page` fixture only to discard it. Use `async ({}, info)`, or keep `_page` with a short comment.
- In `apiRequestCounter.ts:93`, when `fetch` receives a Playwright `Request` object, the method falls back to `"GET"` instead of `target.method()`. This is unused today but cheap to make correct.
- **CI time (an estimate from measured local durations, not a CI measurement).**
  - The file runs serially in one worker (`fullyParallel: false`). Locally the 14 tests sum to about 99 s, in 1.7 min wall time.
  - The split adds 5 extra register+login+seed cycles. Each fresh accent test is about 9.6 s including its seed.
  - That puts the net added time at roughly +10 to 20 s locally. Scaled by CI's roughly 2–3x slowdown, that is about +30–60 s on whichever leg holds this spec.
  - Main's slowest leg runs about 16 min against the 18-min cap, so check the shard leg time on the PR's CI run.
