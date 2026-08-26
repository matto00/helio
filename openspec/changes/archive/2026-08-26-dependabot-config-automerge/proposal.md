## Why

There is no `.github/dependabot.yml` today; dependency updates only surface as
manual security alerts. HEL-452 shipped tonight but confirmed the pattern
recurs (97 historical alerts, all npm) and that Dependabot has never covered
`backend/build.sbt`. We want a recurring, low-noise update stream with
safe (patch/minor) auto-merge on green CI, majors held for review.

## What Changes

- Add `.github/dependabot.yml`: `npm` at `/` (root), `npm` at `/frontend`,
  `github-actions` at `/`, and `sbt` at `/backend` — **corrected from the
  ticket's premise**: GitHub Dependabot *does* support an `sbt`
  package-ecosystem (version updates only; **not** security updates for sbt —
  confirmed against GitHub's current supported-ecosystems docs). This closes
  the backend *version-drift* gap; CVE/security-alert coverage for backend
  remains HEL-459's responsibility, since Dependabot's own table marks
  security updates "Not supported" for sbt.
- Weekly schedule per ecosystem; `groups` collapse related updates
  (`dev-dependencies`, `react`) into one PR per group instead of one-per-package.
- New `.github/workflows/dependabot-auto-merge.yml`: merges a Dependabot PR
  only after this repo's own `CI` workflow has completed successfully
  *against that PR's current head commit*, and only when
  `dependabot/fetch-metadata`'s `update-type` is patch or minor. This repo
  has no branch protection / required status checks, so the native
  `gh pr merge --auto` (or GitHub's auto-merge toggle) cannot be used —
  neither waits for anything without a required-checks list, and would merge
  immediately regardless of CI state. Instead the workflow is triggered
  `on: workflow_run` for the `CI` workflow's completion and re-validates the
  PR's head SHA before merging (design.md Decision 1) — this delivers the
  ticket's actual "CI-gated auto-merge" requirement without needing branch
  protection at all. Enabling branch protection itself remains a separate,
  broader repo-configuration decision (design.md Decision 3) — deferred as
  an independent improvement, not because it's required to satisfy this
  ticket's acceptance criteria.
- `ci.yml`'s `paths-ignore` already does not exclude any Dependabot-touched
  manifest/lockfile/workflow path — confirmed, no change needed (see
  premise-validation evidence).

## Capabilities

### New Capabilities
(none — pure CI/tooling configuration, no application-level spec behavior)

### Modified Capabilities
(none)

This change sets `skip_specs: true` — it changes only repo/CI configuration,
not application request/response behavior covered by `openspec/specs/`.

## Impact

- `.github/dependabot.yml` (new)
- `.github/workflows/dependabot-auto-merge.yml` (new)
- No application code, schema, or API changes.
- Depends on: HEL-452 (merged, clean baseline). Blocks/informs: HEL-459 (CI
  CVE gate — backend security-update coverage).

## Non-goals

- Remediating the current 5 backend alerts (HEL-452, done).
- The fail-on-new-CVE CI gate (HEL-459).
- Enabling GitHub branch protection / required status checks — a broader
  repo-config improvement (would also gate every human PR, not just
  Dependabot's), deferred as independent scope, not required to deliver
  this ticket's CI-gated auto-merge (see design.md Decision 3).
