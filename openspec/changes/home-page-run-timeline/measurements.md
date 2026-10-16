# Measurements — HEL-1578

## 1.1 Retention red-first (worktree /home/matt/Development/helio/.claude/worktrees/feature/home-page-run-timeline/HEL-1578)

Command: `cd backend && sbt "testOnly com.helio.infrastructure.persistence.pipelines.PipelineRunRepositorySpec"` on unchanged `deleteOldRunsInternal` (keep-10 only):

```
[info] - should HEL-1578: a busy pipeline keeps a day of runs (40 runs over 20h, all kept) *** FAILED ***
[info] - should HEL-1578: the cap bounds a very busy pipeline (350 runs inside 24h keep the newest 300) *** FAILED ***
   ... had size 10 instead of expected size 300 (PipelineRunRepositorySpec.scala:213)
[info] Total number of tests run: 41
[info] Tests: succeeded 39, failed 2, canceled 0, ignored 0, pending 0
[info] *** 2 TESTS FAILED ***
```
(The 15-old-runs scenario passed on main, as expected: it is unchanged behaviour.)

Green after the `deleteOldRunsInternal` change + V136: `Total number of tests run: 41 / Tests: succeeded 41, failed 0` (same command). Covers 40-runs-over-20h (41 incl. new run semantics: all 40 kept), 15-old-runs (10 kept), 350-in-24h (300 kept).

## 3.1 Owner-filter mutation check

With `p.owner_id = $owner::uuid` replaced by `true` in both `HomeSummaryRepository` queries (reverted afterwards),
`HomeSummaryScopingSpec` "exclude A's pipelines for B on a connection that bypasses RLS" FAILED (`Tests: succeeded 7, failed 1`),
while the route spec (non-bypassing role, RLS only) still passed: the explicit filter and RLS are independently proven.
RLS proof: `rolbypassrls=false, rolsuper=false` asserted in-session on `helio_app_test`; raw `pipeline_runs`/`pipeline_schedules`
counts for B = 0, for A = 2/1, via `withSystemContext` = 2/1 (positive control).

## 1.6 EXPLAIN ANALYZE of the runs query (task 1.6; skeptic note 4)

DB: the **embedded test Postgres** (zonky) after Flyway to V136, under role `helio_app_test` (asserted in-session:
`rolbypassrls=false, rolsuper=false`) with `app.current_user_id` set (via `DbContext.withUserContext`). Not the dev DB.
Seed: 50 owned pipelines x 300 succeeded runs, all inside the 24h window (15000 rows, the worst case the retention
cap allows), `ANALYZE`d; every seeded pipeline removed by exact-prefix id after the run (embedded DB is discarded anyway).

Result (third of 3 runs): `Planning Time: 0.210 ms`, `Execution Time: 11.899 ms` (target < 50 ms), 15000 rows returned.
Plan: Nested Loop, `Bitmap Index Scan on idx_pipelines_owner_id` (50 pipelines) driving `Bitmap Index Scan on
pipeline_runs_pipeline_started_idx` (rows=300 loops=50), top-level Sort quicksort 2494kB. The V136 index is used.
The RLS policy subplan (`helio_can_access_pipeline`) adds ~0.4 ms.


## 3.4 Screenshots

`openspec/changes/home-page-run-timeline/screenshots/` (full page, from the running app on ports 7010/9917):
`populated-{light,dark}-{1280,820,768,375}.png`, `newuser-{light,dark}-{1280,820,768,375}.png` and
`populated-coarse-{light,dark}-820.png` (Chromium with `hasTouch`+`isMobile`: `(pointer: coarse)` asserted true, the
pipeline row control measured >= 44px high). The shelf is 4 columns at 1280, 2x2 at 820/768 and one column at 375.
Shot by a temporary Playwright spec (not committed) after registering throwaway users through the registry.

## 3.5 Gate results (this worktree, 2026-10-15)

- `sbt testFull`, sharded in the foreground (`testOnly`): api 2334, domain 2552, infrastructure 1083, services 2101
  (4 canceled, pre-existing environmental), spark+testkit+testsupport 73 -- all `failed 0`.
- `npm test` (3 jest workers): root 51 suites / 469 tests; frontend 626 suites / 7360 tests, 0 failed.
- Full Playwright e2e (2 workers): 305 passed, 1 failed (`hel1562` "Add dashboard" after `/`), fixed and re-run 24/24 passed.
- `npm run lint`, `format:check`, `typecheck`, `npm --prefix frontend run build`, `check:schemas`, `check:scala-quality`,
  `check:openspec`, `check:spec-structure`, `check:e2e-user-cleanup`, `check:e2e-evidence-paths`, `check:tokens`,
  `openspec validate home-page-run-timeline`: all clean.

## Cycle 2 (evaluation-1.md change requests)

### CR3 scheduled-skip prune guard, red with the prune disabled

`FireTimeRunConfigGateSpec` now seeds 14 real runs started 3 days ago, runs 12 scheduled skips, and asserts no run older
than 24h survives and all 12 fires do. With `if (false && pruneOldRuns && ...)` in `PipelineRunService.recordUnrunnable`
(reverted afterwards), from `/home/matt/Development/helio/.claude/worktrees/feature/home-page-run-timeline/HEL-1578/backend`:

```
[info] set current project to helio-backend (in build file:/home/matt/Development/helio/.claude/worktrees/feature/home-page-run-timeline/HEL-1578/backend/)
[info] - should prune runs older than 24h on every scheduled skip, and keep every fire of the last day (1.1a; HEL-1578 keep-24h; guard for the prune call) *** FAILED ***
[info]   14 was not equal to 0 (FireTimeRunConfigGateSpec.scala:282)
[info] Tests: succeeded 9, failed 1, canceled 0, ignored 0, pending 0
```
With the prune restored: `Tests: succeeded 10, failed 0`.

### CR2 dark hover rung, red then green

`/home` cell of `state-surface-contrast-guard.spec.ts` (dark) with the `:root[data-theme="dark"]` overrides removed:
7 states failed the 1.1 threshold at ratio 1.0301 (Retry, Open, four timeline marks, an Up next row). With the overrides
(`--app-surface-strong`) and a hover background on `.home-upnext__row` (it had none, the guard's first finding): both themes pass.

### CR4 Home coverage in the guards

`/home` is a route key in `state-surface-contrast-guard.spec.ts` and `focus-presence-guard.spec.ts`, seeded (that cell
only) with a succeeded and an unresolved failed run plus a 3h interval schedule. Focus guard: 19 focusable elements
measured in each theme. State guard: 16 probed, resolved=16, unresolved=0, pass=5, fail=0 after the fix.

### Gates (cycle 2)

- `npm test`: root 51 suites / 469 tests; frontend 626 suites / 7367 tests, 0 failed. lint, format:check, typecheck and e2e types clean.
- Full Playwright e2e (2 workers): 310 passed, 0 failed.
- `sbt testOnly com.helio.services.*`: 2101 succeeded, 0 failed, 4 canceled (pre-existing).

## Cycle 3 (Phase B, after merging origin/main at 0d8bd55cf)

### Full `/home` request list (hard load of `/home`, user with viewed dashboards and one saved tab)

Measured by `e2e/hel1578-home-changed-dot.spec.ts` (first test; the list is printed and asserted), against the
isolated DB `helio_hel1578` (Flyway at V136), 7010/9917:

```
POST /api/events                       (the shell's product telemetry)
GET  /api/auth/me                      (x2, the shell's session check; both pre-existing)
GET  /api/home-summary?dashboardIds=…  (HOME'S ONE REQUEST: runs, fires, attention, up next, dashboardChanges)
GET  /api/dashboards                   (the shell's list, reused by the shelf)
GET  /api/dashboard-changes?ids=…      (HEL-1575's shell request for the saved tabs; Home does not make it)
GET  /api/dashboards/<id>/panels       (the shell's existing fetch for the auto-selected dashboard)
```
7 requests total; exactly one `/api/home-summary`; no `/api/pipelines/<id>/...` request and no per-dashboard fan-out.
The spec asserts: one `home-summary`, zero per-pipeline requests, fewer than 25 `/api` calls.

Volume against the 120/60 s per-user limit: Home adds 1 request per load (plus one per visibility return and one per
Retry). The one e2e that makes many page loads (twelve pipeline visits) is split into two batches of six a rate
window apart (each load is ~10 requests); an earlier single batch of twelve hit the limit (429), which is the limit
working, not a Home defect. Full list also in `.concertino/scratch/HEL-1578/home-request-list.txt`.

### Failures found on the first full run of the merged head, and their causes

- `hel1578-home-page.spec.ts:63` (`attention.getByText(/source returned 0 rows/)` not found): my own merge-time sed
  turned this spec's `goto("/home")` into `goto("/dashboards")`; the page snapshot showed the dashboard view
  (`heading "Dashboards: HEL-1578 Dashboard" [level=1]`). Probe-confirmed; line 101 restored to `/home`. Not a timing issue.
- `hel1572-appearance-preferences.spec.ts:177` ("first heading is serif on a new device"): deterministic, not the
  HEL-1633 flake. A probe of the post-sign-in `/home` headings showed the first `h1, h2` is the shell's visually hidden
  `h1 "Home"` in the body face, then mono eyebrows; the dashboards list heading that used to come first is gone from
  Home. The test's claim (first authenticated heading is heading-face) is kept: that device now deep-links to
  `/dashboards` (sent to `/login` and back), and a new test asserts Home's opening sentence is Fraunces on a new
  device with no cache.

### Screenshots

`openspec/changes/home-page-run-timeline/screenshots/` (also `.concertino/runs/HEL-1578/evidence/screenshots/`),
refreshed on the merged shell: `populated-{light,dark}-{1280,820,768,375}.png`, `newuser-...` (same grid),
`changed-dot-{light,dark}-1280.png` and `changed-dot-dark-375.png`. In the changed-dot shots Shot Dashboard 5 shows the
neutral `--app-text` dot and the sentence reads "One dashboard changed since your last visit." `populated-coarse-{light,dark}-820.png` (emulated coarse pointer, `(pointer: coarse)` asserted true, row control >= 44px) were re-shot too.

### Gates on the final head (bd9089521 + this note), this worktree, isolated DB `helio_hel1578` (Flyway V136)

- `sbt testFull` (under `sbtfull.lock`, foreground): `Total number of tests run: 8210`, `succeeded 8210, failed 0, canceled 4`
  (pre-existing), `EXIT 0` (`.concertino/scratch/HEL-1578/sbt-full.txt`, run on the merged Phase B backend). No file under
  `backend/`, `frontend/` or `schemas/` has changed since: `git diff --stat 00b48cda0 HEAD -- backend frontend schemas` is empty
  (later commits touch only `e2e/` and `openspec/`), so the result stands for the final head.
- `npm test` (2 workers): root 61 suites / 524 tests; frontend 680 suites / 7962 tests; 0 failed (also the pre-commit hook).
- lint, `format:check`, typecheck, e2e types, `check:schemas`, `check:scala-quality`, `check:openspec`, `check:spec-structure`,
  `check:e2e-user-cleanup`, `check:e2e-evidence-paths`, `check:tokens`, `openspec validate`: all clean (the commit hook ran them).
- Full Playwright (2 workers, `--trace retain-on-failure`, under `e2e.lock`): `380 passed, 1 skipped`, `EXIT 0`
  (`.concertino/scratch/HEL-1578/e2e-full5.txt`). It includes the new `hel1578-home-changed-dot.spec.ts` (5 tests), `hel1578-home-page.spec.ts` (3),
  the `/home` cells of both guards, and the new hel1572 Home test.
- Earlier full run (e2e-full4, cut by a reboot): `hel1572-appearance-preferences.spec.ts:580` (tabular numerals; a pipeline-detail test
  Home does not touch) failed once and the `hel1574` 769px rail test was in flight when the machine rebooted. Both pass on rerun
  (19/19 for `hel1572:580` + all of `hel1574-shell-rail`) and in the clean full run above: recorded as the known flake family
  (HEL-1633), not fixed here. Evidence copy: `.concertino/runs/HEL-1578/evidence/e2e-full4-failures/`.
