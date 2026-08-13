## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Tooling note (environmental, not a design defect):** `scripts/concertino/next-report-number.sh`,
`persist-evidence.sh`, and `emit-event.sh` do not exist in this worktree (`find . -iname
next-report-number.sh -o -iname persist-evidence.sh -o -iname emit-event.sh` → empty;
`scripts/concertino/` here contains only `assert-phase.sh`, `cleanup.sh`, `README.md`,
`setup-worktree.sh`, `start-servers.sh`). Confirmed via `git show origin/main:scripts/concertino/
next-report-number.sh` (→ "MISSING in origin/main") that this worktree's branch point (`7d06321c`,
verified identical to a fresh `git fetch origin main` — `git merge-base --is-ancestor HEAD
origin/main` → true, `git rev-parse HEAD origin/main` → both `7d06321c...`) genuinely predates these
three scripts being added to `main`'s tooling — this is a stale-worktree/newer-tooling gap, not
something I can work around without guessing a fallback path. I wrote the report to the filename the
orchestrator's own dispatch message explicitly named (`skeptic-design-2.md`), after confirming no
collision (`ls .../skeptic-design-*.md` → only `skeptic-design-1.md` exists). I could not run
`persist-evidence.sh`/`emit-event.sh` — flagging this in my returned message for the orchestrator to
handle on its end rather than fabricating a workaround.

1. **Re-read all five round-2 artifacts fresh, cold, from disk** (not from the orchestrator's
   narrative): `ticket.md`, `proposal.md`, `design.md` (135 lines), `tasks.md` (76 lines), both
   `specs/*/spec.md` files, and round 1's own report for the exact wording of CR1/CR2.

2. **CR1 (reload-survival gap) — verified genuinely closed, not just moved.**
   - Read design.md D7 (lines 88–98) and tasks.md 1.3/2.2/3.5/4.2/5.1/5.2/6.1/6.3 end-to-end: a new
     `GET /api/authoring/conversations/:id` route, RLS-scoped via the same `withUserContext`
     404-for-missing-or-not-owned pattern already proven in this codebase — read
     `MetricRepository.scala`'s `findByIdOwned` directly (`ctx.withUserContext(user.id.value)(...)`,
     doc comment: "Returns `None` for a row that exists but belongs to a different user... see
     CONTRIBUTING.md's ACL triad") and confirmed it is a real, working, already-shipped pattern, not
     invented for this design.
   - Read `DashboardAuthoringRoutes.scala` in full: the existing route lives under
     `pathPrefix("authoring" / "dashboard")`; a new `authoring/conversations/:id` prefix is a
     non-colliding sibling, consistent with how this single route class is structured today.
   - Read `AuthoringChatDrawer.tsx` (full file) and `useDashboardAuthoringStream.ts` (full file):
     confirmed the *current* shipped state has no `conversationId` anywhere and the drawer is opened
     via plain local `useState` (destroyed on reload) — exactly the gap CR1 identified. `sessionStorage`
     genuinely fixes the "which id to resume" half of the gap (survives a reload within the same tab,
     which the Risks section correctly scopes as the literal ask); the new `GET` route genuinely fixes
     the "nothing to rehydrate the thread with" half (`AuthoringConversationView(conversationId,
     displayTurns, latestProposal)` — read task 2.2, matches D7's returned shape exactly, and task 2.3/
     the `GET` response schema is the additive counterpart to the existing
     `dashboard-authoring-request/response.schema.json` pair I found in `schemas/`).
   - Checked for a remaining hole: mid-`sessionStorage`-write graceful degradation is handled (`on
     404/failure, clear it and start fresh` — matches spec.md's new "stale or foreign conversation id"
     scenario), and the "second user's conversation is rejected" scenario is covered by the same
     RLS-404 mechanism task 6.1/6.2 test for. I did not find a case where the gap is silently moved
     rather than closed — this is a real, technically grounded fix using an already-proven codebase
     pattern (RLS-scoped owner-or-404 repository lookups), not hand-waving.

3. **CR2 (terminal-effect rework + turn content) — verified genuinely closed.**
   - Re-read `AuthoringChatDrawer.tsx` lines 75–81 fresh: confirmed byte-for-byte the same
     auto-navigate-and-`handleClose()`-on-any-`result` behavior round 1 flagged.
   - Read tasks.md 5.2: it now explicitly says to (a) stop that auto-navigate/close, (b) append a
     `display_turns`-shaped entry and reopen the input instead, (c) add an explicit "Review & apply"
     control reachable after any completed turn that performs the *existing* unmodified
     `navigate("/proposals/review", {state:{proposal}})` call and clears the stored id, and (d)
     persist `conversationId` to `sessionStorage` after every successful turn. This is specific enough
     for a competent implementer: it names the exact effect to change, the exact old behavior to
     remove, the exact new behavior, and the exact new control's exact side effects.
   - Read design.md D6 (lines 74–86): it now specifies exact turn-entry content — user's own typed
     text verbatim, and a deterministic `"Proposed \"<name>\" (<n> panel(s))"` summary for the
     assistant side, "never raw model JSON." Cross-checked this against
     `useDashboardAuthoringStream.ts`'s own doc comment (lines 14–18: `progressText` is explicitly
     "not meant to be rendered verbatim... raw, incomplete proposal JSON, not conversational prose") —
     the new design is consistent with, not contradicting, that existing constraint.

4. **The api_history/display_turns split (D3) — coherent and does genuinely avoid re-embedding
   grounding on turn 2+, consistent with the existing repair loop.** Read
   `DashboardAuthoringService.scala` in full. The existing `runRepair`/`runStreamingRepair` already
   establish the pattern D3 claims to mirror: they build `repairMessages` by appending onto the
   existing message vector (which already contains the one grounded user message from turn 1) an
   assistant message (the prior raw response) plus a *new*, small `DashboardAuthoringPrompt
   .repairMessage(errorText)` user message — the grounded prompt is never repeated, only appended to.
   Task 3.2's plan — build turn N's outbound vector as `AuthoringHistoryBudget.trim(persisted
   api_history) + new plain-text user message (reusing goal)` — is structurally identical: append,
   don't re-embed. This checks out as an accurate, not just asserted, parallel.
   - The two-representation split itself is coherent: `ClaudeMessage(role: String, content: String)`
     (read `ClaudeModels.scala`) is a trivial JSONB-serializable shape for `api_history`; `display_turns`
     is a separate, deliberately narrower shape so the new `GET` route can return conversation content
     without ever exposing internal repair-round-trip mechanics or the heavy grounded prompt — task
     3.4's "persist only the FINAL state on a repair round-trip" is terse but unambiguous given the
     surrounding context (skip the failed-attempt/repair messages, persist the turn as
     `[user message, final successful assistant text]`), and task 6.1 explicitly tests that `GET`
     returns `displayTurns`/`latestProposal` *without* `apiHistory` — the leak this split exists to
     prevent has a regression test planned, not just a doc claim.

5. **Flyway/RLS ground truth, re-verified fresh (not trusted from round 1's report).**
   `ls backend/src/main/resources/db/migration | sort -V | tail -3` → `V74`, `V75__metrics.sql`,
   `V76__panel_metric_id.sql`; `V77` is genuinely next. Read `V75__metrics.sql` directly, byte for
   byte: `owner_id UUID NOT NULL REFERENCES users(id)`, `ENABLE`/`FORCE ROW LEVEL SECURITY`, one
   `USING (owner_id = current_setting('app.current_user_id')::uuid)` policy — matches design.md D3's
   paraphrase exactly. Independently re-fetched `origin/main` from inside the worktree
   (`git fetch origin main` → `7d06321c...`) and confirmed `HEAD` is identical to `origin/main` with
   zero unmerged commits either direction, reproducing round 1's same conclusion via a fresh,
   independent check rather than trusting its prior report.

6. **Route/protocol/schema plumbing sanity-checked against real current shapes.** Read
   `DashboardAuthoringProtocol.scala`: `DashboardAuthoringRequest(goal, contextOptions)`,
   `DashboardAuthoringResponse(proposal, warnings)`, `AuthoringStreamEvent.Result(proposal,
   warnings)` — none carry `conversationId` today, confirming tasks 2.1/5.3's additive-field plan is
   real, not already-done busywork. Confirmed `schemas/dashboard-authoring-{request,response}.schema
   .json` exist as the base task 2.3 extends.

7. **Line/format budgets, re-confirmed.** `openspec instructions design --change
   authoring-conversation-state` → rule: "Maximum 150 lines; wrap prose at 120 chars per line";
   design.md is 135 lines, `awk` line-length check found zero lines over 120 chars.
   `openspec instructions tasks` → rule: "Maximum 80 lines"; tasks.md is 76 lines. `openspec validate
   authoring-conversation-state --strict` → `Change 'authoring-conversation-state' is valid`.
   `grep -rniE "TODO|TBD|figure out later|to be determined|placeholder"` across design.md/tasks.md/
   proposal.md/specs/ → no matches.

8. **MODIFIED spec delta correctness.** Read the base `openspec/specs/nl-dashboard-proposal-
   authoring/spec.md`'s "The endpoint authors, validates, but never applies a proposal" requirement
   verbatim and compared to the change's MODIFIED delta — the delta accurately reflects the existing
   requirement's structure with only the additive `conversationId` field and its own new scenario
   added; `openspec validate --strict` passing corroborates the header/scenario matching is
   structurally sound, not just visually similar.

### Verdict: CONFIRM

Both round-1 change requests are genuinely resolved in the actual file contents, not just narrated as
resolved. D7's `GET` hydration route + `sessionStorage` is a real, technically grounded fix built on
an already-proven codebase pattern (RLS-scoped owner-or-404 lookups via `withUserContext`) — it closes
the reload-survival gap rather than relocating it, and the Risks/Trade-offs section now explicitly and
honestly scopes what "survive a reload" does and doesn't cover (tab-scoped, not cross-device). The
api_history/display_turns split is coherent, technically accurate about mirroring the existing
repair-loop's append-don't-re-embed pattern, and has a planned regression test for the one leak it
exists to prevent (apiHistory never appearing in the GET response). The reworked terminal-effect task
is specific enough to build correctly: it names the exact effect, the exact behavior to remove, the
exact new behavior and control, and (via D6) the exact deterministic content each turn's thread entry
renders. Line budgets, prose-width, and `openspec validate --strict` all still pass.

### Non-blocking notes

- AC4's "updates the working-proposal preview" is satisfied by D6's one-line deterministic summary
  (`"Proposed \"<name>\" (<n> panel(s))"`), not a visual mockup. The codebase already has a
  precedent for a richer visual "preview" for exactly this data shape — `ProposalReview.tsx`'s
  `proposal-review__preview` mini grid-layout section (`PREVIEW_COLS`/`PREVIEW_ROW_PX`, lines
  30–31/184–204) — which this design doesn't consider or explicitly rule out reusing. The text-summary
  reading is defensible (proposal.md's own "What Changes" already frames the thread as a "read-only
  progress log," and Non-Goals correctly keep editing/detailed rendering exclusive to `ProposalReview`),
  and I'm not blocking on it, but it's worth a conscious call rather than an implicit one if the
  executor or a later reviewer expects a visual echo of the grid layout per turn.
- No explicit "start a new, unrelated conversation" affordance is specced: once a conversation exists
  in `sessionStorage`, it's only cleared by hitting "Review & apply" or by a stale/404 `GET`. A user
  who opens the drawer, does a turn, closes it without applying, then reopens the drawer to start a
  completely different dashboard would be resumed into the old conversation rather than starting
  fresh. This isn't required by AC2/AC4's literal text and may be intentional (resumability is the
  whole point), but it's a real product-facing edge case worth a conscious decision during
  implementation rather than an accidental default.
- Report-persistence tooling gap noted above (`next-report-number.sh`/`persist-evidence.sh`/
  `emit-event.sh` absent from this worktree, confirmed absent from `origin/main` at this worktree's
  branch point too) is orthogonal to the design's merits — surfacing it for the orchestrator to route
  around, not treating it as a design defect.
