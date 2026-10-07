## Standing Constraints

- [C1] Weights come from CI Playwright JSON reports only: per file, sum durations across all shard reports of one run, then take the median across runs; never hand-tune or hand-add a row.
- [C2] CI timings come from this PR's own runs, one at a time, via the GitHub API; keep full logs for any failing run.

## 1. Tooling

- [x] 1.1 Write `scripts/e2e-shard.mjs` (`run`, `weights` modes per design D1-D5); verify `node scripts/e2e-shard.mjs run 4 4` prints its assignment and fails with a named file when a partition is broken
- [x] 1.2 Generate `e2e/shard-weights.tsv` with `weights <runDir>...` from the 5 baseline runs named in design.md Context (ids in header); verify every discovered spec has a row or is printed by `run` as defaulted
- [x] 1.3 Replace the `e2e` job's run step in `.github/workflows/ci.yml` (D6), updating its HEL-951 comment and the `ci.yml:81-85` state-contrast comment; verify YAML parses
- [x] 1.4 Rewrite e2e/README.md's "CI runtime: sharding and parallel-mode files" section (file-level LPT from shard-weights.tsv, parallel mode spreads only across a leg's workers, unknown = median of rows for currently discovered files) and document regeneration; verify the command in the doc runs

### Tests

- [x] 2.1 Write `scripts/e2e-shard.selftest.mjs` (D7) with a demonstrated-red mutation; verify it passes and the mutation fails
- [x] 2.2 Wire `check:e2e-shard:selftest` into package.json, `.husky/pre-commit`, and CI per `check-precommit-ci-parity`; verify `npm run check:precommit-ci-parity` passes
- [x] 2.3 Locally (`nice -n 19`, <= 2 workers, own DEV_PORT) dry-check all 4 assignments cover every discovered spec exactly once via `--list`
- [ ] 2.4 Push the branch, open a DRAFT PR (title `HEL-1361 ...`), measure >= 5 sequential CI runs of one head (wait for each, then `gh run rerun`) via the GitHub API; write `profile.md` with before (25-run and 5-run) / after per-leg medians and maxima (leg + test step) and run ids
