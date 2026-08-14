## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### Context

Round 5, the second post-escalation round. Per the orchestrator's brief, I re-reviewed the FULL
artifact set fresh (ticket.md, proposal.md, design.md, tasks.md, specs/patch-set-preview/spec.md) —
not just the round-4 D6 fix — cross-checking every claim against actual source myself, with
particular focus on: (a) whether `ProposalReviewPage.tsx`'s real structure matches what
design.md/tasks.md now claim `PatchSetReviewPage.tsx` should mirror, (b) whether `App.tsx`'s route
structure is accurately described, and (c) a full pass over every `ticket.md` Scope/AC line for
drift across five rounds.

### What I verified (with evidence)

**Round-4's D6 fix — the corrected precedent claim itself re-verified, not re-trusted:**
- `git log --diff-filter=A --oneline --follow` on both `ProposalReview.tsx` and
  `ProposalReviewPage.tsx` independently confirms both were added in the same commit `60980e4d`
  (HEL-148/HEL-224) — matches design.md D6's corrected claim exactly.
- Read `ProposalReviewPage.tsx` in full: it reads `location.state.proposal`, falls back to
  `synthesizeDemoProposal(dataTypes)` built from the first pipeline-output DataType found via
  `fetchDataTypes()`, shows an `EmptyState` on load error, a plain busy `<div>` while
  `proposal === null`, an `EmptyState` (via `EMPTY_WORKSPACE_COPY`) when the resolved proposal has
  zero panels, and otherwise renders `<ProposalReview>`. This matches design.md D6 / tasks.md 5.3's
  description of the pattern being mirrored (location-state-or-synthesize, `EmptyState`/loading
  states) point for point.
- `git log --diff-filter=A` on `AuthoringChatDrawer.tsx` shows it was added in `7d06321c`
  (2026-08-13), over five weeks after `60980e4d` (2026-07-05) — confirms the "second caller, not
  originator" claim. `grep -n "navigate(\"/proposals/review\"" frontend/src/features/dashboards/ui/AuthoringChatDrawer.tsx`
  confirms it does call `navigate("/proposals/review", { state: {...} })` at line 190, i.e. it really
  is a second caller of a pre-existing route, not the route's origin.

**`App.tsx`'s route structure — verified accurate:**
- Read `frontend/src/app/App.tsx` in full. Confirmed the exact nesting design.md/tasks.md 5.4
  describe: `<Route element={<ProtectedRoute />}><Route element={<AppShell />}>` wraps every
  authenticated route including `<Route path="/proposals/review" element={<ProposalReviewPage />} />`
  (line 511) inside that same shared list. A new `<Route path="/patch-sets/review"
  element={<PatchSetReviewPage />} />` sibling entry, as tasks.md 5.4 specifies, is a coherent,
  minimal, purely-additive diff against this real file — no restructuring needed.

**Deep re-verification of design.md's other load-bearing source citations (not re-trusted from
rounds 1-4's claims that they "held up"):**
- `DashboardService.scala:147-184` (`applyUpdate`) does compose all three fields (`name`,
  `appearance`, `layout`) via `.copy(...)` on both the rename and no-rename branches — confirms
  design.md's corrected three-field mirror (round-1 fix) is still accurate against current source.
- `DataTypeService.scala` `delete` (127-141) calls `checkSourceLink` first, then
  `existsBoundToAnyOwnedPanel` — confirms the documented (opposite-of-enumeration) real order.
  Re-verified the mutual-exclusivity closing argument: `PanelService.scala:483-494`'s
  `rejectCompanionBinding` (mirrored in `PatchSetApplyResolvers.scala:191-202`) rejects any panel
  bind to a `sourceId`-defined DataType, and this is the SAME enforcement that governs ordinary
  (non-patch-set) `PATCH /api/panels/:id` calls, not a patch-set-only rule — so the invariant
  design.md leans on ("a DataType can never simultaneously have a bound panel and a defined
  `sourceId`") is grounded in a system-wide guard, not a narrow one.
- `PanelServiceHelpers.resolvePatch` (line 21), `PanelConfigCodec.applyConfigPatch`
  (`domain/panels/PanelConfigCodec.scala:77`, confirmed returns the complete `Panel`, not a
  fragment), `PanelAppearance.applyPatchJson` (`model.scala:387`), `PipelineStepConfigCodec.decode`
  (`api/protocols/PipelineStepConfigCodec.scala`, signature `Try[Any]` as claimed),
  `PanelService.scala:450` (`validateScatterAggregationConflict` call site), `DataTypeService.scala:79-108`
  (`MaxExpressionLength` + `ExpressionEvaluator.validateTolerant` composition) — all match design.md's
  citations exactly.
- `WorkspaceTeardownServiceSpec.scala`'s doc comment and `helio_app_test` non-superuser role/harness
  (lines ~27-110) match design.md D4 / tasks.md 6.5's citation verbatim.
- `PatchSetApplyProtocol.scala`'s real `EditOutcome` (`index/status/newId/priorState/resultingState`)
  confirms D5's "mirrors... without being the same type" characterization — `EditOutcome` carries no
  `kind`/`op`, so `EditPreview` adding those is a legitimate, non-duplicative addition, not scope
  drift.
- `schemas/patch-set-apply-response.schema.json` (HEL-406's existing precedent) is a coherent
  template task 1.2 can mirror for the new `patch-set-preview-response.schema.json` (does not yet
  exist — confirmed no collision).

**`ticket.md` traced against the live Linear issue (HEL-408) via `mcp__linear__get_issue`:** the
Scope, Acceptance criteria, Out of scope, and Dependencies text returned by Linear is verbatim
identical to `ticket.md`'s content (the `HEL-343` reference appearing under both "patch-set schema"
and "multi-turn refinement" is Linear's own epic-link rendering, not drift introduced by this
change). No AC has drifted across five rounds — all six ACs (preview endpoint + diff/impact, shared
pre-validation both directions, impact-hint content, frontend reuse + Accept/Reject wiring,
green tests + `DESIGN.md`, additive backward-compat) are still traceable to concrete design.md
decisions (D1-D7) and tasks.md line items with no orphaned AC and no task doing unscoped work.

**`proposal.md` Impact list cross-checked line-by-line against `tasks.md`'s file-producing tasks**
(1.1/1.2/1.3, 2.1/2.2/2.3/2.3a, 3.1/3.2, 4.1-4.3, 5.1-5.4, 6.1-6.10): every file proposal.md lists is
produced by exactly one tasks.md item and vice versa; no orphaned file, no missing task.

### Minor observations (non-blocking)

1. **Task 6.9's "mirrors `ProposalReviewPage.test.tsx`'s coverage style" citation is imprecise.**
   The real `ProposalReviewPage.test.tsx` (added later, in HEL-401/`e77bf716`, not in the original
   `60980e4d` commit — confirmed via `git log --follow`) exclusively tests authoring-outcome
   correlation; every one of its test cases passes an explicit `proposal` via `routeState` and none
   exercises the `location.state`-absent / demo-synthesis fallback path. So there is no existing
   test in this codebase that actually covers "renders the synthesized demo ... when no router state
   is supplied" the way task 6.9 implies a precedent does. This doesn't block implementation — task
   6.9's four required behaviors are stated explicitly and unambiguously regardless of the citation's
   accuracy — but the citation itself overstates what the precedent test file covers.
2. **The "no dashboards/panels exist yet" edge case for `PatchSetReviewPage`'s demo synthesis is not
   named explicitly.** `ProposalReviewPage.tsx` has an explicit guard (`proposal.panels.length === 0`
   → `EmptyState` with `EMPTY_WORKSPACE_COPY`) for the case where no pipeline-output DataType exists
   to build a demo from. Design.md D6 / tasks.md 5.3 say the new page's demo builds an edit from "the
   first dashboard's first panel" and that "loading/error states mirror `ProposalReviewPage.tsx`'s
   own `EmptyState`/loading patterns," but don't explicitly call out what happens when the workspace
   has zero dashboards or the first dashboard has zero panels (a real possibility for a fresh
   account, `DemoData` notwithstanding). The generic "mirror the patterns" instruction plausibly
   covers this by extension, but an explicit callout (as D6 already does for the timestamp exclusion
   and the pending-id sentinel) would remove the ambiguity outright.

Neither observation blocks implementation: both are specific, narrow, and the executor has enough
concrete guidance (task 6.9's explicit bullet list; the general "mirror EmptyState/loading patterns"
instruction) to build a correct, testable page without needing to resolve them via a guess.

### Verdict: CONFIRM

### Non-blocking notes

- See "Minor observations" above (2 items) — worth a one-line tightening in a future edit but not
  worth another design round given both are self-resolving once an implementer reads
  `ProposalReviewPage.tsx` directly (which task 5.3 already points them at).
- This design has now survived five rounds of adversarial, source-grounded review (four prior
  REFUTEs, each fixing a genuine, independently-discovered defect: overclaimed 1:1 failure parity,
  an unspecified RLS-detection query, an unspecified RLS test harness, and a falsely-cited frontend
  precedent). This round's fresh, full-artifact pass — including re-deriving every backend citation
  from source rather than trusting rounds 1-4's "still holds" claims — found no new defect of that
  caliber. The artifact set is internally consistent (proposal.md/design.md/tasks.md/spec.md all
  agree on file list, decisions, and requirements) and sound enough to implement.
