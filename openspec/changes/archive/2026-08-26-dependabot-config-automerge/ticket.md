# HEL-456: Add Dependabot config with grouped PRs and CI-gated auto-merge for low-risk updates

## Description

There is no `.github/dependabot.yml` today, so dependency updates only surface as security alerts and are applied manually. We want a recurring, low-noise update stream so the tree doesn't drift again, with safe (patch/minor) updates auto-merging on green CI and majors held for human review.

## Scope

- Add `.github/dependabot.yml` with three `package-ecosystem` entries: `npm` rooted at `/` (root manifest), `npm` rooted at `/frontend`, and `github-actions` rooted at `/`. Add a `gradle`/`sbt`-equivalent ecosystem for backend only if Dependabot supports the project's build tool; otherwise note backend is covered by the CI CVE gate ticket instead and document that gap.
- Use weekly schedules and `groups` to collapse related updates (e.g. a `dev-dependencies` group, a `react` group) into single PRs to reduce churn.
- Add a GitHub Actions workflow (or reuse an existing one) that auto-merges Dependabot PRs when: update type is patch or minor AND all required CI checks pass. Gate on `dependabot/fetch-metadata` `update-type`; never auto-merge `version-update:semver-major`.
- Ensure `ci.yml` `paths-ignore` does not exclude the Dependabot-touched manifests/lockfiles from triggering CI.

## Acceptance criteria

- `dependabot.yml` present and valid (GitHub shows the ecosystems as active under Insights > Dependency graph > Dependabot).
- A test/patch Dependabot PR auto-merges only after CI passes; a synthetic major update PR does NOT auto-merge and is labeled for review.
- Grouped PRs land as a single PR per group, not one-per-package.

## Out of scope

- Remediating the current 5 alerts (separate ticket, HEL-452, already shipped).
- The fail-on-new-CVE CI gate (separate ticket, HEL-459).

## Dependencies

Best sequenced after the alert-remediation ticket so the initial Dependabot run opens against a clean baseline. HEL-452 merged tonight (18e00ba5) — dependency satisfied.

## Orchestration notes (not part of ticket; carried from human brief)

- No branch protection exists on this repo. `gh pr merge --auto` merges immediately without waiting on checks. Any auto-merge mechanism delivered here MUST have a real CI-gating precondition (branch protection / required status checks) or the auto-merge portion must be scoped out with that reason recorded.
- Enabling branch protection is an infra/repo-configuration change — escalate, do not do unilaterally.
- GitHub Dependabot has no native sbt/Scala ecosystem support (to be verified against current GitHub docs during Planning). If confirmed, scope this ticket to npm (root + frontend) + github-actions only, and document that backend drift detection is HEL-459's responsibility.
