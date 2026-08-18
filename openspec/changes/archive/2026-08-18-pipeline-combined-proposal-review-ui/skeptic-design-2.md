## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-proposal-review-ui/spec.md`, `workflow-state.md`, and round 1's
  `skeptic-design-1.md` in full, treating the latter only as a claim of what was required —
  not as ground truth for whether it was actually fixed.

**CR1 (combined accept must select the new dashboard) — verified fixed, consistently, everywhere:**
- `design.md` D7 now states the `applyCombinedProposal` thunk "on success it must dispatch BOTH
  `dashboardUpserted(response.dashboard.dashboard)` AND
  `setSelectedDashboardId(response.dashboard.dashboard.id)`."
- `tasks.md` 3.3 mirrors this exactly ("dispatches BOTH `dashboardUpserted(...)` AND
  `setSelectedDashboardId(...)`") and explicitly tags it "skeptic round 1 CR1 fix."
- `tasks.md` 6.7 adds a test task asserting both dispatches on the thunk's success path.
- `specs/pipeline-proposal-review-ui/spec.md`'s "Accepting a combined proposal" scenario says
  "navigates to `/` with the created dashboard selected" — consistent with the fix (this line was
  already present in round 1 as the target-state contract the fix now actually satisfies).
- Re-verified ground truth directly in
  `frontend/src/features/dashboards/state/dashboardsSlice.ts`: `dashboardUpserted` (lines 216-224)
  only pushes/replaces in `state.items`, never touches `state.selectedDashboardId`;
  `setSelectedDashboardId` (line 193-195) is a separate exported reducer action that does. Both are
  exported (lines 317-323), confirming both actions the fix requires actually exist and are
  importable as described.
- Re-verified `patchSetsSlice.ts` (`grep` for `dashboardUpserted`/`setSelectedDashboardId`):
  it dispatches only `dashboardUpserted` (line 191), never `setSelectedDashboardId` — confirms
  design.md D7's claim that the patch-set precedent is not analogous (it re-syncs an
  already-selected dashboard, never needs to newly select one) and is not itself evidence that
  `dashboardUpserted` alone would suffice for a brand-new dashboard.
- Confirmed the response-shape path `response.dashboard.dashboard.id` the fix targets is real:
  `CombinedProposalProtocol.scala` — `CombinedProposalApplyResponse(pipeline, dashboard:
  DuplicateDashboardResponse)`; `DashboardProtocol.scala` — `DuplicateDashboardResponse(dashboard:
  DashboardResponse, panels)`. So `response.dashboard.dashboard.id` correctly resolves to the new
  dashboard's id.

**CR2 (combined page's dashboard half must not be a `ProposalReview.tsx` reuse) — verified fixed,
consistently, everywhere:**
- `design.md` adds Decision D8, explicitly citing "skeptic round 1 REFUTE, fix required," and lands
  on option (b) from round 1's required-fix list: new, dedicated, read-only JSX (dashboard name +
  panel list, no title-edit/panel-removal affordances), not a reuse of `ProposalReview.tsx`.
- `proposal.md`'s "What Changes" now describes the combined page's dashboard half as "a new,
  dedicated read-only rendering of its nested dashboard proposal ... see Design Decision D8 for why
  this is new JSX rather than a reuse of `ProposalReview.tsx`," and its Impact section explicitly
  states "`ProposalReview.tsx` is NOT touched — see Design Decision D8" — no task anywhere modifies
  that file, consistent with this.
- `tasks.md` 4.1 matches: "NEW, dedicated read-only JSX ... NOT a reuse of `ProposalReview.tsx`
  (design.md D8; that component owns its own Modal chrome + footer and cannot be embedded
  footer-less, skeptic round 1 CR2 fix)."
- `design.md`'s Non-Goals section was also reworded consistently with D8 ("its dashboard half is
  read-only (D8), unlike the standalone dashboard-only `/proposals/review` flow
  (`ProposalReview.tsx`), which keeps its own existing title-edit/panel-removal affordances
  untouched and unaffected by this change") — this resolves round 1's follow-on concern about the
  old, now-superseded Non-Goals wording that implied the combined page inherited edit affordances.
- Re-read `frontend/src/features/dashboards/ui/ProposalReview.tsx` in full (216 lines) to
  independently re-confirm the factual premise D8 rests on, not just trust round 1's prior reading:
  it renders its own `<Modal open onClose={onReject} ... footer={footer} ...>` (lines 91-99), the
  `footer` (lines 70-89) hard-wires its own Accept ("Accept & create")/Reject buttons directly to
  `onAccept`/`onReject`, and panel state is local `useState` (`name`, `panels`, lines 45-46) with
  inline `updateTitle`/`removePanel` edit affordances (lines 48-51, 130-143) interleaved into the
  panel-list JSX. There is no prop to suppress the Modal chrome or footer, and no separately
  exported "just the panel list" piece. D8's claim — this component cannot be embedded footer-less
  inside a single combined-page Accept/Reject pair — holds up under independent re-verification.
- `specs/pipeline-proposal-review-ui/spec.md`'s "Combined proposal review page" requirement and its
  "Reviewing a combined proposal" scenario both describe "a single Accept and a single Reject action
  covering both halves" — consistent with, and only achievable given, the D8 fix.

### Other checks

- Re-read `ProposalHandoff.tsx` (full file, 86 lines) — the `pipeline`/`combined` fallback (lines
  75-84) and the `dashboard`/`patch` `navigate(path, {state: {...}})` pattern (lines 22-73) match
  exactly what `proposal.md`/`design.md`/spec.md assume the wiring task (5.1) will replace.
- Re-read `store.ts`'s reducer registration list: `patchSetsReducer` is registered as `patchSets`
  (line 30) — matches design.md D7/proposal.md's Impact claim that `combinedProposalsReducer` will
  be registered the same way (`tasks.md` 3.4 has the corresponding task).
- No `TODO`/`TBD`/"figure out later"/deferred-decision language anywhere in the change dir's `.md`
  files (`grep -rniE` across `*.md` and `specs/*/*.md` returned nothing).
- Scope: ticket.md's three ACs (review page + Accept/Reject, `ProposalHandoff.tsx` wiring, new
  routes in `AppRoutes.tsx`) are each traceable to a spec requirement and a tasks.md section
  (1-2/6, 5.1, 5.2). "Not in scope" items (standalone source/type/metric proposal UI) have no
  corresponding tasks — no scope drift found. D2's decision not to wire the `analyze` preview is
  consistent with the ticket's own "Consider surfacing" (optional) framing, not a silent drop of a
  required AC.
- Round 1's non-blocking notes (store.ts registration clarity, D4's missing `enabled` field,
  `/patch-sets/review` lazy-loading inaccuracy) were advisory, not required fixes; I did not
  re-litigate them as blocking, though the store.ts registration ambiguity now reads as resolved
  incidentally (tasks.md 3.4 + design.md D7 both state it explicitly).

### Verdict: CONFIRM

Both round-1 required fixes are present, mutually consistent across every artifact (design.md,
proposal.md, tasks.md, specs/pipeline-proposal-review-ui/spec.md), and independently verified
against current ground truth in the codebase (dashboardsSlice.ts, patchSetsSlice.ts,
ProposalReview.tsx, CombinedProposalProtocol.scala, DashboardProtocol.scala, ProposalHandoff.tsx,
store.ts). No new contradictions, placeholders, or scope drift introduced by the round-2 revisions.
The design is sound enough to implement.

### Non-blocking notes

- `tasks.md` 6.7 ("including BOTH the `dashboardUpserted` AND `setSelectedDashboardId` dispatches
  on success") is a good regression-test anchor for CR1 — the executor should make sure this
  assertion actually checks the dispatched action *types* (or resulting store state), not just that
  the thunk resolved, or it wouldn't actually catch a regression to the round-1 bug.
- Round 1's D4 `enabled?: boolean` field-completeness note and the `/patch-sets/review`
  lazy-loading wording in proposal.md's Impact section remain unaddressed — both were explicitly
  non-blocking in round 1 and still are; worth a one-line cleanup during implementation but not a
  reason to hold the design gate.
