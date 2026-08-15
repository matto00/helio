## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

This is a post-delivery **fold-in addendum** to an already-merged ticket (PR #345, cf2fce39). The
addendum's stated scope is narrow: delete `AuthoringGoalRequest`/`AuthoringResult` from
`frontend/src/features/dashboards/types/authoring.ts` and drop them from
`authoringService.ts`'s import + re-export line. I verified this independently rather than trusting
`ticket.md`/`proposal.md`/`tasks.md`'s own assertions.

1. **Read the artifacts.** `ticket.md`'s "Post-delivery fold-in" Context/Notes section, AC4;
   `proposal.md`'s "Fold-in addendum" bullet + Impact section; `tasks.md`'s new `## 4. Fold-in
   addendum` (4.1–4.4). All three are internally consistent with each other and with `design.md`
   (which predates the addendum and is silent on it — not contradictory, just doesn't mention it;
   see non-blocking note below).

2. **Read current file state** (worktree HEAD = cf2fce39, the actual post-merge state):
   - `frontend/src/features/dashboards/types/authoring.ts` — confirmed both `AuthoringGoalRequest`
     (lines 10-13) and `AuthoringResult` (lines 34-39) exist, alongside four other exports
     (`AuthoringErrorKind`, `AuthoringOutcome`, `AuthoringDisplayTurn`, `AuthoringConversationView`)
     the plan says must stay untouched.
   - `frontend/src/features/dashboards/services/authoringService.ts` — confirmed the import list
     (lines 4-9) and the single re-export line (line 47) both include `AuthoringGoalRequest` and
     `AuthoringResult` alongside `AuthoringConversationView`/`AuthoringOutcome`.

3. **Independently grepped for consumers** (the crux of this gate — did not trust the plan's "zero
   remaining consumers" claim):
   - `grep -rn "AuthoringGoalRequest" frontend/src/` → 4 hits: the interface definition, one doc
     comment inside `authoring.ts` referencing it, the import, and the re-export line in
     `authoringService.ts`. No consumer anywhere else.
   - `grep -rn "AuthoringResult" frontend/src/` → 3 hits: same pattern (definition, import,
     re-export). No consumer anywhere else.
   - Repo-wide sweep (`grep -rln "AuthoringGoalRequest\|AuthoringResult"` across the whole worktree,
     not just `frontend/src`) → only `authoring.ts`, `authoringService.ts`, and the openspec change
     docs (ticket/proposal/tasks/archived evaluator+skeptic reports) turned up. No backend (`.scala`)
     hits, no `schemas/` hits, no `e2e/` hits.
   - Confirmed **no barrel/index re-export** widens the blast radius: `grep -rln "from.*types/
     authoring\""`/`"from.*authoringService\""` across `frontend/src` shows every consumer imports
     only `AuthoringErrorKind`/`AuthoringDisplayTurn` (from `types/authoring`, used by
     `RefinementChatDrawer.tsx`/`useRefinement.ts`/`refinementService.ts`) or
     `fetchAuthoringConversation`/`postAuthoringOutcome` (from `authoringService`, used by
     `RefinementChatDrawer.tsx`/`ProposalReviewPage.tsx` respectively) — never the two names being
     deleted. This matches the plan's explicit claim that those four other exports "all still have
     real consumers" and are untouched.
   - This traces back correctly to the causal claim in `ticket.md`: `AuthoringGoalRequest`/
     `AuthoringResult`'s only real consumer was `useDashboardAuthoringStream.ts`, deleted by this
     same ticket's own original delivery — confirmed by reading `git diff --stat cf2fce39^..cf2fce39`
     equivalent (the file no longer exists at HEAD and its historical only-import relationship is
     corroborated by the archived `evaluation-1.md`/`skeptic-final-1.md` non-blocking notes from the
     original PR, which independently flagged this exact same dead-code fact — I read those as
     claims and verified them against real grep output myself, not as ground truth on their own).

4. **Checked for scope creep.** `git diff cf2fce39 --stat -- frontend/` (this worktree's branch vs.
   the commit it was reset to) shows zero uncommitted changes yet (design gate, pre-execution) — the
   diff shown is cf2fce39's own diff against its parent, confirming the *original* delivery's shape
   only (AuthoringChatDrawer deletion, DashboardList changes, etc.), not this addendum's. The
   addendum's task list (4.1-4.4) touches exactly two files for production code
   (`authoring.ts`, `authoringService.ts`) plus a grep sweep and standard gates — no other file is
   named anywhere in ticket.md/proposal.md/tasks.md's fold-in sections. `AuthoringErrorKind`,
   `AuthoringOutcome`, `AuthoringDisplayTurn`, `AuthoringConversationView`, and both surviving
   functions are explicitly called out as untouched and my own grep confirms every one of them has a
   real consumer today, so deleting them would have been wrong — the plan correctly excludes them.

5. **Checked whether an openspec spec delta is needed.** These are pure frontend TypeScript request/
   response interface deletions for an endpoint (`POST /api/authoring/dashboard`) that is already
   unreachable from any frontend consumer (per the original ticket's D5, unchanged). The existing
   `specs/nl-authoring-chat-surface/spec.md` REMOVED-requirements delta (from the original delivery)
   already covers the capability-level removal; these two types are implementation-level detail with
   no independent capability-requirement surface, so no additional spec delta is needed for this
   addendum. Not a gap.

6. **Checked for placeholders/ambiguity.** No `TODO`/`TBD` in any of the addendum's four new
   artifact sections. Task 4.2's phrasing ("leave `fetchAuthoringConversation`/`postAuthoringOutcome`
   and the other re-exports untouched") is unambiguous given the current single-line re-export
   statement — an implementer reading it has exactly one way to execute it (delete two of the four
   names from the import block and the same two from the re-export line).

### Verdict: CONFIRM

### Non-blocking notes

- `design.md` was not updated with a decision entry for the fold-in (it still reads as the original
  delivery's D1-D7 + Planner Notes, silent on the addendum). This doesn't create any ambiguity in
  practice — `tasks.md`'s own `## 4. Fold-in addendum` section is fully self-contained and
  unambiguous — but a one-line pointer in `design.md` (e.g. "see ticket.md/tasks.md for the
  post-delivery fold-in addendum") would make the artifact set read as complete on its own without
  needing to cross-reference which file has the addendum's rationale.
- I found one additional stale doc-comment reference the original ticket's task 3.5 grep-sweep
  apparently missed: `authoring.ts` line 29-30's JSDoc on `AuthoringResult` itself says `"warnings"
  is exposed on `useDashboardAuthoringStream`'s state but not rendered anywhere yet` — a dangling
  reference to the now-deleted hook, inside the very interface this addendum deletes. This isn't a
  design defect (deleting `AuthoringResult` removes this comment as a side effect, so no separate
  task is needed), just worth noting so the executor doesn't get confused seeing a "current" comment
  reference a hook that no longer exists — it's dead by construction once 4.1 lands.
