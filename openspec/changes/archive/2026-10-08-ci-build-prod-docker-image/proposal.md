## Why

The v0.9.0 backend deploy failed at the root `Dockerfile`'s `sbt update` (`Not found: TestShards`, CD run 37879636919)
because CI never builds the production image. The break sat on `main` for the whole v0.9 cycle and surfaced only when
the release tag deployed, causing prod frontend/backend skew (HEL-1426 fixed the Dockerfile; this closes the gap).

## What Changes

- Add a `docker-image` job to `.github/workflows/ci.yml` that runs `docker build` of the root `Dockerfile` through the
  final `runtime` stage (so `sbt update`, `sbt assembly` and the jar `COPY --from=builder` are all exercised) with no
  registry login and no push.
- Add the job to `ci-complete`'s `needs:` so a failure of the image build fails the required check.
- Run it on every PR and every `main` push (no path filter) and without an Actions-cache-backed layer cache; see
  design.md for the measured justification of both.
- Demonstrate on real CI that removing the `COPY backend/project/*.scala` line fails `docker-image` and `ci-complete`.

## Capabilities

### New Capabilities
- `ci-production-image-build`: CI verifies the production backend container image builds on every PR and main push.

### Modified Capabilities

## Non-goals

- Pushing, scanning or smoke-running the built image (CD still owns build+push+deploy).
- Changing `cd-backend.yml`, the `Dockerfile` itself, or any existing HEL-1299 cache key, path or save/restore split.
- Frontend image/hosting build verification.

## Impact

- `.github/workflows/ci.yml` only (new job + `ci-complete.needs`). No application code, schema or dependency change.
- Adds one parallel runner job per CI run (public repo: no billed minutes); must stay off the critical path.
