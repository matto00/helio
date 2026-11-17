## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `2c2b75e468f26fdfbacf393058a6f6d840d648ae` against the live base `0c699d2633e5dedbc14cb3bddaca6147dd6b6025`
(`resolve-review-base.sh`, origin/main, exit 0).

### What I verified (with evidence)
- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/fix-stale-hint-e2e-race/HEL-1623`.
- **Diff scope (AC6):** `git diff BASE...HEAD --stat` shows one code file, `e2e/hel1562-landing-page.spec.ts` (+8/-4). Everything
  else is under `openspec/changes/fix-stale-hint-e2e-race/`. Nothing under `frontend/` or `backend/` changed.
- **Axios version:** the worktree's `frontend/node_modules` is a real directory, not a symlink to the main checkout.
  `frontend/node_modules/axios/package.json` reports `"version": "1.21.1"`, and the Vite-served prebundle
  `node_modules/.vite/deps/axios.js` contains `VERSION$1 = "1.21.1"`.
- **AC1 (seeding runs no app code):** `frontend/index.html` has one inline head script, and it only reads `helio.signedIn`
  (`location.replace("/home")` at line 47). The only other script is `/src/landing/landing.ts`. The hint is removed only
  by `registerSignedInHintListener` in `signedInHint.ts`, which the app's store runs and the landing page does not.
  Runtime check: in my own probe, the seed on `/` was followed by a 1.5 s idle wait. Zero `/api/auth/me` requests were
  made and the hint was still `"1"` before the second navigation.
- **AC2 (red first), my own forced probe:** I held `/api/auth/me` until after the seed, released it, then waited 1.5 s,
  which is harsher than the CI race window.
  - The base test body, unchanged (`goto /login` → seed → `goto("/")` → `waitForURL("/login")`), **failed 3/3** with a
    `page.waitForURL` timeout.
  - The committed body under the same condition **passed 3/3**.
- **AC3 (fonts):** the same NEW-body probe ran with `https://fonts.googleapis.com/**` hung and passed 3/3.
  - The probe also asserted that `/api/auth/me` fired after the second navigation, so the `/home` app really ran the
    bounce.
  - The committed waits are `domcontentloaded`/`commit`, so none depends on `load`.
- **AC4:** the committed test, run as
  `-g "stale hint" --repeat-each=40 --workers=2 --trace retain-on-failure` on axios 1.21.1, gave **40 passed (45.0s)**.
  The whole spec file gave **24 passed (14.1s)**.
- **CI signature matches the diagnosis:** the archived CI shard-4 `error-context.md` (`.concertino/scratch/HEL-1623/ci-4/...`)
  shows the landing page's h1 "Give me a dashboard for" and the "Sign in" nav at the time of the timeout. The page
  stayed on `/`, which is consistent with the hint having been cleared before the head script ran.
- **CI runs the `dev` project** (`playwright.config.ts` projects, with `HELIO_E2E_PROD_BUILD` unset), which is the same
  project I measured.
- **No timeouts enlarged, no retries added:** confirmed in the diff. The `expect.poll` on the hint uses the default expect
  timeout and tolerates the navigation that happens mid-poll.
- **AC5 (green in CI):** not verifiable before push. This depends on the PR's CI run.
- **AC7 (hel813):** the CI-history scan is recorded in proofs.md D5 (`.concertino/scratch/HEL-1623/ci-history.txt`). This
  closes the item without code, by the ticket's own rule.
- **Hygiene:** I ran my probe from scratch by copying it into `e2e/` for the run only, then removed it by exact path
  (`ls e2e | grep -c skeptic` → 0). `git status` shows only the evaluator's untracked `evaluation-2.md`. Servers were
  started and stopped with the canonical scripts (`STOPPED ports=7055,9962`).
- **UI:** no UI change, so the design review does not apply.

### Verdict: CONFIRM

### Non-blocking notes
- `evaluation-2.md` is untracked in the worktree. The orchestrator should commit it with the delivery artifacts.
- The test title still says "bounces once through /home", but the test does not assert the `/home` hop itself. This is
  unchanged from the base and out of scope here.
