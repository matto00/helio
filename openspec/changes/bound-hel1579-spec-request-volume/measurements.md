# HEL-1620 measurements

Counter: `e2e/support/apiRequestCounter.ts` (page request/response events plus a wrapped `page.request.fetch`, because `page.on("request")` does NOT fire for `page.request.*` calls: probed, empty event list after `page.request.get`). Attached before `registerAndLogin` (C5). Local dev servers (Vite dev build, StrictMode on), 1 Playwright worker, nice 19. Window = max requests in any sliding 60 s.

## 1. RED (before any fix): unmodified spec, counter report-only

Run 1 (counter v1 double-counted `page.request.post` via its internal `fetch`, so the totals below are inflated; the 429 counts and the pass/fail are not affected). Accent audit: **24 x 429** observed, test still passed.

Run 2 (counter fixed, each request counted once): the accent audit **FAILED** at `toBeVisible` on the "Rows after step" region (the ticket's symptom, line 191 equivalent) with **6 x 429** and a max 60 s window of **129 > 120**. Raw: `.concertino/scratch/HEL-1620/red2.jsonl`.

| test | total | max 60s window | 429s | result |
|---|---|---|---|---|
| 1280x800: spine, editor and at least 8 preview rows fit without page s | 25 | 25 | 0 | passed |
| 1440x900 (HEL-1585 check for this page): the document does not scroll | 25 | 25 | 0 | passed |
| accent audit: only Run, the selected step and focus use the accent (ev | 129 | 129 | 6 | failed |
| 820/900/1100px: the header keeps one row and the page does not scroll  | 117 | 117 | 0 | passed |
| selecting a step updates the focused editor heading and the preview he | 39 | 39 | 0 | passed |
| a branch renders as a labelled sub-spine and a lane row is selectable | 27 | 27 | 0 | passed |
| an edit made just before selecting another step is saved (no edit is l | 26 | 26 | 0 | passed |
| evidence: the running page at 1440, 1280 and 820 wide, in both themes | 91 | 91 | 0 | passed |
| sweep 769-1100px: header and editor actions fit, both themes, list at  | 67 | 67 | 0 | passed |

Accent audit (red2, failed part-way so counts are a floor): 54 x `GET /api/pipelines/:id/steps/:id/preview`, 18 x `POST .../steps` (seed), 10 x `GET /api/auth/me`, 5 x `GET /api/dashboards`, then 4 x each of the pipeline-page loads (4 full `page.goto`s).

Per full load of `/pipelines/:id` (820 test, 8 loads, red3): 1 each of `pipeline-schedules`, `pipelines`, `pipelines/:id`, `steps`, `analyze`, `schedule`, `outputs`, `data-sources`, `dashboards`, `data-sources/:id/sample`, default-step `preview`, plus **2 x `GET /api/auth/me`** = 13 per load. Seed + login + `/home` = 25 requests (the six-ish shell/home requests of the post-login page are in the 25).

Dominant cost of the accent audit: 4 loads x ~19 spine-row clicks, each a fresh preview GET (required by pipeline-detail-spine-layout D8), all charged to one user.

Over-budget tests before any change (target <= 90): accent audit (129+, 429s), 820/900/1100 (117), evidence (91).

## 2. Classification (design D2)

Per full load of `/pipelines/:id` (from the red3 probe, plus a single-load probe logging start times):

| request | per load | class | reason |
|---|---|---|---|
| `GET /api/auth/me` | **2** (same millisecond) | **defect (dev build only)** | F-207's `authStatus === "idle"` gate in `App.tsx` cannot stop React StrictMode's dev double-invoke of the mount effect (both runs see the same stale "idle" closure), so `rehydrateAuth` fires twice. Production builds do not double-invoke effects, so this is a dev/e2e-only duplicate (the e2e job runs the dev server). |
| `GET /api/pipelines/:id`, `/steps`, `/analyze`, `/schedule`, `/outputs` | 1 each | required | the page's data |
| `GET /api/data-sources`, `GET /api/data-sources/:id/sample` | 1 each | required | root-source picker; HEL-1628 draft preview sample (1 per root) |
| `GET /api/pipelines`, `GET /api/pipeline-schedules`, `GET /api/dashboards` | 1 each | required | shell: pipeline list rail, scheduled context list, dashboard rail. Candidate "unguarded `fetchScheduledItems`": measured exactly 1 per load (4 in 4 loads), no duplicate, not a defect |
| selected dashboard's panels on `/pipelines` | 0 | n/a | candidate checked: not requested on this route |
| default-step `GET .../steps/:id/preview` | 1 | required | pipeline-detail-spine-layout D8 |
| `GET .../steps/:id/preview` per spine-row click | 1 per click | required | D8: a settled response is never reused; not a defect |

Only defect: the StrictMode-duplicated `auth/me`. Fix (cycle 2, after evaluation-1 CR1): a `useRef` once-guard on App's mount rehydrate effect in `App.tsx` (the pattern `OAuthCallbackPage`'s `calledRef` uses). `rehydrateAuth` itself is unchanged. The cycle-1 fix (a thunk `condition`) was withdrawn: it also cancelled App's rehydrate on `/auth/callback` (where `OAuthCallbackPage` sets `loading` first), which changes the `frontend-auth-state` "Session rehydration on app load" requirement, forbidden by D2.

Every dispatch path is identical to base except the second StrictMode invocation, which the ref swallows (production builds never double-invoke effects, so production is unaffected). Test: `App.test.tsx` "issues exactly one session rehydrate (GET /api/auth/me) per mount under StrictMode" renders `App` under `React.StrictMode` with an `idle` session and asserts one `getMeRequest` call: **red on the base `App.tsx` (`Expected number of calls: 1, Received: 2`), green with the guard.** Live checks are in section 5.

Overlap check (2026-10-18): `gh pr list` open PRs and `git diff --name-only origin/main...HEAD` of the HEL-1630 and HEL-1582 worktrees: none touch `frontend/src/features/auth/**`, `frontend/src/app/App.tsx`, `e2e/hel1579-pipeline-spine-layout.spec.ts` or `e2e/support/apiRequestCounter.ts`. PR #1060 (HEL-1582) touches other e2e specs and `e2e/support/pipelineSpine.ts` only. No overlap.

The remaining volume is structural (one user reloading 4 to 8 times plus 19 clicks per load), so the test is restructured (D3): accent audit into 4 tests (one per theme/accent, one fresh user, one load each), 820/900/1100 into 2 (per theme), evidence into 2 (per theme). Sweep (67) and the rest stay as they were.

## 3. After: 10 runs (`--repeat-each=10 --workers=2`, 140 tests, all passed, 8.7 min)

| test | runs | max total | max 60s window (worst of 10) | 429s |
|---|---|---|---|---|
| 1280x800: spine, editor and at least 8 preview rows fit without page scroll | 10 | 23 | 23 | 0 |
| 1440x900 (HEL-1585 check for this page): the document does not scroll | 10 | 23 | 23 | 0 |
| accent audit [dark #ec4899]: only Run, the selected step and focus use the accen | 10 | 55 | 55 | 0 |
| accent audit [dark #3b82f6]: only Run, the selected step and focus use the accen | 10 | 55 | 55 | 0 |
| accent audit [light #ec4899]: only Run, the selected step and focus use the acce | 10 | 55 | 55 | 0 |
| accent audit [light #3b82f6]: only Run, the selected step and focus use the acce | 10 | 55 | 55 | 0 |
| 820/900/1100px [dark]: the header keeps one row and the page does not scroll (sc | 10 | 60 | 60 | 0 |
| 820/900/1100px [light]: the header keeps one row and the page does not scroll (s | 10 | 60 | 60 | 0 |
| selecting a step updates the focused editor heading and the preview header | 10 | 36 | 36 | 0 |
| a branch renders as a labelled sub-spine and a lane row is selectable | 10 | 25 | 25 | 0 |
| an edit made just before selecting another step is saved (no edit is lost) | 10 | 24 | 24 | 0 |
| evidence: the running page at 1440, 1280 and 820 wide [dark] | 10 | 48 | 48 | 0 |
| evidence: the running page at 1440, 1280 and 820 wide [light] | 10 | 48 | 48 | 0 |
| sweep 769-1100px: header and editor actions fit, both themes, list at default an | 10 | 62 | 62 | 0 |

Total 429s across all 140 test runs: **0**. Worst window anywhere: **62** (target <= 90, limit 120). Before: accent audit 129 with 6 x 429.

## 4. Guard mutation check (task 3.3)

`MAX_WINDOW_TARGET` temporarily lowered 90 -> 50, one test run (`-g "820/900/1100px \[dark\]"`); guard went red with the count message, then the constant was restored to 90 (transcript `.concertino/scratch/HEL-1620/mutation.txt`):

```
Error: worst 60s /api window exceeds 50: 60 /api requests, max 60s window 60 (limit 120, target <= 50), 0 x 429; top: 5 GET /api/auth/me; 5 GET /api/dashboards; 4 GET /api/pipeline-schedules; ...
Expected: <= 50   Received: 60
```
The 429 half of the guard was shown red by the unmodified-spec runs in section 1 (6 x 429 observed by the same counter). The auth fix's effect: `GET /api/auth/me` for 4 loads fell from ~10 to 5 per test.

## 5. Cycle 2 (after evaluation-1: ref guard instead of thunk `condition`)

Live probe (full `page.goto`, dev server, StrictMode): `/pipelines` sends exactly **1** `GET /api/auth/me`; `/auth/callback?code=bogus&state=x` sends `GET /api/auth/google/callback` and still sends `GET /api/auth/me` (App's mount rehydrate is not suppressed; 1 call, the StrictMode duplicate removed).

10 runs again (`--repeat-each=10 --workers=2`, 140 test runs, all passed, 8.9 min), raw `.concertino/scratch/HEL-1620/after10b.jsonl`:

| test | max total | worst 60s window | 429s |
|---|---|---|---|
| 1280x800: spine, editor and at least 8 preview rows fit without page scroll | 23 | 23 | 0 |
| 1440x900 (HEL-1585 check for this page): the document does not scroll | 23 | 23 | 0 |
| accent audit [dark #ec4899]: only Run, the selected step and focus use the accen | 55 | 55 | 0 |
| accent audit [dark #3b82f6]: only Run, the selected step and focus use the accen | 55 | 55 | 0 |
| accent audit [light #ec4899]: only Run, the selected step and focus use the acce | 55 | 55 | 0 |
| accent audit [light #3b82f6]: only Run, the selected step and focus use the acce | 55 | 55 | 0 |
| 820/900/1100px [dark]: the header keeps one row and the page does not scroll (sc | 60 | 60 | 0 |
| 820/900/1100px [light]: the header keeps one row and the page does not scroll (s | 60 | 60 | 0 |
| selecting a step updates the focused editor heading and the preview header | 36 | 36 | 0 |
| a branch renders as a labelled sub-spine and a lane row is selectable | 25 | 25 | 0 |
| an edit made just before selecting another step is saved (no edit is lost) | 24 | 24 | 0 |
| evidence: the running page at 1440, 1280 and 820 wide [dark] | 48 | 48 | 0 |
| evidence: the running page at 1440, 1280 and 820 wide [light] | 48 | 48 | 0 |
| sweep 769-1100px: header and editor actions fit, both themes, list at default an | 62 | 62 | 0 |

Total 429s: **0**. Worst window anywhere: **62** (target <= 90).
