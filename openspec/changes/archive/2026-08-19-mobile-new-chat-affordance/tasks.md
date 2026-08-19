## 1. Frontend — Finding B: shared Modal blank-screen regression (priority — do first)

- [x] 1.1 At a real 390×844 viewport, reproduce "Open assistant" from the dashboard (`/`) exactly:
      tap the `CommandBar` quick-launcher icon (`aria-label="Open assistant"`); screenshot; check
      console for errors; capture `getComputedStyle`/`getBoundingClientRect` for the `<dialog
      class="ui-modal...">`, `.ui-modal__inner`, and `.ui-modal__body` elements.
- [x] 1.2 At the same viewport, reproduce "Review proposal" exactly for the `pipeline` kind first
      (deepest capture — screenshot/console/computed-style, same as 1.1): get a `ProposalHandoff`
      card on screen (a live `propose_pipeline` result, or `PipelineProposalReviewPage.tsx`'s own
      `IS_DEV` demo-fixture fallback, `useDemoFixture`), tap "Review proposal", capture against the
      resulting route's `Modal`. The other three `ProposalHandoff` kinds (`dashboard`, `patch`,
      `combined` — each routes to its own `lg` review `Modal`: `ProposalReview`, `PatchSetReview`,
      `CombinedProposalReview` respectively) are NOT exercised by this single repro — they are
      covered instead by 1.6's spot-check list below, so all four stay covered somewhere in this
      section rather than three of the four review Modals going untested.
- [x] 1.3 Compare the two captures. Confirm (or rule out) that both show the identical collapsed or
      mispositioned `<dialog>` geometry — i.e. that `shared/ui/Modal.tsx`/`Modal.css` is the shared
      root cause (design.md D4), not two independent bugs.
- [x] 1.4 From the concrete computed-style/bounding-rect numbers, identify which of design.md D5's
      two candidate mechanisms (CSS percentage-height-through-auto-parent collapse, or mobile
      `vh`/dialog-centering viewport quirk) — or a third mechanism — is actually occurring.
- [x] 1.5 Fix the confirmed mechanism in `Modal.tsx`/`Modal.css` — one shared fix, not a per-consumer
      patch. Keep the change minimal and targeted; do not regress the narrower-fixed-height-override
      case a prior HEL-716 skeptic round already fixed.
- [x] 1.6 Spot-check the remaining `size="lg"` (and `PanelDetailModal`'s `full`-mode) `Modal`
      consumers at 390×844 for the same symptom, pre- and post-fix — the accurate list (corrected
      from an earlier draft that wrongly named two `size="sm"` consumers instead): `ProposalReview`,
      `PatchSetReview`, `CombinedProposalReview` (the three "Review proposal" kinds 1.2 does not
      itself exercise — see 1.2's note), plus `PanelCreationModal`, `CreateMetricModal`,
      `PipelinePreviewModal`, `RunHistoryModal`, and `PanelDetailModal` in its **view** mode
      specifically (the `full`-size variant — not edit mode's `md`, which is out of this audit's
      `lg`/`full` scope).
- [x] 1.7 N/A — not triggered: 1.1/1.2 DID reproduce the symptom (see files-modified.md for the full
      evidence: `.ui-modal__inner` grew to 4277px against a 759.6px-capped dialog for "Open
      assistant", and to 2863px for a large injected "Review proposal" proposal), so no escalation
      was needed.

## 2. Frontend — Finding A: New chat affordance

- [x] 2.1 In `CommandBar.tsx`, add a phone-only "+" `IconButton` (variant="secondary", size="xs",
      aria-label="New chat") next to `.app-command-bar__mobile-title`, gated on `pickerId ===
      "chat"`, dispatching `startNewConversation()` (from `assistantConversationsSlice`).
- [x] 2.2 In `App.css`, add the breakpoint rule hiding the new control by default and showing it
      only under the existing `@media (max-width: 768px)` block, mirroring
      `.app-command-bar__mobile-title`'s own pattern.
- [x] 2.3 Verify the new control does not crowd the phone command bar layout.
- [x] 2.4 Re-verify at 390×844 that tapping the new "New chat" control does not itself trigger
      Finding B's symptom (it renders no `Modal`, but confirm live rather than assume).

## 3. Tests

- [x] 3.1 Add/update a `CommandBar.test.tsx` case covering the new control's visibility gating
      (`pickerId === "chat"` and phone-width only) and that it dispatches `startNewConversation()`.
- [x] 3.2 Add/update a `Modal.test.tsx` (or the relevant consumer's test) covering whichever
      mechanism 1.4/1.5 confirmed and fixed, so the regression has an automated guard.
- [x] 3.3 Run the full frontend test suite (`npm test`) and lint (`npm run lint`) clean.

## 4. Documentation

- [x] 4.1 Record the specific live evidence from section 1 (states tested, console output, computed
      styles, which mechanism was confirmed) for the closing ticket comment — both findings, stated
      as separate root causes, never conflated.
