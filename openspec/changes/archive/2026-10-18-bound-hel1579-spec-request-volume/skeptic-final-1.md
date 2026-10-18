## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `c326fe8d6fb1d8741a8ad524aca7c8a06342506d`. Diff base was resolved live with `resolve-review-base.sh` to `08e65e17e12087e42667f0771ed76d8d1d02b45e`, and the spawn-cwd guard returned READY. I checked a merge-tree against the current `origin/main` (`d83875077`): it merges cleanly, and HEL-1582 touches none of the changed files.

Scratch for this review: `/home/matt/Development/helio/.concertino/scratch/HEL-1620/skeptic/`. That covers `mut.log`/`mut.jsonl`, `head.log`/`head.jsonl` and the `pw-*` trace dirs. Load was below 10 before each heavy run (3.63 and 5.10). I used at most 2 workers, `nice -n 19`, and the e2e flock.

### What I verified (with evidence)

**1. The red is real (I reproduced it).**
- *e2e side.*
  - I built a throwaway detached worktree at HEAD and restored base's single-user accent-audit test into it, keeping HEAD's counter guard.
  - I ran it against the live 7052/9959 servers.
  - Result: `142 /api requests, max 60s window 142 (limit 120, target <= 90), 20 x 429`, rc=1, test failed. 72 of the 142 were `GET .../steps/:id/preview`.
  - The executor's raw `red2.jsonl` agrees: re-parsed, it shows 129 max window, 6 x 429, `failed`.
- *Unit side.*
  - In the same throwaway worktree, with `frontend/src/app/App.tsx` reverted to base, `jest src/app/App.test.tsx -t "exactly one session rehydrate"` FAILS: `Expected number of calls: 1 / Received number of calls: 2`.
  - At HEAD, `jest src/app/App.test.tsx src/features/auth` passes: 11 suites, 147 tests.

**2. The guard can fail on the real regression, not just on a lowered threshold.**
- The run in item 1 is exactly the regression the guard exists to catch (the split reverted).
- The `afterEach` guard failed with `rate-limited (429) responses: ... Received: 20`.
- The executor's mutation (threshold 90 -> 50) also exercised the window half.
- The counter does see seed traffic. I checked that `playwright-core/lib/client/fetch.js` get/post/put/... all call `this.fetch(...)`, and the wrapper is installed on that method.
- The registration `request` fixture is never reused in the spec after registration. Registration itself carries no cookie, so the limiter does not key it.
- The guard is conservative in the right direction: the max over a sliding 60 s window is always at least the count in any fixed limiter window.

**3. HEAD meets the AC (my run).**
- Full spec, `--workers=2 --trace retain-on-failure`: 14 passed in 1.5 min, rc 0.
- `head.jsonl` shows 14 rows, worst window 62, 0 x 429.
- For the 10-run AC I relied on the executor's raw `after10b.jsonl` (140 rows, all passed, 0 x 429, worst 62). The evaluator independently recomputed the same figures, and my own run matches them exactly.
- Rate limit and exemptions: nothing under `backend/` or the CI or Playwright config is touched by the diff (`git diff --stat`), so the limit is not raised and no test user is exempted.

**4. Coverage of the original assertions is preserved.**
- `git diff -w` of the spec shows that the only non-comment changes are:
  - the counter import and hooks;
  - the test wrappers: titles, `for` loops moved from inside to outside the test, setTimeout 240 -> 120 s for the accent audit, and per-theme `label`s.
- Every assertion body is byte-identical modulo indentation.
- The theme x accent x every row x tab-focus matrix is fully covered (4 tests), as are the 820/900/1100/1280 x both themes cases and the 1440/1280/820 evidence x both themes.
- `seedPipeline` and the sweep test are unchanged.

**5. The App ref guard never skips a legitimate rehydrate.** I traced every case in source.
- **How the ref is set.** It is set only inside the branch that actually dispatches (`App.tsx:413-421`). A first render on the public viewer path leaves it `false`, so a later navigation still rehydrates.
- **Status never returns to idle.** `authSlice.ts` sets `status` to `"idle"` only in `initialState`. Every reducer and extraReducer moves it to loading, authenticated or unauthenticated (lines 216-328). Logout dispatches `clearAuth` -> `"unauthenticated"`. So within one App instance, base would never have dispatched a second time either.
- **Remount after logout.** `<App />` is mounted once at the root in `main.tsx:106`, outside the route tree, so logout does not remount it. If it ever were remounted, the new instance gets a fresh ref, which matches base.
- **HMR.** Fast refresh either preserves the ref (state-preserving refresh) or remounts with a fresh ref (hook-signature change). In both cases the store survives with a non-idle status, so neither base nor HEAD dispatches. Behaviour is identical.
- **Test harness.** Each `render` creates a new instance with a new ref. The full auth and App suites pass.
- **StrictMode.** The double-invoke keeps the same fiber, so the ref survives the simulated remount. That is exactly the duplicate being removed, as proven by the red/green test in item 1.
- **`/auth/callback`.** The thunk is unchanged (`authSlice.ts` is not in the diff), so the cycle-1 concern does not apply.

**6. CI-time impact is acceptable.**
- `node scripts/e2e-shard.mjs plan 4` puts this spec in leg 3. The weight table is unchanged, so the partition does not move.
- On main's latest run (39113821847), the `e2e (3)` job took 14:35 wall against an 18 min cap. The heaviest leg, `e2e (4)`, took 17:00, but this spec is not in it.
- Locally, HEAD's summed test time is about 101 s. Base's equivalent was about 75 s, judging from the 31.6 s single-user accent audit in my mutation run plus the others.
- So the added cost is about +26 s serial, or about +13 s wall at 2 workers. Even at 3x on CI, that is under a minute, leaving roughly 2.5 min or more of headroom on leg 3.

**7. UI.** There is no visual change. The `App.tsx` edit is effect logic only, and no CSS or TSX markup was touched. Design judgment (step 4) does not apply.

### Verdict: CONFIRM

### Non-blocking notes

- **DB residue from this review.** My throwaway-worktree mutation run had no `backend/.env`, so the global teardown failed with `DATABASE_URL is unset`. One throwaway user was left in the shared dev DB: `hel1579-accent-1792317349353-87080@example.test`. The real-worktree run deleted its 14 users normally.
- **File length.** The spec is still over CONTRIBUTING's ~400-line split point. Mention this in the PR body, as the evaluator noted.
- **Watch the PR's CI time.** Check leg 3's wall time on the PR's CI run to confirm the estimate in item 6.
