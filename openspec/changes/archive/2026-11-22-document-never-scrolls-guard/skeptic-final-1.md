## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `4c17779014027704cad20fce0e9c26aa3c0ecf98`. The diff base was resolved live with
`resolve-review-base.sh` (exit 0) as `c405b68179c46b59e3f7f06940e3acc5d2031999`.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/document-never-scrolls-guard/HEL-1585`.
- **Scope of the change.** `git diff --stat c405b6817...HEAD` lists only these paths:
  - `e2e/hel1585-document-never-scrolls.spec.ts` (+419)
  - `e2e/support/hel1585Seed.ts` (+102)
  - `openspec/changes/document-never-scrolls-guard/**`

  There is no `frontend/**`, `backend/**`, `playwright.config.ts` or shard-weights change. The claim that no product code changed holds.
- **Drift against current main.** `origin/main` (`68829c1c6`) is ahead of the base. Since the base, main has touched only e2e user-cleanup support, `hel1683` and `e2e/README.md`, plus backend tests and scripts. It has no `frontend/` or `playwright.config.ts` change.

  `git merge-tree --write-tree HEAD origin/main` is clean. `npm run check:e2e-prod-build-projects` exits 0, which is the partition check HEL-1816 added.
- **Static gates, run fresh on HEAD.** Every one exited 0: `eslint --max-warnings=0` on both files, `prettier --check` on both files and the change markdown, `check:e2e-types`, `check:e2e-evidence-paths`, `check:e2e-user-cleanup`, `check:e2e-prod-build-projects`, `check:openspec`, `check:spec-structure`, `check:repo-integrity` and `check:no-credential-leak`. Output: `/home/matt/Development/helio/.concertino/scratch/HEL-1585/skeptic-final-static.txt`.
- **Guard run.** My own lane servers: `start-servers.sh` on 7017/9924 with `DATABASE_URL=…/helio_hel1585`, `DB_USER=matt` and `ANTHROPIC_API_KEY` empty, and `assert-phase.sh servers` printed `PASS servers`.

  I ran the full spec file twice with `--workers=2`. The file runs its 4 tests serially on 1 worker.
  - Run 1: 4 passed in 21.4 s.
  - Run 2: 4 passed in 19.2 s.
  - Both runs: 0 x 429, maxWindow 73-74 (≤ 90), and teardown deleted 3 users per run.

  Output: `/home/matt/Development/helio/.concertino/scratch/HEL-1585/skeptic-final-run{1,2}.txt`.
- **Per-route numbers from my run.** These persisted JSONs are load-bearing evidence:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1585/evidence/e2e-evidence/HEL-1585/measurements-1440x900.json`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1585/evidence/e2e-evidence/HEL-1585/measurements-1280x800.json`

  At both viewports, all 17 route visits have `scrollHeight === innerHeight` (900 or 800) and `scrollY` 0.
  - The long pipeline's inner region is `aside.spine-body__spine` (scrollHeight 1904 against clientHeight 763 or 663), so the overflowing content is real and the shell contains it.
  - The wheel check at 1440x900 recorded `{scrollY:0, commandBarMoved:false, innerMoved:true, innerRegion:"aside.spine-body__spine", innerScrollTop:600}`.
  - The Dashboards context list measured 32 items on `/dashboards` and `/dashboards/:id`.
  - `/pipelines` measured 32 links.
- **Failability, from committed evidence.** I did not re-mutate, because I do not modify code. The committed evidence is self-authenticating content, not mtime ordering:
  - `evidence/mutation-shell-height-cycle2.txt` (`.app-shell` height changed to min-height) fails with "2 failed". It names the long `/pipelines/:id` route with `scrollHeight 2041 > innerHeight 900, tallest: div.spine-body__live-output`, along with 10 other routes. That shows the measurement is not vacuous on content-heavy routes, including those without a seed landmark (`/settings` 7595, the review pages ~7547).
  - `evidence/mutation-route-list.txt` shows the AppRoutes check failing with `["/connectors"]`.

  I also re-read `AppRoutes.tsx:112-170` myself. The 16 `path=` literals inside `ProtectedRoute` all appear in the spec's `ROUTES`.

### Acceptance criteria

1. **Reproduced or ruled out, per route, in non-emulated Chromium at 1440x900 and 1280x800, with short and long step lists and a 30+ list:** met.
   - The evidence is `evidence/red-run-main.txt` and `main-run-long-dashboards.txt`, which contain the per-route JSON, plus my own two runs above. The report does not reproduce.
   - The AC's "30+ item context-list pipeline list" cannot exist today: `ScheduledContextList.tsx:18` sets `MAX_ROWS = 8`, which I verified. The change covers the intent two ways instead. It asserts a 32-item Dashboards context list (the context list that still grows with data), and a 32-pipeline `/pipelines` overview. This is a disclosed premise correction, not a gap.
2. **Guard on every authenticated route at both viewports, with CI cost stated:** met.
   - The guard is one spec file, a loop over both viewports in `hel1585-document-never-scrolls.spec.ts:365-393`.
   - Routes are checked against the router (lines 395-404).
   - `evidence/ci-cost.txt` states the cost (~20 s for the file). My runs match: 19-21 s.
3. **Wheel over the steps area leaves the document's scrollY at 0:** met. The check is `wheelOverSpine` (lines 320-363) with its assertion at lines 311-317, and my run recorded `innerScrollTop` 600 with `scrollY` 0.
4. **Other offending routes listed or fixed:** met. `evidence/offenders.md` records none; my run independently found none.

### Iron Laws

- **Verification:** I re-ran the gates and the guard myself (above).
- **Debugging:** no fix was made, because the defect did not reproduce. The guard is proven failable by two mutations with committed output.
- **Red-first deviation:** the iteration on main before the first committed run is disclosed honestly in `ci-cost.txt`.

### UI / design judgment

N/A. No `frontend/**` or style file changed, so there is no visual surface to judge. The Playwright MCP browser was not used.

### Gate defects

None. No mtime-ordering claim was relied on.

### Verdict: CONFIRM

### Non-blocking notes

- Several routes wait only on the shell's sr-only `<h1>`, with no content landmark: `/home`, `/sources`, `/connectors`, `/chat`, `/settings` and the review pages. The mutation run shows their content had rendered by measurement time, but a per-page content landmark would make that independent of fetch timing.
- `evidence/red-run-main.txt` is a passing run despite its name. `ci-cost.txt` explains why; the PR body should say so too.
- The spec is ~419 lines, over the ~400 soft budget. Mention this in the PR.
- Lane servers were started and stopped by me with `stop-servers.sh` (`STOPPED ports=7017,9924`; both ports return 000 afterwards).
