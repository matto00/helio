## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `7450dd2ae445d5b60cefc31c05e654b90da0dc19` against live base `0c699d2633e5dedbc14cb3bddaca6147dd6b6025`
(origin/main). The diff touches `e2e/hel1562-landing-page.spec.ts` (stale-hint test only) and
`openspec/changes/fix-stale-hint-e2e-race/**`.

### Evaluator's own measurements on axios 1.21.1 (closes the AC4 gap)

Setup, done inside the worktree only. The worktree's `frontend/node_modules` was a hardlinked copy of the main
checkout's, at axios 1.20.0. I removed it with `rm -rf` (this only unlinks; the main checkout still reports 1.20.0 and
the inode link count went from 6 to 5), then ran `nice -n 19 npm ci` in the worktree's `frontend/`. Afterwards
`node -p "require('./frontend/node_modules/axios/package.json').version"` printed `1.21.1`, and the running dev
server's `/node_modules/.vite/deps/axios.js` served `VERSION = "1.21.1"`. `git status` stayed clean in both checkouts.
Servers were started with `start-servers.sh` on 7055/9962 and stopped with `stop-servers.sh`. Every run used
`--workers=2 --trace retain-on-failure` under nice 19.

| Run | Result |
| --- | --- |
| Fixed test (`-g "stale hint" --repeat-each=40`) | **40/40 passed** (1.1 min, 2.4-2.5 s each) |
| UNMODIFIED test body (from 0c699d263), unforced, `--repeat-each=10` | **2/10 failed** (`page.waitForURL: Test timeout of 30000ms exceeded`). The error-context snapshot shows the landing page (`#top`/`#center`/`#plans` anchors), the same signature as CI run 43993159078. This is the natural failure rate the fix removes. |
| Forced repro, executor's probe, OLD shape (`/api/auth/me` held, released after `setItem`) | **5/5 failed** (`waitForURL` timeout; stays on `/`) |
| Same hold, NEW shape | **5/5 passed**, `authMeBetweenSeedAndSecondGoto=0` in every run (AC1) |
| NEW shape, fonts stylesheet hung / delayed 5 s, `--repeat-each=3` each | 3/3 and 3/3 passed, 0 `/api/auth/me` requests before the second goto |
| Whole spec file | 24/24 passed |

On 1.21.1, ACs 1-4 hold as measured. Probe sources are at `/home/matt/Development/helio/.concertino/scratch/HEL-1623/`
(`eval-unmodified-hel1623.spec.ts`, `eval-commit-wait-hel1623.spec.ts`, plus the executor's
`probe-hel1623.spec.ts`). They were copied into `e2e/` only for each run and then removed by exact path.

### Phase 1: Spec Review — PASS
- AC1: the hint is seeded from the static landing page. The runtime count of 0 `/api/auth/me` requests confirms it.
- AC2: red-first is proven both forced (5/5 red to 5/5 green) and unforced (2/10 red on the unmodified body).
- AC3: the test passes with the font stylesheet held and with it delayed.
- AC4: 40/40 on 1.21.1, measured by the evaluator.
- AC5: CI is still pending.
- AC6: no product code changed.
- AC7: the hel813 scan is recorded in proofs.md.
- tasks.md matches the implementation.
- No scope creep. Constraints C1-C4 are honored: no retries, and no timeout was enlarged.
- proofs.md's AC4 caveat (the 40/40 ran on 1.20.0) is now outdated. The cycle-2 fix should update it to cite these 1.21.1 numbers.

### Phase 2: Code Review — FAIL
Gates: the changed files match neither `frontend/**` nor `backend/**`, so no required gate applies. I ran these
anyway: eslint on the spec passed (0 warnings), prettier on the spec and change dir passed, `tsc -p e2e/tsconfig.json`
passed, and `check-openspec-hygiene` is clean.

Issue (blocking): `e2e/hel1562-landing-page.spec.ts:88` replaces `page.waitForURL("/login")` with
`await expect(page).toHaveURL(/\/login$/)`. This quietly shrinks the budget for the whole `/` -> `/home` (app boot,
`/api/auth/me` 401) -> `/login` bounce. Before, it had the 30 s test timeout. Now it has the default 5 s expect
timeout, because `playwright.config.ts` sets no `expect.timeout`. CI evidence for why this matters:
- In the last three passing main CI runs (43990610999, 43986390715, 43985570071; `playwright-json-shard-4`), the
  whole stale-hint test took 4421 / 3581 / 3318 ms.
- Locally the bounce alone is about 1.0-1.3 s of a 2.1-2.8 s test.
- So on CI the bounce is likely about 2-3 s against a 5 s cap: roughly 2x headroom on a runner that
  `playwright.config.ts` itself describes as CPU-bound and flaky.

The fix would trade a race for a timing dependency, and main CI must go reliably green (AC5). proofs.md D3.3 dropped
`waitForURL` because `domcontentloaded` still waited on the stylesheet, but it never tried `waitUntil: "commit"`.
Design D3.3 named `commit` as the option. I probed it (`eval-commit-wait-hel1623.spec.ts`).
`page.waitForURL("/login", { waitUntil: "commit" })` passes 3/3 with no font interference, 3/3 with the stylesheet
hung and 3/3 with it delayed 5 s, resolving in 941-1298 ms. It does not wait on `load`, and it keeps the test-timeout
budget.

### Phase 3: UI Review — N/A
No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The e2e runs above cover
the behavior.

### Overall: FAIL

### Change Requests
1. `e2e/hel1562-landing-page.spec.ts:88`: replace `await expect(page).toHaveURL(/\/login$/);` with
   `await page.waitForURL("/login", { waitUntil: "commit" });`. This restores the 30 s test-timeout budget for the
   real app-boot bounce without waiting on the fonts stylesheet's `load`. Do not add an explicit timeout to either
   form. Re-run `--repeat-each=40` (now possible on 1.21.1: the worktree's `frontend/node_modules` is a fresh `npm ci`
   at 1.21.1), the NEW-shape probe with `PROBE_FONT=hang` and `PROBE_FONT=delay`, and the whole spec. Update the
   comment at :82-84 ("the URL is asserted by polling" no longer applies).
2. `openspec/changes/fix-stale-hint-e2e-race/proofs.md`, the "D3.3 AC4" section: replace the 1.20.0 caveat with the
   1.21.1 measurements (the evaluator's from this report and the executor's own re-run after change 1). Add the
   unforced unmodified-shape result (2/10 failed on 1.21.1) as the natural failure-rate evidence.

### Non-blocking Suggestions
- `e2e/hel1562-landing-page.spec.ts:84` is 129 characters, a comment line that prettier does not wrap. Consider
  rewrapping it to match the 108/106-character lines above it.
