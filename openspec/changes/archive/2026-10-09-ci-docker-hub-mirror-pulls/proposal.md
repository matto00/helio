## Why

Every CI run pulls three Docker Hub library images anonymously (`eclipse-temurin:21-jdk-jammy` and `eclipse-temurin:21-jre-alpine` in the `docker-image` job, `postgres:16` as the e2e service container). GitHub-hosted runners share egress IPs, so Docker Hub's per-IP anonymous pull limit is exhausted on busy days and `docker-image` plus every e2e shard fail with `429 toomanyrequests` in seconds (runs 37989372933, 37990636971). `ci-complete` correctly fails, so every lane's PR is blocked.

## What Changes

- CI pulls those three images through Google's public Docker Hub pull-through mirror `mirror.gcr.io` instead of `registry-1.docker.io`. No new secret, no login.
- The root `Dockerfile` gains one global build arg (`BASE_REGISTRY`, default `docker.io/library`) prefixing its two `FROM` images. The default expands to the exact canonical reference the bare name resolves to today, so `cd-backend.yml` (which passes no build args) and the production image are unchanged.
- The `docker-image` CI job passes `--build-arg BASE_REGISTRY=mirror.gcr.io/library`.
- The e2e `postgres` service image becomes `mirror.gcr.io/library/postgres:16`.
- No fallback to Docker Hub: a failed mirror pull fails the job, which fails `ci-complete`.

## Capabilities

### New Capabilities
- `ci-base-image-pulls`: where CI pulls third-party container images from, how the deploy build stays pinned to Docker Hub, and how a failed pull surfaces.

### Modified Capabilities
<!-- none: ci-production-image-build's requirements (build the final stage, gate ci-complete, no cache) are unchanged -->

## Impact

- `Dockerfile` (two `FROM` lines parameterised, one `ARG` added; defaults preserve today's references).
- `.github/workflows/ci.yml` (`docker-image` job build command; e2e service image).
- `cd-backend.yml`, `cd-frontend.yml`: unchanged.
- Local `docker build .` / `docs/verify-backend-logging.sh`: unchanged behaviour (defaults).
- Risk: mirror.gcr.io is a cache; a newly pushed tag may briefly lag Docker Hub, so CI may build against a base one refresh older than CD would. See design.md.
