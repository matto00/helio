## Standing Constraints

- [C1] Merge policy is the owner ruling `merge-after-ci-complete`: patch/minor squash-merge after CI success with `--match-head-commit`, never `--auto`; major label only.
- [C3] Selftest: per-scenario `pr view` data (author pinned to `app/dependabot`), assert no unhandled `gh` call and the expected abort line per scenario, mutations built into the selftest.
- [C2] No live Dependabot PR is created, merged, commented on or re-triggered; read-only `gh api` calls only.

### Tests (red first)

- [x] 1.1 Write `scripts/check-dependabot-auto-merge.selftest.mjs` per design Decision 6 (all scenarios + static assertions)
- [x] 1.2 Add `check:dependabot-auto-merge:selftest` to `package.json`
- [x] 1.3 Run it against the UNMODIFIED workflow; save output as `openspec/changes/fix-dependabot-auto-merge-author/red-run.txt`; it must fail on no `pr merge` logged and show `author is 'app/dependabot'`, not a stub error; commit (selftest + script + red-run.txt)

### CI config

- [x] 2.1 Replace `gh pr view` with the REST `pulls/<n>` read (Decision 1) and the three-condition author check (Decision 2)
- [x] 2.2 Add the actor condition to the job `if:` (Decision 3)
- [x] 2.3 Add `--match-head-commit "$HEAD_SHA"` to the merge step (Decision 4)
- [x] 2.4 Correct the stale header and merge-step comments (Decision 5)
- [x] 2.5 Add the selftest step to `ci.yml`'s `frontend` job after `check:cache-cleanup-pr:selftest` (Decision 7)

### Verification

- [x] 3.1 Selftest green on the edited workflow; record output
- [x] 3.2 Mutation runs, each must turn the selftest red (record output): revert author check; drop in-script actor check; drop type check; drop `--match-head-commit`; add `--auto`; remove actor condition from job `if:`; widen merge step `if:` to admit semver-major; drop `conclusion == 'success'` from job `if:`
- [x] 3.3 actionlint (Decision 9) clean on both edited workflows; record output
- [x] 3.4 `npm run check:ci-complete-needs` and `npm run check:precommit-ci-parity` pass
- [ ] 3.5 PR body states the applied policy (patch/minor squash-merge after CI success with `--match-head-commit`, never `--auto`; major label-only) and the risks: no post-merge CI on main, non-strict ruleset lets a behind-main branch merge, GITHUB_TOKEN merge and `--delete-branch` untested until a real Dependabot run
