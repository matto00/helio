## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

1. **Round-2 CR 1 landed.** `sed -n '125,140p' design.md` — the Risks bullet now
   reads "`dependabot/fetch-metadata@v3` is pinned to a major-version tag per common
   Actions practice in this repo's other workflows (verify against
   `cd-backend.yml`/`cd-frontend.yml` convention during execution)". The `@v2` is gone;
   the substantive content the CR asked to keep (major-tag rationale + the
   `cd-backend.yml`/`cd-frontend.yml` convention check) is intact.

2. **No stale `@v2` remains in any planning artifact.**
   `grep -rn "fetch-metadata\|@v2\|@v3" .` across the change dir + `ticket.md`.
   Hits for `@v2` appear ONLY inside `skeptic-design-1.md` and `skeptic-design-2.md`
   — historical review records quoting the defect, correctly untouched. The four
   authoritative artifacts are now consistent:
   - `design.md:67` — `dependabot/fetch-metadata@v3` (+ explicit-PR-input note)
   - `design.md:131` — `@v3` (the fixed line)
   - `tasks.md:33-34` — `@v3` ("current documented major — not `@v2`")
   - `proposal.md:24` / `ticket.md:11` — unversioned references, no conflict.

3. **Nothing else was touched.** `git status --porcelain` in the worktree shows only
   the untracked `openspec/changes/dependabot-config-automerge/` dir; `git diff HEAD --stat`
   is empty (no tracked-file edits crept in alongside the fix).

4. **Independent re-derivation (cold), not inherited from round 2.** I re-checked the
   items a one-line edit could plausibly have disturbed rather than trusting the
   prior report:
   - Placeholders: `grep -rn "TODO\|TBD\|figure out later\|???"` across all four
     artifacts → no hits.
   - AC coverage: AC1 (valid `dependabot.yml`, ecosystems active) → tasks 1.1-1.4, 4.2;
     AC2 (patch/minor auto-merges only after CI; major does not merge and is labeled)
     → tasks 2.1-2.6 + 4.3, with the major path's `major-update` label at task 2.5 and
     the `issues: write` permission it actually requires correctly called out at 2.6;
     AC3 (grouped PRs land as one PR per group) → task 1.2. Task 4.4 honestly records
     that a live Dependabot run is only observable post-merge — an acknowledged limit,
     not a hidden gap.
   - Task numbering: 1.1-1.4, 2.1-2.6, 3.1-3.2, 4.1-4.4, no gaps; task 3.2's
     `workflows: ["CI"]` cross-reference to task 2.1 is correct.
   - Ticket-premise deviation is justified, not drift: the ticket's orchestration note
     assumed no sbt ecosystem exists; proposal.md:12-18 and design.md:24-28 correct
     this against GitHub's supported-ecosystems table (sbt: version updates supported,
     security updates NOT supported), and route backend security coverage to HEL-459.
     Round 1 verified that claim against live upstream docs; the four-entry
     `updates` list in task 1.1 follows from it consistently.
   - The `--auto` hazard from the human brief is honored, not glossed: task 2.4 requires
     `gh pr merge --squash --delete-branch` explicitly *not* `--auto`, with the
     no-branch-protection reason recorded — which is the real CI gate (`workflow_run`
     on `CI` + `conclusion == 'success'`) the brief demanded.

No contradictions, ambiguities, or scope drift found. The sole round-2 objection is
resolved and introduced nothing new.

### Verdict: CONFIRM

### Non-blocking notes
- Carried forward from round 2, still true and still fine: design.md's Risks section
  flags the "`CI` split into multiple workflows" hazard, but tasks.md 3.2 only guards
  the *rename* case. Explicitly out of scope; noting the asymmetry only.
- This worktree's `scripts/concertino/` predates `next-report-number.sh` /
  `persist-evidence.sh`; I invoked the main checkout's copies. Environmental, not a
  design defect — the executor should expect the same here.
