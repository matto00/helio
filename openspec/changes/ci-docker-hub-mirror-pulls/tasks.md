## Standing Constraints

## 1. Dockerfile

- [x] 1.1 Add `ARG BASE_REGISTRY=docker.io/library` (with a short comment: every Docker Hub `FROM` must use the prefix; CI overrides it to the mirror, CD uses the default) before the first `FROM`, and prefix both `FROM` images with `${BASE_REGISTRY}/`; verify no other line of the Dockerfile changed (`git diff --stat`, `git diff Dockerfile`).
- [x] 1.2 Verify the default expands to `docker.io/library/eclipse-temurin:21-jdk-jammy` / `21-jre-alpine` (the exact strings BuildKit printed for the bare names in run 37989372933's `load metadata` lines) by textual substitution of the edited FROM lines; record it. Do NOT use `docker buildx build --call outline` (lists build args, not resolved bases; buildx is not installed locally). No full sbt image build locally.

## 2. CI workflow

- [x] 2.1 `docker-image` job: `docker build --build-arg BASE_REGISTRY=mirror.gcr.io/library -t helio-backend:ci-${{ github.sha }} .`, with a comment citing HEL-1452; verify via `actionlint` (if available) or YAML parse.
- [x] 2.2 e2e `services.postgres.image: mirror.gcr.io/library/postgres:16`, with a comment citing HEL-1452; verify YAML parse.
- [x] 2.4 Update the HEL-1427 comment above the `docker-image` job ("exactly as cd-backend.yml does") to say the base images come from mirror.gcr.io in CI (same tags, same digests as Docker Hub) while CD uses Docker Hub; verify by reading the diff.
- [x] 2.3 Verify `cd-backend.yml` and `cd-frontend.yml` are untouched (`git diff --stat origin/main -- .github/workflows/cd-*.yml` empty).

## 3. Evidence

- [x] 3.1 Capture mirror vs Docker Hub manifest-list digests for the three tags (anonymous registry HEAD requests); record in the change's evidence.
- [ ] 3.2 After the PR exists, capture the CI run where `docker-image` logs both `load metadata for mirror.gcr.io/library/eclipse-temurin:...` lines and all four `e2e (n)` jobs log `docker pull mirror.gcr.io/library/postgres:16`, and every job passes (orchestrator/evaluator task, post-push). The PR body states that prod base-digest equality is inferred (same reference + matching mirror/Hub digests), not observed from a rebuilt prod image.
