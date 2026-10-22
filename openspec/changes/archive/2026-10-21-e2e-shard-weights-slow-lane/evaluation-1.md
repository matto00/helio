## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 2e75962b5bda7157cd80b21e5089980d365aacca (base fb684d03b0010e030f80db62f45a2003957344a6, resolved live).
Commits: a1fbe992d, 2e75962b5.

### Phase 1: Spec Review — PASS
Issues: none.

- Ticket item 1 (weights regenerated with the documented command, no hand edit) is done. Independently verified:
  `node scripts/e2e-shard.mjs weights` over the five run dirs named in the TSV `# Runs:` header
  (39689629368 39619844110 39542663790 39507357019 39477341305) produces output byte-identical to the committed
  `e2e/shard-weights.tsv` (`cmp` clean; sha256 2fc0f5a7...3ad8 for both). C2 is honoured.
- Run selection (D1) checked independently. I re-ran the script's validator on every downloaded run dir and listed
  the main push runs with `gh run list`. The five chosen runs are exactly the five most recent runs the validator
  accepts. They include fb684d03b (39689629368, the hel1683 run) and 4f729eed7 (39619844110, the hel1681 run).
  Every rejected run (39615405498, 39583908105, 39560107292, 39540076554) has `unexpected=1`, so the script, not a
  hand filter, decided. 39507357019 failed overall but its e2e reports are clean, so the validator accepts it. That
  is the D1 rule ("the script is the arbiter").
- `plan 4` re-run now: 2078/2078/2077/2077 s, and no file is `defaulted`. It matches the executor's
  `plan-after.txt` (diff clean). Before the change, 10 files were defaulted. The total predicted load rose from
  1717 s to 2078 s per leg because measured weights replaced median defaults. That is consistent with the
  15-25 min legs the proposal describes.
- Ticket item 2 / C1: `e2e-slow.yml` parsed with js-yaml gives
  `on = {schedule:[cron "17 10 * * 1"], workflow_dispatch, pull_request.paths:[".github/workflows/e2e-slow.yml"]}`,
  `permissions = {contents: read}`, `concurrency = {group: e2e-slow-${{ github.ref }}, cancel-in-progress: false}`,
  `timeout-minutes: 30`. This matches D3 exactly. It is weekly, not nightly, and does not run on every PR.
- AC1 (leg spread on main) and AC2 (one green slow-lane run on main) can only be judged after merge. Tasks 4.1 and
  4.2 are correctly left unchecked and assigned to the orchestrator.
- Scope: no application code, schema, `scripts/e2e-shard.mjs` or `playwright.config.ts` change.
- CONSTRAINTS C1-C4 are honoured in the diff. C3 and C4 are process rules; the diff does nothing that would break
  them.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself in WORKTREE_PATH (load 1.28):
- `npm run check:e2e-shard:selftest`: rc 0, 15 cases passed.
- `npm run check:ci-complete-needs`: rc 0. `e2e-slow` is a separate workflow, so `ci-complete` needs no new entry.
- `npm run check:ci-sbt-guard`: rc 0.
- `npm run lint`: rc 0. `eslint --max-warnings 0` on `scripts/check-e2e-slow-results.mjs` and
  `e2e/support/hel1582Phone.ts`: rc 0.
- `npm run format:check`: rc 0. `prettier --check` on the new workflow, guard script, README and support file:
  clean.
- Grep of `e2e-slow.yml` for `pgrep|pkill|killall|kill `: zero hits.
- I did not run the frontend jest/build or `sbt testFull` gates: no `frontend/**` or `backend/**` file changed.

Guard failability (`scripts/check-e2e-slow-results.mjs`), with hand-built reports:
- skipped=1: rc 1. Output: "1 test(s) skipped: ... MAXIMAL sweep" (red, names the test).
- expected=0: rc 1, "no test ran".
- unexpected=1: rc 1.
- missing file: rc 1.
- clean report (expected=4, skipped=0): rc 0.
The guard step uses `if: always()`, so it also runs after a failed Playwright step. `playwright.config.ts:151-153`
writes `test-results/results.json` when `CI` is set, so the path the guard reads exists on Actions.

Comment/string-only claim: of the `+`/`-` lines in `e2e/support`, `e2e/*.spec.ts` and `ci.yml`, only one is not a
comment line: the `test.skip` reason string in `e2e/support/hel1582Phone.ts:401`. The skip condition
(`size.width !== 375 && process.env.HELIO_E2E_SLOW !== "1"`) is unchanged.

Setup parity: the setup in `e2e-slow.yml` matches `ci.yml`'s `e2e` job step for step: postgres service, the env
block (including the CI-only CONNECTOR_MASTER_KEY), cache restore only, `e2e-backend.sh start/wait`, `npm ci` twice,
Playwright install, and the Vite loop. Both files carry a comment pointing at the other.

Executor evidence (read only, not trusted as a gate): `sweep-e2e.log` shows both MAXIMAL tests at 390 and 768
passed (4 passed, 4.2 m), and `full-e2e.log` shows 662 passed and 3 skipped. As instructed, I did not re-run the
full suite.

### Phase 3: UI Review — N/A
No file matches the triggers (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). This is a
CI-config change.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `files-modified.md` lists all 10 paths the executor wrote, each by explicit path. It does not list the 8
  planning-artifact paths that `a1fbe992d` also commits: `.openspec.yaml`, `proposal.md`, `design.md`, `ticket.md`,
  `specs/e2e-slow-lane/spec.md`, and `skeptic-design-{1,2,3}.md`. If CON-260 is meant to cover every path in the
  diff, add them.
- `scripts/check-e2e-slow-results.mjs:12` builds the test label from `suite.file ?? ""` of the nearest suite. That
  is fine for real Playwright JSON, where describe suites carry `file`. On a hand-built report it prints a leading
  ": " (cosmetic only).
- The guard does not report `stats.flaky`. A retried-then-passed MAXIMAL sweep counts as green. That is defensible
  for a weekly lane, but surfacing the count would make a quietly degrading sweep visible.
- The pre-existing `ci.yml` comment "Slowest leg measures ~7 min" above `timeout-minutes: 25` is stale (legs are
  now 15-25 min). It is outside this ticket's comment-only scope, so it is a follow-up candidate.
