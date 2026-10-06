# Files modified — HEL-1288

Draft PR: #774, branch `task/halve-e2e-ci-time/HEL-1288`. Counts (`npx playwright test --list`): 177 tests / 37 files before the screenshot-spec deletion, 173 tests / 35 files after.

- `.github/workflows/ci.yml` — `e2e` job only: 4-leg shard matrix (`max-parallel: 4`, `timeout-minutes: 18`), backend started via `scripts/e2e-backend.sh`, per-shard artifacts, JSON report upload.
- `playwright.config.ts` — `workers: CI ? 2`, CI-only JSON reporter.
- `scripts/e2e-backend.sh` — new: setsid process-group start and fail-fast health wait for the e2e backend.
- `scripts/e2e-profile.mjs` — new: ranks specs/steps from CI artefacts.
- `e2e/state-surface-contrast-guard.spec.ts` — split into 18 parallel-mode cells; API seeding and API login; readiness gates; heaviest-first.
- `e2e/focus-presence-guard.spec.ts` — split into 10 parallel-mode cells; API dashboard seeding; cookie hand-off; readiness gate.
- `e2e/support/settleTransitions.ts` — new: awaits running CSS transitions instead of fixed sleeps.
- `e2e/hel1028-layout-undo-redo-visual-revert.spec.ts`, `e2e/hel1023-breakpoint-layout-derivation.spec.ts` — parallel mode; `afterAll` log became per-registration; hel1028 waits for `.panel-grid`.
- `e2e/hel813-mobile-touch-target-floor.spec.ts`, `e2e/hel773-top-anchored-mobile-nav-sheet.spec.ts`, `e2e/hel516-palette-quick-create.spec.ts`, `e2e/hel519-recent-navigation.spec.ts` — parallel mode (per-test user/data, no `beforeAll`/`afterAll`).
- `e2e/hel588-cross-filter-panels.spec.ts` — parallel mode; one comment no longer names the deleted spec.
- `e2e/hel516-screenshots.spec.ts`, `e2e/hel519-screenshots.spec.ts` — DELETED (4 tests); ledger rows confirmed by the final skeptic (skeptic-final-1.md); surviving coverage in profile.md.
- `e2e/README.md` — documents sharding, pinned workers and the parallel-mode rule.
- `openspec/changes/halve-e2e-ci-job-time/` — `.openspec.yaml`, `design.md`, `proposal.md`, `ticket.md`, `tasks.md`, `profile.md`, `files-modified.md`, `evaluation-1.md` .. `evaluation-7.md`, `skeptic-design-1.md` .. `skeptic-design-4.md`, `skeptic-final-1.md`.

Not modified (by rule): `e2e/hel1260-orphan-owner-repair.spec.ts`, the `backend`/`security`/`frontend` jobs, `ci-complete`.
