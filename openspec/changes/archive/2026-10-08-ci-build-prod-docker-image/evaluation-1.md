## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 804e274d664ce6d356d0996f7d0038c48bc25d68. Review base (resolve-review-base.sh, live): eda9ed491428c904ab9d486146ed65b47c003ba7.

### Phase 1: Spec Review — PASS
Issues: none.

- AC "A PR that reintroduces the HEL-1426 gap fails CI. Demonstrate the red": I checked this myself with read-only `gh`.
  - Run 37883321913 had head 5aff692f and concluded `failure`. `gh api compare adb1fece...5aff692f` shows a single change: the Dockerfile's `COPY backend/project/*.scala backend/project/` line and its comment were removed.
  - Job `docker-image` 113667697496 failed between 04:19:23Z and 04:20:19Z. Its log contains `L161: Not found: TestShards` and `process "/bin/sh -c cd backend && sbt update" did not complete successfully: exit code: 1`.
  - Job `ci-complete` 113669469121 failed with the log line `results: success, success, success, success, failure`.
  - The other 10 jobs in that run all succeeded, so the failure comes from `docker-image` alone.
- AC "`ci-complete` gates on the new job": ci.yml:681 is `needs: [frontend, backend, security, e2e, docker-image]`. The existing `join`/`contains(needs.*.result, ...)` script already covers the new job. Real CI confirms it: the red run shows five results, ending in failure, and the green run shows five successes.
- Green on the implementation tree:
  - Run 37883939609 (head 0d2c7797) concluded `success`.
  - The tree SHA of 0d2c7797 is d371a509, the same as the tree SHA of adb1fece.
  - Job `docker-image` 113669618345 succeeded, running 04:27:13Z to 04:30:28Z (195 s). Job `ci-complete` 113671691999 succeeded.
  - The slowest other job was `frontend` 113669618245, which finished at 04:35:43Z. The D3 acceptance condition is met with about 5 minutes to spare.
- Throwaway PR #873 is draft and CLOSED, and its commits are exactly [adb1fece, 5aff692f, 0d2c7797]. `git ls-remote origin task/ci-build-prod-docker-image/HEL-1427-red-proof` returns nothing, so the branch is deleted.
- Cache: `gh cache list --ref refs/pull/873/merge` returns `[]`, and the repo-wide cache list has no docker/buildx/buildkit key. The job has no cache step and no cache flags.
- Every task in tasks.md is ticked and matches the implementation. There is no scope creep: the only code file changed is `.github/workflows/ci.yml`.
- Driver constraint on caches: the diff against eda9ed49 removes exactly one line, the old `needs: [frontend, backend, security, e2e]`. No existing cache key, path, or restore/save line changed.
- Standing constraints:
  - C1 is honored. I did no local docker build, and the evidence comes from real CI.
  - C2 is honored. `needs` is still a single-line list, and `node scripts/check-precommit-ci-parity.mjs` reports OK.
- Timeout commit 804e274d came after the green run. It changes only `timeout-minutes: 20 -> 8` and a comment on the `docker-image` job, plus ci-evidence.md and tasks.md. This does not weaken the evidence:
  - The red is unaffected.
  - The green's build behaviour is unchanged. The only new way to fail is a build slower than 8 min, against 195 s measured cold and cache-less.
  - The ticket requires "green proven on the final head", and the real PR's own CI run at Delivery (design D7) provides that. The branch is not pushed yet and no PR exists, so that run is still owed. Delivery must confirm `docker-image` and `ci-complete` succeed on 804e274d (or its squash).

### Phase 2: Code Review — PASS
Issues: none blocking.

- Gates: no files under `frontend/**` or `backend/**` changed, so the frontend and backend gate suites do not apply. I ran the relevant checks myself:
  - `npx prettier --check .github/workflows/ci.yml`: pass.
  - `python yaml.safe_load`: parses, and the job list and `needs` are as expected.
  - `check-precommit-ci-parity.mjs`: OK.
  - `npm run check:openspec`: clean.
  - `npm run check:spec-structure`: passed, 0 issues.
- The build line is `docker build -t helio-backend:ci-${{ github.sha }} .`. It mirrors cd-backend.yml:46 `docker build -t "$IMAGE" .`: same context, default (final runtime) stage, no login, no push, no secrets, and no new permissions.
- The comment block at ci.yml:656-660 and the timeout comment at :663 are accurate and cite the run id, following the HEL-1287 D11 convention.
- The always-on design removes the skipped-vs-failed risk: the job can never be `skipped`.
- No dead code and no over-engineering. The report-only `docker history` step is small and is justified by D4.

### Phase 3: UI Review — N/A
This change only touches CI. None of the triggers (`frontend/**`, ApiRoutes.scala, `schemas/**`, `openspec/specs/**`) matched; the spec delta is under `openspec/changes/`, not `openspec/specs/`. I started no dev servers.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- D4 evidence: the `docker history` output covers only the runtime image (840MB total, 316MB jar + 316MB chown copy, 164MB JDK). It does not measure the builder-stage `sbt update` layer, which is what a `type=gha` cache would actually persist. So the design's "plausibly 1 GB+ per key" figure is still an estimate, not a measurement.
  - This does not undermine the decision. The decisive argument is measured and stands on its own: 195 s for this job against 510 s for the slowest job means a cache would save no wall time.
  - The runtime layers already total about 0.8 GB, and the builder adds JDK+sbt+Coursier on top. Even an `mode=min` cache of the final image would be a sizeable share of the 10 GB budget.
  - ci-evidence.md already says builder layers are not in the history. The PR body should present the cache-size figure as an estimate, not as measured.
- The `chown -R` RUN in the Dockerfile duplicates the 316MB jar layer, making the image about 316MB larger than it needs to be. This is outside this ticket's scope (no Dockerfile changes). A `COPY --chown=helio:helio` would fix it, and could be a follow-up ticket.
- Delivery: the real PR's CI run on the final head is the outstanding "green on final head" evidence. Record its run id in the PR body.
