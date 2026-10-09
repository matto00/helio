## Standing Constraints

- [C1] No local `docker build`: `nice` cannot cap dockerd/BuildKit, so it would take every core on the shared desktop. Measure on real CI only (the job prints `docker history` of the built image after the build). Never `docker builder prune`/`system prune`.
- [C2] Keep `ci-complete`'s `needs:` a single-line `[...]` list (check-precommit-ci-parity.mjs parses it with a single-line regex).

## 2. Add the CI job

- [x] 2.1 Add a `docker-image` job to `.github/workflows/ci.yml`: `runs-on: ubuntu-latest`, checkout, then
  `docker build -t helio-backend:ci-${{ github.sha }} .` (no login, no push, no cache flags, no new permissions, provisional `timeout-minutes: 20` until 3.3),
  with a short comment citing HEL-1427/HEL-1426 and design D2-D4, followed by a report-only step printing `docker history helio-backend:ci-${{ github.sha }}` and `docker image ls` (D4 size evidence; changes nothing). Verify: `npx prettier --check
  .github/workflows/ci.yml` and an `actionlint`-equivalent YAML parse (`node -e` with a YAML parser already in
  node_modules, or `python -c 'import yaml'`) succeed.
- [x] 2.2 Add `docker-image` to `ci-complete.needs`. Verify: `grep -n "needs: \[" .github/workflows/ci.yml` shows it.
- [x] 2.3 Confirm no existing cache key/path/restore/save line changed: `git diff "$(scripts/concertino/resolve-review-base.sh "$WORKTREE_PATH" main origin)" -- .github/workflows/ci.yml`
  contains only additions for the new job, the needs list and comments.

## 3. Prove on real CI

- [ ] 3.1 Push the implementation to the throwaway branch per design D7 with the COPY-line mutation and open the DRAFT
  PR. Wait for the run to complete. Verify: `docker-image` = failure with `Not found: TestShards` in its log,
  `ci-complete` = failure. Also record `ci-complete`'s `results:` log line and confirm every other job succeeded (failure attributable to `docker-image` only). Record run id + job ids in `ci-evidence.md` in this change dir.
- [ ] 3.2 Push a revert of the mutation to the same throwaway PR; wait for completion. Verify: `docker-image` and
  `ci-complete` = success; record run id, the `docker-image` job's duration AND finish time vs the last-finishing other job (D3
  acceptance condition), and the `docker history` sizes from the job log (D4 evidence); `gh cache list --ref refs/pull/<N>/merge` shows no entry created by `docker-image` (distinguish by key prefix from setup-node's npm entries) and the job has no cache step/flag.
- [ ] 3.3 Set `timeout-minutes` on `docker-image` to ~2.5x the measured duration with a run-id-citing comment (D5);
  close the throwaway PR and delete exactly its remote branch. Also note in `ci-evidence.md` the caching-bullet deviation with the measured numbers (for the PR body). Verify: `gh pr view <N> --json state` = CLOSED;
  `git ls-remote origin task/ci-build-prod-docker-image/HEL-1427-red-proof` empty.
