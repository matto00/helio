## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 7c41d989e0f6af811ff3cb79d4e70ed741d40c08. Base resolved live with `resolve-review-base.sh`: bc2831cf2 (exit 0).
I checked everything below myself. I did not take the evaluator's word for any of it.

### What I verified (with evidence)

**AC1, Dockerfile layer.** The diff shows the runtime stage now uses `COPY --chown=helio:helio --from=builder ... helio-backend.jar` and `RUN mkdir -p data && chown helio:helio /app /app/data`, which is non-recursive. `ARG BASE_REGISTRY=docker.io/library` and both `FROM ${BASE_REGISTRY}/...` lines are unchanged.
I rebuilt the image myself with `nice -n 19 docker build --build-arg BASE_REGISTRY=mirror.gcr.io/library -t helio-backend:hel1428-skeptic` (exit 0). The non-zero layers in `docker history` are:
`12.3kB mkdir -p data && chown helio:heli…` and `316MB COPY --chown=helio:helio f…`, followed by base layers only. There is one jar layer, and the second 316 MB layer is gone. pr-notes.md records before/after sizes (1.5GB / 894MB, with `docker history` lines). Afterwards I removed the image by exact tag. `docker image ls` shows no `hel1428` leftovers from the executor's measurement either.

**AC2, runtime equivalence.**
- I ran a shell inside my rebuilt image: `id` is uid=100(helio). The `stat` listing is `/app helio:helio 755`, `/app/data helio:helio 755`, `/app/helio-backend.jar helio:helio 644 316149100`. That matches pr-notes.md byte for byte, including the jar size.
- `/app/data` and `/app` are both writable by helio, as they were under the old recursive chown.
- `docker inspect` gives User=helio, WorkingDir=/app and ExposedPorts 8080.
- ENTRYPOINT and HEALTHCHECK are untouched in the diff.
- I did not boot the container against postgres. pr-notes records that the executor did, for both images: `/health` returned 200 with throwaway postgres and dummy Google env. My file and metadata evidence agrees with that claim on every point I could check.

**AC3.** pr-notes.md contains the post-release line "CD deploys and `/health` is 200 on the next tagged revision", and says no release is cut.

**AC4, guard.**
- `.husky/pre-commit` runs under `set -e` and has `npm run check:ci-complete-needs`. The ci.yml `frontend` job, which is in `ci-complete.needs` and runs root `npm ci`, runs both the check and its selftest.
- js-yaml is pinned exactly `4.3.2` in root devDependencies. The lockfile diff is one line, the root package's devDependencies entry. `node_modules/js-yaml` was already locked at 4.3.2 with `dev: true`, and there are no nested copies.
- Fresh gate runs, all exit 0: `check:ci-complete-needs` (6 jobs / 5 needs), `check:ci-complete-needs:selftest` (all passed, including the three named REGRESSION cases and the real-ci.yml red), `check:precommit-ci-parity` (26/26 covered) and its selftest (5/5), `prettier --check`, `eslint --max-warnings 0` on both scripts, and `check:openspec`.
- My own attacks, run through the CLI against scratch copies of the real ci.yml, each exited 1 and named the right problem:
  - `e2e` dropped from needs: exit 1, names e2e.
  - A new job appended after ci-complete: exit 1, names newjob.
  - A second YAML document appended: exit 1, "expected a single document".
  - needs given an anchor with a short list: exit 1, names docker-image.
  - Missing ci.yml: exit 1.
- Mutation test: I replaced the missing-job condition with `if (false)` in a scratch copy and ran the selftest. It exited 1 with 9 FAIL lines, which matches pr-notes' claim of 9.

**AC5.** The ci.yml diff adds only 3 lines, so `timeout-minutes` is unchanged. I sampled 24 recent `docker-image` job durations myself with `gh run view` (one fetch hit a TLS timeout). The longest successful run was 207 s. There were 4 failures, all 8–37 s, so none were timeouts. That agrees with pr-notes (max 213 s against 480 s, no timeouts).

**Squash route.** Skipping `squash-branch.sh` and relying on GitHub squash merge is safe here. The branch is 6 linear commits on one ticket, and GitHub's squash produces a single commit regardless. The only requirement is that the merge is checked against this head SHA, which `check-merge-readiness.sh` does with `head_sha`.

### Verdict: CONFIRM

### Non-blocking notes
- `specs/ci-required-jobs-guard/spec.md`, scenario "Duplicate job key", is worded inaccurately. Its example is "a fake copy inside an earlier job's multi-line quoted string", but that is string content, not a duplicate key. The selftest's cycle-2 regression shows it produces "job b missing", not a parse error. A real duplicate key is two sibling keys, as the selftest's other duplicate-key case does. This could be fixed when the change is archived.
- The known gap is disclosed: if `frontend` itself is dropped from needs, only the hook catches it. Separately, `check-precommit-ci-parity.mjs` `parseCiCompleteNeeds` still fails open when a comment is matched first. Both are reasonable follow-ups.
- `docker image ls` sizes on this host are containerd store accounting, and pr-notes says so. The `docker history` layer lines are the evidence that matters, and I reproduced them.
- No gate defect: none of the reports I relied on depend on mtime ordering.
