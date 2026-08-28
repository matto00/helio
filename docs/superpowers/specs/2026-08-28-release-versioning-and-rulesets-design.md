# Release Versioning, Rulesets, and Registry Lifecycle

**Date:** 2026-08-28
**Status:** Awaiting review

## Problem

Four related administrative gaps, all touching how Helio ships:

1. **Bypass warnings on every release fast-forward.** The `Release branch protection`
   ruleset (id `15879813`) applies `creation` + `update` + `deletion` to
   `refs/heads/release/**`. The `update` rule blocks *all* pushes, fast-forward
   included, so every FF consumes the owner's bypass and emits a warning.
2. **Deploys fire on branch push.** `cd-backend.yml` and `cd-frontend.yml` trigger
   on `push: branches: ["release/**"]`, so a release cut is inseparable from a
   deploy, and there is no way to deploy a specific reviewed version.
3. **Version numbers are one major ahead of reality.** The product is a 0.7, not a
   1.7. There are **zero git tags** in the repo, so per-patch release tracking does
   not exist at all.
4. **No artifact lifecycle.** Artifact Registry holds 56 images / 27.4 GB with no
   retention policy.

## Hard Invariant: commit history is never rewritten

**No commit's SHA, author date, or committer date changes.** No `rebase`, `--amend`,
`filter-branch`, `filter-repo`, or force-push appears anywhere in this plan.

Two operations could be mistaken for rewrites; neither is:

- **Branch renames move a ref pointer.** Pushing `release/v0.6` at `82186dd7` and
  deleting `release/v1.6` changes which names point at a commit, not the commit.
- **Tag backdating stamps the tag object.** `GIT_COMMITTER_DATE`/`GIT_AUTHOR_DATE`
  set around `git tag -a` write the *tagger* date onto a new tag object that points
  at the commit. The commit is read-only in that operation.

**Mechanical gate.** A baseline of all 1134 commits was captured before any work:

```
git log --all --format='%H %aI %cI' | sort > commits-before.txt
# sha256: dc843c7cd1d8a9dde41a995d49f19e558ec767e4dfa1b45906896ff7b490dcd4
```

After every phase, `git log --all --format='%H %aI %cI' | sort` must diff clean
against that baseline (modulo commits newly added by this branch). A non-empty diff
on any pre-existing commit means the phase is reverted, not patched.

Phase 2 also *strengthens* this: `non_fast_forward` on `release/**` makes rewriting
a release branch impossible going forward. Today the owner's bypass permits it.

## Evidence base

Release branches are pure fast-forwards of `main` and carry no merge commits, so
git alone cannot say when each FF happened. **Artifact Registry is the surviving
ledger:** images are already tagged `release-v1.6-<sha8>` with push timestamps,
back to 2026-04-26 — far past GitHub Actions' retention (31 runs, oldest
2026-07-26).

Verified for all 51 registry-recorded FF deploys:

- 51/51 SHAs resolve in the local repository
- every SHA is an ancestor of its own release branch
- SHAs are in push-time order within each branch (no reordering)
- each branch's last image is exactly that branch's current tip

This makes `git log <prev-ff>..<this-ff>` a faithful per-deploy changelog.

**Known gaps.** `release/v1.0` predates SHA tagging (only hand-tags `v1`/`v3`), so
it contributes a single tag covering all 282 commits up to `4ee0fa3b`.
`release/v1.2` **never existed**.

Registry timestamps are naive UTC; they are normalized to `Z`-suffixed ISO-8601
before use. `release/v1.0`'s date comes from the commit itself and carries a real
offset.

## Version mapping

Sequential, closing the historical v1.2 gap:

| old branch | new branch | tags | count |
|---|---|---|---|
| `release/v1.0` | `release/v0.1` | `v0.1.0` | 1 |
| `release/v1.1` | `release/v0.2` | `v0.2.0` | 1 |
| `release/v1.3` | `release/v0.3` | `v0.3.0`–`v0.3.2` | 3 |
| `release/v1.4` | `release/v0.4` | `v0.4.0`–`v0.4.7` | 8 |
| `release/v1.5` | `release/v0.5` | `v0.5.0`–`v0.5.7` | 8 |
| `release/v1.6` | `release/v0.6` | `v0.6.0`–`v0.6.25` | 26 |
| `release/v1.7` | `release/v0.7` | `v0.7.0`–`v0.7.4` | 5 |

**52 tags, covering 1118 commits.** The full ledger — tag, SHA, original push
timestamp, changelog range, commit count — is committed alongside this document as
`2026-08-28-release-tag-manifest.tsv` and is the single input to the backfill.

Next release branch is cut as `release/v0.8`.

## Phased plan

Ordering is the design, not a preference. Two steps are mutually explosive:
renaming 7 branches while CD watches `release/**` fires **7 production deploys**;
creating 52 tags after CD watches `tags: v*` fires **52 production deploys**.

### Phase 1 — Disarm deploys

Change both CD workflows from `push: branches: ["release/**"]` to
`push: tags: ["v*"]`, and add `workflow_dispatch` as a manual escape hatch. Merge to
`main` first. Nothing auto-deploys for the remainder of the migration.

**Artifact naming.** The backend image tag becomes `release-<version>-<sha8>`
(e.g. `release-v0.8.0-1a2b3c4d`), continuous in shape with today's
`release-v1.6-6b269a79`.

The `release-` prefix is retained deliberately: it denotes the **channel**, not the
branch. It only looked branch-derived because release branches were historically the
only thing that deployed. Keeping it reserves `staging-v…` / `dev-v…` for future
channels, and means one keep-prefix (`release-`) covers both legacy and new images
so no image is swept merely for predating the migration.

The SHA stays at **8 characters** — `cut -c1-8`, unchanged from the current
workflow. This keeps new images at the same SHA width as the 51 already in the
registry, so an image from either scheme can be matched to a commit the same way.
(Note: GitHub's UI and `gh` abbreviate to 7 by default; 8 is this repo's existing
convention, which is the reason to keep it.)

*Caveat:* a tag pushed by Actions using the default `GITHUB_TOKEN` does **not**
trigger workflows. Tagging stays manual (which is the intent); any future automation
needs a PAT or GitHub App.

### Phase 2 — Rulesets

- **Release branches:** drop `update`, add `non_fast_forward`; drop `creation`.
  Fast-forward becomes an ordinary push with no bypass; rewrites stay refused.
- **Tags (new, `target: "tag"`):** `creation` + `deletion` on `refs/tags/v*`, with
  the owner as sole bypass actor.

The tag ruleset is **armed last**, after the backfill, so it does not fight it.

### Phase 3 — Backfill tags and releases

Driven entirely by the committed manifest, in two reviewable stages:

1. **Generate** all 52 annotated tags and their changelogs locally, writing a
   review artifact. Nothing is pushed. Owner reads it.
2. **Publish** on approval: push tags, then `gh release create --notes-file` for
   each.

Tag objects are backdated to the original push timestamp so
`git tag --sort=creatordate` reflects true chronology.

All 52 Releases are published normally — GitHub marks the newest as Latest on its
own. They are **not** flagged `prerelease`: that flag means *unstable* (alpha/beta/rc),
not *old*, and would mislabel 51 versions that genuinely shipped to production.

*To verify:* GitHub sets `published_at` itself. If the API accepts no override, all
52 Releases will show today's publish date; the true date then lives in the release
notes and the tag object.

### Phase 4 — Rename branches

For each mapping: push the new ref at the identical SHA, **verify it resolves**,
then delete the old ref. New-before-delete means the commits are never unreachable.

### Phase 5 — Registry lifecycle

An Artifact Registry cleanup policy:

- **Keep** the 10 most recent versions, unconditionally. Keep rules win over delete
  rules in Artifact Registry, so this is the rollback floor.
- **Delete** untagged images, and images tagged `release-` older than **30 days**
  that the keep rule does not cover.

**Why 30 days and not 90.** Modeled against the live registry (53 images, 31.8 GB):

| age rule | deletes | reclaims |
|---|---|---|
| >90 days | 7 | 2.4 GB |
| >60 days | 9 | 3.7 GB |
| >30 days | 26 | 14.4 GB |

47 of 53 images were pushed within the last 90 days — the bloat is recency-dense,
not old (2026-08-16 alone produced 26 images). A 90-day rule is close to a no-op and
never converges at this deploy cadence. The 30-day rule matters less for immediate
reclaim than for reaching a bounded steady state: bursts age out and the repository
settles at the keep-10 floor (~6 GB).

Aggressive retention is low-risk here precisely because of Phase 3 — every deployed
version now has a git tag and a GitHub Release, so any image is reproducible from a
known commit.

Applied in **dry-run first**. The concrete delete list is reviewed before the policy
is armed.

### Phase 6 — The release skill

`/release <major.minor>`:

1. If `release/<major.minor>` does not exist → cut it from `main`, target `x.y.0`.
2. If it exists → fast-forward it from `main`, compute `n+1` from existing tags.
3. Build the changelog from the last tag to the new tip.
4. **Show it and stop for confirmation.**
5. On approval: push the branch FF, create and push the annotated tag, publish the
   Release. The tag push is what deploys.

### Phase 7 — Cosmetics

- 9 Linear project renames (`Helio v1.3` … `v1.10` → `v0.3` … `v0.10`).
- Version references in `notes/roadmap-v2.md`, `notes/roadmap.md`,
  `development-plan.md`, `docs/cloud-dev-setup.md`, `infra/README.md`. Other `v1.x`
  grep hits are schema/proposal versions and must be left alone.
- Root `package.json` `"version": "1.0.0"` → current release version.

## Testing

- **History invariant:** baseline diff after every phase (above). Non-negotiable.
- **Manifest:** every SHA resolves, is on its branch, is in order, tips match — the
  checks already run to build it, re-run as a gate.
- **Ruleset behavior:** after Phase 2, a fast-forward push to a release branch
  succeeds with no bypass warning; a force-push is refused.
- **Deploy trigger:** after Phase 1, a branch push to `release/**` triggers no
  workflow; `workflow_dispatch` still deploys.
- **Registry policy:** dry-run output reviewed before arming; no semver-tagged image
  appears in the delete list.
- **Release skill:** exercised for both paths (new minor, patch increment) with the
  push step stubbed before it is trusted live.

## Open questions

1. Should `main` also get a ruleset requiring CI to pass before merge? Out of scope
   here, but adjacent — the repo currently has no required status checks.
2. Should the frontend get versioned artifacts too? It deploys to Firebase Hosting,
   which keeps its own release history, so this plan leaves it alone.
