# HEL-1428: Backend image: use COPY --chown instead of chown -R so the 316 MB jar isn't stored twice; guard that every ci.yml job is in ci-complete.needs

## Description

Origin: HEL-1427 (matto00/helio#874), lane-reported, not yet verified by the driver. Priority Low, label Follow-up.

1. **Image size.** The Dockerfile runtime stage's `RUN mkdir -p data && chown -R helio:helio /app` rewrites the jar
   layer, so the ~316 MB jar is stored twice and the runtime image is ~840 MB. Use
   `COPY --chown=helio:helio --from=builder ...` plus a chown that covers only `data`. Measure image size before and
   after (`docker history`), and confirm CD still deploys and `/health` is 200 on a tagged revision.
2. **Guard.** Add a static check (pre-commit + CI parity, like the existing single-line `needs:` regex check) that
   every job in `ci.yml` except `ci-complete` itself appears in `ci-complete.needs`. A new job left out of `needs`
   silently stops being required. Demonstrate the red.
3. **Timeout watch.** The `docker-image` job has `timeout-minutes: 8`, based on one cold 195 s measurement. If it times
   out more than once from slow downloads, re-measure and raise it.

## Acceptance Criteria

- AC1: The runtime stage copies the jar with `COPY --chown=helio:helio --from=builder ...`; the only remaining chown
  covers `/app/data` alone. `docker history` before/after shows the second ~316 MB layer is gone; before/after image
  sizes are recorded as evidence.
- AC2: The runtime is unchanged: same file set under `/app`, `/app/data` and `/app/helio-backend.jar` owned by
  helio:helio, same USER, ENTRYPOINT, HEALTHCHECK, EXPOSE, WORKDIR (proven by `docker inspect` + in-image
  listing/`stat` diffs, and by starting the container and hitting `/health` if it can start; if it cannot start
  without a DB, say so and rely on the file/metadata equivalence). HEL-1452's `ARG BASE_REGISTRY` stays intact.
- AC3: "CD deploys and /health is 200 on a tagged revision" is stated in the PR body as a post-release check for the
  driver/owner (no release is cut by this ticket).
- AC4: A static guard fails when any `ci.yml` job other than `ci-complete` is missing from `ci-complete.needs`, fails
  closed when it cannot parse the jobs or the needs list, runs in `.husky/pre-commit` and in a `ci-complete`-required
  CI job, and has a selftest; the red is demonstrated against the real `ci.yml` with a job removed from `needs`.
- AC5: Item 3 is report-only: recent `docker-image` job durations are reported with a headroom verdict;
  `timeout-minutes` changes only if the data shows timeouts.

## Driver notes

- MODELS for this run (driver override): orchestrator opus, executor sonnet, evaluator opus, skeptic opus,
  auditor sonnet.
- Remove local images built for measurement by exact tag afterwards. Never print environment contents.
