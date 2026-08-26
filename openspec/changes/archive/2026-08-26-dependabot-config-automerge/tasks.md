## 1. Dependabot config

- [x] 1.1 Add `.github/dependabot.yml`: `version: 2`, four `updates` entries —
      `npm` at `/`, `npm` at `/frontend`, `github-actions` at `/`, `sbt` at
      `/backend`. Weekly schedule on all four.
- [x] 1.2 Groups per design.md Decision 2 (corrected): `npm` (root) and `npm`
      (`/frontend`) each get a `dev-dependencies` group keyed on
      `dependency-type: development`; `/frontend` additionally gets a `react`
      group (patterns `react`, `react-dom`, `@types/react*`). `github-actions`
      (root) and `sbt` (`/backend`) each instead get a single catch-all group
      (`patterns: ["*"]`) — `dependency-type: development` does not exist for
      either ecosystem and would silently degrade them to one-PR-per-package.
- [x] 1.3 Set `open-pull-requests-limit` to a sane bound (e.g. 10) per entry so
      a first run against a long-untouched tree doesn't flood.
- [x] 1.4 `labels: ["dependencies"]` per entry, for later filtering.

## 2. Auto-merge workflow

- [x] 2.1 Add `.github/workflows/dependabot-auto-merge.yml` implementing
      design.md Decision 1: `on: workflow_run` for the `CI` workflow,
      `types: [completed]`; guard `conclusion == 'success'` and
      `event == 'pull_request'`.
- [x] 2.2 Resolve the PR from the `workflow_run` context via `gh pr view`
      (e.g. `gh pr list --search "sha:<head_sha>"` or the
      `workflow_run.pull_requests` context to get a number, then `gh pr view`
      for full detail). From that single `gh pr view` result, verify **all
      three**: (a) the PR's live head SHA still matches
      `github.event.workflow_run.head_sha` (force-push race guard), (b) the
      PR's `user.login == 'dependabot[bot]'` (the authoritative actor check --
      do NOT use `github.actor`/`triggering_actor`, which can read as a human
      on a manually re-run CI job), (c) `baseRefName == 'main'`. Any failing
      check aborts the workflow with no further action.
- [x] 2.3 **(Corrected, Delivery cycle 2 -- design.md Decision 1a.)** Read
      `update-type` from a `dependabot-semver-{patch,minor,major}` label on
      the resolved PR, applied by the companion
      `.github/workflows/dependabot-metadata.yml` workflow (added below as
      2.3a-2.3c) -- **not** by calling `dependabot/fetch-metadata@v3` inline
      here. That action resolves its target PR exclusively from
      `context.payload.pull_request`, which does not exist under
      `workflow_run`; there is no `pr-number`-style input that redirects it
      (verified against the pinned tag's real `action.yml` and compiled
      `dist/index.js`). If no `dependabot-semver-*` label is present yet,
      abort this run cleanly (`exit 0`) rather than merge on missing
      information.
  - [x] 2.3a Add `.github/workflows/dependabot-metadata.yml`: `on:
        pull_request` (`opened`/`synchronize`/`reopened`); job gated `if:
        github.actor == 'dependabot[bot]'` so it skips (not fails) for every
        human PR.
  - [x] 2.3b In that workflow, run `dependabot/fetch-metadata@v3` (a genuine
        `pull_request` context, so no PR-targeting workaround is needed) and
        map its `update-type` output to one of
        `dependabot-semver-{patch,minor,major}`, creating the label if
        absent and removing any stale label of the same family first (a
        `synchronize` re-run can change the highest semver in a grouped PR).
  - [x] 2.3c Confirmed against this repo's real Dependabot commit history
        (`git log --author=dependabot -p`, 8 commits, all grouped-PR shape)
        that none of them carry an explicit `update-type` key in the
        `updated-dependencies:` trailer for a grouped commit (only
        `dependency-name`/`dependency-version`/`dependency-type`/
        `dependency-group`). `fetch-metadata` itself derives `update-type`
        locally from the same commit-message data (version-diffing the
        `Updates \`x\` from A to B` lines / `dependency-version:` trailer --
        no GitHub API call), so an inline parse was not strictly
        impossible -- but 2.3a/2.3b's two-workflow shape was chosen anyway,
        to reuse the action's maintained, tested semver-diff logic rather
        than reimplement and maintain that version-comparison heuristic by
        hand, per design.md Decision 1a.
- [x] 2.4 Patch/minor branch (label is `dependabot-semver-patch` or
      `dependabot-semver-minor`): `gh pr merge --squash --delete-branch` (not
      `--auto`) -- explain in a workflow comment why `--auto` is not used here
      (no branch protection in this repo; see design.md Decision 1).
- [x] 2.5 Major branch (label is `dependabot-semver-major`): apply/create a
      `major-update` label; take no merge action. Note inline (comment or
      design reference) that `update-type` reports a grouped PR's *highest*
      semver change, so this correctly excludes any group containing a major
      bump even though Decision 2 groups multiple updates per PR.
- [x] 2.6 Set `permissions:` block on `dependabot-auto-merge.yml`:
      `contents: write`, `pull-requests: write` (merge path), AND
      `issues: write` (label create for `major-update` the first time 2.5
      fires). Per GitHub's REST docs, `POST /repos/{owner}/{repo}/labels`
      (Create a label) accepts **either** `Issues (write)` **or**
      `Pull requests (write)` -- both are granted here for safety/clarity,
      not because `pull-requests: write` alone is insufficient.
      `dependabot-metadata.yml` likewise declares both `pull-requests:
      write` and `issues: write` for its own `gh label create` call, for
      the same either-suffices-but-grant-both reason (skeptic-final-2.md CR2).
- [x] 2.7 **(Delivery cycle 2.)** Verify a non-Dependabot PR ends this job
      green (skipped), not red (failed): the top-level `if:` on
      `dependabot-auto-merge.yml`'s job already requires
      `workflow_run.event == 'pull_request'` (skips for non-PR triggers of
      `CI`, e.g. a direct push to `main`); within the job, the `resolve`
      step's `AUTHOR_LOGIN != 'dependabot[bot]'` branch `exit 0`s cleanly for
      a human PR's CI completion. `dependabot-metadata.yml`'s job-level `if:
      github.actor == 'dependabot[bot]'` guard likewise reports "skipped",
      not "failed", for every human PR/push event it receives. Traced by
      hand against both workflow files; no live-PR test was run (would
      require pushing a real non-Dependabot PR).
## 3. CI-trigger verification

- [x] 3.1 Confirm `.github/workflows/ci.yml`'s `paths-ignore` does not exclude
      `.github/dependabot.yml`, `.github/workflows/dependabot-auto-merge.yml`,
      `package.json`/`package-lock.json`, `frontend/package.json`/
      `frontend/package-lock.json`, or `backend/build.sbt`/`project/*.sbt` —
      already confirmed true in premise-validation evidence; re-verify inline
      here since the file could have moved during Execution of a parallel
      ticket.
- [x] 3.2 Confirm `ci.yml`'s `name: CI` still matches the `workflows: ["CI"]`
      filter used in task 2.1 — if `ci.yml` is renamed in this same tree by a
      concurrent change, this must be updated together, not left silently
      mismatched. Also confirm `ci.yml`'s three jobs (`frontend`, `backend`,
      `e2e`) are all still expected to gate the merge (design.md Context) —
      i.e. no job should be excluded from this gate without saying so.

## 4. Verification

- [x] 4.1 `actionlint` (or equivalent YAML/workflow syntax check) against
      both new workflow-shaped files, if available in this repo's tooling;
      otherwise a manual review pass for YAML validity plus GitHub Actions
      expression syntax (`${{ }}`).
- [x] 4.2 Validate `.github/dependabot.yml` is syntactically well-formed
      (`yq`/`python -c "import yaml"` parse check) since GitHub does not
      offer a local dry-run validator.
- [x] 4.3 Where feasible without live GitHub state, simulate the
      merge-decision branch (patch/minor -> merge command constructed;
      major -> label path taken, no merge command constructed) against sample
      `update-type` values, e.g. a small shell/node snippet exercising the
      same conditional the workflow uses, to give the evaluator something
      concrete to check beyond a syntax parse.
- [x] 4.4 Document, in the PR description, that full end-to-end verification
      (a real Dependabot PR opening, grouping correctly, and the merge
      workflow actually firing/gating/merging) can only be observed post-merge
      on GitHub's own schedule — this ticket's evaluator/skeptic gates cover
      config correctness and workflow logic, not a live Dependabot run.
