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

## 4. Delivery-time amendment (coordinator ruling: install-in-ci)

- [ ] 4.0 FIRST, as its own commit before any re-archive: commit the un-archive reset — the change-dir
      restoration out of `openspec/changes/archive/` AND both `openspec/specs/**` files reset to their
      pre-archive state. Verify with `git diff main -- openspec/specs/` returning empty AND
      `git grep -n "self-test is enforced in continuous integration" HEAD -- openspec/specs/` returning no
      hits, so canonical specs cannot end up carrying both the old and the renamed requirement
      (skeptic-design-2 CR2).
- [ ] 4.1 Add a `--print-expected` flag to `scripts/check-openspec-version.mjs` that prints the `EXPECTED`
      constant to STDOUT ONLY — one line, bare version, no banner or prefix — and exits 0, leaving the default
      no-argument behaviour untouched (design.md Decision 6).
- [ ] 4.2 In `.github/workflows/ci.yml`'s `frontend` job, install openspec before the openspec checks, using a
      FAILABLE substitution — `V="$(node scripts/check-openspec-version.mjs --print-expected)"` then
      `[ -n "$V" ] || exit 1` then `npm i -g "@fission-ai/openspec@$V"`. Do NOT inline `$(...)` directly in the
      npm argument: `set -e` does not fire for a failing substitution in argument position, so an empty print
      would install `latest` and stay green (skeptic-design-2 CR1a). Do NOT hardcode the version a second time.
- [ ] 4.2a Add `- run: npm run check:openspec-version` immediately AFTER the install step and BEFORE the openspec
      checks — a runtime assertion that the CLI actually on the runner's PATH equals `EXPECTED`, closing the
      empty-print/wrong-print/stale-cache/registry-redirect variants that 4.2 alone cannot (CR1b).
- [ ] 4.3 Wire BOTH `- run: npm run check:openspec` (the gate) and `- run: npm run check:openspec:selftest`,
      replacing the self-test-only step from task 1.5, with a comment recording that the CLI's absence — not an
      oversight — is why these were pre-commit-only (AC4's "why this one differed").
- [ ] 4.4 Assert that `--print-expected` prints exactly the version `check:openspec-version` enforces, on stdout
      only. Note this is an authoring-time content check and is NOT the guard for a failed runtime invocation —
      4.2 and 4.2a are (skeptic-design-2 CR1).
- [ ] 4.5 Re-verify `npm run check:openspec-version` still passes with no arguments, unchanged.
- [ ] 4.6 Confirm in CI that the install step, `check:openspec-version`, and both openspec checks pass on the
      runner.
- [ ] 4.7 Add a short comment at the `ci.yml` install step pointing at `scripts/check-openspec-version.mjs`'s
      header ("detection, not a true dependency pin - tracked separately"), so the next reader finds the deferred
      devDependency fix without re-deriving it (skeptic-design-2 non-blocking note 2).
