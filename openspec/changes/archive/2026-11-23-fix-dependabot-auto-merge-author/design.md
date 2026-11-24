## Context

`dependabot-auto-merge.yml` (HEL-456) runs on `workflow_run: [CI] completed`. Its `resolve` step finds the open PR by
head SHA, reads `gh pr view --json number,headRefOid,author,baseRefName,labels`, and compares `.author.login` to
`dependabot[bot]`. `gh` reports `app/dependabot`, so every run aborts (run 44990891169, PR #1225). Ground truth
gathered at Planning (read-only):

- `gh api repos/matto00/helio/pulls/1222` → `user: {login: "dependabot[bot]", type: "Bot"}`, `head.sha`, `base.ref`,
  `labels[].name` (`dependencies`, `dependabot-semver-minor`).
- The `CI` run for that head SHA: `event: pull_request`, `actor.login` and `triggering_actor.login` both
  `dependabot[bot]`.
- `gh api repos/matto00/helio/rules/branches/main` → `required_status_checks: [ci-complete]`, `strict: false`.

Owner ruling (escalation `HEL-1825-1795470843652-cbd96f`): `merge-after-ci-complete`.

## Decisions

1. **One REST read is the source of truth.** Replace `gh pr view` with
   `gh api "repos/$REPO/pulls/$PR_NUMBER"` and read `.head.sha`, `.user.login`, `.user.type`, `.base.ref`,
   `.labels[].name` with `jq -r`. The PR number lookup (`gh pr list --search "sha:..."`) stays.
2. **Author check (three conditions, all required):** `user.login == "dependabot[bot]"`, `user.type == "Bot"`, and
   `RUN_ACTOR == "dependabot[bot]"` where `RUN_ACTOR: ${{ github.event.workflow_run.actor.login }}` is passed via
   `env:` (never interpolated inside `run:`). `actor` (not `triggering_actor`) is used: a human re-running CI changes
   `triggering_actor` but not `actor`, while a human pushing a commit to the Dependabot branch changes `actor`, which is
   exactly the case that must not auto-merge.
3. **Job-level filter too.** Add `github.event.workflow_run.actor.login == 'dependabot[bot]'` to the job `if:`, so human
   PRs' CI completions skip the job instead of spending a runner. The in-script check stays (defence in depth, and it
   is what the selftest exercises).
4. **Merge command:** `gh pr merge "$PR_NUMBER" --repo "$REPO" --squash --match-head-commit "$HEAD_SHA" --delete-branch`
   with `HEAD_SHA: ${{ github.event.workflow_run.head_sha }}` in the step's `env:`. Never `--auto`.
5. **Comment fix.** Replace the "no branch protection" header and the merge-step comment with the current facts: the
   `main - no delete` ruleset requires `ci-complete` (non-strict), so `gh pr merge` refuses to merge without it anyway;
   this workflow still gates on the CI run's own conclusion; `--auto` is still not used (helio rule, MISTAKES.md).
   Keep comments short and factual (CONTRIBUTING.md comment standard).
6. **Behavioural selftest, not a static grep.** `scripts/check-dependabot-auto-merge.selftest.mjs` loads the workflow
   with `js-yaml` (root devDependency), extracts the job `if:`, each step's `if:`/`env:`/`run:`, and runs every
   scenario through the workflow's REAL text:
   - **Preflight:** fail with a clear message if `jq` or `bash` is not on `PATH`.
   - **Stub `gh`** (bash, in a `mkdtemp` dir prepended to `PATH`, removed at the end) appends every invocation's argv
     to a log and answers from the scenario fixture: `pr list ... --search sha:<sha>` (PR number or empty);
     `pr view <n> --json ...` with the RECORDED display shape (`author: {is_bot: true, login: "app/dependabot"}`,
     `headRefOid`, `baseRefName`, `labels`, as `gh pr view 1222` returns); `api repos/<repo>/pulls/<n>` with the REST
     shape (`user: {login, type}`, `head.sha`, `base.ref`, `labels[].name`, as `gh api .../pulls/1222` returns);
     `pr merge`, `pr edit`, `label list`, `label create` (logged, exit 0). **Any other invocation is logged and exits
     non-zero** so an unhandled call can never look like a pass. The `pr view` answer stays in the stub after the fix,
     so "REST says `dependabot[bot]`/`Bot`, `pr view` says `app/dependabot`" proves the new check ignores the display
     form.
   - **Real `if:` evaluation.** A minimal evaluator applies the workflow's actual job `if:` and step `if:` strings to
     the scenario context. It supports `==`, `!=`, `&&`, `||`, parentheses, single-quoted string literals,
     `github.event.workflow_run.*` and `steps.resolve.outputs.*`, and throws on any other token. Conditions are never
     re-implemented in JS.
   - **`env:` substitution** through an explicit map (`secrets.GITHUB_TOKEN`, `github.repository`,
     `github.event.workflow_run.head_sha`, `github.event.workflow_run.actor.login`, `steps.resolve.outputs.*`) that
     throws on any unmapped `${{ }}` expression.
   - **Outcome assertions** come from `GITHUB_OUTPUT` and the logged `gh` calls, never from a step's exit code (the
     workflow aborts with `exit 0`). Each scenario also captures the resolve step's stdout.
   - **Scenarios:** patch merges (exact argv `pr merge <n> --repo <repo> --squash --match-head-commit <sha>
     --delete-branch`, no `--auto`); minor merges; major adds `major-update` and logs no `pr merge`; genuine Dependabot
     with display-form `app/dependabot` passes; REST `user.login` human aborts; `user.type: User` aborts; run actor human
     is skipped by the job `if:` AND, with the job `if:` bypassed, aborts in-script; CI conclusion `failure` is skipped
     by the job `if:`; head SHA mismatch aborts; base not `main` aborts; no semver label aborts; no PR aborts.
   - **Static assertions:** no `--auto` in any `run:`; no `${{` inside any `run:`.
   - Fixture user/labels shapes are copied from the PR #1222 reads above.
   - (Design gate round 2) The stub's `pr view` answer uses each scenario's head SHA, base and labels; only the author
     is pinned to `app/dependabot`. Every scenario asserts no unhandled `gh` call was logged, and abort scenarios assert
     their expected abort line. The task-3.2 mutations are built into the selftest (each mutated copy must fail), as
     `check-cache-cleanup-pr.selftest.mjs` does, so CI keeps proving them.
   - **Red expectation:** against the unmodified workflow the patch and minor (and display-form) scenarios fail
     because no `pr merge` was logged, and the captured resolve output contains the workflow's own line
     `author is 'app/dependabot', not dependabot[bot]`. A red caused by a stub error does not count.
7. **Wiring.** `package.json` script `check:dependabot-auto-merge:selftest`; one step in `ci.yml`'s `frontend` job after
   `check:cache-cleanup-pr:selftest`. CI-only, like that selftest; no `.husky/**` change.
8. **Red first.** The selftest is committed and run against the unmodified workflow before any workflow edit; the
   failing output is committed as `openspec/changes/fix-dependabot-auto-merge-author/red-run.txt`.
9. **actionlint.** Not installed. Run a pinned release binary downloaded into the main checkout's
   `.concertino/scratch/HEL-1825/` (never committed), against the edited workflow; record the output.

## Risks (stated in the PR)

- Merges made with `GITHUB_TOKEN` trigger no workflows, so main gets no post-merge `push` CI for these merges.
- `strict: false`: a Dependabot branch behind main can merge without being tested against current main.
- Whether `GITHUB_TOKEN` in a Dependabot-triggered `workflow_run` may merge, and whether `--delete-branch` with `--repo`
  and no checkout works there, is untested until a real Dependabot run (the merge step has never run in production).

## Planner Notes

- Self-approved: dropping `gh pr view` for the REST call (removes the display-form ambiguity at its source).
- Self-approved: the job-level actor filter (Decision 3); it only narrows when the job runs.
- No spec existed for this workflow; a new `dependabot-auto-merge` capability records the ruled behaviour.
