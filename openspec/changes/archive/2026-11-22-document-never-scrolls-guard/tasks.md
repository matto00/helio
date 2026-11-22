## Standing Constraints

## 1. Reproduce (red first)

- [x] 1.1 Write `e2e/hel1585-document-never-scrolls.spec.ts` per design D2-D4b and D7 (one user + seed per viewport test, route list + AppRoutes check, client-side navigation, preconditions, seed via `page.request`, request counter asserting `count429 === 0` and `maxWindow <= 90` (seedRequests recorded only), `test.setTimeout(150_000)`, wheel check), with per-route measurements (incl. tab-bar presence) written via `evidencePath("HEL-1585", ...)`.
- [x] 1.2 Run it in full against unmodified `main` code on the lane dev server (DATABASE_URL=helio_hel1585, ANTHROPIC_API_KEY empty, 2 workers). Record per-route scrollHeight/innerHeight/scrollY at both viewports. Commit the run output as `openspec/changes/document-never-scrolls-guard/evidence/red-run-main.txt` (or the passing run, if nothing reproduces) BEFORE any implementation code.

## 2. Prove the guard is failable

- [x] 2.1 Mutation (a): `.app-shell` `height` -> `min-height` in `frontend/src/app/App.css`; run the spec; confirm red with the long `/pipelines/:id` route named as an offender; revert. Commit output as `evidence/mutation-shell-height.txt`.
- [x] 2.2 Mutation (b): drop one path from the spec's route list; run; confirm the AppRoutes check fails naming it; revert. Commit output as `evidence/mutation-route-list.txt`.

## 3. Fix (only if 1.2 found offenders)

- [x] 3.1 N/A: no offenders on main (evidence/offenders.md), so no shell fix and no green-run.txt
- [x] 3.2 Page-local cause: no fix; list each route, its numbers and the overflowing element in `evidence/offenders.md` for follow-up triage.

## 3b. Plan amendment (execution finding)

- [x] 3b.1 Seed at least 32 dashboards per user (PAT bucket) and assert the Dashboards context list shows at least 30 items on `/dashboards` and `/dashboards/:id` before measuring; re-run full spec green twice and the shell-height mutation red; update ci-cost.txt.

## 4. Verify

- [x] 4.1 Run the spec in full twice green; record its wall time per test, `seedRequests`, `maxWindow` and `count429` (D4a, D7) in `evidence/ci-cost.txt`.
- [x] 4.2 Run the existing `e2e/hel1579-pipeline-spine-layout.spec.ts` and `e2e/hel1574-shell-rail.spec.ts` in full (they cover the same shell) and confirm green.
- [x] 4.3 `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run check:e2e-types`, `npm run check:e2e-evidence-paths`, `npm run check:e2e-user-cleanup`; frontend jest if any `frontend/src` file changed.
