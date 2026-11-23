## Why

`.github/workflows/dependabot-auto-merge.yml` aborts on every run: its author check compares `gh pr view`'s
`author.login` (`app/dependabot`) to `dependabot[bot]` (run 44990891169), so Dependabot PRs pile up unmerged (HEL-1820).
The owner ruled (escalation `HEL-1825-1795470843652-cbd96f`, answer `merge-after-ci-complete`) that the workflow should
keep merging patch/minor updates itself after CI succeeds, without `--auto`.

## What Changes

- Author check reads the identity GitHub actually provides: the REST `pulls/<n>` `user.login == "dependabot[bot]"` and
  `user.type == "Bot"`, plus `github.event.workflow_run.actor.login == "dependabot[bot]"` (job-level `if:` and in-script).
- PR head SHA, base ref and labels come from the same REST response (`gh pr view` dropped).
- Merge adds `--match-head-commit "$HEAD_SHA"`, so only the exact CI'd commit can merge. Still never `--auto`.
- Corrects the stale "no branch protection" comment (the `main - no delete` ruleset requires `ci-complete`, non-strict).
- A behavioural selftest runs the workflow's real `run:` blocks against recorded payloads with a stub `gh`, wired into
  the CI `frontend` job.

## Capabilities

### New Capabilities

- `dependabot-auto-merge`: which Dependabot PRs the auto-merge workflow merges, labels or ignores, and how.

### Modified Capabilities

(none)

## Non-goals

- No change to the merge policy itself (patch/minor merge after CI success, major label-only) beyond the owner ruling.
- No live Dependabot PR is created, merged or re-triggered; whether `GITHUB_TOKEN` may merge from a Dependabot-triggered
  `workflow_run` stays untested until a real run.
- No ruleset change (strict status checks), no post-merge CI trigger for these merges.
- No change to `dependabot-metadata.yml` or `dependabot.yml`.

## Impact

`.github/workflows/dependabot-auto-merge.yml`, a new `scripts/check-dependabot-auto-merge.selftest.mjs`, `package.json`
(one script), `.github/workflows/ci.yml` (one step in `frontend`). No app code, no migration, no `.husky/**` change.
