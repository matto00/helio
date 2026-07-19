## Context

`Select` (`frontend/src/shared/ui/Select.tsx`) and other popovers use `usePortalPopover`
(`frontend/src/hooks/usePortalPopover.ts`). On open, `handleOpen` reads the trigger's
`getBoundingClientRect()` (viewport coordinates) and stores `{ top, left, width }`; the rendered panel
(`.ui-select__panel`, `inputs.css:99`) is `position: fixed` with those coordinates. `Select.openPanel`
portals the panel into the nearest `dialog[open]` when present (Select.tsx:51) so it renders in the dialog's
top layer instead of behind the modal backdrop.

`.panel-creation-modal[open]` (`PanelCreationModal.css:12-25`) applies `animation: panel-creation-modal-in
var(--transition-slow) both`, whose keyframes animate `transform`. With `animation-fill-mode: both`, the
forwards fill keeps the final keyframe's `transform` applied after the animation ends — and a non-`none`
`transform` makes the dialog a **containing block** for fixed-positioned descendants. So the panel's `fixed`
coordinates resolve relative to the dialog's box, displacing it by the dialog's origin (~283px down at
390×844, where the dialog is vertically centered).

**This exact defect was already fixed once in this codebase.** `frontend/src/shared/ui/Modal.css:14-21`
(commit `d7fb3816`, "Fix popover layering and positioning") uses the same entrance-animation pattern on the
shared `Modal` primitive but with `animation-fill-mode: backwards`, and carries a comment describing precisely
this mechanism ("a lingering forwards fill would keep the dialog as a transform containing block — which
re-anchors `position: fixed` popovers portalled into it (Select) to the dialog … The `to` state equals the
modal's resting style, so dropping the forwards fill is visually identical at rest"). `PanelCreationModal`
duplicates the dialog+animation instead of composing `Modal`, and never received that fix.

The executor MUST confirm with a runtime probe that the dialog is the fixed-positioning containing block and
that flipping the fill mode removes it (Iron Law: systematic-debugging).

## Goals / Non-Goals

**Goals:**
- The chart-type `Select` popover aligns to its trigger at 390×844, options tappable.
- Fix the actual root cause (a lingering `transform` on the dialog) minimally, mirroring the proven `Modal.css`
  precedent.
- Audit every `<dialog>`/popover call site for the same lingering-transform condition.
- Regression coverage that the panel-creation dialog leaves no containing-block transform at rest.

**Non-Goals:**
- Reworking the popover/Select API, keyboard/focus behavior, or touch-target sizing (HEL-308).
- Generic JS containing-block compensation in the shared hook (see Decisions — rejected).
- Migrating `PanelCreationModal` onto the shared `Modal` primitive.

## Decisions

**Fix the root cause in CSS: change `.panel-creation-modal[open]`'s fill mode from `both` to `backwards`.**
This mirrors the already-shipped `Modal.css` fix (d7fb3816). The `to` keyframe equals the dialog's resting
style (`transform: none`), so dropping the forwards fill is visually identical at rest while removing the
lingering `transform` — the dialog stops being a containing block and the portalled `position: fixed` popover
resolves against the viewport, as it already does everywhere else. Zero JS changes; the audited real-world
scope today is this one file.

- *Alternative — keep `both`, add generic JS containing-block-offset math in `usePortalPopover`/`Select`
  (subtract the portal target's rect from the trigger rect on every open/resize/scroll):* rejected. It treats
  the symptom rather than the root cause, is materially more invasive, and is the shared-hook change most
  likely to regress the non-dialog (`document.body`) path — for zero benefit given the audit shows one
  afflicted CSS file. If defense-in-depth against future containing-block sources (`filter`, `perspective`) is
  ever wanted, it should be a separate, explicitly-justified change, not a substitute for this fix.
- *Alternative — migrate `PanelCreationModal` to the shared `Modal` primitive (which is already correct):*
  rejected for this ticket as a larger refactor beyond the bug's scope; noted as a possible follow-up to
  eliminate the duplication that caused the fix to be missed.

## Risks / Trade-offs

- [Another dialog has the same lingering-transform bug] → the audit checks every `<dialog>`'s entrance-animation
  `animation-fill-mode`. Known result (verified during design review): `PanelDetailModal` — no transform
  animation, unaffected; all shared-`Modal`-based create/share dialogs — already `backwards`, unaffected;
  `ActionsMenu`/`UserMenu`/`DashboardAppearanceEditor` — always portal to `document.body`, never inside a
  dialog, unaffected. The executor re-confirms rather than assuming.
- [Entrance animation looks different after the change] → `backwards` fill only drops the *forwards* fill; the
  `to` state already equals the resting style, so at-rest appearance is unchanged (as proven by the shipped
  `Modal.css` comment). The entrance still animates from the `from` keyframe.
- [jsdom cannot compute real layout, and jest mocks `.css` imports to `{}` (`src/test/styleMock.js`) so no
  computed-style assertion is possible] → the regression test reads the CSS source with `fs.readFileSync` and
  asserts `.panel-creation-modal[open]`'s animation uses `backwards` (not `both`/`forwards`), mirroring the
  existing `frontend/src/shared/chrome/ActionsMenu.css.test.ts` precedent. True pixel alignment at 390×844 is
  verified by the evaluator/skeptic via Playwright.

## Planner Notes

- Self-approved: frontend-only, one-line CSS fix, no external deps, no API/schema/architectural change.
- Root-cause fix (CSS fill mode) adopted over the initial JS-compensation approach after the design-gate
  skeptic surfaced the `Modal.css` / d7fb3816 precedent — the same bug, already fixed once for the shared
  modal. This is the minimal fix that addresses the true root cause.
- Follow-up worth a spinoff ticket: fold `PanelCreationModal` into the shared `Modal` primitive so this class
  of divergence can't recur.
