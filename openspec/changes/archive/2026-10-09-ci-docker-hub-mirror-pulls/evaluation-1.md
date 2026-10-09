## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: beb10502f5677558adddd1562537b3c381932e53 (diff base 03588796bbef47de0b48bedd201ae3e49739a191, resolved live via resolve-review-base.sh against origin/main).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (pick a fix): mirror option chosen. `Dockerfile:3` adds `ARG BASE_REGISTRY=docker.io/library`, and both FROM lines (`Dockerfile:6`, `Dockerfile:28`) use `${BASE_REGISTRY}/`. CI passes `--build-arg BASE_REGISTRY=mirror.gcr.io/library` (`.github/workflows/ci.yml:670`), and the e2e service uses `mirror.gcr.io/library/postgres:16` (`ci.yml:518`). No new secret.
- AC2 (CD unchanged, same digests): `git diff --stat 03588796b...HEAD -- .github/workflows/cd-backend.yml .github/workflows/cd-frontend.yml` is empty. `cd-backend.yml:46` still runs `docker build -t "$IMAGE" .` with no build args, so the default `docker.io/library/eclipse-temurin:<tag>` applies. That is the fully-qualified form of the bare name it resolved to before. The repo has only two FROM lines, both prefixed. The cd-frontend FROM is `scratch`, which pulls nothing.
- AC3 (CI run pulls via the new path, and a pull failure is loud): see the CI evidence below. There is no `continue-on-error` and no fallback on the docker-image job or the e2e service. The only `continue-on-error` in ci.yml (line 204) is on an unrelated report-only step that already existed.
- Tasks 1.1 to 2.4 and 3.1 are done and match the diff. Task 3.2 is the evaluator/orchestrator's job after the push, and the evidence below satisfies it. Its PR-body wording requirement is still pending (non-blocking, see below).
- The spec delta `specs/ci-base-image-pulls/spec.md` matches the implemented behaviour.
- CONSTRAINTS: `[]`, so nothing to honour.

### Phase 2: Code Review — PASS
Issues: none.

- Gates: the change touches no `frontend/**` or `backend/**` files, so no configured gate was triggered. `ci.yml` parses as YAML (python yaml.safe_load). actionlint and hadolint are not installed locally. The real PR CI run (below) passed every job, including the repo's own workflow and openspec checks.
- CONTRIBUTING comment standard: the new comments carry the HEL-1452 prefix and also state the decision inline (mirror is used to avoid Docker Hub 429s; no fallback, so a failed pull fails the job; CD uses the default). That is compliant.
- The `Dockerfile:1-2` hazard comment ("Every Docker Hub FROM must use it") documents the contract for future FROM lines. That is a good use of a comment.
- No over-engineering, no dead code, minimal surface.

Independent digest check, run by me at 2026-10-09T21:22:53Z with anonymous HEAD requests (Docker-Content-Digest; manifest-list/OCI index Accept):
- eclipse-temurin:21-jdk-jammy: hub = mirror = sha256:e0c60c487345d1dc9d0fc7b6f0496f3cc941e5132e09296cc17a6decc71b902b (EQUAL)
- eclipse-temurin:21-jre-alpine: hub = mirror = sha256:51ab5e3302e7141ce665ca3ea85e8b5cd648eafbc3c0c90dd79d6537684e4555 (EQUAL)
- postgres:16: hub = mirror = sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d (EQUAL)

### CI evidence (task 3.2)
PR #899, CI run **37993012058** (pull_request event, headSha beb10502f5677558adddd1562537b3c381932e53). Status: completed/success. Every job concluded success: frontend, backend (0-3), e2e (1-4), docker-image, security, ci-complete.

docker-image (job 114031771764):
- `#2 [internal] load metadata for mirror.gcr.io/library/eclipse-temurin:21-jdk-jammy`
- `#3 [internal] load metadata for mirror.gcr.io/library/eclipse-temurin:21-jre-alpine`
- `[builder  1/10] FROM mirror.gcr.io/library/eclipse-temurin:21-jdk-jammy@sha256:e0c60c487345d1dc9d0fc7b6f0496f3cc941e5132e09296cc17a6decc71b902b`
- `[runtime 1/5] FROM mirror.gcr.io/library/eclipse-temurin:21-jre-alpine@sha256:51ab5e3302e7141ce665ca3ea85e8b5cd648eafbc3c0c90dd79d6537684e4555`
- `registry-1.docker.io` appears 0 times in the job log. The only `docker.io` hit is the local tag name `docker.io/library/helio-backend:ci-...`, which is not a pull.

The resolved digests in the BuildKit log match the Docker Hub digests above.

e2e "Initialize containers", each followed by `Digest: sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d` and `Status: Downloaded newer image for mirror.gcr.io/library/postgres:16`:
- e2e (1) job 114031771677: `##[command]/usr/bin/docker pull mirror.gcr.io/library/postgres:16`
- e2e (2) job 114031771930: `##[command]/usr/bin/docker pull mirror.gcr.io/library/postgres:16`
- e2e (3) job 114031771782: `##[command]/usr/bin/docker pull mirror.gcr.io/library/postgres:16`
- e2e (4) job 114031771813: `##[command]/usr/bin/docker pull mirror.gcr.io/library/postgres:16`

Prod digest equality is inferred, not observed. CD resolves the same canonical reference as before, and that reference's Docker Hub digest equals the mirror digest CI built from. No prod image was rebuilt.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` files changed. The change-local spec delta under `openspec/changes/` is not a UI trigger.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- PR #899's body is still the draft placeholder. Before the final gate, it must say what task 3.2 requires: prod base-digest equality is inferred (same reference plus matching mirror and Hub digests), not observed. It should also cite run 37993012058.
- `ci.yml:662` (job header comment) and `ci.yml:669` (step comment) both say the base images come from mirror.gcr.io. One of them could go, but both carry slightly different information (the CD contrast vs no fallback), so this is optional.
