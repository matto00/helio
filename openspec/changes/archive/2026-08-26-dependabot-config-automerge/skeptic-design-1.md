## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **`sbt` Dependabot ecosystem claim — CONFIRMED TRUE.** Fetched
   `https://docs.github.com/en/code-security/dependabot/ecosystems-supported-by-dependabot/supported-ecosystems-and-repositories`
   fresh and parsed the supported-ecosystems table row for sbt.
   Header columns: `Package manager | YAML value | Supported versions | Version updates | Security updates | Private repositories | Private registries | Vendoring`.
   sbt row: `sbt | sbt | Not applicable | Supported | Not supported | Supported | Supported | Not supported`.
   The design's correction of the ticket premise is exactly right, including
   the "version updates yes / security updates no" nuance and the resulting
   hand-off of backend CVE coverage to HEL-459.

2. **No branch protection — CONFIRMED.** `gh api repos/:owner/:repo/branches/main/protection`
   → `404 {"message":"Branch not protected"}`. The design's core safety premise holds.

3. **`ci.yml` `paths-ignore` — CONFIRMED harmless.** Ignores only `**.md`,
   `LICENSE`, `.github/ISSUE_TEMPLATE/**`, `docs/**`. No manifest, lockfile,
   `build.sbt`, or `.github/workflows/**` path is excluded.

4. **`ci.yml` workflow name — CONFIRMED** `name: CI`, so `workflows: ["CI"]` matches.

5. **`skip_specs: true` precedent — CONFIRMED GENUINE.**
   `openspec/changes/archive/2026-08-26-remediate-backend-dependency-cves/.openspec.yaml`
   contains exactly `schema: spec-driven / created: 2026-08-26 / skip_specs: true`,
   and that change (HEL-452) is likewise dependency/tooling-only with no
   request/response behavior. This change is even more clearly spec-free
   (`.github/**` only). Not a stretch. **No objection to `skip_specs`.**

6. **`dependabot/fetch-metadata` semantics — read upstream README (main).**
   `update-type` is documented as "**The highest semver change being made by
   this PR**", and outputs are only populated for PRs opened by Dependabot
   containing only Dependabot commits. Current published major is **v3**
   (README examples use `dependabot/fetch-metadata@v3`); design/tasks pin `@v2`.
   Also: on a `workflow_run` trigger there is no `github.event.pull_request`,
   so the action requires an explicit PR reference input — the design does not
   say how.

7. **`workflow_run` gating logic — assessed as sound in principle.** A
   `workflow_run`/`completed` trigger with `conclusion == 'success'` plus a
   re-read of the PR's live head SHA does deliver real CI gating without branch
   protection: the workflow only ever runs *after* CI concluded, and the SHA
   re-check closes the force-push-during-CI window (a later push produces a
   different head SHA, so the stale run's merge is skipped; the new push
   re-triggers CI and a fresh merge attempt). The `workflow_run`-runs-from-base-branch
   property noted in Risks is accurate. **Decision 1 is the right call** and I
   confirm it, in itself, over native `--auto`.

### Verdict: REFUTE

The central technical judgment (Decisions 1–3, sbt correction, skip_specs) is
sound. But the artifact set contains a direct proposal↔design contradiction
about what is even being built, two false ground-truth statements, and three
config/permission specifics that would fail at runtime as written.

### Change Requests

1. **`proposal.md` directly contradicts `design.md` about the ticket's central
   deliverable.** `proposal.md` "What Changes" states, in bold: *"**BREAKING
   (scope change from ticket text): the 'CI-gated' half of this workflow's name
   is not actually deliverable as auto-merge in this repo today**"*, describes
   the workflow as `gh pr merge --auto`-based, and says branch protection is
   "escalated separately". `design.md` Decision 1 says the opposite — CI gating
   *is* delivered via `workflow_run`, `--auto` is explicitly **not** used, and
   "this change needs no branch-protection escalation to satisfy the ticket's
   'CI-gated' requirement". `tasks.md` follows the design. An implementer
   reading the proposal alone ships the weaker, unsafe thing, and the archived
   record would misstate what was delivered. Rewrite `proposal.md`'s "What
   Changes" bullet 3 and its Non-goals to match Decision 1: no scope reduction,
   no "BREAKING", branch protection deferred as a *broader repo-config
   improvement* (Decision 3's actual reasoning), not as the reason CI gating
   was dropped.

2. **`design.md` Context misstates this repo's CI — a false premise in the
   doc's own "premise-validation evidence".** It says *"`ci.yml` runs a single
   `frontend` job (lint/typecheck/format/test)"*. Ground truth
   (`.github/workflows/ci.yml`): **three** jobs — `frontend`, `backend`
   (`sbt compile test` on Temurin 21), and `e2e` (Postgres 16 service +
   Playwright chromium + real backend/Vite boot, HEL-813 touch-target guard).
   Correct the Context, and address the consequence the design never
   considers: gating on the *whole* `CI` workflow's conclusion means an
   auto-merge is blocked by the heavyweight, boot-dependent `e2e` job. State
   explicitly whether that is intended (fail-closed: acceptable, PR just waits
   for human merge) rather than leaving it undiscovered at execution time.

3. **`tasks.md` 1.2 / `design.md` Decision 2: a `dev-dependencies` group keyed
   on `dependency-type: development` is meaningless for two of the four
   ecosystems.** `github-actions` and `sbt` have no development/production
   dependency-type distinction, so such a group matches nothing and those two
   ecosystems would fall back to **one PR per package** — directly violating
   the AC "Grouped PRs land as a single PR per group, not one-per-package".
   Specify a `patterns: ["*"]`-style catch-all group for the `github-actions`
   and `sbt` entries instead, and keep `dependency-type: development` only on
   the two `npm` entries.

4. **`tasks.md` 2.6 requires creating a label, but 2.7's permissions cannot
   create one.** 2.6 says "apply/**create** a `major-update` label"; 2.7 grants
   only `contents: write` + `pull-requests: write`. Creating a repository label
   is `POST /repos/{owner}/{repo}/labels`, which needs `issues: write`. As
   written the major-update path fails at runtime the first time it fires —
   i.e. exactly the AC "a major update PR does NOT auto-merge **and is labeled
   for review**". Either add `issues: write` to the permissions block, or drop
   creation and pre-create the label out-of-band (and say which, in the task).

5. **`tasks.md` 2.3 leaves a security-relevant guard as an implementer
   coin-flip.** It offers `github.actor == 'dependabot[bot]'` *"(or
   `github.event.workflow_run.actor.login`)"*. These are not equivalent, and
   neither is authoritative: on a manually re-run CI job the actor/triggering_actor
   can be a human, and `actor` semantics on `workflow_run` are exactly the
   subtlety this workflow must not get wrong. Mandate the authoritative check —
   the **resolved PR's** `user.login == 'dependabot[bot]'` (from the same
   `gh pr view` used for the head-SHA re-check in 2.2) — and additionally
   require asserting the PR's `baseRefName == 'main'`. Drop the "or".

6. **`fetch-metadata` under `workflow_run` needs an explicit PR input, and the
   pin is a major version behind.** Task 2.4 says only "run
   `dependabot/fetch-metadata@v2` against the PR". Under `workflow_run` there
   is no `github.event.pull_request` for the action to read, so the task must
   name the explicit input used to point it at the resolved PR. Also state
   whether `@v2` is deliberate: upstream's current documented major is `@v3`.

7. **Record why grouping does not defeat the never-auto-merge-major rule.**
   Decision 1 reads `update-type` on PRs that Decision 2 deliberately makes
   *grouped* (many bumps per PR), and never addresses the interaction. It is in
   fact safe — upstream documents `update-type` as "the **highest** semver
   change being made by this PR" — but the design should cite that, since the
   whole major-vs-patch AC rests on it and a reviewer cannot currently tell
   whether it was considered.

### Non-blocking notes

- `tasks.md` section 4 is misordered (`4.4` precedes `4.3`); renumber.
- Task 4.1's `actionlint` is not present in this repo's tooling
  (`.husky`/`package.json` scripts have no workflow linter); the "otherwise
  manual review" fallback will be the path taken — fine, but expect it.
- The worktree's `scripts/concertino/` is missing `next-report-number.sh`,
  `persist-evidence.sh`, and `emit-event.sh` (only assert-phase/cleanup/
  setup-worktree/start-servers are present). I used the main checkout's copies.
  Not a defect in this change, but the branch base is older than main's
  `scripts/concertino/`.
