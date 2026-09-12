## 1. Verify premise on main

- [x] 1.1 Run `check:repo-integrity`, `check:scala-quality`, `check:schemas`, `check:spec-structure` on current
      main and confirm all four exit 0 (already confirmed at Setup — 8fc7face, all four clean); re-verify at the
      branch point and record output in the PR description.

## 2. Backend/CI wiring

- [x] 2.1 Add `check:repo-integrity`, `check:scala-quality`, `check:schemas`, `check:spec-structure` as `run:`
      steps in `.github/workflows/ci.yml`'s `frontend` job, placed after the existing `check:openspec`/
      `check:openspec:selftest` steps; verify by pushing and confirming all four steps appear and pass in the
      Actions run.
- [x] 2.2 Confirm no new entry is needed in `ci-complete`'s `needs: [frontend, backend, security, e2e]` — the
      `frontend` job is already a dependency; verify by inspecting the rendered `ci-complete` job conditions
      after the change.

## 3. Drift guard

- [x] 3.1 Write `scripts/check-precommit-ci-parity.mjs`: parse `.husky/pre-commit`'s script lines in BOTH forms
      (`npm run <script>` and the bare npm alias forms `npm test`/`npm start`), resolve each script name
      generically via the repo's own `package.json` `scripts` entry (not a hand-maintained name→path table), scan
      only `.github/workflows/ci.yml`'s jobs named in `ci-complete`'s `needs:` array (not every workflow file) for
      `npm run`/bare-alias invocations and direct underlying `node <path>` invocations, and fail listing any hook
      script not covered by either form within that scope. Verify by running it locally against the now-updated
      `ci.yml` and confirming exit 0.
- [x] 3.2 Add `check:precommit-ci-parity` npm script and wire it into the `frontend` CI job (after step 2.1's
      additions, so it validates the very lines just added). Verify the step appears and passes in CI.
- [x] 3.3 Write `scripts/check-precommit-ci-parity.selftest.mjs` (or equivalent) that builds a fixture hook
      (including a bare-alias `npm test` line) + fixture `ci.yml`-shaped workflow (including a fixture
      `ci-complete`/`needs:` block and a fixture `package.json`), asserting the guard passes when every fixture
      hook script is covered by the `ci-complete`-scoped set and fails when one isn't. Add
      `check:precommit-ci-parity:selftest` npm script, wire it into the `frontend` CI job next to the guard
      itself. Verify by running the self-test locally: it must exercise both a pass and a fail branch, including
      the bare-alias and indirect-path cases.
- [x] 3.4 Demonstrate mutation-failability manually (not part of the shipped diff): add a throwaway
      `npm run check:does-not-exist-in-ci` line to a scratch copy of `.husky/pre-commit`, run
      `check:precommit-ci-parity` against it, confirm it reports the gap and exits non-zero, then discard the
      scratch change. Record the before/after output in the PR description as evidence.

## 4. Tests

- [x] 4.1 Run the full local check suite (`npm run check:precommit-ci-parity`,
      `npm run check:precommit-ci-parity:selftest`, all four re-verified checks) and confirm all exit 0 on the
      final worktree state.
- [ ] 4.2 Push and confirm the full `ci-complete` gate is green on the PR, including the four newly-wired checks
      and the new drift guard + its self-test. (Not verifiable from the executor's local worktree — deferred to
      the PR's CI run.)
