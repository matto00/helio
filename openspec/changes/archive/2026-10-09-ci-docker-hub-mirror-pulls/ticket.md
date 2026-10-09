# HEL-1452: CI hits Docker Hub's unauthenticated pull rate limit (docker-image job + e2e postgres service): authenticate or mirror image pulls

## Description

On 2026-10-09, PR matto00/helio#896 (HEL-1448) CI run 37989372933 failed `docker-image` and `e2e (1)` in 10–25s with `toomanyrequests: You have reached your unauthenticated pull rate limit`; a re-run failed the same way. HEL-1427 (matto00/helio#874) added an always-on, cache-less `docker build` on every PR, pulling `eclipse-temurin:21-jdk-jammy` and `eclipse-temurin:21-jre-alpine` from Docker Hub each time. e2e also pulls the `postgres:16` service image. Docker Hub's anonymous limit is per IP; GitHub runner IPs are shared, so busy days hit it.

Priority: High. Labels: Follow-up, Bug. Related: HEL-1427, HEL-1448. Currently blocking PR #896 (HEL-1448) and PR #897 (HEL-1430) (run 37990636971: docker-image + e2e 1–4).

## Acceptance Criteria

* Pick a fix:
  * `docker/login-action` with a Docker Hub read-only token in Actions secrets (owner action to create it);
  * pull from a mirror (`mirror.gcr.io` / `public.ecr.aws`), keeping FROM lines byte-identical for CD or parameterised by build arg, with CD unchanged;
  * cache base images.
  Any new secret is created by the owner.
* CD (`cd-backend.yml`) must keep pulling exactly what it pulls today, or deliberately the same digests. Prove the prod image is unchanged (same base digests).
* Show a CI run that pulls via the new path. A rate-limited pull must fail loudly, never silently skip the job (ci-complete semantics from HEL-1427).

## Verified failure evidence (orchestrator premise check)

* `docker-image` (job 114022169980): BuildKit `load metadata for docker.io/library/eclipse-temurin:21-jdk-jammy` -> `HEAD https://registry-1.docker.io/v2/library/eclipse-temurin/manifests/21-jdk-jammy: 429 Too Many Requests`.
* `e2e (n)` (jobs 114022170732, 114026221890, ...): service-container start `docker pull postgres:16` -> `toomanyrequests`, retried 3x, job fails. e2e does not pull eclipse-temurin.
* mirror.gcr.io manifest-list digests equal Docker Hub's at 2026-10-09 21:10Z: eclipse-temurin:21-jdk-jammy sha256:e0c60c487345d1dc9d0fc7b6f0496f3cc941e5132e09296cc17a6decc71b902b; eclipse-temurin:21-jre-alpine sha256:51ab5e3302e7141ce665ca3ea85e8b5cd648eafbc3c0c90dd79d6537684e4555; postgres:16 sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d.
