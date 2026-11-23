## ADDED Requirements

### Requirement: Dependabot authenticity is read from GitHub's own identity fields

The auto-merge workflow SHALL treat a pull request as Dependabot's only when the REST pull request's `user.login` is
exactly `dependabot[bot]`, its `user.type` is `Bot`, and the triggering CI run's `workflow_run.actor.login` is exactly
`dependabot[bot]`. It SHALL NOT compare against `gh`'s display form of the author (such as `app/dependabot`).

#### Scenario: A genuine Dependabot pull request passes the author check

- **WHEN** CI succeeds for a pull request whose REST `user` is `{login: "dependabot[bot]", type: "Bot"}` and whose CI
  run's actor is `dependabot[bot]`
- **THEN** the author check passes

#### Scenario: A commit pushed by someone else is not merged

- **WHEN** the pull request was opened by Dependabot but the CI run's actor is a different account
- **THEN** the workflow aborts without merging or labelling

#### Scenario: A non-bot account named like Dependabot is not merged

- **WHEN** the REST `user.login` is `dependabot[bot]` but `user.type` is not `Bot`
- **THEN** the workflow aborts without merging or labelling

### Requirement: Patch and minor updates merge only the exact commit CI passed

After the `CI` workflow run concludes `success` for a `pull_request` event, the workflow SHALL squash-merge a verified
Dependabot pull request against `main` labelled `dependabot-semver-patch` or `dependabot-semver-minor` with
`--match-head-commit` set to the CI run's head SHA, and SHALL never use `--auto`. It SHALL abort without merging when no
open pull request matches, the pull request's head SHA differs from the CI run's, the base is not `main`, or no
`dependabot-semver-*` label is present.

#### Scenario: A patch update merges with the head-commit guard

- **WHEN** a verified Dependabot pull request against `main` labelled `dependabot-semver-patch` has CI succeed at its
  current head SHA
- **THEN** the workflow runs `gh pr merge` with `--squash`, `--match-head-commit <that SHA>` and `--delete-branch`, and
  without `--auto`

#### Scenario: A stale CI run does not merge

- **WHEN** the pull request's head SHA no longer matches the CI run's head SHA
- **THEN** the workflow aborts without merging

### Requirement: Major updates are labelled, never merged

The workflow SHALL add the `major-update` label to a verified Dependabot pull request labelled `dependabot-semver-major`
and SHALL NOT merge it.

#### Scenario: A major update is only labelled

- **WHEN** a verified Dependabot pull request labelled `dependabot-semver-major` has CI succeed
- **THEN** the workflow adds `major-update` and runs no `gh pr merge`
