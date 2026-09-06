## 1. Implementation

### Tooling

- [x] 1.1 In `scripts/check-no-credential-in-agent-surface.selftest.mjs`, read a test-only forced-skip environment
      hook near the existing `isRoot`/`skip` machinery (:140-146) and register one synthetic skipped case when it
      is set; the hook may only add a skipped case, never clear or suppress one (design.md Decision 4).
- [x] 1.2 Replace the terminal `skippedCases.length > 0` branch (:1061-1069) so it exits non-zero when `CI` is
      non-empty, and exits 0 otherwise; both paths name every skipped case (design.md Decisions 2 and 3).
- [x] 1.3 Drop the hardcoded "running as euid 0" wording from that message, since the branch is no longer keyed
      on `isRoot` and each skip already carries its own reason string.
- [x] 1.4 Add an explanatory comment at the new branch naming HEL-996 and why a CI skip is fatal, in the
      established house style of the HEL-913/HEL-846 comments in `.github/workflows/ci.yml`.

### CI

- [x] 1.5 Add `- run: npm run check:openspec:selftest` to the `frontend` job in `.github/workflows/ci.yml`,
      alongside the existing self-test steps, with an explanatory HEL-996 comment naming why CI and not
      `.husky/pre-commit` (design.md Decision 5).
- [x] 1.6 Leave `.husky/pre-commit`, `package.json` and `tsconfig.json` untouched; escalate rather than edit
      `package.json` or `tsconfig.json` if either becomes necessary (concurrent HEL-997).

## 2. Tests

- [x] 2.1 Add a self-test case that spawns the self-test as a subprocess with the forced-skip hook set and `CI`
      set, asserting a non-zero exit, that the output names the synthetic skipped case, **and** that the output
      carries a distinctive token from the new fatal message (skeptic-design-1 note 2 — so the case is
      self-evidently sound without reconstructing the 2.1/2.2 differential).
- [x] 2.2 Add the paired case with the forced-skip hook set and `CI` cleared in the child environment, asserting
      exit 0 and that the output still names the skipped case.
- [x] 2.3 Ensure the forced-skip hook doubles as the recursion guard so the spawned children do not re-run 2.1/2.2.
- [x] 2.3a Place both probe cases at the END of the `try` block, after every other case has cleaned up: the child
      re-plants the same fixed-path fixtures in the same worktree, so its `finally` would delete them under the
      parent if interleaved (skeptic-design-1 note 1). If a lingering plant makes that placement impossible, say
      so explicitly rather than interleaving.
- [x] 2.4 Mutation-verify both new cases locally: invert the CI-fatal condition and confirm 2.1 goes red; suppress
      the skipped-case naming and confirm the output assertion goes red. Revert each mutation.
- [x] 2.5 Run `npm run check:no-credential-leak`, `npm run check:no-credential-leak:selftest`,
      `npm run check:openspec`, `npm run check:openspec:selftest`, `npm run lint`, `npm run typecheck` and
      `npm run format:check` and record the transcripts.
- [x] 2.6 Do NOT start a backend dev server, run a backend spec, or open any database connection (HEL-974 holds
      the shared dev Postgres with an in-flight V100).

## 3. Delivery verification

- [ ] 3.1 After the PR is open, push one mutation that breaks a check in the shipped gate script and confirm the
      **CI** job goes red; capture the failing run URL (AC3 — local pre-commit red does not satisfy this).
- [ ] 3.2 Revert the mutation, confirm CI returns green, and record the failing run URL in the PR description.
