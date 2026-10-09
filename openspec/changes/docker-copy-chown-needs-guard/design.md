## Context

See proposal.md (Why). Current runtime stage (`Dockerfile` lines 28-34): `WORKDIR /app`, `COPY --from=builder
.../helio-backend.jar helio-backend.jar`, `RUN mkdir -p data && chown -R helio:helio /app`. The recursive chown makes
`/app`, `/app/data` and the jar helio-owned, and re-stores the jar. HEL-1452 put `ARG BASE_REGISTRY` before the first
`FROM`; CI builds with `--build-arg BASE_REGISTRY=mirror.gcr.io/library`, CD with the default. The only existing CI
topology guard is `scripts/check-precommit-ci-parity.mjs` (CI-only, `frontend` job), whose `parseCiCompleteNeeds`
reads `ci-complete`'s single-line `needs: [...]` by regex and is lenient by design (no `ci-complete` → scans the whole
file; non-flow `needs` → `[]`). Today `ci-complete.needs` = `[frontend, backend, security, e2e, docker-image]`, i.e.
all five other jobs, so the new guard is green on main.

## Goals / Non-Goals

**Goals:** jar stored once with an identical runtime contract; a fail-closed guard in hook + CI; item 3 reported.
**Non-Goals:** CD changes, a release, a YAML parser dependency, changing `docker-image`'s timeout.

## Decisions

**D1 - jar copy and ownership.** `COPY --chown=helio:helio --from=builder /build/backend/target/scala-2.13/helio-backend.jar
helio-backend.jar` and `RUN mkdir -p data && chown helio:helio /app /app/data` (non-recursive). The ticket says "a
chown that covers only `data`"; chowning `/app` itself too (one directory inode, no file content re-stored) keeps
`/app` helio-owned exactly as today, so the runtime contract is unchanged rather than "mostly" unchanged (a process
writing a file directly under `/app` keeps working). Alternative rejected: chown `data` only, which silently flips
`/app` to root:root. Mode bits: `COPY --chown` does not change the jar's mode; `chown` never did either.

**D2 - proving equivalence.** Build before (origin/main `Dockerfile`) and after with the same builder cache so the
builder stage is a cache hit and the jar bytes are identical; both builds use the same `BASE_REGISTRY`
(record which); tag by exact names `helio-backend:hel1428-before` /
`:hel1428-after`; build with `nice -n 19`. Evidence: `docker history` both, `docker image ls` sizes, a diff of
`docker inspect --format` for `Config.User/Entrypoint/Cmd/Healthcheck/ExposedPorts/WorkingDir/Env`, and a diff of an
in-image listing via `docker run --rm --entrypoint sh <img> -c "find /app -exec stat -c '%n %U:%G %a %s' {} +"` (same
command for both images; the image entrypoint is java) (plus jar sha256). Container start: run each image
against a throwaway `postgres:16` container on a dedicated docker network (exact names, e.g. `hel1428-net`,
`hel1428-pg`), never the shared dev DB, publish 8080 on a free 127.0.0.1 port checked unused first (not
`BACKEND_PORT`, which this lane's dev backend may hold), and `curl /health`. If the
backend cannot reach `/health` for a reason unrelated to the Dockerfile, record why and rely on the listing/inspect
diff, saying so. Remove containers, network and both images by exact name afterwards. Never print env contents.

**D3 - guard as its own script.** New `scripts/check-ci-complete-needs.mjs` exporting a pure
`checkCiCompleteNeeds(ciYamlText)` returning `{errors, jobs, needs}`, plus a CLI taking an optional `repoRoot` (same
shape as `check-precommit-ci-parity.mjs`). It does not reuse `parseCiCompleteNeeds`, because that helper's leniency is
exactly what this guard must not have. Parsing: scope to the top-level `jobs:` block, which starts at the `^jobs:` line and runs to
end of file: `jobs:` must be the last top-level key. Any non-blank, non-comment column-0 line after it is an error
(never a terminator, since it could be the continuation of a multi-line quoted scalar that would otherwise hide later
jobs); blank lines and comment lines at any indent (including column 0) are ignored. Inside it, every line at exactly 2-space indent that is not a comment MUST match
`^  ([A-Za-z0-9_-]+):\s*(#.*)?$`; any other 2-space line (quoted key `  "lint":`, flow mapping, anchor) is an error
naming the line, so no job can be skipped silently; `ci-complete`'s block is the text
until the next 2-space key; the `needs` key is the one non-comment line in that block indented exactly 4 spaces matching
`^    needs:` (comment lines are never read, so a comment mentioning `needs: [...]` cannot stand in for the list;
zero or more than one such line is an error), and its value must be the single-line `needs: [a, b]` form; each entry must be a bare
`[A-Za-z0-9_-]+` id, and a quoted or otherwise non-bare entry is an error (rejected, not stripped). Errors (fail closed): a duplicate job key (valid YAML cannot repeat one, and a fake `ci-complete`/`needs:` inside an earlier job's multi-line quoted scalar must not stand in for the real gate), a column-0 line after `jobs:`, an unrecognised 2-space line in `jobs:`, a non-bare needs entry, zero jobs,
no `ci-complete`, no `needs`, a `needs` value not in single-line flow form (block list or a bare scalar), a `needs`
entry naming no defined job, any job other than `ci-complete` missing from `needs` (each named).

**D4 - wiring.** `package.json`: `check:ci-complete-needs` and `check:ci-complete-needs:selftest`. `.husky/pre-commit`:
add `npm run check:ci-complete-needs` (the check, not the selftest). `ci.yml` `frontend` job: run both, next to
`check:precommit-ci-parity`. The selftest stays CI-only (a choice, not a uniform convention: the hook already runs several selftests; CI-only keeps
the hook diff to one line). Parity is
then satisfied (`check:precommit-ci-parity` must stay green).

**D5 - the red.** Selftest (standalone node script, not jest - jest is vacuous in a worktree, HEL-880): fixtures for
every error path asserting on the reason text (including a column-0 comment between two jobs where the later job is
missing from `needs` -> red naming it; a quoted job key -> red; a quoted needs entry -> red; the real `ci.yml` with a comment listing all five jobs above
the `needs` line and `docker-image` dropped from the real line -> red naming `docker-image`; two job-level `needs:`
lines -> red), plus a case that reads the real `ci.yml`, removes `docker-image` from
`needs` in memory, and asserts that job is named; plus a case that the real file passes. Demonstrate the CLI red too:
copy the real `ci.yml` into a scratch repoRoot with `docker-image` removed from `needs`, run the CLI, capture exit 1
and the message. Mutation check: weaken the missing-job comparison, show the selftest goes red, revert.

**D6 - item 3.** No change to `timeout-minutes: 8`. Query: `gh run list --workflow ci.yml --limit 100`, runs created
after 2026-10-09T05:00Z, `docker-image` job startedAt/completedAt: 78 job rows = 73 success (143-213 s, mean ~180 s,
~2.25x headroom at the max) + 4 failures ending in 8-37 s (pre-HEL-1452 pulls, not timeouts) + 1 in progress. The
premise-validation evidence's "59 runs / max 203 s" was read from a partial output mid-query; these are the final
numbers. The executor re-runs the query at Execution time and records the result in the PR body.

## Risks / Trade-offs

- [Image layout changes in prod on next release] -> equivalence evidence (D2) plus a post-release check in the PR
  body for the driver/owner: "CD deploys and `/health` is 200 on the next tagged revision" (AC3; no release here).
- [Regex parse of YAML] -> fail closed on every unparseable shape; a reformat of `needs` breaks the commit loudly,
  never silently passes.
- [Hook touched (gate chain)] -> checklist below; isolation test per executor procedure before wiring.

## Gate-Chain Implications Checklist

- **What does it execute?** `node scripts/check-ci-complete-needs.mjs`: reads `.github/workflows/ci.yml` and
  prints/exit-codes. No subprocesses, no network, no git.
- **What environment does it inherit, and from where?** The hook's environment (husky via git); it reads no env vars
  and resolves the repo root from its own file location (`import.meta.url`), not cwd or `GIT_*`.
- **Does it write anything outside its own sandbox?** No. It writes nothing at all (stdout/stderr only).
- **Does it behave differently from a linked worktree than from a main checkout?** No: path is derived from the
  script's location, and `ci.yml` is a tracked file present in both.
- **What happens on its first run?** It parses the current `ci.yml`, which already lists all five jobs in `needs`, and
  exits 0. It needs no dependency install (node built-ins only).

## Planner Notes

- Self-approved: D1's non-recursive chown of `/app` in addition to `data` (preserves today's `/app` ownership; the
  ticket's intent is not re-storing the jar). Self-approved: guard as a new script rather than extending the parity
  check (different strictness contract).
- Design-gate r3 clarifications (non-blocking): a trailing `# comment` after `needs: [...]` is allowed (selftest
  case); an empty entry (trailing comma, `[a,,b]`) is an invalid entry and fails. Known gap, stated in the PR body: if
  `frontend` itself is removed from `needs`, the CI run of the guard (in `frontend`) no longer blocks `ci-complete`;
  the pre-commit hook still catches it. Not running the guard inside `ci-complete` keeps the aggregate job unchanged.
- Noted for a follow-up, not fixed here: `check-precommit-ci-parity.mjs:98`'s `parseCiCompleteNeeds` has the same
  comment-first-match fail-open (design-gate round 2 reproduced it); out of this ticket's scope.
- Squash may reject a bare `Dockerfile` in `files-modified.md` (CON-245): declare it as `./Dockerfile` if needed, and
  disclose.
