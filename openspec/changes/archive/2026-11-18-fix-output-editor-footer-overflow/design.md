## Context

`OutputEditorFooter.tsx` renders `<div class="output-editor-sheet__footer">` inside the shared Modal's
`<footer class="ui-modal__footer">` (`shared/ui/Modal.tsx:261`). Its buttons use the shared `ui-modal-btn` recipe
(`shared/ui/Modal.css:203`): `display: inline-flex; height: var(--control-md); padding: 0 var(--space-4)`. The sheet's
footer rule (`OutputEditorSheet.css:90`) is `display: flex; justify-content: flex-end; gap: var(--space-3)` with no
`flex-wrap`, and `.output-editor-sheet__delete` adds `margin-right: auto`.

Root cause at 375px: the row never wraps, so flex-shrink squeezes the longest-label buttons (the confirm and "Add as
tail with aggregate") far below their max-content width; their text then wraps to 3-5 lines inside a box whose height
is fixed at `--control-md`, and the extra lines paint outside the border (HEL-1733 skeptic screenshot). Both symptoms in
the ticket share this one cause and this one CSS rule, so both are in scope.

## Goals / Non-Goals

**Goals:** every footer label contained by its button at 375px in both themes, at most two lines; full confirm text
kept; desktop footer pixel-equivalent to today.

**Non-Goals:** copy changes; touching `.ui-modal-btn` globally (other modals rely on its fixed height); the sheet body.

## Decisions

1. **Wrap the row, scoped to this sheet.** Add `flex-wrap: wrap` to `.output-editor-sheet__footer`. When the buttons fit
   (desktop) this is a no-op; when they do not, the long button moves to its own line instead of being squeezed.
   Alternative: column-stack all buttons under a width media query. Rejected: a width gate duplicates breakpoints and
   changes the layout even when the row would fit (e.g. no confirm showing).
2. **Let a footer button grow in height, scoped to this sheet.** Under `.output-editor-sheet__footer .ui-modal-btn`, use
   `height: auto; min-height: var(--control-md); padding-block: var(--space-1); text-align: center`,
   so a label that still needs two lines on its own line (the confirm at the 303px footer content width: the `lg` dialog is 343px at 375px, minus 2x `--space-5`) grows the box rather than
   spilling. Arithmetic (measured on the running app): buttons compute `line-height: normal`, about 18px per line at
   `--text-sm` (14px), so a single-line button is 18 + 2x4 (`--space-1`) + 2x1 border = 28px, and `min-height:
   var(--control-md)` (32px) holds it at exactly 32px, as today. The two-line confirm measures 46px (not the 52px a
   1.5 line-height would give); line height is font-dependent, so no spec asserts these numbers. `--space-2` would make every single-line footer button 36px (18 + 16 + 2), above `--control-md`; it is rejected and
   the e2e guards it (task 1.1, mutation in 1.2). Alternative: shorten the copy (e.g. "Confirm (1 dashboard)").
   Rejected by the orchestrator's scoping (ticket.md AC 3, C16), not by an owner ruling: Linear allows "wraps or
   shortens", and wrapping keeps the dashboard count without a copy decision.
3. **Desktop arrangement is preserved, not redefined.** From the CSS, `.output-editor-sheet__footer` is an unstretched
   flex item of the right-aligned `.ui-modal__footer`, so on desktop Delete likely sits next to Cancel, not at the
   dialog's left edge. Task 1.0 measures the real arrangement on the running app before any CSS change; the 1280
   assertions encode those measured relations (Delete's left vs the footer's left, shared row). Moving Delete to the
   far left is out of scope.
4. **Scoped exception to DESIGN.md §5.** §5 says footer buttons are "all at `--control-sm/md` height", and §3 Control
   metrics treats two-line wrapped labels as a failure mode. A button here grows past `--control-md` only when, on its
   own wrapped line at a phone width, its label still cannot fit one line: today only the dashboard-count confirm. That
   is a deliberate exception scoped to this footer, justified by the ticket's "wraps" wording and by keeping the count.
   No 44px inflation: the `::after` hit expander is unchanged.
5. **Keep the 44px mobile hit expander working.** `.ui-modal-btn::after` is a 44px centered overlay; a taller button is
   already >= 44px tall, so the expander stays valid. No change.
6. **Measure geometry, not CSS text.** RED-first Playwright spec at 375x812 (light + dark) and 1280x800: assert each
   footer button's `scrollWidth <= clientWidth` and `scrollHeight <= clientHeight` plus the phone's 44px `::after`
   hit expander's own overflow (computed from `getComputedStyle(button, "::after").height`, half the excess over the
   button's height; measured Cancel/Save 37 vs 30, the 46px confirm 44 vs 44), the label text's range rects lie
   inside the button rect, line count <= 2 (via `Range.getClientRects()` distinct tops), button width <= footer width,
   and at 1280 all buttons share one `top`. No hard-coded pixel widths (HEL-1757 is changing e2e fonts). A jest test
   cannot measure layout, so the e2e is the proof; the RED run is recorded against unmodified CSS.

## Risks / Trade-offs

- [Wrapped row looks unbalanced: confirm alone on line 1, Cancel/Save right-aligned on line 2] -> acceptable and in the
  design language (footer actions stay right-aligned; destructive action leads). Judged in both themes on the running
  app.
- [Create-mode wrap depends on font metrics] With Cancel, "Add as tail with aggregate" and Save on a 303px line, greedy
  wrapping may put Cancel alone on line 1, or Cancel + Add-tail on line 1 with Save alone on line 2, and HEL-1757's font
  change can flip which. ANY arrangement is acceptable if: DOM order is kept, each line is right-aligned, every label is
  inside its box, single-line buttons are `--control-md` tall, and no label exceeds two lines. Add-tail must fit one
  line (~214px). No deterministic grouping is added: forcing one needs a media query, which Decision 1 rejects. Task 3.1
  judges both themes' create-mode screenshots against this list; the e2e asserts the invariants, not an arrangement.
- [Selector specificity vs `.ui-modal-btn` mobile block] -> the sheet-scoped selector has higher specificity; the
  geometry spec, not a CSS-text test, is the guard.
- [Concurrent HEL-1746 / HEL-1757] -> neither touches OutputEditorSheet.css or OutputEditorFooter.tsx (checked at
  Setup); rebase at Delivery.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` or hook-invoked script is touched.

## Planner Notes

- Self-approved: folding in the "Add as tail with aggregate" wrap (same rule, same root cause).
- Corrected (design gate round 1): keeping the count is orchestrator scope (C16), not an owner ruling.
- Self-approved: no spec MODIFY of "Placements list and delete warning"; the confirm copy is unchanged.
