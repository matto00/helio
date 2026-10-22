## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD e6f168b33f339ec15bc2126eb093d4f7d56b247d against live-resolved base 26f6a1ede9b8b5f6c2b7144f9dc4d61698ea5a11
(`resolve-review-base.sh`, origin/main). Gates were run directly in WORKTREE_PATH (CLEAN_WORKTREE not set).

### Phase 1: Spec Review — PASS
Issues: none.

- AC (5 consecutive green main runs, slowest leg <= 20 min) can only be measured after merge. The proposal, design D7
  and the spec delta say so explicitly and hand it to the driver's post-merge watch. It is not silently reinterpreted.
  The leg count (6) is the owner's ruling, recorded in design D1.
- Tasks: all ticked except 3.4a (PR-run table), which belongs to Delivery. Each ticked task matches the diff.
- Ticket extras: the slow-results selftest is wired into ci.yml `frontend`; the composite action is extracted; the
  stale "~7 min" comment is replaced.
- Scope: CI files, scripts, comments and change artifacts only. No product code.
- CONSTRAINTS C1–C6 honored. `git diff --name-status base...HEAD -- e2e/` shows only `M e2e/README.md`, so no spec file
  was moved, changed or deleted, and nothing under `e2e/hel1632-*` or `e2e/hel1668-*` was touched.
  `e2e/shard-weights.tsv` is unchanged. Parsed YAML still has `timeout-minutes: 25` on `e2e` (8 on `e2e-prod-build`
  and 30 on e2e-slow, both unchanged).

### Phase 2: Code Review — PASS
Issues: none blocking.

Fresh gate runs (my own, in WORKTREE_PATH), all exit 0:
- `check:e2e-shard:selftest`: 17 cases
- `check:e2e-slow-results:selftest`: 6 cases
- `check:ci-sbt-guard`: 6 files scanned
- `check:ci-sbt-guard:selftest`
- `check:ci-complete-needs`
- `check:precommit-ci-parity`
- `check:e2e-prod-build-projects` and its selftest
- `check:openspec`
- `npm run lint`
- `npm run format:check`
- `node scripts/e2e-shard.mjs plan` (default 6): 1382–1388 weighted s per leg

actionlint is not installed. No `frontend/**` or `backend/**` file changed, so jest, the frontend build and sbt were
not required.

Composite action is byte-identical (checked mechanically, not by eye). I parsed base ci.yml `e2e`, base ci.yml
`e2e-prod-build` and base e2e-slow.yml with js-yaml, then compared every replaced step object with
`.github/actions/e2e-setup/action.yml` `runs.steps`. The comparison ignores only the added `shell: bash` and the Vite
step's `if`. Result: all 10 steps are IDENTICAL for `e2e` and e2e-slow, and the first 9 are IDENTICAL for
`e2e-prod-build`, which correctly passes `start-dev-frontend: "false"`. Keys, values and the multi-line `run:` bodies
are all included. In the new files, each job is `checkout`, then `./.github/actions/e2e-setup`, then the same next
step as before. Every `run` step in the action has `shell: bash`. `services`/`env` stay at job level, and composite
steps inherit job env. The run step still uses `strategy.job-total` (ci.yml:630). e2e-slow `pull_request.paths` adds
the action.

Selftest mutation testing. I ran each mutation on a scratch copy, never on worktree files. Both selftests pass on
the scratch baseline.
- `check-e2e-slow-results.selftest.mjs`: all 9 mutations go red (exit 1).
  - Skipped check disabled.
  - Zero-ran check disabled.
  - Unexpected check disabled.
  - No-stats returns `[]`.
  - `collectSkipped` drops names.
  - Missing-arg exit 2 changed to 0.
  - Unreadable-file exit 1 changed to 0.
  - `evaluate` always red.
  - CLI ignores problems.
- `e2e-shard.selftest.mjs`: 7 of 8 mutations go red (exit 1).
  - ci.yml matrix 6 changed to 5.
  - ci.yml `max-parallel` 6 changed to 4.
  - `DEFAULT_E2E_LEGS` 6 changed to 5.
  - `EXPECTED_SHARD_REPORTS` changed to 4.
  - `--legs` value ignored.
  - `--legs` validation removed.
  - Run dirs dropped by `parseWeightsArgs`.
  - Survivor: `findReports` no longer passes `expected` to `validateRunReports`. See the first non-blocking
    suggestion. Every assertion in the selftest can fail. The survivor is untested wiring, not a vacuous assertion,
    and it would fail loudly ("expected exactly 6, found 4"), not silently.
- D4a guard: `checkText` on an in-memory copy of action.yml with a pattern-kill line appended reports
  `.github/actions/e2e-setup/action.yml:74`. The same holds for e2e-slow.yml (`:88`). Both real files return `[]`.
  Nothing was executed.

Standards: no type escape hatches, no dead code, no TODOs. Comments follow the repo's ticket-ref convention.
`parseWeightsArgs` is small and exported for test. No over-engineering.

### Phase 3: UI Review — N/A
No trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The spec delta is under
`openspec/changes/`, not `openspec/specs/`. `playwright.config.ts` changed in a comment only. No servers were started.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `scripts/e2e-shard.selftest.mjs`: add one CLI case. Make a temp run dir with 4 `<n>/results.json` reports, run
  `node e2e-shard.mjs weights --legs 4 <dir>`, and assert exit 0. Then run it without `--legs` and assert it fails
  with "expected exactly 6". The current "--legs 4 accepts a pre-HEL-1698 four-report run" case calls
  `validateRunReports` directly, so the `weightsMode` -> `findReports(d, legs)` wiring has no test (mutation E7
  survived).
- `playwright.config.ts:169-170`: the edited comment has an unbalanced parenthesis, "(the e2e matrix runs 6 legs
  (HEL-1698 owner ruling; ... C8).", and line 170 is now much longer than its neighbours. Close the outer paren or
  reword it, and re-wrap.
