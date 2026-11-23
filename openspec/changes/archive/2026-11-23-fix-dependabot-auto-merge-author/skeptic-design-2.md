## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/dependabot-auto-merge-author-check/HEL-1825`.
- I re-checked ground truth myself with read-only calls:
  - `gh pr view 1222 --json author,headRefOid,baseRefName` returns `author {is_bot:true, login:"app/dependabot"}` and head `943f784…`.
  - `gh api repos/matto00/helio/pulls/1222` returns `user dependabot[bot]/Bot`, base `main`, and the same head SHA.
  - `rules/branches/main` requires `ci-complete` with `strict_required_status_checks_policy: false`.
  Design Decisions 1, 2 and 5 rest on correct facts.
- I read the current workflow (`.github/workflows/dependabot-auto-merge.yml:41-114`):
  - The order is: PR lookup, `gh pr view`, head-SHA check (line 58), author check (line 63), base check, labels.
  - The step `env:` entries use only `secrets.GITHUB_TOKEN`, `github.repository`, `github.event.workflow_run.head_sha` and `steps.resolve.outputs.pr_number`. All of these are in Decision 6's substitution map, so the selftest can load the unmodified workflow without the map throwing. The red run is therefore achievable.
  - The workflow has no `${{` inside any `run:`, so the static assertion holds on both the old and new text.
- Round-1 CR1 (the red run must show the real symptom) is addressed:
  - Decision 6 now has the stub answer `pr view` with the recorded display shape.
  - Any unrecognised `gh` call exits non-zero.
  - Outcomes come from `GITHUB_OUTPUT` and the logged calls, not from exit codes.
  - The red expectation names the workflow's own `author is 'app/dependabot'` line and excludes stub-error reds.
  - Task 1.3 repeats all of this.
- Round-1 CR2 (evaluate the real `if:` strings) is addressed:
  - Decision 6 adds a real `if:` evaluator that throws on unknown tokens.
  - It adds a throwing `env:` map.
  - The run-actor-human scenario is tested both at job level and with the job `if:` bypassed.
  - Task 3.2 lists all three requested mutations, plus the five original ones.
- Round-1 CR3 (AC2 had no task) is addressed: task 3.5 has the PR body state the policy and all three risks. The `--delete-branch` risk from my round-1 note is included.
- Mutation sensitivity: I traced each mutation in task 3.2 to a scenario that would turn red.

  | Mutation | Scenario that catches it |
  | --- | --- |
  | Revert the author check | Patch scenario: the display form makes it abort, so no merge is logged |
  | Drop the in-script actor check | Human actor with the job `if:` bypassed: it merges |
  | Drop the type check | `user.type: User`: it merges |
  | Drop `--match-head-commit` / add `--auto` | Exact-argv merge assertion |
  | Remove the job `if:` actor term | Job-level skip assertion |
  | Widen the merge step `if:` | Major scenario: a merge is logged |
  | Drop the `conclusion` term | CI failure scenario |

  Every guard has a scenario that fails when that guard alone is removed.
- Owner ruling `merge-after-ci-complete`: Decisions 2-4 and the spec implement it. `--auto` is excluded statically and by the argv check. I did not relitigate it.
- Wiring is feasible:
  - The `frontend` job runs `npm ci` on `ubuntu-latest`.
  - `js-yaml` 4.3.2 is a root dependency (package.json:112).
  - The anchor step is at ci.yml:168.

### Verdict: CONFIRM

### Non-blocking notes

1. **The `pr view` fixture must follow the scenario, apart from the author.** The old workflow checks the head SHA (line 58) before the author (line 63). If the stub's `headRefOid` is the literal #1222 SHA rather than the scenario's `HEAD_SHA`, the red run aborts on the "force-push race" line and never prints the author line. Task 1.3's criterion would catch this, but do it right first time: `headRefOid`, `baseRefName` and `labels` should mirror the scenario's REST values, with only `author` pinned to `{is_bot:true, login:"app/dependabot"}`.
2. **An unhandled `gh` call should fail every scenario, not just positive ones.** Decision 6 says such a call "can never look like a pass". That only holds for positive scenarios. In an abort scenario, a crash from an unhandled call also logs no merge and would pass. Two assertions close this:
   - every scenario asserts that its unhandled-call log is empty;
   - abort scenarios assert the expected abort reason in the captured resolve stdout.
3. **Consider embedding the mutations in the selftest.** The sibling `check-cache-cleanup-pr.selftest.mjs` keeps its mutations in the file, so CI re-proves on every run that they are detected. Task 3.2 is a one-time recorded run. Embedding the task 3.2 mutations, as text replacements on the loaded workflow that must each produce a failing scenario, would keep the failability guarantee permanent.
4. **Two GitHub `if:` semantics the evaluator does not model:**
   - GitHub compares strings in `==` case-insensitively. A case-sensitive evaluator is stricter, which is harmless here.
   - A step with no status function gets an implicit `success()`. Model "skip later steps if resolve exited non-zero", or at least do not run the merge step after a crashed resolve.
5. **The read-only token risk is real.** GitHub restricts the `GITHUB_TOKEN` and secrets in Dependabot-triggered runs. Whether a `workflow_run` whose upstream actor is Dependabot inherits those restrictions is exactly the untested merge risk the PR body must state (task 3.5). Keep its wording explicit.
