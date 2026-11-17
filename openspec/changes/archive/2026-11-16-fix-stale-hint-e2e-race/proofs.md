# HEL-1623 proofs

Throwaway probes (not committed): `/home/matt/Development/helio/.concertino/scratch/HEL-1623/probe-hel1623.spec.ts`, `probe-hel1623b.spec.ts`.
Servers: `scripts/concertino/start-servers.sh` on 7055/9962. All runs `--workers=2` max, nice 19, `--trace retain-on-failure`.

## D3.1 Red first (UNMODIFIED shape, forced hold)
`/api/auth/me` held behind a gate; unmodified body (`goto /login` -> `setItem` -> release gate -> poll until the hint is gone -> `goto("/")` -> `waitForURL("/login", 5s)`):
`npx playwright test e2e/probe-hel1623.spec.ts -g OLD --repeat-each=5` -> **5 failed** (`page.waitForURL: Timeout` at the `/login` wait; hint already cleared by the booting /login app, so `/` renders the landing page). Deterministic 5/5.

## D2/D1 Landing document is app-code-free (task 2.1)
`frontend/index.html` has one inline script (reads, never writes, `helio.signedIn`) and `/src/landing/landing.ts`, whose imports (theme.css, tapTarget.css, landing.css, betaWiring, build, reel) never reference the key. `grep -rln "helio.signedIn|SIGNED_IN_HINT"` over frontend/src, index.html, public: only `signedInHint.ts`, its test, `landingHtml.test.ts`, `index.html`. Runtime proof is the request count in D3.2.

## D3.2 Same hold, NEW shape: green, zero /api/auth/me before the second goto (AC1)
`-g NEW`: `PROBE seed-goto ms=~100 authMeBetweenSeedAndSecondGoto=0` in every run (none, hang, delay); the hold is released right after the `setItem`, the `/home` document's own 401 passes, test green.

## D3.3 Font stylesheet (https://fonts.googleapis.com/**)
Per-wait probe of the new body (before the fix to the waits):
- seed `goto("/", domcontentloaded)`: 95-147 ms even with the stylesheet hung. Not dependent.
- second `goto("/")` default `load`: 1358 ms (no font), **6056 ms** (delayed 5 s), **timeout** (hung). Dependent -> `waitUntil: "commit"`.
- `waitForURL("/login")` default `load`: 28 ms / **5245 ms** / timeout; even `waitUntil: "domcontentloaded"` still took 5.2 s / timed out (Playwright's lifecycle wait). Dependent -> `waitForURL("/login", { waitUntil: "commit" })` (evaluator-verified; keeps the full test-timeout budget).
Final body: none 1431-1917 ms pass; hung pass (1921 ms); delayed 5 s pass (1922 ms). No timeout was enlarged.

## D3.4 CI corroboration (run 43993159078, shard 4, `playwright-report-shard-4`)
`error-context.md` page snapshot of the failed test: the **landing page** (hero "Give me a dashboard for", Sign in / Start free nav), call log has no "navigated to" line. So the page sat on `/` at timeout: the hint race, cured by this fix; not a broken 401 bounce. Saved in `.concertino/scratch/HEL-1623/ci-4/`.

## D3.3 AC4 `--repeat-each=40` on axios 1.21.1
Worktree `frontend/node_modules` is a fresh `npm ci`; `node -p "require('./frontend/node_modules/axios/package.json').version"` -> `1.21.1` (checked before running).
Final shape (cycle 2: `page.waitForURL("/login", { waitUntil: "commit" })`, no explicit timeout; cycle 1's `toHaveURL` was rejected because it cut the bounce's budget to the 5 s expect default):
- `-g "stale hint" --repeat-each=40 --workers=2 --trace retain-on-failure` -> **40 passed (51.1s)** (executor, cycle 2).
- Evaluator, cycle 1 shape on 1.21.1: 40/40 (1.1 min); `waitForURL(commit)` probe 3/3 plain, 3/3 hung, 3/3 delayed (941-1298 ms).
- NEW shape under the hold, cycle 2: font hung -> pass, `authMeBetweenSeedAndSecondGoto=0`, bounce 1619 ms; font delayed 5 s -> pass, count 0, 1102 ms.
- Natural failure rate (evaluator): the UNMODIFIED body from 0c699d263, unforced, `--repeat-each=10` on 1.21.1 -> **2/10 failed** (`waitForURL` timeout, snapshot = landing page, same signature as CI 43993159078).

## D3.5 Whole spec
`npx playwright test e2e/hel1562-landing-page.spec.ts --workers=2` -> **24 passed (13.7s)** (cycle 2, axios 1.21.1).

## D4 Sweep
Only the stale-hint test seeds `localStorage` from a page. The sign-in test (`registerAndLogin`, line ~56) gets the hint from the real app, the sign-out test only reads it, the rest only `goto("/")` with no seed. No other change.

## D5 hel813 (no code)
CI-history scan of failed main CI runs since 2026-10-16 (27 runs): zero hel813 failures (hel813=57 counts in 5 runs are the passing listing; failures there were hel1584/hel1575/hel1579/hel1562). Releases v0.9.7..v0.9.11 since. Closed per the ticket's own rule. Data: `/home/matt/Development/helio/.concertino/scratch/HEL-1623/ci-history.txt`, `.concertino/runs/HEL-1623/evidence/premise-validation.md`. Orchestrator closes the item in Linear.

## Product defect check
None found: the listener clearing the hint on a 401 is intended; no product code changed.
