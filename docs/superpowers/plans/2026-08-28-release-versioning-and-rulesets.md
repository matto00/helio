# Release Versioning, Rulesets, and Registry Lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Helio from branch-triggered deploys and untracked 1.x versioning to tag-triggered deploys with a complete, backfilled 0.x release history, enforced branch/tag rulesets, and a bounded artifact registry.

**Architecture:** Seven ordered phases. Deploys are disarmed first so that renaming branches and creating 52 tags cannot fire production rollouts; rulesets are armed around the backfill rather than before it. Every phase ends with a commit-history invariant check. The backfill is generated offline into a reviewable artifact before anything is pushed.

**Tech Stack:** GitHub Actions, GitHub REST API (rulesets, releases) via `gh`, git tags, Google Artifact Registry cleanup policies, Firebase Hosting, bash.

**Spec:** `docs/superpowers/specs/2026-08-28-release-versioning-and-rulesets-design.md`

**Manifest:** `docs/superpowers/specs/2026-08-28-release-tag-manifest.tsv` (52 rows: tag, sha8, push timestamp, changelog range, commit count)

**Baseline:** `docs/superpowers/specs/2026-08-28-commits-baseline.txt` (1123 commits, sha256 `d249f2931ff91e6db71480527809aa43faf920a5822c31481ad97a61fa00b22f`)

## Global Constraints

- **Commit history is never rewritten.** No `rebase`, `--amend`, `filter-branch`, `filter-repo`, or force-push. Any phase whose history check fails is reverted, not patched.
- **Phase order is load-bearing.** Task 2 (disarm deploys) MUST merge to `main` before Task 6 (rename branches) or Task 5 (push tags). Renaming 7 branches under the old trigger fires 7 production deploys; pushing 52 tags under the new trigger fires 52.
- **Repo:** `matto00/helio`. **Owner user id:** `64526343`. **GCP project:** `helio-493120`. **AR region:** `us-west1`.
- **Version mapping:** `v1.0→v0.1`, `v1.1→v0.2`, `v1.3→v0.3`, `v1.4→v0.4`, `v1.5→v0.5`, `v1.6→v0.6`, `v1.7→v0.7`. There is no `release/v1.2`.
- **Image tag scheme:** `release-<version>-<sha8>`, SHA at exactly 8 chars (`cut -c1-8`).
- **Existing CI job names:** `frontend`, `backend`, `security`, `e2e`.
- **Releases:** all 52 git tags; GitHub Releases for the 7 `x.y.0` minors only.

## The history invariant check

Run after every mutating task. Referenced below as **"run the history check"**.

```bash
cd /home/matt/Development/helio
git fetch --all --tags --prune -q
git log --format='%H %aI %cI' origin/main $(git branch -r --list 'origin/release/*' | tr -d ' ' | tr '\n' ' ') | sort -u > /tmp/helio-history-now.txt
comm -23 docs/superpowers/specs/2026-08-28-commits-baseline.txt /tmp/helio-history-now.txt > /tmp/helio-history-lost.txt
if [ -s /tmp/helio-history-lost.txt ]; then
  echo "FAIL: baseline commits altered or unreachable:"; cat /tmp/helio-history-lost.txt; exit 1
fi
echo "PASS: all 1123 baseline commits intact with original dates"
```

**Scope note.** The baseline covers commits reachable from `origin/main` and the
release branches — the history this migration touches — NOT `git log --all`. An
earlier `--all` baseline captured a sibling worktree's in-flight branch
(`bug/reject-mistyped-step-config/HEL-860`); when that PR was squash-merged and its
worktree removed by another session, the pre-squash commits became unreachable and
the check reported a false failure. Unreferenced commits on other people's branches
are not this migration's to preserve.

`comm -23` is deliberate: it reports baseline lines *absent* from the current state. New commits added by this work are expected and ignored.

---

### Task 1: Make CI always report a status

Required status checks cannot be added until CI reports on every PR. `ci.yml` currently declares `paths-ignore` for `**.md`, `LICENSE`, `.github/ISSUE_TEMPLATE/**`, and `docs/**`. A skipped workflow reports **no status at all**, so requiring its jobs would leave any docs-only PR permanently pending. This plan's own branch is docs-only and would be the first casualty.

**Files:**
- Modify: `.github/workflows/ci.yml:3-17` (trigger block), and append a new `ci-complete` job

**Interfaces:**
- Produces: a job named `ci-complete` — the single required status check consumed by Task 4.

- [ ] **Step 1: Remove `paths-ignore` from both triggers**

Replace lines 3–17 of `.github/workflows/ci.yml` with:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

Rationale: the four jobs already cache aggressively, and correctness of the merge gate outweighs skipping a docs-only run. Path-based skipping is reintroduced *inside* jobs only if run time becomes a problem — never at the trigger level again, because that is what breaks required checks.

- [ ] **Step 2: Append the aggregator job**

Add at the end of `.github/workflows/ci.yml` (top-level under `jobs:`, 2-space indent to match `e2e`):

```yaml
  # Single required status check for the `main` ruleset. Individual jobs may be
  # skipped by future path filters; a skipped job reports "skipped", which this
  # gate treats as success. Only failure/cancelled fail the gate. Never add
  # `paths-ignore` to this workflow's triggers — a skipped WORKFLOW reports no
  # status at all and would block every affected PR permanently.
  ci-complete:
    if: always()
    needs: [frontend, backend, security, e2e]
    runs-on: ubuntu-latest
    steps:
      - name: Verify no job failed or was cancelled
        run: |
          set -euo pipefail
          echo "results: ${{ join(needs.*.result, ', ') }}"
          if ${{ contains(needs.*.result, 'failure') }}; then
            echo "A required CI job failed." >&2; exit 1
          fi
          if ${{ contains(needs.*.result, 'cancelled') }}; then
            echo "A required CI job was cancelled." >&2; exit 1
          fi
          echo "All CI jobs succeeded or were skipped."
```

- [ ] **Step 3: Validate the workflow parses**

```bash
cd /home/matt/Development/helio/.claude/worktrees/task/release-versioning-and-rulesets
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/ci.yml')); \
print('jobs:', list(d['jobs'].keys())); \
assert 'ci-complete' in d['jobs'], 'aggregator missing'; \
assert 'paths-ignore' not in str(d[True]), 'paths-ignore still present'; \
print('OK')"
```

Expected: `jobs: ['frontend', 'backend', 'security', 'e2e', 'ci-complete']` then `OK`.

Note `d[True]` — YAML parses the bare key `on` as boolean true.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "Always report a CI status via a ci-complete aggregator job

Removes trigger-level paths-ignore. A skipped workflow reports no status,
so requiring CI on main would block every docs-only PR permanently.
ci-complete runs with if: always() and treats skipped jobs as success,
making it a safe single required check."
```

---

### Task 2: Move deploys from branch push to tag push

This is the disarming step. Until it is merged to `main`, Tasks 5 and 6 are unsafe.

**Files:**
- Modify: `.github/workflows/cd-backend.yml` (trigger + image tag steps)
- Modify: `.github/workflows/cd-frontend.yml` (trigger + add artifact push + deploy message)

**Interfaces:**
- Consumes: nothing.
- Produces: both CD workflows trigger on `push: tags: ["v*"]`; both compute `VERSION=${{ github.ref_name }}` and `SHA=$(echo "${{ github.sha }}" | cut -c1-8)`; both publish/stamp `release-${VERSION}-${SHA}`.

- [ ] **Step 1: Retarget the backend trigger**

In `.github/workflows/cd-backend.yml`, replace:

```yaml
on:
  push:
    branches: ["release/**"]
```

with:

```yaml
# Deploys are triggered by pushing a version tag (see /release), never by a
# branch push. A release branch fast-forward no longer deploys on its own.
# NOTE: a tag pushed by Actions with the default GITHUB_TOKEN does NOT trigger
# workflows — tagging is deliberately manual. Automating it needs a PAT/App.
on:
  push:
    tags: ["v*"]
  workflow_dispatch:
    inputs:
      tag:
        description: "Existing version tag to deploy (e.g. v0.7.4)"
        required: true
```

- [ ] **Step 2: Make the backend checkout and image tag version-aware**

Replace the `Build and push image` step's `run:` block with:

```yaml
        run: |
          set -euo pipefail
          VERSION="${{ github.event.inputs.tag || github.ref_name }}"
          SHA=$(echo "${{ github.sha }}" | cut -c1-8)
          IMAGE=us-west1-docker.pkg.dev/helio-493120/helio-backend/helio-backend:release-${VERSION}-${SHA}
          echo "IMAGE=$IMAGE" >> "$GITHUB_ENV"
          docker build -t "$IMAGE" .
          docker push "$IMAGE"
```

Also add `ref: ${{ github.event.inputs.tag || github.ref }}` under the `actions/checkout@v7` step's `with:` so `workflow_dispatch` checks out the requested tag.

The `release-` prefix denotes the deploy **channel**, not a branch, reserving `staging-`/`dev-` for later. Keeping it also means one AR keep-prefix covers legacy and new images alike.

- [ ] **Step 3: Retarget the frontend trigger identically**

Apply the same `on:` block and the same `checkout` `ref:` line to `.github/workflows/cd-frontend.yml`.

- [ ] **Step 4: Add frontend artifact parity**

In `.github/workflows/cd-frontend.yml`, after the `Build` step and before the Firebase deploy, insert:

```yaml
      - name: Configure Docker
        run: gcloud auth configure-docker us-west1-docker.pkg.dev

      # Artifact of record for the frontend, at 1:1 parity with the backend:
      # same registry, same release-<version>-<sha8> scheme, therefore the same
      # retention policy. This image is NOT the deploy vehicle (Firebase Hosting
      # serves the assets) — it exists for traceability and rollback.
      - name: Build and push frontend artifact
        run: |
          set -euo pipefail
          VERSION="${{ github.event.inputs.tag || github.ref_name }}"
          SHA=$(echo "${{ github.sha }}" | cut -c1-8)
          IMAGE=us-west1-docker.pkg.dev/helio-493120/helio-frontend/helio-frontend:release-${VERSION}-${SHA}
          echo "FRONTEND_IMAGE=$IMAGE" >> "$GITHUB_ENV"
          cat > /tmp/Dockerfile.artifact <<'EOF'
          FROM scratch
          COPY dist /dist
          EOF
          docker build -f /tmp/Dockerfile.artifact -t "$IMAGE" frontend
          docker push "$IMAGE"
```

- [ ] **Step 5: Stamp the Firebase release with the version**

Replace the frontend deploy step's `run:` with:

```yaml
        run: |
          set -euo pipefail
          VERSION="${{ github.event.inputs.tag || github.ref_name }}"
          SHA=$(echo "${{ github.sha }}" | cut -c1-8)
          npx firebase-tools deploy --only hosting --project helio-493120 \
            --message "release-${VERSION}-${SHA}"
```

Firebase Hosting keeps its own release history; today it records no version. This is where the frontend's deploys are actually visible.

- [ ] **Step 6: Create the frontend AR repository**

```bash
gcloud artifacts repositories create helio-frontend \
  --repository-format=docker --location=us-west1 --project=helio-493120 \
  --description="Frontend build artifacts (traceability/rollback; not the deploy vehicle)"
gcloud artifacts repositories list --project=helio-493120
```

Expected: both `helio-backend` and `helio-frontend` listed.

- [ ] **Step 7: Verify both workflows parse and no branch trigger remains**

```bash
cd /home/matt/Development/helio/.claude/worktrees/task/release-versioning-and-rulesets
for f in .github/workflows/cd-backend.yml .github/workflows/cd-frontend.yml; do
  python3 -c "
import yaml,sys
d=yaml.safe_load(open('$f')); on=d[True]
assert 'branches' not in on.get('push',{}), '$f still triggers on branch push'
assert on['push']['tags']==['v*'], '$f tag filter wrong'
assert 'workflow_dispatch' in on, '$f missing manual dispatch'
print('$f OK')"
done
grep -rn 'release/\*\*' .github/workflows/ && echo "FAIL: branch trigger remains" || echo "PASS: no release/** trigger"
```

- [ ] **Step 8: Commit, open PR, merge to main**

```bash
git add .github/workflows/
git commit -m "Trigger deploys on version tags instead of release-branch pushes

Disarms branch-push deploys so the 0.x migration can rename release
branches and backfill 52 tags without firing production rollouts.
Adds workflow_dispatch as a manual escape hatch, versions the backend
image as release-<version>-<sha8>, and brings the frontend to parity
with a helio-frontend artifact plus a versioned firebase deploy message."
git push -u origin task/release-versioning-and-rulesets
gh pr create --title "Release versioning: tag-triggered deploys, rulesets, 0.x backfill" \
  --body "Implements docs/superpowers/specs/2026-08-28-release-versioning-and-rulesets-design.md"
```

- [ ] **Step 9: Confirm the disarm actually took effect**

After the PR merges, verify on `main`:

```bash
cd /home/matt/Development/helio && git fetch -q origin
git show origin/main:.github/workflows/cd-backend.yml | grep -A3 '^on:'
```

Expected: `tags: ["v*"]`, no `branches:`. **Do not start Task 5 or 6 until this shows the tag trigger on `main`.**

- [ ] **Step 10: Run the history check**

---

### Task 3: Fix the release-branch ruleset

Removes the bypass warning on every fast-forward. Ruleset `15879813` currently applies `creation` + `update` + `deletion` to `refs/heads/release/**`; `update` blocks *all* pushes including fast-forwards, which is why every FF consumes the owner bypass.

**Files:**
- Create: `infra/rulesets/release-branches.json`

**Interfaces:**
- Consumes: nothing.
- Produces: ruleset `15879813` enforcing `deletion` + `non_fast_forward` only.

- [ ] **Step 1: Capture the current ruleset for rollback**

```bash
mkdir -p /home/matt/Development/helio/.claude/worktrees/task/release-versioning-and-rulesets/infra/rulesets
cd /home/matt/Development/helio/.claude/worktrees/task/release-versioning-and-rulesets
gh api repos/matto00/helio/rulesets/15879813 > infra/rulesets/release-branches.before.json
jq '.rules[].type' infra/rulesets/release-branches.before.json
```

Expected: `"creation"`, `"update"`, `"deletion"`.

- [ ] **Step 2: Write the desired ruleset**

Create `infra/rulesets/release-branches.json`:

```json
{
  "name": "Release branch protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/release/**"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" }
  ],
  "bypass_actors": [
    { "actor_id": 64526343, "actor_type": "User", "bypass_mode": "always" }
  ]
}
```

`creation` is dropped so cutting `release/v0.8` needs no bypass. `update` is replaced by `non_fast_forward`, which permits fast-forwards and refuses rewrites — strictly safer than today, where the owner's bypass could force-push a release branch.

- [ ] **Step 3: Apply it**

```bash
gh api repos/matto00/helio/rulesets/15879813 -X PUT --input infra/rulesets/release-branches.json
gh api repos/matto00/helio/rulesets/15879813 --jq '[.rules[].type]'
```

Expected: `["deletion","non_fast_forward"]`

- [ ] **Step 4: Prove a fast-forward no longer warns**

The real test is Task 6's renames. For an immediate check, confirm the rule set contains no `update` rule and that `non_fast_forward` is present — a force-push test against a live release branch is deliberately NOT performed, since the whole point of the ruleset is to refuse it.

```bash
gh api repos/matto00/helio/rulesets/15879813 --jq \
  'if ([.rules[].type] | index("update")) then "FAIL: update rule still present" else "PASS: fast-forward permitted" end'
```

- [ ] **Step 5: Commit**

```bash
git add infra/rulesets/
git commit -m "Replace release-branch 'update' rule with non_fast_forward

'update' blocks all pushes including fast-forwards, so every release FF
consumed the owner bypass. non_fast_forward permits FF and refuses
rewrites, which is strictly safer than the previous bypass-able state.
Drops 'creation' so cutting a new release branch needs no bypass."
```

- [ ] **Step 6: Run the history check**

---

### Task 4: Require CI to pass before merging to main

Depends on Task 1 being merged, or every subsequent PR blocks.

**Files:**
- Create: `infra/rulesets/main-branch.json`

- [ ] **Step 1: Confirm `ci-complete` has reported at least once**

```bash
gh run list --workflow=ci.yml --limit 5 --json headBranch,conclusion,jobs 2>/dev/null | head
gh api repos/matto00/helio/commits/main/check-runs --jq '[.check_runs[].name]'
```

Expected: `ci-complete` appears. If it does not, Task 1 has not merged — **stop**; adding the required check now would block all PRs.

- [ ] **Step 2: Write the ruleset**

Create `infra/rulesets/main-branch.json`:

```json
{
  "name": "main - require CI",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [{ "context": "ci-complete" }]
      }
    }
  ],
  "bypass_actors": []
}
```

`ci-complete` is the required context, not the four individual jobs — those may legitimately skip.

`strict_required_status_checks_policy: false` does not force a branch to be up to date with `main` before merging; set it to `true` only if stale-branch merges become a problem, as it forces a rebuild on every intervening merge.

- [ ] **Step 3: Apply as a new ruleset**

The existing `main - no delete` ruleset (`14964282`) already carries `deletion` + `non_fast_forward`. Update it in place rather than creating an overlapping second ruleset:

```bash
gh api repos/matto00/helio/rulesets/14964282 > infra/rulesets/main-branch.before.json
gh api repos/matto00/helio/rulesets/14964282 -X PUT --input infra/rulesets/main-branch.json
gh api repos/matto00/helio/rulesets/14964282 --jq '[.rules[].type]'
```

Expected: `["deletion","non_fast_forward","required_status_checks"]`

- [ ] **Step 4: Verify a docs-only PR is not deadlocked**

This is the specific failure Task 1 exists to prevent, so prove it:

```bash
gh pr checks --repo matto00/helio <this-PR-number>
```

Expected: `ci-complete` reports a conclusion (not indefinitely pending) even though this branch is largely docs.

- [ ] **Step 5: Commit**

```bash
git add infra/rulesets/
git commit -m "Require ci-complete to pass before merging to main

Requires the aggregator context rather than the four individual jobs,
so a skipped job cannot leave a PR permanently pending. Removes the
reason dependabot-auto-merge.yml reimplements CI gating; retiring that
workflow is a tracked follow-up, not bundled here."
```

- [ ] **Step 6: Run the history check**

---

### Task 5: Generate the tag and changelog backfill (offline)

Nothing is pushed in this task. It produces a review artifact.

**Files:**
- Create: `scripts/release/backfill-tags.sh`
- Create (generated, gitignored): `/tmp/helio-backfill/`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-08-28-release-tag-manifest.tsv` (columns: tag, sha8, ISO timestamp, changelog range, commit count)
- Produces: local annotated tags `v0.1.0`…`v0.7.4`; per-tag notes at `/tmp/helio-backfill/notes/<tag>.md`; a summary at `/tmp/helio-backfill/REVIEW.md`

- [ ] **Step 1: Write the generator**

Create `scripts/release/backfill-tags.sh`:

```bash
#!/usr/bin/env bash
# Reconstructs one annotated tag + changelog per historical deploy, from the
# manifest derived from Artifact Registry push records. Creates tags LOCALLY
# only — pushing is a separate, reviewed step.
#
# Tag objects are backdated via GIT_COMMITTER_DATE/GIT_AUTHOR_DATE. That stamps
# the TAG object's tagger date; the commit it points at is not modified.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
MANIFEST="$REPO_ROOT/docs/superpowers/specs/2026-08-28-release-tag-manifest.tsv"
OUT=/tmp/helio-backfill
rm -rf "$OUT"; mkdir -p "$OUT/notes"

: > "$OUT/REVIEW.md"
{
  echo "# Backfill review"
  echo
  echo "| tag | commit | original push | commits |"
  echo "|---|---|---|---|"
} >> "$OUT/REVIEW.md"

while IFS=$'\t' read -r TAG SHA TS RANGE COUNT; do
  [ -n "$TAG" ] || continue

  git rev-parse -q --verify "${SHA}^{commit}" >/dev/null \
    || { echo "FATAL: $TAG -> $SHA does not resolve" >&2; exit 1; }

  # Normalize the registry's naive-UTC timestamps; leave offset-bearing ones be.
  case "$TS" in
    *Z|*+*|*-??:??) STAMP="$TS" ;;
    *) STAMP="${TS}Z" ;;
  esac

  NOTES="$OUT/notes/${TAG}.md"
  {
    echo "## ${TAG}"
    echo
    echo "Deployed ${STAMP} from \`${SHA}\`."
    echo
    echo "### Changes"
    echo
    git log --format='- %s' "$RANGE" 2>/dev/null || git log --format='- %s' -1 "$SHA"
  } > "$NOTES"

  GIT_COMMITTER_DATE="$STAMP" GIT_AUTHOR_DATE="$STAMP" \
    git tag -a "$TAG" -F "$NOTES" "$SHA" -f

  printf '| %s | `%s` | %s | %s |\n' "$TAG" "$SHA" "$STAMP" "$COUNT" >> "$OUT/REVIEW.md"
done < "$MANIFEST"

echo "Generated $(git tag -l 'v0.*' | wc -l) tags into the local repo."
echo "Review: $OUT/REVIEW.md and $OUT/notes/"
```

`-f` on `git tag` makes the generator rerunnable; it replaces local tag objects only and never touches commits.

- [ ] **Step 2: Run it**

```bash
cd /home/matt/Development/helio/.claude/worktrees/task/release-versioning-and-rulesets
chmod +x scripts/release/backfill-tags.sh
./scripts/release/backfill-tags.sh
```

Expected: `Generated 52 tags into the local repo.`

- [ ] **Step 3: Verify tags point where the manifest says, and chronology is right**

```bash
fails=0
while IFS=$'\t' read -r TAG SHA TS RANGE COUNT; do
  actual=$(git rev-parse --short=8 "${TAG}^{commit}")
  [ "$actual" = "$SHA" ] || { echo "MISMATCH $TAG: $actual != $SHA"; fails=1; }
done < docs/superpowers/specs/2026-08-28-release-tag-manifest.tsv
[ $fails -eq 0 ] && echo "PASS: all 52 tags point at their manifest commit"

echo "--- chronological order (must be ascending by version) ---"
git tag -l 'v0.*' --sort=creatordate | head -5
git tag -l 'v0.*' --sort=creatordate | tail -5
```

Expected: no mismatches; first tags are `v0.1.0`/`v0.2.0`, last is `v0.7.4`.

- [ ] **Step 4: Confirm no commit was touched**

Run the history check. This is the most important assertion in the plan — tag backdating is the one step that could plausibly rewrite something.

- [ ] **Step 5: Read the review artifact**

```bash
cat /tmp/helio-backfill/REVIEW.md
cat /tmp/helio-backfill/notes/v0.6.0.md
cat /tmp/helio-backfill/notes/v0.7.4.md
```

**STOP.** Present `REVIEW.md` and two sample changelogs to the user for approval before Task 6.

- [ ] **Step 6: Commit the generator**

```bash
git add scripts/release/backfill-tags.sh
git commit -m "Add offline tag/changelog backfill generator

Reconstructs 52 annotated tags from the Artifact Registry push ledger.
Creates tags locally only; pushing is a separate reviewed step. Tag
objects are backdated via GIT_COMMITTER_DATE, which stamps the tag
object and leaves the referenced commit untouched."
```

---

### Task 6: Publish tags and the 7 minor releases

Requires Task 2 merged to `main` (else 52 production deploys) and Task 5 approved.

- [ ] **Step 1: Re-confirm deploys are disarmed**

```bash
cd /home/matt/Development/helio && git fetch -q origin
git show origin/main:.github/workflows/cd-backend.yml | python3 -c \
"import yaml,sys; on=yaml.safe_load(sys.stdin)[True]; \
assert 'branches' not in on.get('push',{}), 'ABORT: branch trigger live'; \
print('disarmed; tags:', on['push']['tags'])"
```

Expected: `disarmed; tags: ['v*']`. **If this fails, stop.**

Pushing tags now WILL trigger `cd-backend`/`cd-frontend` for each tag. That is why the tag ruleset (Task 8) is not yet armed and why the next step pushes one tag first.

- [ ] **Step 2: Disable the CD workflows BEFORE pushing any tag**

Task 2 made tag pushes deploy. Pushing 52 historical tags with CD live would
roll each one out to production in turn — including deploying `v0.1.0`, the
April build, over current prod. Disable first; there is no race to win.

```bash
gh workflow disable cd-backend.yml
gh workflow disable cd-frontend.yml
gh workflow list --all | grep -i 'cd '
```

Expected: both show `disabled_manually`. **Do not proceed until they do.**

- [ ] **Step 3: Push all 52 tags and confirm nothing deployed**

```bash
cd /home/matt/Development/helio/.claude/worktrees/task/release-versioning-and-rulesets
git push origin --tags
git ls-remote --tags origin | grep -c 'refs/tags/v0\.'
sleep 15
gh run list --limit 10 --json workflowName,event,status,createdAt
```

Expected: `52` tags on the remote, and **no** `CD Backend` / `CD Frontend` runs.
If any CD run appears, cancel it immediately and stop:

```bash
gh run list --limit 20 --json databaseId,workflowName,status \
  --jq '.[] | select(.status=="in_progress" or .status=="queued") | .databaseId' \
  | xargs -r -n1 gh run cancel
```

- [ ] **Step 4: Create the 7 minor Releases**

The REST API accepts no `published_at`, so only minors get Releases; all 52 tags exist regardless.

```bash
for TAG in v0.1.0 v0.2.0 v0.3.0 v0.4.0 v0.5.0 v0.6.0 v0.7.0; do
  gh release create "$TAG" \
    --title "$TAG" \
    --notes-file "/tmp/helio-backfill/notes/${TAG}.md" \
    --verify-tag
  echo "created $TAG"
done
gh release list --limit 10
```

- [ ] **Step 5: Check which date the UI renders**

The one remaining open question from the spec.

```bash
gh api repos/matto00/helio/releases --jq '.[] | {tag_name, created_at, published_at}' | head -20
```

If `created_at` carries the true historical date and the Releases page renders it, expanding to all 52 is a loop over the manifest. Report the finding; do not expand without approval.

- [ ] **Step 6: Re-enable the CD workflows**

Only after every tag is pushed and every Release is created.

```bash
gh workflow enable cd-backend.yml
gh workflow enable cd-frontend.yml
gh workflow list
```

- [ ] **Step 7: Run the history check**

---

### Task 7: Rename release branches to 0.x

Safe only because Task 2 is merged. New ref is pushed and verified **before** the old is deleted, so commits are never unreachable.

- [ ] **Step 1: Rename, new-before-delete**

```bash
cd /home/matt/Development/helio && git fetch -q origin
set -euo pipefail
for pair in "1.0 0.1" "1.1 0.2" "1.3 0.3" "1.4 0.4" "1.5 0.5" "1.6 0.6" "1.7 0.7"; do
  old=${pair% *}; new=${pair#* }
  sha=$(git rev-parse "origin/release/v${old}")
  git push origin "${sha}:refs/heads/release/v${new}"
  got=$(git ls-remote origin "refs/heads/release/v${new}" | cut -f1)
  [ "$got" = "$sha" ] || { echo "ABORT: release/v${new} is $got, expected $sha"; exit 1; }
  echo "verified release/v${new} = $sha"
done
```

No `--force` anywhere. Each new branch is confirmed at the identical SHA before anything is deleted.

- [ ] **Step 2: Delete the old refs**

```bash
for old in 1.0 1.1 1.3 1.4 1.5 1.6 1.7; do
  git push origin --delete "release/v${old}"
done
git fetch --prune -q origin
git branch -r | grep release/
```

Expected: only `origin/release/v0.1` … `origin/release/v0.7`.

- [ ] **Step 3: Confirm no deploys fired and no bypass was needed**

```bash
gh run list --limit 10 --json workflowName,event,createdAt
```

Expected: no `CD Backend` / `CD Frontend` runs from these pushes. The absence of a bypass warning on these 7 pushes is the practical confirmation that Task 3 worked.

- [ ] **Step 4: Run the history check**

This is the highest-risk task for the invariant. All 1123 baseline commits must still be reachable and unchanged, now via the renamed refs.

---

### Task 8: Arm the tag ruleset

Armed last so it does not fight the backfill.

**Files:**
- Create: `infra/rulesets/tags.json`

- [ ] **Step 1: Write it**

```json
{
  "name": "Version tag protection",
  "target": "tag",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
  "rules": [
    { "type": "creation" },
    { "type": "deletion" },
    { "type": "update" }
  ],
  "bypass_actors": [
    { "actor_id": 64526343, "actor_type": "User", "bypass_mode": "always" }
  ]
}
```

Only the owner may create, move, or delete a version tag. Since a tag push now deploys, this is the production-deploy gate.

- [ ] **Step 2: Apply and verify**

```bash
cd /home/matt/Development/helio/.claude/worktrees/task/release-versioning-and-rulesets
gh api repos/matto00/helio/rulesets -X POST --input infra/rulesets/tags.json --jq '{id,name,target}'
gh api repos/matto00/helio/rulesets --jq '.[] | {id,name,target}'
```

Expected: three rulesets — two `branch`, one `tag`.

- [ ] **Step 3: Commit**

```bash
git add infra/rulesets/tags.json
git commit -m "Protect version tags; only the owner may create or delete them

A tag push now deploys to production, so this ruleset is the deploy gate.
Armed after the backfill so it does not block creating the 52 historical tags."
```

---

### Task 9: Artifact Registry retention

**Files:**
- Create: `infra/artifact-registry-cleanup.json`

- [ ] **Step 1: Write the policy**

```json
[
  {
    "name": "keep-recent-releases",
    "action": { "type": "Keep" },
    "mostRecentVersions": { "keepCount": 10 }
  },
  {
    "name": "delete-untagged",
    "action": { "type": "Delete" },
    "condition": { "tagState": "UNTAGGED", "olderThan": "7d" }
  },
  {
    "name": "delete-aged-releases",
    "action": { "type": "Delete" },
    "condition": { "tagState": "TAGGED", "tagPrefixes": ["release-"], "olderThan": "30d" }
  }
]
```

Keep rules win over Delete rules in Artifact Registry, so the 10 most recent survive regardless of age. 30 days rather than 90 because 47 of 53 images are within 90 days — a 90-day rule reclaims 2.4 GB of 31.8 GB and never converges, while 30 days reclaims 14.4 GB and settles at the keep-10 floor.

- [ ] **Step 2: Dry-run and read the delete list**

```bash
cd /home/matt/Development/helio/.claude/worktrees/task/release-versioning-and-rulesets
for REPO in helio-backend helio-frontend; do
  gcloud artifacts repositories set-cleanup-policies "$REPO" \
    --location=us-west1 --project=helio-493120 \
    --policy=infra/artifact-registry-cleanup.json --dry-run
done
gcloud artifacts docker images list \
  us-west1-docker.pkg.dev/helio-493120/helio-backend --include-tags | wc -l
```

Dry-run marks the policy without deleting. Inspect Cloud Logging for `cleanup_policy` dry-run entries listing candidate deletions.

- [ ] **Step 3: STOP for approval**

Present the candidate delete list. Expected shape: ~26 images, ~14.4 GB, all `release-v1.x-*` older than 30 days. **No image whose tag matches a current release should appear.**

- [ ] **Step 4: Arm it**

```bash
for REPO in helio-backend helio-frontend; do
  gcloud artifacts repositories set-cleanup-policies "$REPO" \
    --location=us-west1 --project=helio-493120 \
    --policy=infra/artifact-registry-cleanup.json
done
gcloud artifacts repositories describe helio-backend \
  --location=us-west1 --project=helio-493120 --format='value(cleanupPolicies)'
```

- [ ] **Step 5: Commit**

```bash
git add infra/artifact-registry-cleanup.json
git commit -m "Bound Artifact Registry growth: keep 10 newest, reap release- over 30d

30 days rather than 90 on modeled evidence: 47 of 53 images are within
90 days, so a 90-day rule reclaims 2.4 GB of 31.8 GB and never
converges. Low risk now that every deployed version has a git tag."
```

---

### Task 10: The `/release` skill

**Files:**
- Create: `.claude/commands/release.md`
- Create: `scripts/release/cut-release.sh`

**Interfaces:**
- Consumes: the tag scheme `v<major>.<minor>.<patch>` and branches `release/v<major>.<minor>`.
- Produces: `scripts/release/cut-release.sh <major.minor>` — prints a plan and the changelog, and acts only after explicit confirmation.

- [ ] **Step 1: Write the script**

Create `scripts/release/cut-release.sh`:

```bash
#!/usr/bin/env bash
# Cut a release: create release/v<M.m> at <M.m>.0, or fast-forward it and
# tag <M.m>.<n+1>. Pushing the TAG is what deploys.
set -euo pipefail

MM="${1:-}"
[[ "$MM" =~ ^[0-9]+\.[0-9]+$ ]] || { echo "usage: cut-release.sh <major.minor>  e.g. 0.8" >&2; exit 1; }

BRANCH="release/v${MM}"
git fetch --all --tags --prune -q

if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  LAST=$(git tag -l "v${MM}.*" --sort=-v:refname | head -1)
  [ -n "$LAST" ] || { echo "Branch $BRANCH exists but has no v${MM}.* tag; aborting." >&2; exit 1; }
  NEXT="v${MM}.$(( ${LAST##*.} + 1 ))"
  BASE="$LAST"
  MODE="patch"
else
  NEXT="v${MM}.0"
  PREV_MINOR=$(git branch -r --list 'origin/release/v*' \
    | sed 's|.*release/v||' | sort -V | tail -1)
  BASE=$([ -n "$PREV_MINOR" ] && echo "origin/release/v${PREV_MINOR}" || echo "")
  MODE="minor"
fi

TARGET=$(git rev-parse origin/main)
SHA8=$(git rev-parse --short=8 origin/main)
RANGE=$([ -n "$BASE" ] && echo "${BASE}..${TARGET}" || echo "$TARGET")

NOTES=$(mktemp)
{
  echo "## ${NEXT}"
  echo
  echo "Released from \`${SHA8}\`."
  echo
  echo "### Changes"
  echo
  git log --format='- %s' "$RANGE"
} > "$NOTES"

cat <<EOF

  mode:     $MODE
  branch:   $BRANCH $([ "$MODE" = minor ] && echo "(will be created)" || echo "(will fast-forward)")
  tag:      $NEXT
  target:   $SHA8
  range:    $RANGE
  commits:  $(git log --oneline "$RANGE" | wc -l)

EOF
cat "$NOTES"
echo
read -r -p "Push $BRANCH and tag $NEXT? This DEPLOYS. [y/N] " ans
[ "$ans" = "y" ] || { echo "Aborted."; rm -f "$NOTES"; exit 0; }

git push origin "${TARGET}:refs/heads/${BRANCH}"
git tag -a "$NEXT" -F "$NOTES" "$TARGET"
git push origin "$NEXT"
gh release create "$NEXT" --title "$NEXT" --notes-file "$NOTES" --verify-tag
rm -f "$NOTES"
echo "Released $NEXT. Deploy triggered by the tag push."
```

Note `git push origin <sha>:refs/heads/<branch>` is a fast-forward push, never `--force` — the `non_fast_forward` rule from Task 3 will refuse anything else, which is the intended safety net.

- [ ] **Step 2: Test both paths without pushing**

Comment out the four push/release lines, then:

```bash
chmod +x scripts/release/cut-release.sh
./scripts/release/cut-release.sh 0.7   # expect: mode=patch, tag v0.7.5
./scripts/release/cut-release.sh 0.8   # expect: mode=minor, tag v0.8.0
./scripts/release/cut-release.sh 1     # expect: usage error, exit 1
```

Restore the lines after verifying. Do not trust the script live until all three behave.

- [ ] **Step 3: Write the slash command**

Create `.claude/commands/release.md`:

```markdown
---
description: Cut a release — create or fast-forward a release branch, tag it, and publish a GitHub Release with a generated changelog.
---

Cut a release for version `$ARGUMENTS` (a `major.minor`, e.g. `0.8`).

Run `scripts/release/cut-release.sh $ARGUMENTS` and show the user its full
output — the mode, target commit, and generated changelog — before it acts.

The script prompts for confirmation itself. Do not answer the prompt on the
user's behalf: pushing the tag triggers a production deploy.

If the changelog looks wrong, abort and investigate rather than editing notes
after the fact — a published Release's notes and its tag should agree.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/release/cut-release.sh .claude/commands/release.md
git commit -m "Add /release: cut a minor or patch release with a generated changelog

Resolves major.minor to either a new release branch at x.y.0 or a
fast-forward plus x.y.(n+1), generates the changelog from the previous
tag, and requires explicit confirmation because the tag push deploys."
```

---

### Task 11: Update version references

**Files:**
- Modify: `package.json:3`
- Modify: `notes/roadmap-v2.md`, `notes/roadmap.md`, `development-plan.md`, `docs/cloud-dev-setup.md`, `infra/README.md`
- Modify: Linear project names (9)

- [ ] **Step 1: Fix the root version**

```bash
cd /home/matt/Development/helio/.claude/worktrees/task/release-versioning-and-rulesets
python3 - <<'EOF'
import json,io
p='package.json'; s=open(p).read()
s=s.replace('"version": "1.0.0"','"version": "0.7.4"',1)
open(p,'w').write(s)
EOF
grep -n '"version"' package.json
```

- [ ] **Step 2: Update the five doc files by hand**

Review each `v1.x` occurrence and rewrite per the mapping. **Do not run a blanket sed** — most `v1.x` matches elsewhere in the repo are schema and proposal versions (`DataSource.scala`, `proposal.ts`, migration SQL, `*.schema.json`) and must not change.

```bash
grep -n 'v1\.[0-9]' notes/roadmap-v2.md notes/roadmap.md development-plan.md docs/cloud-dev-setup.md infra/README.md
```

Apply the mapping `v1.0→v0.1, v1.1→v0.2, v1.3→v0.3, v1.4→v0.4, v1.5→v0.5, v1.6→v0.6, v1.7→v0.7, v1.8→v0.8, v1.9→v0.9, v1.10→v0.10`.

- [ ] **Step 3: Confirm no unintended file changed**

```bash
git diff --name-only
```

Expected: only `package.json` and the five doc files.

- [ ] **Step 4: Rename the Linear projects**

Using the Linear MCP `save_project` for each: `Helio v1.3 …`→`Helio v0.3 …`, `v1.3.1`→`v0.3.1`, `v1.4`→`v0.4`, `v1.5`→`v0.5`, `v1.6`→`v0.6`, `v1.7`→`v0.7`, `v1.8`→`v0.8`, `v1.9`→`v0.9`, `v1.10`→`v0.10`. Change only the version token; leave each project's descriptive suffix intact.

- [ ] **Step 5: Commit**

```bash
git add package.json notes/ development-plan.md docs/cloud-dev-setup.md infra/README.md
git commit -m "Renumber version references from 1.x to 0.x

Doc and package.json references only. Schema and proposal 'v1' strings
elsewhere in the repo are unrelated version namespaces and are untouched."
```

- [ ] **Step 6: Run the history check, final**

---

## Follow-ups (not in this plan)

- **Retire or simplify `dependabot-auto-merge.yml`.** It exists only because `main` had no required checks; Task 4 removes that reason. It is load-bearing (HEL-459 CVE gating shares the CI run) and needs its own reviewed change.
- **Update the "never `gh pr merge --auto` on helio" convention.** Task 4 makes `--auto` safe; the standing guidance becomes wrong.
- **Possibly expand to 52 GitHub Releases** if Task 6 Step 5 shows the UI renders `created_at`.
