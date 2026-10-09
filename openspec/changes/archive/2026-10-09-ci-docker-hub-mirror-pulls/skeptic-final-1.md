## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: beb10502f5677558adddd1562537b3c381932e53 (branch bug/ci-docker-hub-mirror-pulls/HEL-1452).
Base resolved live via resolve-review-base.sh (origin/main): 03588796bbef47de0b48bedd201ae3e49739a191.

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/ci-docker-hub-mirror-pulls/HEL-1452`.
- **Diff scope** (`git diff BASE...HEAD --stat`): code changes are only `Dockerfile` (+ARG, two FROM lines) and `.github/workflows/ci.yml` (e2e service image, docker-image build-arg, comments); the rest is OpenSpec artifacts. One commit.
- **AC1 — fix picked from the listed options**: mirror option. `Dockerfile:3` `ARG BASE_REGISTRY=docker.io/library` (global ARG before the first FROM, so in scope for FROM lines); `Dockerfile:6` and `:28` use `${BASE_REGISTRY}/eclipse-temurin:<same tag>`. `ci.yml:670` passes `--build-arg BASE_REGISTRY=mirror.gcr.io/library`; `ci.yml:518` uses `mirror.gcr.io/library/postgres:16`. No secret and no login added.
- **Completeness of Docker Hub pulls in CI**: grep of `.github/workflows/*.yml` for `image:|docker build|docker pull|FROM|container:` shows the only Docker Hub pulls are the two FROMs and the e2e postgres service. Backend tests use `io.zonky.test:embedded-postgres` (Maven, `backend/build.sbt:278`), not a container. The CI log (below) has 0 occurrences of `registry-1.docker.io` / `toomanyrequests` in docker-image or e2e jobs.
- **AC2 — CD unchanged, same digests**:
  - `git diff --quiet BASE...HEAD -- .github/workflows/cd-backend.yml` -> unchanged. CD runs `docker build -t "$IMAGE" .` (cd-backend.yml:46) with no build args, so the default `docker.io/library/eclipse-temurin:<tag>` applies.
  - The pre-change failing run 37989372933 logs `load metadata for docker.io/library/eclipse-temurin:21-jdk-jammy` / `:21-jre-alpine` for the bare names. The new default expands to exactly those normalised references, so CD makes the same pull (same registry, repo and tag) as before. I could not run `buildx --call outline` locally (buildx not installed); the expansion follows from standard global-ARG semantics plus the CI log showing the arg substituted correctly when overridden.
  - Fresh anonymous manifest HEADs I ran myself at 2026-10-09 21:34Z: hub == mirror for all three tags (jdk-jammy `sha256:e0c60c48...b902b`, jre-alpine `sha256:51ab5e33...4555`, postgres:16 `sha256:ca0bd484...b641d`), matching evidence-3.1.md and the ticket's 21:10Z capture.
- **AC3 — CI run pulls via the new path**: run 37993012058, headSha beb10502f5677558adddd1562537b3c381932e53, event pull_request, all 12 jobs `success` including ci-complete. From `gh run view 37993012058 --log`:
  - docker-image (job 114031771764): `#2 [internal] load metadata for mirror.gcr.io/library/eclipse-temurin:21-jdk-jammy`, `#3 ... 21-jre-alpine`, `#5 resolve mirror.gcr.io/library/eclipse-temurin:21-jdk-jammy@sha256:e0c60c48...`, `#7 resolve ...21-jre-alpine@sha256:51ab5e33...`. These match Docker Hub's digests.
  - e2e (1)-(4) (jobs 114031771677/930/782/813): `##[command]/usr/bin/docker pull mirror.gcr.io/library/postgres:16`, `Digest: sha256:ca0bd484...` in all four.
- **AC3 — a rate-limited pull fails loudly**: no `continue-on-error` on the docker-image job/step or on the e2e job (the only one in ci.yml, line 204, is on a pre-existing report-only sbt cache step). There is no retry or fallback to Docker Hub. ci-complete (`needs: [..., e2e, docker-image]`, `if: always()`) fails on any `failure`. That path is observed in run 37989372933: docker-image `failure`, so ci-complete `failure`. The service-container pull happens in "Initialize containers", and a failure there fails the job, as observed for the e2e shards in that run.
- **PR #899 body vs ground truth**: job IDs match `gh run view --json jobs`. The digests match my fresh HEADs. The "load metadata for mirror.gcr.io" and "0 registry-1.docker.io" claims match the log. The "inferred vs observed" section honestly says the prod image was not rebuilt. headRefOid is beb10502f.
- **Evaluator report** (evaluation-1.md): read as a claim. Its AC and continue-on-error statements agree with what I found independently.
- **UI**: no frontend changes, so the design step is skipped.

### Verdict: CONFIRM

### Non-blocking notes
- The PR body's "Prod image" fact 1 says CD's references are "textually identical" to today's. They are normalisation-identical (`eclipse-temurin:<tag>` -> `docker.io/library/eclipse-temurin:<tag>`), not textually identical. Fact 2 (mirror == hub digests) supports CI/prod base parity, not prod-unchanged; prod-unchanged follows from fact 1 alone. Consider tightening the wording.
- `ci.yml:517` comment "same tag/digest as Docker Hub" holds at a point in time; the mirror can lag a re-push (already acknowledged in design Risks).
- `infra/docker-compose.spark.yml` and local `docker build` flows still pull from Docker Hub. This is out of scope (not CI) and correctly listed as a non-goal.
