## Context

See proposal.md (Why). Verified from the failing job logs: `docker-image` dies in BuildKit's `load metadata` HEAD to
`registry-1.docker.io` for `eclipse-temurin:21-jdk-jammy` (429); every e2e shard dies in the runner's service-container
`docker pull postgres:16` (429, 3 retries). Those are the only Docker Hub pulls in `.github/workflows/` (`cd-frontend.yml`
builds `FROM scratch`; `cd-backend.yml` builds the root Dockerfile with no build args). Dependabot has no `docker`
ecosystem configured, so parameterising `FROM` breaks no automated base-image update.

## Goals / Non-Goals

**Goals:** CI's three Docker Hub pulls stop counting against Docker Hub's anonymous per-IP limit; no secret; CD and the
production image unchanged; a failed pull still fails CI.

**Non-Goals:** pinning base images by digest (would change CD's behaviour — separate decision); layer caching for the
image build (HEL-1427 D4/HEL-1299 cache budget); authenticating to Docker Hub; changing `docs/verify-backend-logging.sh`
or any local developer flow.

## Decisions

### D1. Mirror (`mirror.gcr.io`) over Docker Hub login or caching
`mirror.gcr.io` is Google's public, unauthenticated pull-through cache of Docker Hub library images. It is not subject to
Docker Hub's anonymous per-IP limit (requests go to Google, not Docker Hub) and needs no secret. Alternatives: a Docker Hub
read-only token via `docker/login-action` raises the limit but still a limit, needs an owner-created secret, and does not
run on fork PRs (secrets unavailable); `public.ecr.aws/docker/library/...` also works but ECR Public's anonymous quota is
per-IP too; Actions-cache of base image tarballs spends the HEL-1299 cache budget. Mirror wins on no secret + no budget.

### D2. Build-arg prefix for the Dockerfile, not a daemon `registry-mirrors` config
Add before the first `FROM`:
`ARG BASE_REGISTRY=docker.io/library` and change the two lines to
`FROM ${BASE_REGISTRY}/eclipse-temurin:21-jdk-jammy AS builder` / `FROM ${BASE_REGISTRY}/eclipse-temurin:21-jre-alpine AS runtime`.
With no build arg the reference is `docker.io/library/eclipse-temurin:<tag>`, which is exactly what Docker's reference
normalisation turns the bare `eclipse-temurin:<tag>` into today — same registry, repo, tag, therefore the same pull. CI passes
`--build-arg BASE_REGISTRY=mirror.gcr.io/library`. Rejected alternative: writing `registry-mirrors` into
`/etc/docker/daemon.json` and restarting dockerd keeps the Dockerfile byte-identical, but (a) it cannot affect service
containers, which start before any step, (b) the daemon silently falls back to Docker Hub when the mirror misses, which is
exactly the hidden-path behaviour we want visible, and (c) whether BuildKit's metadata resolution honours it depends on the
builder driver — the job log would still say `docker.io`, so "pulls via the new path" would be unprovable from the log.
The build-arg makes the log itself print `mirror.gcr.io`.

### D3. Service image referenced via the mirror directly
`services.postgres.image: mirror.gcr.io/library/postgres:16`. Same tag, same digest (verified), no step-time option exists
for services.

### D4. No fallback
Neither job retries against Docker Hub. A mirror failure is a job failure → `ci-complete` failure (unchanged HEL-1427
semantics). Falling back would reintroduce the 429 path silently on the days it matters.

## Risks / Trade-offs

- [mirror.gcr.io lags a freshly re-pushed tag] → CI may briefly build on the previous base digest while CD gets the new one.
  The window is a cache refresh; the production image is still built by CD from Docker Hub, so prod is never built from the
  mirror. Accepted; digest pinning is a separate decision (follow-up candidate).
- [mirror.gcr.io drops a tag or is unavailable] → job fails loudly (D4); a revert of this change restores the old path.
- [A future Dockerfile `FROM` added without `${BASE_REGISTRY}`] → that image would pull from Docker Hub in CI again. Comment
  in the Dockerfile next to the ARG says every Docker Hub `FROM` must use the prefix.

## Gate-Chain Implications Checklist

Not applicable: no file under `.husky/` and no script `.husky/pre-commit` invokes is touched.

## Migration Plan

Merge; the next CI run of every open PR picks it up after a rebase/merge of main. Rollback: revert the commit.

## Verification evidence required

1. CI run on this PR where `docker-image` logs `load metadata for mirror.gcr.io/library/eclipse-temurin:...` for both stages
   and every `e2e (n)` logs `docker pull mirror.gcr.io/library/postgres:16`, and every job passes.
2. Digest equality (mirror vs Docker Hub manifest-list digest) for all three tags, captured at verification time.
3. `git diff` shows `cd-backend.yml` untouched; the Dockerfile default expands to `docker.io/library/eclipse-temurin:<tag>`
   (demonstrated, e.g. via `docker buildx build --call outline` or a build-log `load metadata for docker.io/library/...` line
   from a local default build's metadata step), i.e. the same reference CD resolves today.
4. Loud failure: shown by construction (no `continue-on-error`, no fallback) plus the job's failure on the pre-change runs.
