# HEL-996: check:no-credential-leak:selftest runs only in pre-commit, never in CI

## Description

The gate's own proof runs only on a developer's machine. `check:no-credential-leak` runs in CI; its self-test — the thing that establishes the gate can actually *fail* — historically ran only in the Husky pre-commit chain, which is skippable with `--no-verify` and does not run on anything reaching `main` by another route.

HEL-956 and HEL-993 between them found **seven** defects in this gate, every one of which produced a confident `OK` over unexamined code, and none of which was caught by reading the source — each was found only by a mutation making a self-test case go red. If the self-test is not in CI, a change that quietly breaks the gate reaches `main` with CI fully green.

**AC1 is already delivered and out of scope.** HEL-846 (PR #570, `627fc281`) wired both `check:no-credential-leak` and `check:no-credential-leak:selftest` into `.github/workflows/ci.yml` (lines 54-55). Verified present on the base branch. Do not re-do this.

### Remaining scope — the three parts this change delivers

**1. AC2 — decide and document the euid-0 policy.**
`scripts/check-no-credential-in-agent-surface.selftest.mjs:1061-1069` degrades to `OK WITH SKIPS (N case(s) skipped, running as euid 0)` and **exits 0**, because `chmod 000` does not restrict root, so the permission-denial cases — the ones proving the unreadable-file paths are guarded — cannot execute. That branch passed CI only because `ubuntu-latest` happens to run as a non-root user. It was dodged by luck, not decided: nothing documents the dependency and nothing fails if a runner image changes to run as root.

Owner's stated preference: **a root-detected skip must be a hard failure in CI**, not a silent pass. Implement that unless a concrete reason not to is found, and state the reasoning in `design.md` either way. The design must also decide and justify *how the script detects it is in CI* (e.g. `process.env.CI`), and what the behaviour remains for a developer legitimately running as root locally — a local root run should stay a visible, non-fatal skip, not a hard failure, unless design argues otherwise.

**2. AC3 — prove CI goes red by mutation.**
Push a mutation to this branch, confirm the **CI job** fails, then revert it. Local pre-commit going red does not satisfy this. The failing CI run URL is the evidence and must appear in the PR description.

**3. AC4's remaining gap — wire `check:openspec` AND `check:openspec:selftest` into CI.**
It appears only at `.husky/pre-commit:13` and is absent from `ci.yml` — the same defect. `check:dependabot:selftest` (ci.yml:46) and both `check:node-root-encoding` self-tests (ci.yml:41,43) are already wired; match their pattern, including an explanatory comment in the established house style.

## Acceptance criteria

* A root-detected skip in `check-no-credential-in-agent-surface.selftest.mjs` is a hard failure (non-zero exit) when running in CI, never a silent or `OK WITH SKIPS` pass. The chosen policy and its CI-detection mechanism are documented in `design.md` with reasoning.
* The euid-0 hard-failure path is itself covered by a test/probe, not merely asserted — this ticket's whole subject is gates reporting green over things they did not check, so the new branch must be demonstrably failable.
* `npm run check:openspec:selftest` runs in CI on every PR, wired into `.github/workflows/ci.yml` alongside the existing self-tests with an explanatory comment.
* A mutation pushed to this branch makes the **CI** job go red; the failing CI run URL is recorded in the PR description; the mutation is reverted before the PR is handed over.
* AC4's survey conclusion is recorded: `check:dependabot:selftest` and both `check:node-root-encoding` self-tests were already in CI; `check:openspec:selftest` was not and is fixed here.

## Constraints

* **Do NOT start a backend dev server, run a backend spec, or open any database connection.** HEL-974 holds the shared dev Postgres exclusively with an in-flight `V100` whose body may still change; a boot could apply or conflict with it and poison `flyway_schema_history`.
* HEL-997 is live on root `tsconfig.json`. This change should not need `tsconfig.json` or `package.json` (both npm scripts already exist). If either genuinely becomes necessary, escalate to coordinate rather than editing it.
* Never commit a real credential, including in a fixture.
* No production database or deploy access.
