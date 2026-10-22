## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD e6f168b33f339ec15bc2126eb093d4f7d56b247d against the live base 26f6a1ede9b8b5f6c2b7144f9dc4d61698ea5a11 (`resolve-review-base.sh`, exit 0). The change is CI-only, so the UI/design step (section 4) does not apply and no servers were started.

### What I verified (with evidence)
- **Cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/e2e-ci-shard-headroom/HEL-1698`.
- **Owner ruling:** events.jsonl lines 6-7 show `escalation.raised` with the options six-legs, five-legs, ... and `escalation.answered` with `answer":"six-legs"` and `answer_source":"human"`. I did not re-litigate it.
- **Composite action** (`.github/actions/e2e-setup/action.yml`):
  - Every `run:` step has `shell: bash`.
  - `working-directory: frontend` resolves against `github.workspace`, because composite run steps default to the workspace and not to the action dir.
  - ci.yml and e2e-slow.yml have no workflow-level `defaults.run`, so nothing inherited is lost (grep shows only per-step `working-directory: backend|frontend`).
  - The job-level `env`, which e2e-backend.sh needs, is inherited by composite steps.
  - `if: inputs.start-dev-frontend == 'true'` compares strings. The default is `"true"`, and `e2e-prod-build` passes `"false"`. That reproduces the old step sets exactly: the old prod-build job had no Vite step and the old e2e and e2e-slow jobs did.
  - Each `uses: ./.github/actions/e2e-setup` comes right after `actions/checkout@v7` (ci.yml:623 and :721, e2e-slow.yml:59).
  - The diff shows the commands, order, and action versions copied verbatim.
  - The backend still starts under `setsid` in e2e-backend.sh:56, and its lifetime across step boundaries is unchanged.
- **Leg count:** the matrix is `[1..6]` with `max-parallel: 6`. The run step passes `${{ strategy.job-total }}`, so no count is hardcoded.
- **Gates re-run by me, all exit 0:**
  - `e2e-shard.selftest.mjs`: 17 cases, including "default leg count equals the ci.yml e2e matrix length".
  - `check-e2e-slow-results.selftest.mjs`: 6 cases.
  - `check-ci-sbt-no-pattern-kill.mjs`: ok, 6 files scanned. Its selftest also passes.
  - `check-ci-complete-needs.mjs`: OK.
  - `check-precommit-ci-parity.mjs`: OK.
  - `check:dependabot`: OK.
- **New selftest is failable and wired:** the RED cases assert on message content. The CLI exits 0, 1, 1 and 2 as expected. It is wired into the CI `frontend` job (ci.yml diff, `npm run check:e2e-slow-results:selftest`). The evaluator's mutation M2 is consistent with what I read.
- **Weights tooling for 6-leg runs:** `DEFAULT_E2E_LEGS=6` feeds both `plan` and `weights`. `weights --legs 4` handles pre-change runs, and the selftest covers 6-of-6 accepted, 5-of-6 refused, 4 refused by default and `--legs 4` accepted. `DEV_PORT=7130 node scripts/e2e-shard.mjs plan` (default 6) gave balanced legs of 1382-1388 s weighted, with the 717 s hel1575-dashboard-tabs alone on leg 1. The prod-build report is still named `playwright-json-prod-build`, so `-p 'playwright-json-shard-*'` still excludes it.
- **Coverage:** no spec file, test or assertion was touched. The diff has no e2e/*.spec.ts. playwright.config.ts changed in comments only, so discovery and testIgnore are unchanged. Every leg still gates `ci-complete`.

### Verdict: REFUTE

### Change Requests
1. **Dependabot will not see the new composite action, so the pins in the e2e setup will silently drift from the rest of CI.** `.github/dependabot.yml:75-83` sets the `github-actions` ecosystem to `directory: "/"`. That scans `.github/workflows/*` and a root `action.yml` only, not `.github/actions/*/action.yml`. Past bumps confirm the single-directory scope: commit 44f3a486f is titled "Bump the github-actions group across 1 directory".
   - Before this change, `actions/setup-java@v6`, `sbt/setup-sbt@v1`, `actions/cache/restore@v6` and `actions/setup-node@v7` lived in ci.yml and e2e-slow.yml, so Dependabot bumped them. Now they live in `.github/actions/e2e-setup/action.yml:23,27,30,45`, where nothing bumps them.
   - The next group bump will move the `frontend` and `backend` jobs to new majors and leave the e2e setup behind. The two copies would no longer be kept in step, which is the drift this ticket's extraction was meant to remove, and outdated action majors would be frozen out of security updates without anyone noticing.
   - This PR's CI cannot show the problem. It only appears weeks after merge.
   - **Fix:** in `.github/dependabot.yml`, replace `directory: "/"` with `directories: ["/", "/.github/actions/*"]` for the github-actions entry, or add the explicit path. Then re-run `npm run check:dependabot` and `node scripts/check-dependabot-groups.selftest.mjs`; that checker uses a hand-written subset YAML parser, so confirm it accepts the new key. Add the file to files-modified.md and mention it in a comment on the action header.

### Non-blocking notes
- `e2e/README.md:109` still says `node scripts/e2e-shard.mjs plan 4` when describing how to inspect an assignment. `plan` now defaults to 6, so `plan 4` prints a layout CI no longer runs. Change it to `plan` or `plan 6`.
- `weights --legs <n>` applies one leg count to every runDir in a call, so a single regeneration cannot mix 4-leg and 6-leg runs. That is acceptable, since medians come from 6-leg runs once enough exist, but the README could say so.
- The weighted plan (about 1385 s per leg across 2 workers) predicts legs of roughly 15-18 min wall. The 20-min AC margin against 20-30% runner variance is real but not large. The post-merge watch is the true measurement, as the brief says.
