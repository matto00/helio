## ADDED Requirements

### Requirement: The frontend SHALL expose a type-check script

`frontend/package.json` SHALL define a `typecheck` script that runs `tsc --noEmit` against the frontend TypeScript
project, and the repo-root `package.json` SHALL define a `typecheck` script that delegates to it, so the gate is
invoked the same way `lint` and `format:check` are. The script name SHALL match the existing `helio-mcp/package.json`
`typecheck` script rather than introducing a second vocabulary.

#### Scenario: Frontend typecheck script runs the type checker

- **WHEN** `npm run typecheck` is run in `frontend/`
- **THEN** it SHALL invoke `tsc --noEmit` and exit 0 on a type-clean tree

#### Scenario: Root passthrough delegates to the frontend script

- **WHEN** `npm run typecheck` is run at the repo root
- **THEN** it SHALL run the frontend `typecheck` script and propagate its exit code

### Requirement: The type-check gate SHALL be wired into pre-commit and CI

`.husky/pre-commit` SHALL run the type-check gate alongside its existing `lint` and `format:check` steps, and the CI
frontend job in `.github/workflows/ci.yml` SHALL run it alongside its existing `npm run lint` and `npm run
format:check` steps. A non-zero exit from the type checker SHALL abort the commit. The CI step SHALL be placed such
that its failure fails the job: it SHALL live under `jobs.frontend` (never `jobs.backend`), and neither the step nor
its job SHALL set `continue-on-error` or otherwise swallow the exit code.

#### Scenario: Pre-commit aborts on a type error

- **WHEN** `.husky/pre-commit` is executed against a tree containing a type error
- **THEN** it SHALL exit non-zero and abort the commit

#### Scenario: CI wiring is mechanically asserted, not eyeballed

- **WHEN** `.github/workflows/ci.yml` is parsed after the edit
- **THEN** it SHALL still parse as YAML, a step whose `run` is exactly `npm run typecheck` SHALL exist under
  `jobs.frontend.steps`, no such step SHALL exist under `jobs.backend`, and neither that step nor the `frontend` job
  SHALL set `continue-on-error` or contain `|| true`

#### Scenario: The CI step is confirmed to have executed

- **WHEN** the pull request has run CI, during the Delivery phase (CI triggers only on `pull_request`, so this is a
  durable orchestrator obligation recorded in `workflow-state.md`, not an Execution-phase task)
- **THEN** the frontend job's run log SHALL show the `npm run typecheck` step executing, and the result SHALL be
  appended to the PR body — by editing it after CI completes, since the body is created before CI has run

### Requirement: The gate SHALL be demonstrated to fail on a real type error

The gate SHALL be verified red-before-green by direct observation for every leg where observation is possible: a
deliberate type error is introduced into a tracked frontend source file, the script and pre-commit legs are run and
observed to exit non-zero, the error is reverted, and both are re-run and observed to exit zero. A passing run alone
SHALL NOT be accepted as evidence that the gate works. The probe SHALL live in a module no test imports, so the
failure is attributable to the type-check gate rather than to `ts-jest`, which already type-checks test-reachable
modules. CI *redness* SHALL be described as inferred — from the mechanical assertions above plus the observed local
red of the identical command — and SHALL NOT be reported as observed. The deliberate error SHALL NOT survive into any
commit.

#### Scenario: Gate goes red on an introduced type error

- **WHEN** a deliberate type error is present in a tracked, non-test-imported module under `frontend/src`
- **THEN** `npm run typecheck` SHALL exit non-zero with an `error TS…` line, and the pre-commit hook SHALL abort

#### Scenario: Gate returns green once the error is removed

- **WHEN** the deliberate type error is reverted, while the change is still in-progress
- **THEN** `npm run typecheck` SHALL exit 0 and the pre-commit hook SHALL complete

#### Scenario: The probe leaves no residue

- **WHEN** the red-before-green demonstration is complete
- **THEN** `git status` SHALL show no trace of the deliberate error, and the committed diff SHALL contain none

### Requirement: The gate SHALL cover the frontend TypeScript surface it claims to cover

`frontend/tsconfig.json`'s `include` SHALL name only paths that exist, and SHALL cover the frontend's tracked
TypeScript outside `src` — `vite.config.ts` and `pwa-assets.config.ts` — so the gate's real scope matches its
advertised scope. It SHALL NOT list a non-existent path.

#### Scenario: No phantom include entry

- **WHEN** `frontend/tsconfig.json` is read
- **THEN** every path in `include` SHALL exist on disk

#### Scenario: Frontend config files are type-checked

- **WHEN** a type error is introduced into `frontend/vite.config.ts`
- **THEN** the type-check gate SHALL report it

### Requirement: Documentation enumerating the enforced gate set SHALL stay accurate

Any tracked document that enumerates the pre-commit hook's commands or the frontend's npm scripts SHALL be updated in
the same change, so no canonical doc understates the enforced gate set.

#### Scenario: CONTRIBUTING.md matches the hook

- **WHEN** CONTRIBUTING.md's Pre-Commit Policy block is compared to `.husky/pre-commit`
- **THEN** it SHALL enumerate the same commands, including the type-check gate

#### Scenario: Command lists include the new script

- **WHEN** the frontend command lists in README.md and CLAUDE.md are read
- **THEN** they SHALL include `npm run typecheck`

#### Scenario: Prose descriptions of the hook are not left understating it

- **WHEN** CLAUDE.md's prose "Pre-commit hooks" section is read
- **THEN** it SHALL NOT enumerate a strict subset of the hook's actual commands

#### Scenario: Remaining enumerations are decided, not assumed away

- **WHEN** the documentation sweep is run
- **THEN** every live hit SHALL carry a recorded update-or-exempt decision, and the sweep SHALL NOT assert that no
  other enumeration exists

### Requirement: The change SHALL be behavior-preserving

No runtime, API, schema, or product behavior SHALL change. Existing tests SHALL pass unmodified, and the production
build SHALL be unaffected, since `include` governs `tsc` only and `vite build` transpiles via esbuild.

#### Scenario: Tests pass unmodified

- **WHEN** the frontend test suite is run after the change
- **THEN** all tests SHALL pass with no test file modified by this change

#### Scenario: Build is unaffected

- **WHEN** `npm run build` is run in `frontend/`
- **THEN** it SHALL succeed as before
