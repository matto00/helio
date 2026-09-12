## Context

`.github/workflows/ci.yml`'s `ci-complete` job is `if: always()` with `needs: [frontend, backend, security, e2e]` —
adding a check to an existing job in that list is sufficient; no new job needs adding to `needs:` (HEL-913/846/1037/
996 precedent: they extended the `frontend` job rather than adding a fifth). Measured on current main (8fc7face):
all four checks run in well under a second and need no sbt/Scala compilation or network access — mostly
`readFileSync`/`readdirSync` over the tree, though `check-repo-integrity.mjs` and `check-spec-structure.mjs` each
also shell out to a local binary (`git config`, `which`) already present on any `actions/checkout` runner. `check:spec-structure` is the one exception with an environment dependency:
it resolves the `openspec` CLI via `which openspec` and loads its internal modules from wherever that binary lives
(`scripts/check-spec-structure.mjs` lines 20/53/89) — the `frontend` job already installs the exact pinned
`openspec` version (HEL-996) before running `check:openspec`, so placing `check:spec-structure` after that install
step gets it for free with no new toolchain.

## Goals / Non-Goals

**Goals:**
- All four checks gate `ci-complete` via the `frontend` job (cheapest fit: node+npm already present, `openspec`
  CLI already installed there for HEL-996).
- A CI-enforced drift guard so `.husky/pre-commit` and CI can't silently diverge again.

**Non-Goals:**
- No guard for CI checks absent from the hook (proposal's Non-goals) — not a bypass hole.
- No change to `backend`/`security`/`e2e` jobs — none of the four checks need Scala compilation, Postgres, or a
  browser.
- No new Scala/JVM toolchain invocation — `check:scala-quality` is static text scanning, not `sbt`.

## Decisions

1. **Add all four as `run:` steps in the `frontend` job**, immediately after the existing `check:openspec`/
   `check:openspec:selftest` steps (so `check:spec-structure` inherits the pinned `openspec` install already done
   there). Alternative considered: a new dedicated job — rejected, since it would duplicate `actions/checkout` +
   `setup-node` + `npm ci` for zero isolation benefit (none of the four need backend/e2e services) and would
   require adding a fifth entry to `ci-complete`'s `needs:` list, which the existing HEL-913/846/1037/996 precedent
   in this file explicitly did not do for the same reason.

2. **Drift guard: `scripts/check-precommit-ci-parity.mjs`, wired as `check:precommit-ci-parity` + a
   `check:precommit-ci-parity:selftest`**, run only in CI (`frontend` job), never in the hook itself — running it
   from inside `.husky/pre-commit` would let `-n`/`HUSKY=0` bypass the very guard meant to close that bypass,
   exactly the reasoning already given for `check:no-credential-leak`/`check:tokens`/`check:node-root-encoding`
   above it in this same file.
   - **Parse the hook — every invocation form, not just `npm run`.** Read `.husky/pre-commit`, extract every
     non-comment line matching either `npm run <script>` OR the bare npm alias forms `npm test`/`npm start`
     (npm's own built-in shorthand for `npm run <alias>` when `package.json` defines that script key — `npm ci`
     is NOT one of these aliases, it's npm's own clean-install command, unrelated to `package.json` scripts).
     Revision from skeptic round 1: the original `npm run`-only regex silently missed `.husky/pre-commit`'s
     actual `npm test` line (measured: 17 `npm run` lines + this 1 bare-alias line = 18 total) — dropping
     `npm test` from CI would have shipped invisibly to the guard, exactly the class of drift being closed. The
     hook set is the resolved script-name list from both forms.
   - **Resolve every hook script generically, not via a hand-maintained table.** For each script name in the hook
     set, read its command string directly from the repo's own `package.json` `scripts` entry (single source of
     truth — no separate name→path table to fall out of sync). This covers all 18 entries uniformly: `lint`,
     `typecheck`, `check:e2e-types`, `check:helio-mcp-types`, `format:check`, compound `test`
     (`jest && npm --prefix frontend test`), and every `check:*` script alike — not only the `node scripts/*.mjs`
     shape the round-1 table only handled 12 of 18 cases for. Extract every `node <path>` reference the resolved
     command string contains (there may be more than one, e.g. `test`'s compound form) as that script's
     "underlying path" set.
   - **Parse CI, scoped to what actually gates `ci-complete` — not every workflow file.** Read
     `.github/workflows/ci.yml` (not the whole `.github/workflows/*.yml` glob), parse its own `ci-complete` job's
     `needs:` array, and scan only the `run:` blocks of jobs named in that array. Revision from skeptic round 1:
     scanning every workflow file would count a check living solely in a tag-triggered workflow like
     `cd-backend.yml` as "covered" while nothing actually blocks a PR merge — the same class of hole this ticket
     exists to close. From each in-scope `run:` block, extract `npm run <script>`/bare-alias invocations (same
     two forms as the hook parse) and any direct `node <path>` invocations, matched against each hook script's
     resolved underlying-path set from the previous step.
   - **Compare**: any hook script name not found by either name-match or underlying-path-match within the
     `ci-complete`-scoped CI set is reported as a failure, with the hook's full script list and the resolved
     CI-covered list both printed for a human to read directly off the guard's own output. Exit non-zero on any
     gap.
   - **Exclusions**: `selftest:concertino-git-env` is already deliberately excluded from the hook itself (see the
     hook's own trailing comment) — the guard parses the hook's actual content, so it naturally never sees this
     script and needs no separate allowlist entry for it.
   - **Self-test** (`check:precommit-ci-parity:selftest`): constructs fixture hook + fixture `ci.yml`-shaped
     workflow content (including a fixture `ci-complete`/`needs:` block, a `package.json` scripts fixture, and at
     least one bare-alias (`npm test`) case and one indirect-path-invocation case), asserting the guard passes
     when covered and fails when a script is present in the hook but absent from the `ci-complete`-scoped set —
     this is what makes the guard's own mutation-failability provable in CI on every run, not just once manually.

3. **Manual failability demonstration (ticket requirement, not part of the shipped diff)**: during Execution,
   add a throwaway `npm run check:does-not-exist-in-ci` line to a scratch copy of `.husky/pre-commit`, run the new
   guard locally, confirm it fails with that script named, then revert — captured as evidence in the PR
   description / evaluator report, never landing in the final squashed commit (`.husky/pre-commit`'s real content
   is unchanged by this ticket).

## Risks / Trade-offs

- [Risk] A future hook script is added that legitimately should stay hook-only (e.g. something environment-bound
  like `selftest:concertino-git-env` already is) → guard false-positives. Mitigation: the guard reads the hook
  file's literal content, so such a script simply stays out of `.husky/pre-commit`'s `npm run` list (as
  `selftest:concertino-git-env` already does today, per its own comment) rather than needing a guard-side
  allowlist.
- [Risk] `check:spec-structure` depends on `openspec` CLI install ordering within the `frontend` job → placing it
  after the existing `check:openspec` steps, not before, avoids a race. Mitigation: explicit step ordering,
  verified by re-running the job.
- [Trade-off] Extending the `frontend` job (vs. a new job) couples these checks' pass/fail to that job's existing
  steps failing fast on unrelated lint/typecheck errors earlier in the same job — acceptable since `ci-complete`
  already treats the whole job as one unit, and these are independent shell steps that don't share failure state
  with each other.

## Planner Notes

- Self-approved: reusing the `frontend` job rather than adding a new job, consistent with the four cited
  precedents already living in the same file.
- Self-approved: `skip_specs: true` on `.openspec.yaml` — this ticket changes CI/tooling wiring only, no
  API/schema/frontend-Redux/backend-route behavior contract changes.
