## Context

See proposal.md (Why). The shared modal (`frontend/src/shared/ui/Modal.tsx:261-282`) renders
`<dialog.ui-modal> > .ui-modal__inner > header / .ui-modal__body / footer`. `.ui-modal__body`
(`frontend/src/shared/ui/Modal.css:187`) is `flex: 1; overflow-y: auto; padding` with no `position`, and the open
`<dialog>` lives in the top layer (fixed). So an absolute descendant with no positioned ancestor inside the body uses
the dialog as its containing block: it is not clipped or scrolled by the body, and it extends the dialog's own
(native `overflow: auto`) scroll area. `.sr-only` (`frontend/src/theme/theme.css:731`) is `position: absolute`, as is
the shared `Toggle` input (`frontend/src/shared/ui/Toggle.css:22`). HEL-1763 proved this live on the Output editor
(1490 vs 729 at 375 px; 1211 vs 719 desktop) and fixed it with `position: relative` on `.output-editor-sheet__group`
(`frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.css:27`).

About 30 components render `<Modal>` (e.g. `OutputEditorSheet`, `PanelDetailModal`, `AddSourceModal`,
`CreatePipelineModal`, `PipelineShareDialog`, `DashboardShareDialog`, `RunHistoryModal`, `OutputHistoryModal`,
`PipelineScheduleDialog`, `MfaEnrollModal`, connector modals, `AskDrawer`, `CommandPalette`, `QuickLauncherOverlay`,
`HelpOverlay`, `StepPalette`, `ShapePickerModal`, `MobileStepSheet`, proposal reviews); `BottomSheet`
(`frontend/src/shared/motion/BottomSheet.tsx`) styles `.bottom-sheet .ui-modal__body`. Popovers are partly portalled
(`Select`, `ActionsMenu`, `ProvenancePopover`, `OutputSchemaDisclosure`, `ConnectorSelectField`, etc. use
`createPortal`), partly in place.

## Goals / Non-Goals

**Goals:** a measured inventory; one durable fix that also covers future hidden elements; a guard that is red on the
real defect; no placement change for any visible positioned content or popover.

**Non-Goals:** see proposal.md Non-goals. Also no change to non-`Modal` drawers unless the inventory shows the same
defect there (then they are reported, and fixed only if the same one-line remedy applies).

## Decisions

1. **Inventory by live probe first (systematic-debugging law).** With a lane-private DB and seeded data, open every
   reachable `<Modal>` consumer (and `BottomSheet`/`MobileNavSheet`/drawer scroll containers) at 375x812 and 1280x800.
   For each, record: dialog and body `scrollHeight` / `clientHeight`, the content bottom (last in-flow child bottom +
   body padding; `.ui-modal__inner` bottom for the dialog), and every `position: absolute|fixed` descendant of
   `.ui-modal__body` with its containing block (nearest positioned ancestor, or dialog), and whether it is visually
   hidden, plus whether it overflows the body's box (it would be clipped once the body is the containing block). Persist as `inventory.md` under `.concertino/runs/HEL-1774/evidence/` (C13). The probe is a reusable script
   in the e2e helper or scratch, not hand clicks. Modals that cannot be opened without external services (e.g. a live
   connector) are listed with the reason and checked statically (render in jsdom and list absolute descendants).
2. **Preferred fix: shared `position: relative` on `.ui-modal__body`.** It makes the scrolling body the containing
   block, so hidden content is clipped and scrolled with the body and can never extend the dialog. It also covers
   HEL-1774's "hidden element outside a group" case and every future modal. Justification is per child: the
   inventory's list of absolute descendants whose containing block is currently the dialog is exactly the set the rule
   moves. For each one the executor records before/after rects (scroll position 0) and states why the move is correct
   (hidden text: placement irrelevant; visible content: rect unchanged or now correctly scrolls with the body).
   Elements that already have a positioned ancestor inside the body, and `position: fixed` portalled popovers (whose
   containing block is the viewport, or the dialog only via transform, which `position: relative` does not create),
   are unaffected by construction; the probe confirms this for every popover kind reachable from a modal (Select,
   ActionsMenu, ProvenancePopover, OutputSchemaDisclosure, date inputs, tooltips). Note: `BottomSheet`'s drag
   `transform` already re-anchors fixed popovers while dragging, independent of this change; the popover check is
   done at rest so that pre-existing behavior is not attributed to the new rule.
   **Fallback**, only if the inventory finds a visible child intentionally anchored to the dialog that the rule would
   misplace: per-modal `position: relative` on that modal's body wrapper, plus the e2e guard covering every inventoried
   modal. The decision and its evidence are written into this file's Resolution section.
   Alternatives rejected: `overflow: clip/hidden` on the dialog or body (masks the symptom, clips focus rings and
   in-place popovers); `contain: layout|paint` on the body (also becomes the containing block for `position: fixed`
   descendants, re-anchoring portalled-in-dialog popovers such as `Select`, the same failure `Modal.css:13-19`
   documents for transforms).
3. **Keep HEL-1763's group rule.** It is redundant after the shared rule but harmless and still documents the editor
   case; removing it widens the diff for no behavior gain. Its comment is updated to point at the shared rule.
4. **Guards.**
   - New e2e spec `e2e/hel1774-modal-scroll-*.spec.ts` (six files; originally one `hel1774-modal-scroll-extent.spec.ts`, split in cycle 3): for each inventoried modal with absolute hidden content
     (at minimum the Output editor plus every modal the inventory finds), at 375x812, 390x844 and 1280x800, light and
     dark, assert dialog `scrollHeight <= content bottom + 2` and body `scrollHeight <= in-flow content + padding + 2`,
     content bottoms computed from elements, never hard-coded pixels (HEL-1763 spec shape:
     `e2e/hel1763-output-editor-preview-scroll.spec.ts`). Plus a "future hidden element" case (load-bearing: it is
     the discriminator for the shared rule if the inventory finds no other naturally broken modal). `.sr-only` has
     no `top`/`left`, so it sits at its static position and only stretches the dialog when that position is below the
     visible part of a body that already scrolls (skeptic-design-1: short body 240/240 = no defect; overflowing body
     2038 vs 731). So: open a real modal, make its body overflow (append a tall in-flow spacer, e.g. 2x the body's
     clientHeight, or use a modal whose body already scrolls), then append one `.sr-only` span as the body's LAST
     child, keep the body scrolled to the top, and assert the bounds. This case MUST be red in the committed red run.
   - Unit: extend `frontend/src/shared/ui/Modal.css.test.ts` with a static assertion that `.ui-modal__body` declares
     `position: relative` (labelled a guard, not a discriminator).
   - Red-first (C12): the e2e spec is committed and run red BEFORE the CSS fix; the red run is committed. Mutations
     after the fix: (a) remove the shared rule → the injected-element case and every naturally affected modal go red;
     (b) remove both the shared rule and HEL-1763's group rule → the Output editor case goes red. Each modal case that
     is green in the red run is labelled a guard in the spec, not a discriminator.
5. **Regression sweep.** Grep `e2e/` for `.ui-modal__body` and every selector the change touches; run in full every
   e2e spec that opens a modal touched by a per-modal fix, or, for the shared rule, the spec files that exercise
   popovers inside modals (selected from the inventory) plus `hel1763`, `hel1752`, `hel1668-phone-sheet`,
   `hel909-output-picker-panel-sheet`, `hel773-top-anchored-mobile-nav-sheet`. Run `Modal`/`BottomSheet` jest tests.

## Risks / Trade-offs

- [A visible absolute element anchored to the dialog moves] → Decision 2's per-child before/after rects; fallback
  per-modal fix.
- [A popover inside a modal re-anchors] → `position: relative` does not create a fixed containing block; probe
  confirms per popover kind.
- [Absolute content now clipped by the body (e.g. an in-place dropdown near the body's bottom edge)] → the inventory
  lists every visible absolute descendant; any that overflows the body is checked open at the body's bottom.
- [Seeding many modals makes the e2e slow/flaky] → one shared seed per spec, modals opened sequentially in one page,
  2 Playwright workers (C4).

- [`position: relative` makes the body paint above non-positioned siblings (no stacking context)] → any modal whose
  header/footer overlaps the body (check `CommandPalette`, `BottomSheet`) is screenshot-compared in the inventory.

## Planner Notes

- Self-approved: frontend CSS-only, no dependency/API/schema change. The ticket explicitly allows shared or per-modal;
  the choice is evidence-driven (Decision 2), not a product question.
- Driver lane constraints C1–C14 are restated in tasks.md "Lane Constraints" and bind every role.

## Resolution

Chosen: the shared fix, `.ui-modal__body { position: relative }` (`frontend/src/shared/ui/Modal.css`). The fallback
(per-modal) was not needed: the inventory (`evidence/inventory.md`, one row per consumer of the 30-file grep) found no
visible child anchored to the dialog.

Evidence:
- Red first. Committed red run `3129212f4` (`evidence/red-run.txt`, unfixed CSS) covered 7 modal cases (output-editor,
  create-pipeline, add-source, pipeline-share, pipeline-schedule, help-overlay, dashboard-share): the injected
  hidden-element case (body made to overflow, `.sr-only` span as last child, scrolled to top) is red for all 7 at
  375x812, 390x844, 1280x800, light and dark (e.g. Output editor dialog scrollHeight 3622 vs content 729.8 at 375).
  Cases added after that commit were proven red by a run with the shared rule removed, not by the committed red run:
  panel-detail-edit by cycle 1 mutation a (`evidence/mutation-a-shared-rule-removed.txt`), and output-history,
  shape-picker, add-root, create-connector, quick-launcher, mfa-enroll, mobile-step-sheet (phone only), ask-drawer,
  panel-fullscreen, panel-inspect, output-picker, run-history by `evidence/cycle3-unfixed-css-run.txt` (rule removed, split spec files, CI default rate limits; earlier cycle2 run superseded).
  step-palette and command-palette are GUARDS only (their flex-column body absorbs the spacer; injected case is green
  on unfixed CSS). Every natural case is green on unfixed CSS (guards).
- Fix green: `evidence/cycle3-fixed-default-limits-run.txt`, 38/38 across six split spec files (36 scroll-extent + 2 popover guards), against servers with no rate-limit overrides (max 82 requests in any 60 s window, 0 x 429). The guard is split by modal group, one user per test; no rate limit is raised anywhere.
- Mutation a (shared rule removed, group rule kept): 6/6 red. Mutation b (shared and HEL-1763 group rule removed): 6/6
  red, and the Output editor's NATURAL case goes red with HEL-1763's numbers (1490 vs 729.8 at 375, 1211 vs 719 at
  1280). Files restored afterwards.
- Per-child justification: positioned body descendants before and after are identical except `containingBlock` for
  AskDrawer's two hidden `.sr-only` elements and PanelFullscreenOverlay's nested closed dialog (all hidden, rects
  identical); every visible positioned descendant already had a positioned ancestor. A fixed-position `Select`
  listbox opens at identical rects with and without the rule (`evidence/popover-rects.txt`, a GUARD).
- Decision 3 kept: HEL-1763's `.output-editor-sheet__group` rule stays, comment updated (comment-only diff).
- Unit guard `Modal.css.test.ts` (static, a guard not a discriminator).
- Not opened live: EditConnector, RotateCredential, the four proposal/patch-set reviews and PipelineDraftDialogs
  (model output, live connector or cascading draft needed); static CSS findings with the grep are in inventory.md.
  Phone: dashboard-share, run-history, panel-fullscreen, panel-inspect, output-picker, ask-drawer are not reachable
  in the probe (reasons in inventory.md).
- Spec bound: a box that fills its container is bounded by max(content bottom, clientHeight) (phone step sheet).
