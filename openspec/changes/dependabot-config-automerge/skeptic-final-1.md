## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Branch protection (safety-critical, re-derived from first principles — NOT from design.md)**
- `gh api repos/:owner/:repo/branches/main/protection` -> `404 Branch not protected`.
- `gh api repos/:owner/:repo/rules/branches/main` -> only `deletion` + `non_fast_forward`
  rules (ruleset 14964282 "main - no delete"). **No required status checks.**
- `gh api repos/:owner/:repo` -> `"allow_auto_merge": false` (native auto-merge is off
  at the repo level entirely).
- Conclusion: the human brief's premise is CORRECT and independently confirmed. CI is not
  enforced by any repo-side gate.

**The `--auto` hazard is genuinely avoided (the #1 thing I was asked to refute — I could not)**
- `grep` over `.github/workflows/dependabot-auto-merge.yml`: no `--auto`, no
  `gh api .../enable-auto-merge`, no `enablePullRequestAutoMerge` mutation.
- Trigger is `on: workflow_run: workflows: ["CI"], types: [completed]`, gated by
  `github.event.workflow_run.conclusion == 'success' && ...event == 'pull_request'`.
- The `resolve` step re-verifies, server-side via `gh pr view`, all three of:
  live `headRefOid` == the CI'd `workflow_run.head_sha` (force-push race), `author.login`
  == `dependabot[bot]`, and `baseRefName` == `main`. It reads none of these from the
  event payload. Merge is a direct `gh pr merge --squash --delete-branch`.
- This part of the design shipped faithfully and is sound. **Not a finding.**

**Ecosystem/config ground truth**
- `python3 -c "yaml.safe_load(...)"` on both files: valid YAML. `updates` resolves to
  exactly 4 entries: `(npm, /)`, `(npm, /frontend)`, `(github-actions, /)`, `(sbt, /backend)`.
- Manifests exist at each: `package.json`, `frontend/package.json`, `backend/build.sbt`.
- **sbt-ecosystem correction independently verified as true**: `dependabot/dependabot-core`
  contains a top-level `sbt/` ecosystem dir, and the live GitHub supported-ecosystems docs
  page lists `sbt`. The ticket's own stated premise ("no native sbt support") was wrong and
  the design's correction of it is right. **Not a finding.**
- `ci.yml` is `name: CI` (matches the `workflow_run` filter string exactly), triggers on
  `pull_request: branches: [main]`, and its `paths-ignore` is `**.md`/`LICENSE`/
  `.github/ISSUE_TEMPLATE/**`/`docs/**` — none of which exclude manifests or lockfiles.
  Dependabot PRs will trigger CI. **Not a finding.**
- `gh pr list --search "sha:<sha>"` empirically verified against this repo (resolved
  `d8f21efd` -> PR #438). The SHA->PR resolution works. **Not a finding.**
- `dependabot/fetch-metadata@v3` resolves: `refs/tags/v3` exists, latest release `v3.1.0`.
  The `@v3` pin is current and correct. **Not a finding.**

**Repo gates re-run by me (not trusted from evaluation-1.md)**
- `npm run lint` (eslint --max-warnings=0), `npm run typecheck` (tsc --noEmit),
  `npm run format:check` (prettier) — all three pass, clean output. Read myself.

**The defect (reproduced from the action's own source at the pinned tag)**
- `.github/workflows/dependabot-auto-merge.yml` passes `pr-number:` to
  `dependabot/fetch-metadata@v3`. I fetched the v3 tarball and read its real `action.yml`:
  its declared inputs are exactly `alert-lookup`, `compat-lookup`, `github-token`,
  `skip-commit-verification`, `skip-verification`. **There is no `pr-number` input.**
- `grep -rn "pr-number\|prNumber"` across the whole v3 tree: hits appear ONLY in
  `src/dry-run.ts` — a local `yargs` CLI dev tool (`check <nwo> <pr-number>`). The compiled
  `dist/index.js` that actually executes contains **zero** occurrences of `pr-number`.
- The action resolves the PR solely from `github.context.payload.pull_request`:
  `src/dependabot/util.ts` `getBranchNames/getBody/getTitle` all destructure
  `const { pull_request: pr } = context.payload`, and `src/dependabot/verified_commits.ts`
  `getMessage` opens with `if (!pr) { core.warning("Event payload missing \`pull_request\`
  key. Make sure you're triggering this action on the \`pull_request\` or
  \`pull_request_target\` events."); return false }`.
- A `workflow_run` payload has no `pull_request` key. So `getMessage` returns `false`, and
  `src/main.ts` takes the else branch: `core.setFailed('PR is not from Dependabot, nothing
  to do.')`. Both failure strings verified present verbatim in the shipped `dist/index.js`.
- Net effect: the "Fetch Dependabot metadata" step fails on **every** run, and
  `steps.metadata.outputs.update-type` is never set. Both downstream steps' `if` conditions
  compare that empty value against the semver strings and are therefore always false.

### Verdict: REFUTE

The `--auto` hazard is correctly handled and the config half is sound, but the auto-merge
workflow is functionally inert: it can never merge a patch/minor PR and can never label a
major PR. Ticket AC2 ("a test/patch Dependabot PR auto-merges only after CI passes; a
synthetic major update PR does NOT auto-merge and is labeled for review") is not satisfiable
by what shipped — the first clause fails outright, and the second passes only by accident
(nothing merges because nothing works), with its labeling requirement also unmet.

Severity note: this fails **closed**, not open. There is no security exposure — the bug
cannot cause an unreviewed merge, only a permanently failing job. But it also means the
ticket's headline feature does not function, and the failure is silent-ish (a red workflow
run on every CI completion for every PR in the repo, not just Dependabot's).

Root cause of the miss: `design.md:67` and `evaluation-1.md:11` both assert that the
`pr-number` input re-targets the action under `workflow_run`. That input was assumed, never
checked against the action's `action.yml`. Three design rounds hardened the *pin* (`@v2` ->
`@v3`) without ever verifying the *interface*.

### Change Requests

1. **`.github/workflows/dependabot-auto-merge.yml:75-80` — remove the non-existent
   `pr-number` input to `dependabot/fetch-metadata@v3` and replace the metadata step with a
   mechanism that works under `workflow_run`.** The action is hard-wired to
   `context.payload.pull_request` and cannot be pointed at a PR number; passing `pr-number`
   is silently ignored (GitHub emits an "Unexpected input(s)" warning) and the step then
   fails with `PR is not from Dependabot, nothing to do.` Pick one:
   - **(a) Preferred — derive the update type inline.** In the existing `resolve` step you
     already have an authenticated `gh` and a verified PR number. `fetch-metadata` gets
     `update-type` by parsing the `dependabot-*` YAML trailer out of the Dependabot commit
     message. Read it directly, e.g.
     `gh api "repos/$REPO/pulls/$PR_NUMBER/commits" --jq '.[0].commit.message'`, and extract
     `update-type: version-update:semver-*`. This keeps the whole design intact (single
     `workflow_run` job, no second trigger, no new trust surface) and drops the third-party
     action entirely. Note the resolve step must additionally verify the first commit's
     `author.login == "dependabot[bot]"` and `commit.verification.verified == true` — the
     two checks `fetch-metadata` was performing for you and which CR-1 would otherwise
     silently drop.
   - **(b) Alternative — split into two workflows.** Keep a `pull_request`-triggered job
     that runs `fetch-metadata` (valid context) and records the update type as an artifact
     or label, and have the `workflow_run` job read it back. Strictly more moving parts;
     only take this if (a) proves impractical.
   Whichever is chosen, the "highest semver change in a grouped PR" property the workflow's
   inline comment relies on must be preserved — it is a property of the commit trailer, so
   (a) retains it, but state that explicitly.

2. **Add a guard so a non-Dependabot PR does not fail this workflow.** Because `CI` runs on
   every PR, `workflow_run` fires this job for all of them. Today the `resolve` step exits 0
   cleanly for non-Dependabot PRs (good), but after CR-1 confirm the metadata/merge path is
   still skipped — not failed — when `verified != 'true'`. The job should end green, not red,
   on ordinary human PRs. Verify this explicitly rather than assuming.

3. **Correct `design.md:67` and the corresponding `tasks.md` step** so the artifacts no
   longer document a `pr-number` input that does not exist. The design is the thing three
   review rounds signed off on; leaving the false claim in it will re-seed the same bug.

4. **Before the next PASS, verify the chosen mechanism against the action's/API's actual
   declared interface, not its assumed one** — e.g. paste `action.yml`'s inputs list, or the
   real `gh api` output for a commit message trailer. An assertion that an input exists is
   not evidence that it does.

### Non-blocking notes
- `groups` only covers dev-dependencies (both npm entries) and a `react` group in
  `/frontend`. Production npm deps remain ungrouped and will open one PR per package. That
  is consistent with AC3 as written ("one PR per group, not one-per-package") and with the
  approved design, so it is not a finding — but with `open-pull-requests-limit: 10` per
  ecosystem it may be noisier in practice than the ticket's "low-noise" motivation implies.
  Worth a follow-up look after the first real Dependabot run.
- `permissions: issues: write` is correctly justified (label creation on first use) and is
  the minimum for that operation.
- Ticket AC1 (ecosystems shown active under Insights > Dependency graph) is only observable
  post-merge; the config is valid and well-formed, which is as far as pre-merge evidence can
  go. Not held against the change.
