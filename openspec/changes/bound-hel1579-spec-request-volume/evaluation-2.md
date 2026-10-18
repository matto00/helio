## Evaluation Report — Cycle 2 (evaluation-2.md)

- **Reviewed:** HEAD `c326fe8d6fb1d8741a8ad524aca7c8a06342506d`.
- **Diff base:** resolved live with `resolve-review-base.sh` to `08e65e17e12087e42667f0771ed76d8d1d02b45e`.
- **Spawn-cwd guard:** `READY`.
- **Scope:** I reviewed the cycle-2 delta `25ab4ba92..c326fe8d6`, then the full diff from base.

### Phase 1: Spec Review — PASS

**CR1 is resolved.** I checked each part:

- **`authSlice.ts` matches base exactly.** It does not appear in `git diff --stat 08e65e17e...HEAD`.
  - The thunk `condition` is removed.
  - The cycle-1 single-flight tests are removed, including the one that pinned the new contract.
  - The `frontend-auth-state` "Session rehydration on app load" requirement holds again.
- **The new guard is a `useRef` in `App.tsx:409-421`.** It is set only when the effect actually dispatches.
  - No reducer ever sets `auth.status` back to `"idle"`, so a single App instance never legitimately dispatches twice. The ref therefore changes only StrictMode's simulated remount.
  - If the first mount is on the public share-viewer route, the dispatch is skipped and the ref stays `false`. A later client-side navigation to a protected route still rehydrates.
- **Live check: `/auth/callback?code=bogus&state=x`, full load at HEAD.**
  - It sends `GET /api/auth/google/callback` (400) and also `GET /api/auth/me`.
  - The rehydrate is no longer suppressed, matching base.
  - Only one `auth/me` is sent; the StrictMode duplicate is gone.
- **Live check: a normal full load sends exactly one `GET /api/auth/me`.**
  - Signed in, `/home`: one call, 200.
  - Signed out, `/pipelines`: one call, 401, then a redirect to `/login`.
  - Signing in from there returned me to the `/pipelines` deep link, authenticated.

**CR2 is resolved.** measurements.md section 2 now:

- withdraws the cycle-1 "observable behaviour identical" claim and explains why the condition was withdrawn (the `/auth/callback` effect, D2);
- describes the ref guard accurately.

The new section 5's claims match my observations:

- The live probes match mine (above).
- I recomputed `.concertino/scratch/HEL-1620/after10b.jsonl` from the raw file: 140 rows, 140 passed, 0 x 429, worst window 62.

**The new test is red on base and green at HEAD.**

- I built a throwaway detached worktree at HEAD with the base `App.tsx` (removed afterwards).
- On base, `jest src/app/App.test.tsx -t "exactly one session rehydrate"` fails: `Expected number of calls: 1 / Received number of calls: 2`.
- It is green at HEAD, inside the full suite.

**Driver overlap note (HEL-1608).** I compared the base and HEAD text of the spec file:

- `seedPipeline` is byte-identical: the `async function seedPipeline` segment up to `test.describe(`.
- The sweep 769–1100px test is byte-identical: from its leading comment to the end of the file.
- The only shared change that reaches it is the describe-level `beforeEach`/`afterEach` guard wiring. HEL-1608's edits to the sweep body will not conflict textually.

The earlier cycle-1 Phase 1 findings (ACs, C1–C5, red evidence, coverage) still hold. Their source files are unchanged apart from the two small edits below.

Issues: none.

### Phase 2: Code Review — PASS

Gates (fresh runs in WORKTREE_PATH, `nice -n 19`):

| Gate | Result |
|---|---|
| `npm run lint` | rc 0 |
| `npm run format:check` | rc 0 |
| `npm run typecheck` | rc 0 |
| `npm test`, `HELIO_JEST_MAX_WORKERS=2` | rc 0. Root: 61 suites, 524 tests. Frontend: 728 suites, 9124 tests (cycle 1's 9125, minus 2 removed slice tests, plus 1 App test). |
| `npm --prefix frontend run build` | rc 0 |
| `npx playwright test e2e/hel1579-pipeline-spine-layout.spec.ts --workers=2 --trace retain-on-failure`, under the e2e flock, `DEV_PORT=7052` | 14 passed in 1.8 min, 0 x 429, worst window 62 |

The Playwright run's `auth/me` counts were 1 per load plus 1 for the `/login` page, which is consistent with the guard. Raw output: `.concertino/scratch/HEL-1620/eval2/run.jsonl` and `run.log`.

Process note: the 1-minute load was 11.41 when the Playwright run started, and I did not apply the load gate before it. The run still passed, with numbers identical to cycle 1 and the executor's 10-run data.

Code review of the delta:

- **`App.tsx`:** a minimal, well-commented ref guard that follows the existing `OAuthCallbackPage` `calledRef` precedent. It adds no new state.
- **`App.test.tsx`:**
  - `renderApp` gains `idleAuth` and `strictMode` options.
  - The existing authenticated and unauthenticated branches are kept unchanged, nested under `idleAuth`.
  - The new test exercises the real StrictMode double-invoke, which is the actual defect.
- **`apiRequestCounter.ts:96`:** the method now falls back to `target.method()` when `fetch` receives a Request object. This was a cycle-1 suggestion.
- **Spec `afterEach`:** a comment now explains why the unused `_page` fixture is there (Playwright and ESLint constraints). This is acceptable.

Issues: none.

### Phase 3: UI Review — PASS

- Servers were started with `start-servers.sh` on 7052/9959; `assert-phase.sh servers` returned `PASS`.
- Before probing, I confirmed that Vite was serving HEAD's code:
  - `/src/app/App.tsx` contains `rehydrateDispatchedRef`;
  - `/src/features/auth/state/authSlice.ts` has no `condition:`.
- The auth flows I probed live are listed under Phase 1.
- The only console error was the expected 401 from `auth/me` while signed out.
- There is no new UI surface. The hel1579 page is covered by the 14 green e2e tests: both themes, both accents, and widths from 820 to 1440.

### Overall: PASS

### Non-blocking Suggestions

- `e2e/hel1579-pipeline-spine-layout.spec.ts` is still over CONTRIBUTING's ~400-line "propose a split" point. Mention a split in the PR description.
- **CI time:** my cycle-1 estimate still stands, at about +30–60 s on CI for the leg that runs this spec. Check that shard's leg time on the PR run against the 18-minute cap.
