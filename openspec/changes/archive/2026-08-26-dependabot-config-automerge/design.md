## Context

No `.github/dependabot.yml` exists. `ci.yml` (`name: CI`) runs **three** jobs
on `push`/`pull_request` to `main`: `frontend` (lint/typecheck/format/test),
`backend` (`sbt compile test` on Temurin 21), and `e2e` (Postgres 16 service +
Playwright chromium against a real backend/Vite boot). `paths-ignore` does not
exclude any manifest/lockfile (confirmed — premise-validation evidence).
Gating Decision 1's merge on the whole `CI` workflow's conclusion therefore
means an auto-merge waits on the heavyweight, boot-dependent `e2e` job too —
this is intended fail-closed behavior (a slow-but-passing PR just waits
longer for the workflow_run to complete; it never merges early), not an
oversight. **This repo has no branch protection / required
status checks.** `gh pr merge --auto` (and GitHub's native PR auto-merge
toggle) only *wait* for checks that branch protection has marked "required" —
with none configured, "enable auto-merge" resolves and merges immediately,
regardless of whether CI is still running. A naive implementation of the
ticket's "CI-gated auto-merge" would therefore silently merge before CI
finishes — the opposite of the ask. Enabling branch protection is an
infra/repo-configuration change (per standing escalation policy) and is not
performed by this change.

GitHub Dependabot's currently-documented supported ecosystems (fetched fresh
from `docs.github.com` during Planning, not assumed from the ticket text)
include an `sbt` YAML value with `build.sbt` as a required manifest — the
ticket's assumption that Dependabot has "no native sbt/Scala ecosystem
support" is **out of date**. The same reference table shows **Version
updates: supported** but **Security updates: not supported** for `sbt` — so
adding an `sbt` ecosystem entry gives backend scheduled version-bump PRs, but
does **not** give backend CVE/security-alert coverage. That gap is real and
still belongs to HEL-459's CI CVE gate, per the ticket's own dependencies
section — just narrower than HEL-452's finding suggested.

## Goals / Non-Goals

**Goals:**
- One `.github/dependabot.yml` covering `npm` (root), `npm` (frontend),
  `github-actions` (root), and `sbt` (backend), weekly, grouped.
- A merge workflow where a patch/minor Dependabot PR only merges after this
  repo's own CI has actually run and passed against that PR's current head
  commit — genuine gating, not a race with in-flight checks.
- A major-version Dependabot PR never auto-merges and is labeled for review.

**Non-Goals:**
- Enabling branch protection / required status checks (escalated separately,
  not blocking this change — see Decision 3).
- Backend CVE/security-alert coverage (HEL-459; `sbt`'s security-updates
  column is "Not supported" regardless of what this change does).
- Remediating any current alerts (HEL-452, done).

## Decisions

**Decision 1 — `workflow_run`-triggered merge instead of native `--auto` merge.**
Rather than `gh pr merge --auto` (or the GitHub auto-merge toggle), the new
`dependabot-auto-merge.yml` workflow triggers `on: workflow_run` for the `CI`
workflow, `types: [completed]`. On `conclusion == 'success'`, it:
1. Resolves the PR associated with that `workflow_run` (`gh pr list --search
   "sha:<head_sha>"` or the `workflow_run.pull_requests` context) via `gh pr
   view` and verifies **all three**: the PR's live head SHA still matches
   `github.event.workflow_run.head_sha` (guards a force-push landing between
   CI starting and this workflow firing — the same race the "wait for
   checks" feature is meant to close, reproduced by hand since no branch
   protection exists), the PR's `user.login == 'dependabot[bot]'`, and
   `baseRefName == 'main'`, read from that same `gh pr view` call — this is
   the authoritative actor check; a raw `github.actor`/`triggering_actor`
   comparison is not used, since either can read as a human on a manually
   re-run CI job.
2. Reads the `update-type` signal off a `dependabot-semver-{patch,minor,major}`
   label on the resolved PR (see **Decision 1a** below for why this is a
   label read, not a direct `dependabot/fetch-metadata@v3` call).
3. If the label is `dependabot-semver-patch` or `dependabot-semver-minor`:
   `gh pr merge --squash "$PR" --delete-branch` directly (not `--auto`) — the
   merge only runs after step 1 confirms this exact commit's CI already
   succeeded, so there is nothing left to wait for.
4. If the label is `dependabot-semver-major`: apply the `major-update` label
   (created if absent — GitHub's REST docs say label creation accepts
   *either* `Issues (write)` or `Pull requests (write)`; the workflow's
   `permissions:` block grants both `issues: write` and `pull-requests:
   write`, alongside `contents: write` for the merge path, for
   safety/clarity rather than because either alone is insufficient) and
   take no merge action — left for human review, satisfying "never
   auto-merge major" without relying on any branch-protection feature.

**Decision 1a — `fetch-metadata` runs in a companion `pull_request`-triggered
workflow, not inline in the `workflow_run` job (corrected in Delivery
cycle 2, skeptic-final-1.md).** The original design (and evaluation-1.md)
assumed `dependabot/fetch-metadata@v3` accepts a `pr-number` input that
re-targets it under `workflow_run`, where `github.event.pull_request` does
not exist. That input does not exist: the action's real `action.yml`
declares only `alert-lookup`, `compat-lookup`, `github-token`,
`skip-commit-verification`, `skip-verification`, and its compiled
`dist/index.js` resolves the PR solely from
`context.payload.pull_request` — confirmed by fetching the pinned `v3`
tarball and reading both files directly (the skeptic's evidence, reproduced).
Under `workflow_run`, that key is absent, so the step failed on every run
and `update-type` was never set — the whole merge/label logic downstream was
dead code.

The preferred fix considered was deriving `update-type` from the Dependabot
commit-message trailer inside the existing `resolve` step (parsing
`update-type: version-update:semver-*` out of `updated-dependencies:`). That
was checked against this repo's own real Dependabot commit history before
being adopted — `git log --author=dependabot -p`, 8 real commits — and ruled
out: **every one of them is a grouped-PR commit (per Decision 2's grouping),
and none of them carries an `update-type` key at all**; the
`updated-dependencies:` trailer on a grouped commit only has
`dependency-name`/`dependency-version`/`dependency-type`/`dependency-group`
per entry. `update-type` is not present as an explicit key in the commit
message for a grouped update — the one config shape this change actually
uses everywhere.

That said, an inline parse was not strictly *impossible*: `fetch-metadata`
itself (`src/dependabot/update_metadata.ts`, tag `v3`) derives `update-type`
entirely locally, with no GitHub API call — it string-diffs the versions out
of the ``Updates `x` from A to B`` lines / `dependency-version:` trailer via
`calculateUpdateType`, the same commit-message data this repo's real
Dependabot commits do carry. So a hand-rolled inline parse of the same
lines/trailer could, in principle, reproduce that logic. The rejection is an
engineering-tradeoff call, not an impossibility: reusing `fetch-metadata`'s
maintained, tested semver-diff logic is preferable to reimplementing that
version-comparison heuristic by hand and keeping it in sync with the
action's behavior over time. Since `fetch-metadata` genuinely cannot run
under `workflow_run` (see above), the two-workflow split lets this change
keep using the action's real output rather than a hand-rolled duplicate.

Instead, a second workflow, `dependabot-metadata.yml`, triggers `on:
pull_request` (`opened`/`synchronize`/`reopened`), where
`context.payload.pull_request` is genuinely present — `fetch-metadata` works
correctly there. Its job is gated `if: github.actor == 'dependabot[bot]'`
(skips, does not fail, for every human PR — the same event fires for those
too). It reads `update-type` from the action's real output and records it as
one of three labels (`dependabot-semver-patch`/`-minor`/`-major`), removing
any stale label of the same family first (a `synchronize` re-run, e.g. a
Dependabot rebase, can change the highest semver in a grouped PR).
`dependabot-auto-merge.yml`'s `resolve` step reads that label back — it does
not treat the *label's existence* as an authenticity signal (the `resolve`
step's own `author.login`/`baseRefName`/head-SHA checks, run against a fresh
`gh pr view`, are what fetch-metadata's `skip-verification`/checks were
approximating), only as the semver-classification payload. If the label
hasn't been applied yet when the merge workflow runs (e.g. an unusually slow
`pull_request` job racing an unusually fast `CI` completion), the `resolve`
step aborts cleanly (`exit 0`) rather than merging on missing information;
the next `workflow_run` for that PR (there will be another, since Dependabot
PRs typically get re-synced) retries it. This is a deliberate accepted small
race, not a correctness gap — the merge is a false negative (delay), never a
false positive (an unverified merge).

**Grouping interaction.** Decision 2 groups several bumps into one PR per
group. `update-type` is documented upstream as the PR's *highest* semver
change, so a group containing any major bump reports `major` and is
correctly excluded from step 3 — the major/minor split above is unaffected by
grouping.

This is why this change needs no branch-protection escalation to satisfy the
ticket's "CI-gated" requirement: the gate is enforced by this workflow's own
trigger condition (a workflow_run of the right conclusion, against the right
commit), not by asking GitHub's merge API to wait on our behalf.

**Decision 2 — groups.** `dependency-type: development` is a real distinction
only for the two `npm` entries (root, `/frontend`); `github-actions` and
`sbt` have no dev/production dependency-type split, so a
`dependency-type: development`-keyed group on those two would match nothing
and silently degrade them to one-PR-per-package, defeating the "grouped PRs,
not one-per-package" acceptance criterion. Concretely:
- `npm` (root) and `npm` (`/frontend`): a `dev-dependencies` group keyed on
  `dependency-type: development`; `/frontend` additionally gets a `react`
  group (patterns: `react`, `react-dom`, `@types/react*`) per the ticket's
  explicit example.
- `github-actions` (root) and `sbt` (`/backend`): a single catch-all group
  (`patterns: ["*"]`) instead — every update for that ecosystem collapses
  into one PR, since neither has a dev/production split to group by.

**Decision 3 — branch protection: escalate, do not enable.** Recorded here so
a future ticket (or a follow-up filed at Delivery) has the reasoning: enabling
required status checks would let this repo additionally use GitHub's native
`--auto` merge/auto-merge toggle for *all* PRs, not just Dependabot's, which
is a broader repo-configuration change with implications (e.g. every human PR
would then also be blocked from merging until CI passes) beyond this ticket's
scope. Decision 1's `workflow_run` approach achieves this ticket's specific
acceptance criteria without that broader change, so it is deferred rather than
blocking.

## Risks / Trade-offs

- `workflow_run` triggers execute with the **base** branch's workflow file,
  not the PR's — this is a deliberate GitHub Actions security property (a PR
  cannot smuggle in a modified merge workflow to auto-merge itself), and is
  exactly why this pattern is a recommended alternative to giving `pull_request_target`
  merge permissions to fork PRs. Dependabot PRs are same-repo (not forks), so
  this is a non-issue in practice here, but the property holds either way.
- If the `CI` workflow name in `ci.yml` (`name: CI`) is ever renamed, the
  `workflows: ["CI"]` filter in the merge workflow must be updated in the same
  commit — flagged in tasks.md as a verification step, not silently assumed.
- `dependabot/fetch-metadata@v3` is pinned to a major-version tag per common
  Actions practice in this repo's other workflows (verify against
  `cd-backend.yml`/`cd-frontend.yml` convention during execution). It now
  runs in `dependabot-metadata.yml` (see Decision 1a), not inline in the
  merge workflow.
- Decision 1a's label handoff between the two workflows is an accepted small
  race (see Decision 1a) — a merge can be delayed a run but never falsely
  triggered on missing information.
- This workflow does not itself run tests — it trusts the referenced `CI`
  workflow_run's conclusion. If `CI` is later split into multiple workflows,
  this merge gate would need to check all of them, not just one; out of scope
  to anticipate now.
