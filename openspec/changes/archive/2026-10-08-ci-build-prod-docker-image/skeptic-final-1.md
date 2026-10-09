## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 804e274d664ce6d356d0996f7d0038c48bc25d68. Base resolved live via `resolve-review-base.sh` (exit 0): eda9ed491428c904ab9d486146ed65b47c003ba7.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/ci-build-prod-docker-image/HEL-1427`.
- **Diff scope:** `git diff eda9ed49...HEAD --stat` = `.github/workflows/ci.yml` (+19/-1) plus openspec change-dir docs only. No Dockerfile, .dockerignore, cd-backend.yml, or existing job change. The only removed line in ci.yml is the old `needs: [frontend, backend, security, e2e]`; no cache key/path/restore/save line touched (HEL-1299 constraint held).
- **Job shape (D2):** `docker-image` runs `docker build -t helio-backend:ci-${{ github.sha }} .` (same as cd-backend.yml:46 `docker build -t "$IMAGE" .`, default final stage). No login, push, secrets, cache flags or permissions block; workflow-level `contents: read` applies. `actions/checkout@v7` matches every other job.
- **C2:** `needs: [frontend, backend, security, e2e, docker-image]` is a single line. `node scripts/check-precommit-ci-parity.mjs` -> `OK`, rc=0. YAML parse (python yaml) lists jobs `frontend, backend, security, e2e, docker-image, ci-complete` and the `ci-complete.needs` contains docker-image. `prettier --check` on ci.yml and the change docs: clean. `check:openspec` rc=0, `check:spec-structure` passed.
- **AC1 (RED on real CI), checked with read-only gh calls rather than taken from ci-evidence.md:**
  - `git diff adb1fece 5aff692f` = removes exactly `COPY backend/project/*.scala backend/project/` (and its comment) from Dockerfile.
  - `gh run view 37883321913`: conclusion `failure`, headSha 5aff692f, event pull_request. Job `docker-image` 113667697496 = failure; all 10 other jobs (security, frontend, backend 0-3, e2e 1-4) = success; `ci-complete` 113669469121 = failure.
  - Job log: `build.sbt ... L161: Not found: TestShards` (this is the HEL-1426 failure). `ci-complete` log: `results: success, success, success, success, failure`.
- **AC2 (ci-complete gates on the new job):** the RED run above shows that a docker-image failure alone turns ci-complete red. The unchanged script fails on `failure`/`cancelled`. The job has no `if:`/path filter, so it can never be `skipped` and the skip-vs-fail hazard cannot arise.
- **GREEN:** `git diff adb1fece 0d2c7797` is empty (the revert restores the tree exactly). `gh run view 37883939609`: `success`, headSha 0d2c7797. docker-image 113669618345 = success, 04:27:13-04:30:28 (195 s). Slowest other job: frontend, done at 04:35:43, so the D3 acceptance condition holds. ci-complete log: `results: success x5`. The log shows `[builder 10/10] RUN cd backend && sbt assembly`, `[runtime 4/5] COPY --from=builder ...helio-backend.jar` and `naming to docker.io/library/helio-backend:ci-...`, so the full build path ran. The `docker history` step printed the 316MB jar layers.
- **Cache budget:** `gh cache list --ref refs/pull/873/merge` -> `[]`. The job has no cache step.
- **Throwaway cleanup:** `gh pr view 873` -> state CLOSED, isDraft true, title "[throwaway RED proof - do not merge]". `git ls-remote origin task/ci-build-prod-docker-image/HEL-1427-red-proof` -> empty.
- **Final head vs. green tree:** `git diff 0d2c7797 804e274d` touches only ci.yml (the comment changes, and `timeout-minutes: 20` becomes `8`), ci-evidence.md and tasks.md. The build command, the needs list, Dockerfile and backend are byte-identical to the tree that went green. The only behaviour difference is a tighter timeout: 8 min against the measured 195 s, about 2.46x. That matches the D5 and HEL-1287 D11 convention, and a timeout can only turn a run that would otherwise pass into `cancelled`, which then fails ci-complete loudly. It cannot silently pass a break. Main has not moved since the green run (live base = eda9ed49, which is the green run's base), so the only remaining divergence source is runner or network variance. The real PR's CI at Delivery is the binding green on 804e274d.

### Verdict: CONFIRM

### Non-blocking notes
- The 8-minute timeout rests on one cold sample (195 s). If Docker Hub, apt or the sbt/Coursier download is slow, the job could be cancelled. That fails loudly and can be re-run. If it happens more than once, raise the timeout with a new measurement instead of re-running.
- The ticket asked for layer caching and the change deliberately skips it (D4). The evidence supports that choice: the job takes 195 s while the critical path takes 510 s, and the cache list is empty. The PR body needs to state this deviation, as ci-evidence.md already plans.
- `evaluation-1.md` is untracked in the worktree. The orchestrator needs to commit it with the delivery artifacts.
- The GitHub API reports no classic protection on `main`, and the rulesets list shows only "main - no delete", release and tag rules. Whether `ci-complete` is actually a *required* status check is outside this ticket's AC ("ci-complete gates on the new job" is met), but the ticket assumes it is. The driver may want to confirm that separately.
