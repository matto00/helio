## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
Re-read ticket.md, proposal.md, design.md, tasks.md in full from the worktree (cat -n), plus ground truth in `.github/workflows/ci.yml`.

Round-1 CR verification (each checked against the current file text, not the orchestrator's summary):
1. CONFIRMED — proposal.md:21-35 and Non-goals:63-66 carry no BREAKING/scope-reduction framing; branch protection is framed as "deferred as an independent improvement, not because it's required", matching design.md Decision 3 (design.md:110-118).
2. CONFIRMED — design.md:3-12 states three jobs (`frontend`/`backend`/`e2e`) and explicitly calls gating on the whole workflow conclusion (incl. `e2e`) "intended fail-closed behavior". Ground truth agrees: `grep '^  [a-z-]*:' .github/workflows/ci.yml` → jobs at lines 23 `frontend`, 41 `backend`, 67 `e2e`; `name: CI` at line 1; `paths-ignore` (lines 5-9, 12-16) lists only `**.md`, `LICENSE`, `.github/ISSUE_TEMPLATE/**`, `docs/**` — no manifest/lockfile/workflow path excluded, so proposal.md:36-38 and task 3.1's premise hold.
3. CONFIRMED — design.md:105-108 and tasks.md 1.2 (lines 6-12) give `github-actions` and `sbt` a catch-all `patterns: ["*"]` group, with the "would match nothing / degrade to one-PR-per-package" rationale.
4. CONFIRMED — tasks.md 2.6 (lines 48-52) requires `contents: write`, `pull-requests: write`, AND `issues: write`, with the `POST /repos/{owner}/{repo}/labels` justification; design.md:80-82 says the same.
5. CONFIRMED — tasks.md 2.2 (lines 23-32) makes the resolved PR's `user.login == 'dependabot[bot]'` + `baseRefName == 'main'` + head-SHA match all read from one `gh pr view`, and explicitly forbids `github.actor`/`triggering_actor`. design.md:60-66 matches. (The remaining "or" at tasks.md:24-25 is about *how to obtain the PR number*, not the actor check — acceptable implementer latitude.)
6. PARTIAL — design.md:67 and tasks.md 2.3 (lines 33-36) do pin `dependabot/fetch-metadata@v3` with the explicit-PR-input note. But design.md:131-133 (Risks) still asserts "`dependabot/fetch-metadata@v2` is pinned to a major-version tag…". The edit did not propagate to that bullet. See CR 1.
7. CONFIRMED — design.md:67-73 ("the highest semver change being made by this PR") plus the standalone "Grouping interaction" paragraph (design.md:85-89), and tasks.md 2.5 (lines 42-47) carry the note.

Other checks: no `TODO`/`TBD`/deferred decisions found; task numbering is internally consistent (2.1-2.6 with no gaps; task 3.2's cross-reference to "task 2.1" is correct); every ticket AC maps to a task (AC1→1.1-1.4/4.2, AC2→2.1-2.6/4.3, AC3→1.2), with 4.4 honestly recording that live end-to-end Dependabot behavior is only observable post-merge. `.github/dependabot.yml` confirmed absent (nothing implemented yet — correct for a design gate). No scope drift beyond the ticket.

### Verdict: REFUTE

### Change Requests
1. **design.md:131-133** — stale `@v2` pin contradicts design.md:67 and tasks.md 2.3, which authoritatively require `@v3`. An implementer reading the Risks section could pin `@v2`, re-introducing exactly the defect round-1 CR 6 fixed. Rewrite the bullet to reference `dependabot/fetch-metadata@v3` (keeping the "pinned to a major-version tag per this repo's other workflows" point, and the `cd-backend.yml`/`cd-frontend.yml` convention check).

### Non-blocking notes
- design.md's Risks bullet on `CI` being split into multiple workflows is a genuine future hazard; tasks.md 3.2 only guards the *rename* case, not the split case. Fine to leave unhandled (explicitly out of scope), just noting the asymmetry.
- This worktree's `scripts/concertino/` predates `next-report-number.sh`/`persist-evidence.sh`; I invoked the main checkout's copies. Not a design defect, but the executor should expect the same when running scripts here.
