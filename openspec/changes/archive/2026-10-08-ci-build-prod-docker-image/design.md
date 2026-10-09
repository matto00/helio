## Context

See proposal.md (Why). Current state, verified against the tree at eda9ed49:

- `.github/workflows/ci.yml` jobs: `frontend`, `backend` (4-leg matrix), `security`, `e2e` (matrix), `ci-complete`.
  `ci-complete` is `if: always()`, `needs: [frontend, backend, security, e2e]`, and fails on any `failure`/`cancelled`
  result while treating `skipped` as success. Nothing in CI runs `docker build`.
- `.github/workflows/cd-backend.yml` (tag-triggered) builds with plain `docker build -t "$IMAGE" .` then pushes.
- Root `Dockerfile`: `builder` stage (apt-installs sbt, copies `backend/project/{build.properties,plugins.sbt,*.scala}`
  + `backend/build.sbt`, `sbt update`, copies `backend/`, `sbt assembly`), then `runtime` stage that
  `COPY --from=builder .../helio-backend.jar`. `.dockerignore` shapes the context.
- Critical path today (CI run 37880626177 on main): e2e legs up to 7m05s, frontend 5m16s, backend legs 2m33s-3m31s.
- HEL-1299 (#860) bounds the Actions cache to the 10 GB repo limit; its post-merge measurements are live until after
  2026-10-09 22:30Z. Repo is public (no billed runner minutes).

## Goals / Non-Goals

**Goals:** a deploy-only image break fails the required `ci-complete` check on the PR that introduces it, without
lengthening CI wall time or touching the Actions cache budget.

**Non-Goals:** pushing/scanning/running the image; changing `Dockerfile`, `.dockerignore`, `cd-backend.yml`, or any
existing job, cache key, cache path or restore/save step.

## Decisions

**D1 - A separate `docker-image` job, not a step in `backend`.** `backend` is a 4-leg matrix on the critical path of
backend feedback; a step there would run 4x or need a shard-0 guard and lengthen that leg. A standalone job runs in
parallel with every other job. Alternative (extend `backend`) rejected for those reasons.

**D2 - Build exactly what CD builds.** `docker build -t helio-backend:ci-${{ github.sha }} .` from the repo root (the
final/default `runtime` stage), mirroring `cd-backend.yml`'s build line, so the builder's `sbt update`/`sbt assembly`
and the runtime stage's `COPY --from=builder` jar path are all exercised. No registry login, no push, no secrets, no
added `permissions` (inherits workflow-level `contents: read`). `--target builder` rejected: it would miss a jar
name/path drift between the stages, which is also deploy-only.

**D3 - Always-on (no path filter).** The ticket permits path-filtering only "if it's too slow to run on every PR".
It runs in parallel and is expected (local: ~70 s of sbt plus image/apt layers) to finish well inside the 7 min
critical path, and the repo is public so runner minutes are not billed. Always-on also (a) removes the
skipped-vs-failed wiring hazard entirely - the job can never be `skipped`, so `ci-complete` only ever sees
`success`/`failure`/`cancelled` from it - and (b) catches image breaks from paths outside the ticket's list (e.g.
`backend/src/main/resources/**` interacting with `.dockerignore`, or an assembly merge conflict). A filter
(`dorny/paths-filter` = new third-party dependency, or a hand-rolled `git diff` job) is more moving parts for a
narrower guard. **Acceptance condition:** on real CI the `docker-image` job's duration must be shorter than the
slowest other job in the same run. If it is not, stop and report to the orchestrator - do not add a filter or cache
unilaterally (that becomes an owner decision).

**D4 - No layer cache.** A BuildKit `type=gha` cache would persist the builder stage's layers - the JDK base, the apt
sbt install and, above all, the `sbt update` layer holding the full Coursier/Ivy dependency tree (Spark et al.) - as
Actions cache entries, plausibly 1 GB+ per key, against a 10 GB budget that HEL-1299 is actively measuring. Because
D3 keeps the job off the critical path, a cache would buy no wall time anyway. The ticket's "use layer caching" bullet
exists to avoid "significant wall time"; that goal is met by parallelism and is verified by D3's acceptance
condition. The job prints `docker history` of the built image (report-only step) and the executor records those sizes from the
real-CI log as the evidence for this trade (no local build: standing constraint C1).
Plain `docker build` on the runner touches no Actions cache.

**D5 - Timeout** `timeout-minutes` set to ~2.5x the measured real-CI duration, with a HEL-1287 D11-style comment
citing the run ids, matching the convention on every other job in `ci.yml`.

**D6 - `ci-complete` wiring.** Add `docker-image` to `needs:`; its existing script already fails on
`failure`/`cancelled`, so no script change. Update the comment above `ci-complete` only if it becomes inaccurate.

**D7 - RED proof on a throwaway draft PR, not in the real PR's history.** A throwaway branch
`task/ci-build-prod-docker-image/HEL-1427-red-proof` = implementation commit + a commit deleting the `COPY
backend/project/*.scala backend/project/` line, opened as a DRAFT PR to `main` titled
`HEL-1427 [throwaway RED proof - do not merge]`. Expect `docker-image` = failure with `Not found: TestShards` in its
log and `ci-complete` = failure. Wait for that run to complete (PR runs cancel in-progress on a new push), then push a
revert commit and expect `docker-image` and `ci-complete` = success. Record both run ids, then close the PR and delete
exactly that remote branch. The real PR's own CI run (Delivery) is the green on the final head.

## Risks / Trade-offs

- [Docker Hub anonymous pull limits / transient apt or repo.scala-sbt.org outage fail the job] -> the same
  dependencies already gate every deploy; a transient failure is re-runnable. Not mitigated with retries (hides real
  breaks).
- [Runner disk: JDK image + dependency tree + assembly] -> measured on real CI; ubuntu-latest has ample free space.
- [One more job per run against the public-repo concurrent-job limit while several lanes run] -> marginal (+1 to ~11
  jobs per run); accepted.
- [Always-on spends ~minutes of runner time per PR] -> unbilled on a public repo; accepted for the stronger guard.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` file or script `.husky/pre-commit` invokes is touched.

## Planner Notes

- Self-approved: D3 (always-on) and D4 (no cache) are within the ticket's stated latitude and the driver's
  instruction to prefer no cache over eating the HEL-1299 budget; both are bounded by D3's measured acceptance
  condition, which escalates rather than silently re-deciding.
- No new external dependency (no new action; `docker` is preinstalled on `ubuntu-latest`).
- Possible follow-up (not in scope): a static guard that every `ci.yml` job is listed in `ci-complete.needs`.
