## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold re-verification of HEL-456 at 90f366c5 (on 66470984). No claim below is taken
from the executor's or evaluator's narrative; each is grounded in source I fetched
and read, docs I fetched, or commands I ran.

### What I verified (with evidence)

**Diff surface.** `git diff --name-status main...HEAD`: `.github/dependabot.yml`,
`.github/workflows/dependabot-auto-merge.yml`,
`.github/workflows/dependabot-metadata.yml` + change-dir docs. No app code, no UI —
UI/design-judgment step correctly skipped (no `frontend/**` change).

**1. Does `fetch-metadata` work under `pull_request`?** Yes — reproduced round 1's
finding and confirmed the new trigger. Fetched the pinned tag tarball
(`codeload.github.com/dependabot/fetch-metadata/tar.gz/refs/tags/v3`, tag object
`25dd0e34`):
- `action.yml` inputs are exactly `alert-lookup`, `compat-lookup`, `github-token`,
  `skip-commit-verification`, `skip-verification` — **no `pr-number`**. Round 1's
  refutation reproduced.
- `src/dependabot/verified_commits.ts:16` and `src/dependabot/util.ts:19,24,29`
  read `const { pull_request: pr } = context.payload`, and the action emits
  `"Event payload missing 'pull_request' key. Make sure you're triggering this
  action on the 'pull_request' or 'pull_request_target' events."` — i.e. the
  action's own documented-supported triggers are exactly `pull_request` /
  `pull_request_target`, which is what `dependabot-metadata.yml` now uses. Compatible.

**2. Label write permissions + stale-label overwrite.**
- GitHub docs (fetched, *Troubleshooting Dependabot on GitHub Actions* →
  "Changing GITHUB_TOKEN permissions"): Dependabot-triggered workflows get a
  read-only token *by default*, and "You can use the `permissions` key in your
  workflow to increase the access for the token." Both new/modified workflows do
  declare `permissions:`, so elevation is legitimate — this is not a repeat of the
  round-1 class of bug. GitHub's own auto-label/auto-merge examples on that page
  use precisely this shape.
- REST docs (fetched, `rest/issues/labels`): "Create a label" requires **at least
  one of** `Issues (write)` **or** `Pull requests (write)`; "Add labels" and
  "Remove a label" likewise. So `dependabot-metadata.yml`'s `pull-requests: write`
  is *probably* sufficient — but see Change Request 2, because the repo's own
  shipped artifacts assert the opposite.
- Stale-label overwrite (`dependabot-metadata.yml:65-71`): on every run it removes
  the two non-matching `dependabot-semver-*` labels (`|| true`, so a
  not-present removal is not fatal) before `--add-label`. `synchronize` is in the
  trigger list (`:17`), so a Dependabot rebase re-runs it. Correct as claimed.

**3. Is the label a trust signal?** No. `dependabot-auto-merge.yml:46-67` does all
three authenticity checks off one fresh `gh pr view` (`headRefOid` vs
`workflow_run.head_sha`, `author.login == dependabot[bot]`, `baseRefName == main`)
*before* the label is even parsed (`:77-89`), and each failure `exit 0`s. The label
is read only to pick patch/minor/major. Decision 1a's claim holds.

**4. Race.** Analysed the real ordering rather than trusting the doc. Both workflows
fire off the same `pull_request` event; `dependabot-metadata.yml` is one action +
one short script, while `CI` (`ci.yml`) is three jobs including a Postgres-16 +
Playwright `e2e` job — the `workflow_run` cannot complete before the metadata job in
any realistic timing. If it ever did, `:86-89` aborts with `exit 0` (never merges on
a missing label), and for a *stale* label the head-SHA equality check at `:54` means
only the newest push's CI can merge, by which time that same push's metadata run has
had the whole CI duration to finish. Fail-safe: false negative (delay) only. I could
not falsify this; it is sound. Residual liveness note below.

**5. Non-Dependabot PR exits green.** `dependabot-metadata.yml:27`
(`if: github.actor == 'dependabot[bot]'`) → job **skipped**, not failed.
`dependabot-auto-merge.yml:23-25` skips for non-`pull_request` CI runs; for a human
PR the `resolve` step hits `:59-62` and `exit 0`s (green), leaving
`steps.resolve.outputs.verified` unset so both downstream steps' `if:` are false.
Green on both.

**6. Repo gates re-run by me** (in the worktree, output read):
- `npm run lint` → `eslint . --max-warnings=0`, clean.
- `npm run typecheck` → `tsc --noEmit`, clean.
- `npm run format:check` → "All matched files use Prettier code style!"
- `npm test` → root `No tests found` (passWithNoTests) + frontend
  **259 suites / 2846 tests passed**, 0 failures.
- `python3 yaml.safe_load` parses all three new YAML files.

**7. Acceptance criteria traced.**
- *AC1 "dependabot.yml present and valid"* — independently verified the one value I
  most doubted: fetched
  `docs.github.com/.../supported-ecosystems-and-repositories`; the ecosystem table
  lists `sbt` → YAML value `sbt`, with `build.sbt` (root) "fetched as a required
  file". `backend/build.sbt` exists, and `directory: "/backend"` matches. `npm` at
  `/` and `/frontend` both have real `package.json`s. Valid.
- *AC2 "patch auto-merges only after CI; major labeled, not merged"* — the
  workflow_run-on-`CI`-success trigger plus live-head-SHA equality is a genuine
  gate (verified by reading, not asserted); major path at `:112-131` performs no
  merge. `gh pr list --search "sha:<sha>"` — I doubted this qualifier and tested it
  live against this repo: `gh pr list --search "sha:e1a62630..." --state all` returns
  PR #438. It works.
- *AC3 "grouped PRs land as one PR per group"* — `groups:` present on all four
  ecosystems; catch-all `patterns: ["*"]` for `github-actions`/`sbt` (no
  dev/prod split exists there), `dependency-type: development` for the two npm
  entries. Shape is correct.
- `ci.yml` `paths-ignore` (`**.md`, `LICENSE`, `.github/ISSUE_TEMPLATE/**`,
  `docs/**`) excludes no manifest/lockfile/workflow — re-read directly, the ticket's
  fourth scope bullet holds. `name: CI` matches `workflows: ["CI"]`.

**8. Independent check of Decision 1a's *rationale* (where I found the problem).**
I read the action's parser rather than trusting the doc:
`src/dependabot/update_metadata.ts:103` (identical in the `v3` tag and `main`):
```
const updateType = dependency['update-type'] || calculateUpdateType(lastVersion, nextVersion)
```
`calculateUpdateType` (`:159`) is a pure local string diff of the two version
numbers; `lastVersion`/`nextVersion` come from the commit message itself —
`parseMetadataLinks` (`:136`, regex ``/^Updates `(?<dependencyName>\S+)` (from
(?<from>\S+) )?to (?<to>\S+)$/gm``) and the trailer's `dependency-version`. No
GitHub API call is involved in deriving `update-type`. I then checked this repo's
real Dependabot commits (`git log --author=dependabot`): they do carry both
``Updates `form-data` from 4.0.5 to 4.0.6`` lines and `dependency-version:` keys.
Good news for the shipped design — the label will in fact be populated for this
repo's grouped PRs — but it falsifies the stated reason for rejecting the simpler
alternative. See Change Request 1.

### Verdict: REFUTE

Both requests are documentation/record and a one-line permission hardening — the
two-workflow mechanism itself I could not break, and I tried. Nothing here requires
redesign. But the falsified rationale is the same species of confidently-wrong
interface claim that produced round 1's dead code, and it is now committed in three
places, so it should not ship as the record.

### Change Requests

1. **`design.md` Decision 1a and `tasks.md` 2.3c state a false mechanism for how
   `update-type` is derived, and the conclusion drawn from it is wrong.**
   Decision 1a says `update-type` "is apparently only computed by `fetch-metadata`
   itself via the GitHub API, not present in the commit message for a grouped
   update", and 2.3c concludes an inline commit-message parse was therefore "not
   viable". Ground truth (`src/dependabot/update_metadata.ts:103,136,159` at tag
   `v3`, quoted above): `fetch-metadata` derives `update-type` *entirely from the
   commit message*, by local string-diffing the versions in the
   ``Updates `x` from A to B`` lines / `dependency-version:` trailer keys — no API
   lookup. The absence of an explicit `update-type:` key in this repo's grouped
   commits is real, but it does **not** make an inline parse impossible; the action
   itself works from exactly the data those commits do contain.
   Correct both artifacts to say what is actually true — that the inline
   alternative was rejected in favour of reusing the maintained action's
   version-diff heuristic rather than reimplementing it, which is a perfectly good
   reason — instead of asserting an impossibility that the action's own source
   contradicts. (Keep the two-workflow implementation; only the rationale is wrong.)

2. **Permission claim contradicts the shipped file.** `tasks.md` 2.6 states "a
   repository label create is `POST /repos/{owner}/{repo}/labels`, which
   `pull-requests: write` alone does not grant", and
   `.github/workflows/dependabot-auto-merge.yml:19` repeats it in a comment
   (`issues: write # required to create the 'major-update' label on first use`).
   Yet `.github/workflows/dependabot-metadata.yml:19-20` declares **only**
   `pull-requests: write` and calls `gh label create` at `:56` under
   `set -euo pipefail` — by the project's own recorded reasoning that step 403s and
   fails the job red on the very first Dependabot PR, killing the whole feature
   before a single label is ever written.
   GitHub's REST docs (fetched) say Create-a-label accepts *either* `Issues (write)`
   *or* `Pull requests (write)`, so I believe the file is actually fine and the
   claim is what's wrong — but this cannot be settled locally, and the two readings
   disagree about whether the feature works at all. Resolve it in the safe
   direction: add `issues: write` to `dependabot-metadata.yml`'s `permissions:`
   block (this is exactly what GitHub's own "Dependabot auto-label" example on the
   *Automating Dependabot with GitHub Actions* page uses: `pull-requests: write` +
   `issues: write`), and correct 2.6 / the `:19` comment to state the real
   requirement ("either Issues or Pull requests write; both granted for safety")
   rather than a false one.

### Non-blocking notes

- **Human push to a Dependabot branch.** `dependabot-metadata.yml`'s gate is
  `github.actor == 'dependabot[bot]'`, so a `synchronize` from a human pushing onto
  a Dependabot branch skips the relabel, while `dependabot-auto-merge.yml`'s
  `author.login` check still reads `dependabot[bot]` (PR *author* is unchanged) and
  the head-SHA check passes. That path can auto-merge human commits under a stale
  patch label. The pre-split design got incidental protection here from
  `fetch-metadata`'s commit-signature verification. Impact is low (it requires push
  access to a repo with no branch protection, where that person can merge directly
  anyway) — but if you want it closed, gate on
  `github.event.pull_request.user.login` and have `resolve` also verify the head
  commit's author/verification.
- **Liveness, not safety, on the accepted race.** If the label genuinely loses the
  race, the PR silently stalls unmerged until Dependabot next re-syncs it. Design.md
  says "there will be another" — that is not guaranteed for a one-push PR. A cheap
  hardening would be adding `workflow_run` on the metadata workflow's completion, or
  just accepting the occasional manual merge. Not blocking.
- **`gh ... --json name --jq ... | grep -qx` under `set -euo pipefail`** (both
  workflows, `dependabot-metadata.yml:55`, `dependabot-auto-merge.yml:126`): if
  `grep -q` exits on first match while `gh` is still writing, `gh` takes SIGPIPE
  (141) and `pipefail` inverts the `if !` test into a spurious "label missing" →
  `gh label create` on an existing label → red job. Output is a few lines and fits
  the pipe buffer, so this is very unlikely to fire, but `grep -x ... > /dev/null`
  (no `-q`) removes the hazard entirely.
- **`maxSemver` ignores blank update types** (`src/dependabot/output.ts`): a grouped
  PR where one dependency yields no computable version delta (this repo has one such
  real commit — `Removes 'esbuild'`, empty `dependency-version:`) reports the max of
  the *remaining* deps. Inherited from the action, same as any other consumer; worth
  knowing when reading a `dependabot-semver-patch` label.
- **`workflow_run` merging a PR that edits `.github/workflows/**`** (the
  `github-actions` ecosystem group) may hit GitHub's "refusing to allow a GitHub App
  to create or update workflow" restriction on `GITHUB_TOKEN`. I could not verify
  this either way without a live run; if it bites, it fails loudly (red job, no
  merge), never unsafely.
- No `evaluation-2.md` exists for this cycle — the change dir contains only
  `evaluation-1.md`, which predates fix commit 90f366c5. I ran the gates myself
  (section 6) so this did not block the review, but the evaluator's PASS on record
  does not cover the shipped tree.
- `scripts/concertino/next-report-number.sh` does not exist in this worktree's
  checkout (its `scripts/concertino/` predates that script); I used the copy from
  the main checkout against this change dir. Not a defect of this change.
