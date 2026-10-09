## Why

The backend runtime image stores its ~316 MB fat jar twice: `COPY --from=builder` writes it once and the following
`RUN mkdir -p data && chown -R helio:helio /app` rewrites it into a second layer just to change ownership (confirmed
in CI run 37997304485's `docker history`: two 316 MB layers). Separately, nothing checks that every `ci.yml` job is in
`ci-complete.needs`; a new job left out of that list silently stops gating merges.

## What Changes

- `Dockerfile` runtime stage: copy the jar with `COPY --chown=helio:helio --from=builder`, and chown only `data`.
  Runtime contract (files, ownership, USER, ENTRYPOINT, HEALTHCHECK, EXPOSE, WORKDIR, `ARG BASE_REGISTRY`) unchanged.
- New static guard `check:ci-complete-needs` (plus selftest) asserting every `ci.yml` job except `ci-complete` is listed
  in `ci-complete.needs`, failing closed on anything it cannot parse. Runs in `.husky/pre-commit` and in the CI
  `frontend` job (which `ci-complete` needs), keeping `check:precommit-ci-parity` green.
- `docker-image` job `timeout-minutes: 8` unchanged: 73 successful runs on 2026-10-09 took 143-213 s, no timeouts.

## Capabilities

### New Capabilities

- `ci-required-jobs-guard`: every CI job is a required input of the aggregate `ci-complete` check, enforced statically.

### Modified Capabilities

- `ci-production-image-build`: adds a requirement that the runtime image stores the application jar in one layer with
  the runtime's ownership contract unchanged.

## Non-goals

- Changing the CD workflow, deploying, or cutting a release (the post-release `/health` check is handed to the owner).
- Restructuring `ci-complete`'s aggregation logic.
- Changing `docker-image`'s timeout, caching, or base-image registry handling (HEL-1427/HEL-1452).

## Impact

`Dockerfile`, `.husky/pre-commit` (gate chain), `.github/workflows/ci.yml` (frontend job steps), `package.json`
scripts + new exact-pinned devDependency `js-yaml@4.3.2` (already in the lockfile transitively; `package-lock.json` root entry only), new `scripts/check-ci-complete-needs.mjs` + `.selftest.mjs`. Production image layout changes on next release.
