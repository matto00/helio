## Standing Constraints

- [C1] Never read, cat, grep or print any `.env` file (CON-261).
- [C2] No spec split/move; no test assertion change; `timeout-minutes` stays 25; never hand-edit `e2e/shard-weights.tsv`.
- [C3] Do not touch `e2e/hel1632-*` or `e2e/hel1668-*`.
- [C4] Playwright under the driver's flock, <= 2 workers, `nice -n 19`; `HELIO_JEST_MAX_WORKERS=2`; load gate > 10.
- [C5] No kill/pkill/pgrep/killall; never signal a parent/grandparent.
- [C6] File content only via quoted heredocs or Write/Edit; never a runnable destructive command in an unquoted heredoc.

### Backend

- [x] 1.1 (none - CI-only change)

### Frontend

- [x] 2.1 Create `.github/actions/e2e-setup/action.yml` per design D4 (byte-identical commands, `shell: bash`)
- [x] 2.2 `ci.yml` `e2e`: use the action; matrix `[1..6]`, `max-parallel: 6`; comments per D1/D6
- [x] 2.3 `ci.yml` `e2e-prod-build`: use the action with `start-dev-frontend: "false"`; fix "four shard reports" comment
- [x] 2.4 `e2e-slow.yml`: use the action; add `.github/actions/e2e-setup/**` to `pull_request.paths`; update header
- [x] 2.5 `scripts/e2e-shard.mjs` `weights`: default 6 expected reports, `--legs <n>`; `plan` default shares it (D3)
- [x] 2.5a Add action.yml and e2e-slow.yml to `check-ci-sbt-no-pattern-kill.mjs` `SCANNED` (D4a)
- [x] 2.6 Update `playwright.config.ts` and `e2e/README.md` leg-count/regeneration text (comments only)
- [x] 2.7 Add `scripts/check-e2e-slow-results.selftest.mjs`, npm script, wire into ci.yml `frontend` (D5)

### Tests

- [x] 3.1 `e2e-shard.selftest.mjs`: 6-report default, `--legs 4` accepted, 5-of-6 refused, default == ci.yml matrix
- [x] 3.2 Mutation evidence for 3.1's matrix-drift assertion and for D5's selftest (red, then restored)
- [x] 3.2a D4a mutation via `checkText` on an in-memory copy (never executed): reported, then real file passes
- [x] 3.3 Run every CI script check touched (`check:e2e-shard:selftest`, new selftest, `check:ci-complete-needs`,
  `check:precommit-ci-parity`, actionlint if installed) and `plan 6`
- [x] 3.4 Full local e2e suite under the flock (C4); record result
- [ ] 3.4a PR runs: per-leg wall/test-step table + queue delay in the PR body (D7, predictor only)
- [x] 3.5 `files-modified.md` listing every path explicitly (CON-260)
