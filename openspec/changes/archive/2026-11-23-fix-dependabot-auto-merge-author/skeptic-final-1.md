## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `5b90bb2491e6a08038082ac93daa70b10b416b3b`. Base resolved live by `resolve-review-base.sh` (origin/main):
`647f1f111462f46e614a310684a5e90dfd9fb7aa`. No UI or backend change, so no servers and no browser.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/dependabot-auto-merge-author-check/HEL-1825`.
- **Diff scope** (`git diff --stat BASE...HEAD`): `.github/workflows/dependabot-auto-merge.yml`, one step in
  `.github/workflows/ci.yml`, one script in `package.json`, the new `scripts/check-dependabot-auto-merge.selftest.mjs`,
  and the openspec change artifacts. That is CI config only, as the ticket requires.
- **Root cause, checked against the real run with read-only gh calls.** The log of run 44990891169 ends with
  `PR #1225 author is 'app/dependabot', not dependabot[bot]; aborting.`, so the root cause is real.
  `gh api repos/matto00/helio/pulls/1225` returns `user.login=dependabot[bot]`, `user.type=Bot`, head
  `0759778…`, base `main` and labels `[dependencies, dependabot-semver-patch]`. The CI run for that head SHA has
  `event=pull_request` and `actor=dependabot[bot]`. The fixed workflow reads exactly these fields, and on real data each
  of its checks passes: REST login, type `Bot`, run actor, the job `if:` actor, base `main`, and the semver label.
- **Merge policy matches the owner ruling (merge-after-ci-complete).** The job `if:` requires
  `conclusion == 'success'`, the `pull_request` event and the `dependabot[bot]` actor. The merge command is
  `gh pr merge … --squash --match-head-commit "$HEAD_SHA" --delete-branch`, with no `--auto`. Major updates are only
  labelled. Ruleset 14964282 (`main - no delete`, read-only gh api) is active, has no bypass actors, and requires
  `ci-complete` (non-strict). So the header comment's claim about the ruleset is accurate.
- **Selftest, run fresh:** `npm run check:dependabot-auto-merge:selftest` passed 14 scenarios and 2 static checks. All
  8 mutations were rejected, and it printed `all dependabot-auto-merge checks passed`, exit 0. I read the script. It
  runs the workflow's real `if:`/`env:`/`run:` text in bash against a stub `gh`, and the stub logs any unhandled call
  as a failure. The mutation harness requires each mutated text to differ from the real one, so a replace that does
  not apply is reported as FAIL rather than passing silently.
- **Red first:** `red-run.txt` runs the same selftest against the unmodified workflow. It fails 10 checks, each with
  the production message `author is 'app/dependabot'`, not a stub error. That reproduces run 44990891169's symptom.
- **actionlint v1.7.7** on both workflows: exit 0, no output.
- **`check:ci-complete-needs`:** OK. **`check:precommit-ci-parity`:** OK. **`prettier --check`** on the changed
  script and workflow: clean. **`eslint`** on the selftest: clean.
- **CI wiring:** the new step is in the `frontend` job (inside `ci-complete.needs`), next to the sibling CI-only
  selftests. `js-yaml` is a root devDependency, and `jq` and `bash` are on ubuntu-latest.

### Acceptance criteria

1. Dry-run author check passes and the workflow does what the owner approved: **met.** The evidence is the selftest
   scenarios `patch merges` / `minor merges` / `major is labelled, never merged` plus the abort scenarios, and the
   real-payload check above. The ticket's driver constraint (actionlint plus a script-level test, no live PR) is
   satisfied.
2. PR body states the merge policy: **not yet done.** This is Delivery task 3.5, which the orchestrator excluded from
   this judgement. It must still be done before merge.

### Verdict: CONFIRM

### Non-blocking notes

- AC2 / task 3.5 is still outstanding. The PR body must state:
  - the policy: patch/minor squash-merge after CI success with `--match-head-commit`, never `--auto`; major is
    label-only;
  - the risks: no post-merge CI on main from a `GITHUB_TOKEN` merge, the non-strict ruleset, and the
    `GITHUB_TOKEN` write permission / `--delete-branch` untested until a real Dependabot run;
  - that actionlint ran without shellcheck.
- `selftest.mjs:139`: the scenario "display-form app/dependabot via pr view does not matter" is a duplicate of
  "patch merges". This agrees with the evaluator's note.
- An existing race that this change does not fix: if CI completes before `dependabot-metadata.yml` has applied the
  semver label, the run aborts and nothing retries. If PRs still sit unmerged after this ships, this race is the next
  thing to check. It is out of scope here.
- The selftest writes its temporary scenario dirs under `os.tmpdir()` and removes them afterwards. That is fine in CI.
