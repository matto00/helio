## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 03588796bbef47de0b48bedd201ae3e49739a191 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/ci-docker-hub-mirror-pulls/HEL-1452`.
- **Failure premise (ticket claims):** `gh run view 37989372933 --log-failed` shows, verbatim:
  - docker-image: `#4 [internal] load metadata for docker.io/library/eclipse-temurin:21-jdk-jammy` then
    `HEAD request to https://registry-1.docker.io/v2/library/eclipse-temurin/manifests/21-jdk-jammy: 429 Too Many Requests`.
  - e2e (1): `##[command]/usr/bin/docker pull postgres:16` -> `toomanyrequests` x3 -> `##[error]Docker pull failed with exit code 1`.
  Premise confirmed.
- **Digest equality (re-measured myself, 2026-10-09 21:13Z, anonymous HEAD with index/list Accept headers):**
  Docker Hub vs mirror.gcr.io (mirror returned HTTP/2 200, no auth):
  - eclipse-temurin:21-jdk-jammy  hub=mirror=sha256:e0c60c487345d1dc9d0fc7b6f0496f3cc941e5132e09296cc17a6decc71b902b
  - eclipse-temurin:21-jre-alpine hub=mirror=sha256:51ab5e3302e7141ce665ca3ea85e8b5cd648eafbc3c0c90dd79d6537684e4555
  - postgres:16                   hub=mirror=sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d
  Matches ticket.md. mirror.gcr.io needs no credential -> no secret, works on fork PRs.
- **Reference identity of the build-arg prefix (D2):** the default expands by plain string substitution to
  `docker.io/library/eclipse-temurin:21-jdk-jammy` / `...:21-jre-alpine`; the pre-change CI log above shows BuildKit
  already normalising the bare names to exactly those strings (`load metadata for docker.io/library/eclipse-temurin:21-jdk-jammy`).
  Same registry/repo/tag -> same resolution. A global ARG (declared before the first FROM, never redeclared in a stage)
  does not enter any stage's environment or RUN history, so it adds nothing to the image beyond the base choice. With a
  default present, BuildKit's `InvalidDefaultArgInFrom` check does not fire. I applied the planned edit to a scratch copy
  and diffed: exactly 3 lines change (ARG added, two FROM prefixed). Sound.
- **CD untouched:** `.github/workflows/cd-backend.yml:46` is `docker build -t "$IMAGE" .` (no build args) -> default path;
  `cd-frontend.yml` builds `FROM scratch` from an inline Dockerfile (no Docker Hub pull).
- **Other Docker Hub pulls ("anything missed?"):** checked and found none.
  - `grep` over `.github/` for `image:|container:|docker |uses: docker|docker://`: the only Docker Hub pulls are
    `ci.yml:517` (`postgres:16` service) and `ci.yml:667` (the root Dockerfile build). No `container:` jobs, no
    `docker://` actions, no docker-based actions in any `uses:` (all JS/composite: checkout, setup-*, cache, upload-artifact,
    google-github-actions/*, dependabot/fetch-metadata, sbt/setup-sbt).
  - Only one Dockerfile in the repo; it has no `# syntax=` directive, so BuildKit uses its built-in frontend (no
    `docker/dockerfile` frontend image pull).
  - Backend tests use `io.zonky.test:embedded-postgres` (Maven artifact, `backend/build.sbt:278`), not Testcontainers,
    so there's no hidden postgres/ryuk pull in the backend job.
  - No hadolint/Dockerfile lint in `.husky/pre-commit` or workflows; no repo script parses `postgres:16`/`docker build`
    from ci.yml (grep zero hits), so nothing else needs to change with them.
  - `.github/dependabot.yml` has no `docker` ecosystem (grep zero hits), as design claims.
  - `docs/verify-backend-logging.sh` pulls postgres/builds locally only; not referenced from any workflow.
- **Existing spec compatibility:** `openspec/specs/ci-production-image-build/spec.md` requires "same build context as
  the deploy workflow", final stage, no login/push, ci-complete gating, no cache. A build-arg changes none of those, so
  "no modified capability" is correct.
- **Loud failure (D4):** no `continue-on-error`/fallback planned; `ci-complete` (`ci.yml:679-694`) fails on any
  `failure` in `needs` (includes e2e and docker-image). Service-container pull failure already fails the job (shown by the
  pre-change run). Sound.
- **Alternatives judgment (D1):** mirror.gcr.io is the right no-secret choice. Login needs an owner secret and breaks on
  fork PRs. Daemon `registry-mirrors` can't affect service containers and falls back silently. The rejection reasoning holds.
- **Placeholders/contradictions/scope:** none found. Every AC is covered: fix choice (D1-D3), CD unchanged and same
  digests (D2 + evidence 2/3), CI run on the new path (evidence 1 / task 3.2), loud failure (D4 / evidence 4).

### Verdict: CONFIRM

### Non-blocking notes

1. **Task 1.2's suggested command won't work as written, and wouldn't prove the claim.** This machine's Docker
   (server 29.7.1) has no buildx plugin (`docker: unknown command: docker buildx`; only the compose plugin is
   installed), so `docker build` here is the legacy builder. Also, `--call outline` lists build args/secrets, not resolved
   base references, so it can't show the expansion. Acceptable proofs:
   (a) `docker buildx build --progress=plain --call check .` wherever buildx exists (it runs the frontend and prints
   `load metadata for docker.io/library/eclipse-temurin:...`), or
   (b) the deductive one above: the default expands to the exact string the pre-change CI log already prints for the
   bare names (run 37989372933, job 114022169980), and cd-backend.yml passes no build args.
   The evaluator shouldn't accept `--call outline` output as proof of the default reference. Don't run a full sbt build
   for this.
2. "Prod image unchanged (same base digests)" can only be shown by inference before a release tag: same reference
   plus the digests captured at verification time (task 3.1). Say so explicitly in the PR rather than implying the
   prod image itself was rebuilt.
3. Task 3.2: also record the e2e log line `docker pull mirror.gcr.io/library/postgres:16` for every shard (1-4), not
   just one. The BuildKit lines should read `load metadata for mirror.gcr.io/library/eclipse-temurin:21-jdk-jammy` and
   `...:21-jre-alpine`.
4. HEL-1427's comment at `ci.yml:656-660` says the job "builds the production backend image exactly as cd-backend.yml
   does". After this change, the base images come from a different registry (same digests). Update that comment so it
   doesn't overclaim.
