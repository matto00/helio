## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **Alert-set ground truth is still exactly 35 and unchanged since round 1.** Re-ran
   `gh api repos/matto00/helio/dependabot/alerts -X GET -f state=open --paginate` myself and grouped by
   `(manifest, package)`. Severity split `{high: 15, medium: 19, low: 1}` and manifest split
   `{frontend/package-lock.json: 23, helio-mcp/package-lock.json: 10, package-lock.json: 2}` both match
   ticket.md/design.md exactly. Every row of design.md's version-floor table (package, alert count, alert
   numbers, required version) reproduces exactly against the live per-alert `first_patched_version` data —
   axios (10, all →1.18.0), react-router (5, max 7.18.2), postcss (2, max 8.5.23), fast-uri ×2 lockfiles
   (max 3.1.5), brace-expansion (1.x→1.1.16 / 2.x→2.1.2), js-yaml ×2 lockfiles (3.x→3.15.1, root also
   4.x→4.3.1), sharp (0.35.0), hono (4.12.34), ip-address (max 10.3.1), `@hono/node-server` (1.19.15). No
   drift since round 1; the plan's factual basis is still sound.
2. **PR #258 confirmed still OPEN** (`gh pr view 258`): "Bump axios from 1.16.0 to 1.18.0 in
   /frontend..." — matches design.md's characterization (sufficient for the 10 axios alerts, 10/35
   overall).
3. **Round-1 Change Request 1 (helio-mcp `npm test` gate) is genuinely resolved.**
   - `helio-mcp/package.json`'s `scripts` still has no `test` entry (`{build, start, dev, typecheck,
     verify, compose, verify-bound-panel}`) — confirmed by reading the file directly, unchanged from
     round 1.
   - tasks.md task 5.1 now reads "`npm test` green in root and `frontend/`" — **helio-mcp dropped**, no
     longer targets the nonexistent script.
   - tasks.md task 5.2 substitutes `npm run build` + `npm run typecheck` as helio-mcp's real gates, with
     an inline note explaining why. design.md's Planner Notes explicitly documents this as a
     "Self-approved (skeptic design round 1, item 1)" correction with the verified error message quoted.
   - I independently confirmed both substitute gates are real and meaningful: after `npm install` in
     `helio-mcp/` (worktree's `node_modules` was empty — see non-blocking note below), `npm run
     typecheck` and `npm run build` both exit 0 cleanly on the current base commit, matching the primary
     checkout's clean state. These are legitimate stand-in verification gates for a TypeScript-only
     package with no test suite.
   - ticket.md's AC2 wording itself is untouched (still literally says `npm test (root, frontend/,
     helio-mcp/)`), but design.md's Planner Notes explicitly flags this as a known, deliberate,
     self-approved deviation with reasoning — an established mechanism in this project (Planning
     ESCALATION criteria are new-external-dependency / architectural-change / breaking-API-change only;
     this qualifies for none of those, so self-approval without escalation is consistent with the
     orchestrator's own rules). **CR1: resolved.**
4. **Round-1 Change Request 2 (tasks for AC1 post-merge recheck / AC4 PR #258 disposition) is
   textually resolved but introduces a new, unaddressed risk.** tasks.md now has section 7
   ("Delivery follow-through (orchestrator-owned — Phase 3/4, not executor scope)") with three concrete,
   commanded items: 7.1 (PR body states supersession of #258), 7.2 (post-merge `gh api
   .../dependabot/alerts?state=open` recheck against the named alert numbers #56-#103), 7.3 (close #258
   with a comment). design.md Decisions 5/6 cross-reference these tasks explicitly. This satisfies the
   letter of CR2 — concrete, numbered, actionable items now exist where before there was only prose.

   However, I read `.claude/agents/concertino-orchestrator.md`'s actual Phase 3 (Delivery) and Phase 4
   (Post-merge cleanup) procedures in full, since design.md Decision 6 claims these tasks are
   "operationalized... so it cannot be silently skipped." That claim does not hold up against the
   orchestrator's own defined procedure:
   - Phase 3 step 4 ("Create the PR") is generic: "body links the ticket and summarizes behavioral
     changes, test plan, risks/follow-ups" — no instruction to consult a change's `tasks.md` for
     ticket-specific delivery content.
   - Phase 4 is entirely generic: stop servers/remove worktree, set ticket Done + closing comment,
     hygiene check. No step reads `tasks.md`, no step re-runs an alerts-API check, no step closes an
     unrelated PR.
   - I grepped the full orchestrator.md for every `tasks.md` reference (6 hits): all are in Planning /
     fold-in-scope contexts, none in Phase 3/4. There is no established mechanism in this repo's
     orchestration system (confirmed by grepping the whole `.claude/agents/` tree and the archived
     changes) for a `tasks.md` section marked "not executor scope" to be picked up and executed by
     anyone. This run has `AGENT_MERGE: false` (workflow-state.md), so a human does confirm the merge
     and could plausibly do these manually — but nothing in the artifacts ensures the human is actually
     told about tasks 7.1-7.3 specifically (Phase 3's human-facing presentation surfaces "PR URL, brief
     summary, and non-blocking evaluator/skeptic suggestions" — not a change's own delivery-follow-through
     tasks).
   - A second, more concrete consequence: the evaluator's Phase 1 checklist includes the literal item
     "All task items marked done and matching what was implemented," and the final-gate skeptic performs
     similar scrutiny. Tasks 7.1-7.3 structurally cannot be checked off until Phase 3/4 — i.e., **after**
     both the evaluator and the final-gate skeptic have already run. Nothing in tasks.md or design.md
     tells either reviewer that these three unchecked boxes are expected and not a completion defect.
     Before this revision, the same intent lived as unstructured prose (not subject to a literal
     checkbox-completion check); moving it into `tasks.md` as unchecked items creates a new,
     previously-nonexistent risk of a spurious FAIL/REFUTE purely from this section's presence.

### Verdict: REFUTE

### Change Requests

1. **Close the "operationalized but not actually wired up" gap for tasks.md section 7.** Two additions,
   both cheap and within this ticket's own artifacts (no change to the orchestrator agent definition
   required):
   - Add an explicit note under the section 7 heading (and mirror it in design.md Decisions 5/6) stating
     that items 7.1-7.3 are **expected to remain unchecked through Evaluation and the design/final-gate
     Skeptic review** — they complete only during/after Phase 3 Delivery and Phase 4 post-merge cleanup —
     and that this is not an "all task items marked done" defect. This closes the false-FAIL/false-REFUTE
     risk identified above.
   - Since the orchestrator's Phase 3/4 procedure has no generic hook that reads a change's `tasks.md`
     for delivery-specific content, don't rely on Decision 6's "cannot be silently skipped" framing as
     given. Given `AGENT_MERGE: false` for this run (a human confirms the merge), strengthen the plan so
     these three items are guaranteed to reach that human's attention rather than depending on the
     orchestrator happening to recall design.md's Decision 5/6 verbatim: state in design.md that the PR
     body (Phase 3 step 4, "risks/follow-ups") must explicitly enumerate tasks 7.1-7.3 as post-merge
     TODOs, and that the Phase 4 closing comment must restate 7.2/7.3 as outstanding until actually done.
     This makes the obligation self-carrying through the one human checkpoint the workflow actually has
     for this run, instead of depending on an unwritten assumption about orchestrator continuity/memory
     across phases.

### Non-blocking notes

- **helio-mcp `node_modules` is not pre-populated in this worktree** (unlike `frontend/node_modules`,
  which `concertino.config.json`'s `worktree.linkModules` symlinks in). Running `npm run
  build`/`npm run typecheck` in `helio-mcp/` right now fails with spurious `TS7031` errors purely because
  `node_modules/.bin/tsc` doesn't exist; running any `npm install`/`npm update` there (which task 2.1
  will do naturally) resolves it — verified by installing and re-running both gates clean (exit 0,
  matching the primary checkout). Not a design defect, just worth the executor knowing in advance so a
  transient tool-resolution failure isn't mistaken for a real regression during task 5.2.
- Consider mirroring CR1's correction into `ticket.md` itself (not just design.md's Planner Notes) given
  this project's own precedent (`2026-07-12-dependabot-codeql-security-fixes` added a "Scope update from
  discovery" section directly into its `ticket.md` for an analogous correction) — not required, since
  design.md's Planner Notes already documents the deviation clearly, but would make the correction
  visible without needing to cross-reference a second file.
