## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `5b90bb2491e6a08038082ac93daa70b10b416b3b` against the live-resolved base `647f1f111462f46e614a310684a5e90dfd9fb7aa`
(two commits: `c2f35a3df` selftest + red run, `5b90bb249` the fix). Working tree clean.

### Phase 1: Spec Review — PASS

- AC1 (dry-run proves the author check passes and the workflow does what the owner approved): met. The selftest runs the
  workflow's real `if:`/`env:`/`run:` text against recorded payload shapes. Patch/minor produce exactly
  `gh pr merge 1222 --repo matto00/helio --squash --match-head-commit <sha> --delete-branch`, major produces only
  `pr edit --add-label major-update`, and there is no `--auto` anywhere. This matches owner ruling
  `merge-after-ci-complete` (C1).
- AC2 (PR states the merge policy): still open. Task 3.5 is unchecked because no PR exists yet. It is a Delivery-phase
  item, not a code defect, so it does not block this phase. The orchestrator must make sure the PR body states the
  policy and the three risks in design.md.
- Ticket "Do" items: the author check now uses GitHub's identity fields (REST `user.login`/`user.type` and
  `workflow_run.actor.login`), not gh's display form. The merge policy was checked against the repo's rules and
  escalated (no `--auto`, waits for CI success, adds `--match-head-commit`).
- Tasks 1.1–3.4 are marked done and match the diff. Scope: only the four files listed in the proposal plus change
  artifacts. No `.husky/**`, app code or migration changes.
- Spec delta (`specs/dependabot-auto-merge/spec.md`): each requirement and scenario maps to a selftest scenario.
  `check:openspec` is clean.
- CONSTRAINTS C1/C2/C3 are honoured. C3: the `pr view` stub returns per-scenario SHA, base and labels with the author
  pinned to `app/dependabot`. Every scenario asserts that no unhandled `gh` call was made, every abort scenario
  asserts its own abort line, and the mutations are built in.
- Ground truth re-checked read-only (`gh api`):
  - PR #1222 REST `user` = `dependabot[bot]` / `Bot`.
  - Run 44990891169 log shows `PR #1225 author is 'app/dependabot', not dependabot[bot]; aborting.`, with actor and
    triggering_actor both `dependabot[bot]`. So the new job-level actor filter admits a real Dependabot run.
  - The `main` ruleset requires `ci-complete` with `strict: false`, which matches the corrected header comment.
  - gh 2.103.3 supports `--match-head-commit SHA`.

### Phase 2: Code Review — PASS

Gates (my own fresh runs, TMPDIR in the lane scratch dir):
- `node scripts/check-dependabot-auto-merge.selftest.mjs`: exit 0. 16/16 checks plus 8/8 mutations rejected. Output is
  byte-identical to the committed `green-run.txt`.
- **Red reproduced independently.** I ran the same selftest against the base workflow (`git show 647f1f111:...`, which
  is byte-identical to the red commit's workflow): exit 1 with 10 failures. Every failure is the workflow's own abort
  line `PR #1222 author is 'app/dependabot', not dependabot[bot]; aborting.`. There was no stub error and no unhandled
  call. The output matches the committed `red-run.txt` after stripping SHAs.
- **Mutations are real.** I applied each of the 8 built-in mutations separately and checked which scenario kills it:
  - revert author check → patch/minor/major fail;
  - drop in-script actor → "human run actor aborts in-script";
  - drop type check → "REST type User aborts";
  - drop `--match-head-commit` → exact-argv mismatch;
  - add `--auto` → exact-argv mismatch;
  - remove actor from job `if:` → "skipped by job if";
  - widen merge `if:` to major → "major must not merge";
  - drop conclusion → "CI failure skipped".

  Extra mutations of my own were also killed: dropping the base check and dropping the head-SHA check. Every kill is a
  semantic assertion, not a thrown error.
- actionlint v1.7.7 on `dependabot-auto-merge.yml` and `ci.yml`: exit 0, no findings (shellcheck is not installed
  here, so `run:` blocks were not shellchecked).
- `prettier --check` on the changed files: clean. `eslint` on the selftest: clean.
- `check:ci-complete-needs`, `check:precommit-ci-parity`, `check:test-temp-dir-hygiene`, `check:openspec`,
  `check:repo-integrity`, `check:dependabot`, `check:no-credential-leak`: all OK.
- frontend/backend gate sets: not triggered (no `frontend/**` or `backend/**` changes).

Review:
- Security: the new value `RUN_ACTOR` goes through `env:` and is never interpolated inside `run:` (static assertion
  enforces this). `workflow_run` never checks out PR code, so this is not a pwn-request risk. The three-condition
  author check rejects a human push to a Dependabot branch (via `actor`) and a non-Bot account with a matching login.
- Error handling: aborts are `exit 0` with explicit lines, unchanged from the existing pattern. `set -euo pipefail`
  means a failing `gh api` is a loud step failure, not a silent pass.
- Comments follow the CONTRIBUTING comment standard: they state the why (`actor` vs `triggering_actor`, ruleset fact)
  inline, and the stale "no branch protection" claim is corrected.
- Type safety, dead code, over-engineering: nothing found. The `if:` evaluator is minimal and throws on unsupported
  tokens or unmapped context, as design Decision 6 requires.

### Phase 3: UI Review — N/A

No UI-affecting files changed (no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`). No servers
were started.

### Overall: PASS

### Change Requests

(none)

### Non-blocking Suggestions

- `scripts/check-dependabot-auto-merge.selftest.mjs:139`: the scenario "display-form app/dependabot via pr view does
  not matter" uses exactly the same fixture as "patch merges" (`...base`, no overrides). The display-form property is
  already proven by every scenario, because `view.json` pins `app/dependabot` everywhere (and the fixed workflow never
  calls `pr view`). Consider removing the duplicate, or renaming "patch merges" to carry that intent.
- `scripts/check-dependabot-auto-merge.selftest.mjs:26`: `// ---- minimal if: evaluator ... ----` is a section-divider
  style comment. CONTRIBUTING reserves dividers for files of roughly 1,000+ lines (this one is 398). A plain one-line
  comment is enough.
- The file is 398 lines, over the ~250-line soft budget but under the ~400 line where CONTRIBUTING asks for a proposed
  split. That is in line with the sibling selftests, so no action is needed.
- Task 3.3: actionlint ran without shellcheck on PATH. If the PR body cites actionlint, say that `run:` blocks were not
  shellchecked.
- Task 3.5 / AC2: the PR body must state the applied policy (patch/minor squash-merge after CI success with
  `--match-head-commit`, never `--auto`; major label-only) and the three design.md risks: no post-merge CI on main, the
  non-strict ruleset, and the `GITHUB_TOKEN` merge / `--delete-branch` untested until a real Dependabot run.
