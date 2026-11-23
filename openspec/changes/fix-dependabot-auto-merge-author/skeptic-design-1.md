## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/dependabot-auto-merge-author-check/HEL-1825`.
- Root cause is probe-confirmed. `gh run view 44990891169 --log` contains
  `PR #1225 author is 'app/dependabot', not dependabot[bot]; aborting.`
- The display form and the REST form really differ. `gh pr view 1222 --json author` returns
  `{"author":{"is_bot":true,"login":"app/dependabot"}}`. `gh api repos/matto00/helio/pulls/1222` returns
  `user {login:"dependabot[bot]", type:"Bot"}`, base `main`, labels `dependencies, dependabot-semver-minor`.
  Design Decision 1's source of truth is correct.
- CI actor claim holds. `actions/runs?head_sha=943f784...`: the `CI` run has `event: pull_request` and
  `actor`/`triggering_actor` both `dependabot[bot]`. Decision 2's choice of `actor` over `triggering_actor` is sound.
- Ruleset claim holds. `rules/branches/main` requires `ci-complete` with `strict_required_status_checks_policy: false`.
  There is no merge-queue rule, so `gh pr merge` without `--auto` cannot fall into auto-merge mode. Per `gh pr merge
  --help` (gh 2.103.3), that mode only applies to merge-queue branches.
- `--match-head-commit SHA` is a real flag in `gh pr merge --help`.
- The current workflow (lines 41-114) matches the design's description. No `${{` appears inside a `run:` today.
- Wiring is feasible. `check:cache-cleanup-pr:selftest` is at ci.yml:168 in `frontend`, and `js-yaml` is a root
  dependency. `check-precommit-ci-parity` only requires hook→CI coverage, so a CI-only selftest is fine.
- The owner ruling (merge-after-ci-complete, never `--auto`) is implemented by Decisions 2-4 and the spec. I am not
  relitigating it.

### Verdict: REFUTE

The workflow fix is sound. The proof is not: as designed, the selftest's red run would not reproduce the bug it fixes,
and part of the gating logic stays hardcoded and mutation-blind.

### Change Requests

1. **The red run must reproduce the reported symptom, not a stub error.** Decision 6 has the stub `gh` answer only
   `pr list` and `api repos/.../pulls/N`, and the "app-display author shape" scenario has "`gh pr view`-style data
   absent". Against the unmodified workflow, `gh pr view` (lines 50-51) then hits an unhandled stub call. That gives
   either a `set -e` crash or empty jq output. Either way the selftest goes red for a reason unrelated to the bug, and
   red-run.txt proves nothing about the author check.
   Revise Decision 6 and task 1.3 as follows:
   - The stub also answers `pr view <n> --json ...` with the recorded shape: `author: {is_bot: true, login:
     "app/dependabot"}`, plus `headRefOid`, `baseRefName` and `labels`, from the live #1222 read.
   - Any unrecognised `gh` invocation makes the stub log the call and exit non-zero, so it fails loudly and an
     unhandled call can never look like a pass.
   - Scenarios assert the outcome from `GITHUB_OUTPUT` and the logged `gh` calls, not the step's exit code. The
     workflow aborts with `exit 0`.
   - red-run.txt must show the patch and minor scenarios failing because no `gh pr merge` was logged. The captured
     resolve output must contain the workflow's own line `author is 'app/dependabot', not dependabot[bot]`.
   - After the fix, the same `pr view` answer stays in the stub. "REST says `dependabot[bot]`/`Bot` while `pr view`
     says `app/dependabot`" then proves the new check ignores the display form.
2. **Evaluate the real `if:` expressions; do not mirror them.** Decision 6 says the selftest "evaluates the merge/label
   step conditions from the resulting `GITHUB_OUTPUT`". It does not say whether this parses the YAML `if:` strings or
   reimplements the logic in JS. A reimplementation would miss a widened merge-step `if:`, for example one that also
   admits `semver-major`. Specify:
   - A minimal evaluator that applies the workflow's actual job `if:` and step `if:` strings to the scenario context.
     It needs `==`, `&&`, `||`, parentheses, string literals, `github.event.workflow_run.*` and
     `steps.resolve.outputs.*`, and it throws on any unsupported token.
   - An explicit substitution map for `${{ ... }}` in step `env:` (`secrets.GITHUB_TOKEN`, `github.repository`,
     `github.event.workflow_run.head_sha`, `steps.resolve.outputs.pr_number`) that throws on any unmapped expression.
   - The job `if:` is evaluated per scenario. The "run actor human" scenario is then skipped at job level, and
     separately aborts in-script when the job `if:` is bypassed.
   - Task 3.2 gains three mutations, each required to turn the selftest red: (a) remove the actor condition from the
     job `if:`; (b) widen the merge step `if:` to admit `version-update:semver-major`; (c) drop the `conclusion ==
     'success'` term from the job `if:`.
3. **Acceptance criterion 2 has no task.** "The PR states the merge policy the workflow now applies" is not covered by
   tasks.md. The design's "Risks (stated in the PR)" section implies it but assigns it to nothing. Add a task: the PR
   body states the applied policy (patch/minor squash-merge after `CI` success with `--match-head-commit`, never
   `--auto`; major label-only) and the three stated risks.

### Non-blocking notes

- Decision 6 says `check:test-temp-dir-hygiene` "applies". That check only scans `backend/src/test/scala`, so it does
  not cover this `.mjs`. Cleaning up `mkdtemp` dirs is still right; just do not cite that check as enforcement.
- The merge step has never run in production, because every run aborted at the author check. `--delete-branch` with
  `--repo` and no checkout is untested in that environment too. Add it to the third PR risk alongside the
  `GITHUB_TOKEN`-merge question.
- The selftest shells out to the real `jq`. Check for it up front and fail with a clear message if it is missing.
  `ubuntu-latest` has it.
- `user.type == "Bot"` is belt-and-braces: GitHub logins cannot contain `[`, so no human can be named `dependabot[bot]`.
  It is harmless, and fine to keep as a mutation target.
