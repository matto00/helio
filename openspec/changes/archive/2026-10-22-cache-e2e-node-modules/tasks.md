## Standing Constraints

- [C2] No selftest or local check writes into the real worktree git admin dir (`concertino-servers/`); selftests run copies inside a throwaway `git init` repo.
- [C1] AC1 hit-side evidence exists only after merge (main-only save): the PR body must state AC1 is unproven at merge, include the pre-merge miss-path evidence, and the orchestrator collects >=5 post-merge hit runs before hand-back.

## 1. Baseline evidence

- [x] 1.1 Record `npm ci` / `npm --prefix frontend ci` step durations for the e2e jobs of >= 5 recent runs (incl. 39711300255) into `/home/matt/Development/helio/.concertino/scratch/HEL-1699/`
- [x] 1.2 Measure `du -sh node_modules frontend/node_modules` in the worktree

## 2. node_modules cache (item 1)

- [x] 2.1 `.github/actions/e2e-setup/action.yml`: id on setup-node; restore step (D1); `if:` skip on both `npm ci` steps (D2); `save-node-modules-cache` input + guarded save step right after install (D3); header comment updated
- [x] 2.2 `.github/workflows/ci.yml` `e2e` job: pass `save-node-modules-cache: ${{ matrix.shard == 1 }}`
- [x] 2.3 `scripts/cache-janitor.mjs` family + `scripts/cache-janitor.selftest.mjs` case (D4)
- [x] 2.4 Run locally: `check-ci-sbt-no-pattern-kill` (+ selftest), `npm run selftest:ci-sbt`, `check-ci-complete-needs`, cache-janitor selftest, YAML parse/actionlint if available, and every other `check:*` script that reads workflows or actions

## 3. Lane backend start (item 2)

- [x] 3.1 `scripts/e2e-backend.sh lane-start` (D5): explicit subcommand; `start`/`wait` untouched; admin dir from the script's own repo root; refuse unset ports / answering port / live `backend.pid`; replace a dead record; lane-local log/pgid; then the existing wait logic
- [x] 3.2 Selftest (wired into an npm script), run against copies of `scripts/e2e-backend.sh` + `scripts/lib/ci-sbt-diag.sh` in a throwaway `git init` repo (C2): `start` writes no `backend.pid`; `lane-start` refuses a live record (file unchanged) and replaces a dead one; `lane-start` without DEV_PORT/BACKEND_PORT fails. `git diff` shows the `start`/`wait` branches unchanged; evidence that the real worktree's `backend.pid` is byte-identical (or absent) before/after a selftest run with lane servers up
- [x] 3.3 `e2e/README.md` + `scripts/e2e-prod-build.mjs` header: the D6 sequence

## 4. End-to-end lane evidence

- [x] 4.1 Starting from servers launched by `scripts/concertino/start-servers.sh` (lane ports 7131/10038), follow the README sequence verbatim (Playwright under the e2e lock); save full output; after the final `stop-servers.sh` show the recorded PGID has no processes (`ps -o pid= -g <pgid>` empty) and both ports free; then `start-servers.sh` + `scripts/concertino/assert-phase.sh servers ...` PASS. If a lingering thin-client sbt server interferes, resolve with documented commands only or escalate (D5)
- [x] 4.2 Full dev-project e2e suite under the e2e lock (pre-Delivery requirement)
- [x] 4.3 Pre-merge miss-path evidence plan for the PR body (C1): what to check on the PR's CI run (in the PR body)
- [x] 4.4 `files-modified.md` listing every path explicitly

## 5. Post-merge (orchestrator)

- [ ] 5.1 After merge: the merge's main run (miss + one save, entry size via `gh cache list`), then >= 5 runs restoring it (restore-step duration, both `npm ci` steps skipped) — reported in the hand-back (C1) (post-merge; open at archive time by design, C1)
