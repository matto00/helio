# HEL-1791: Phone: compact counter form card collapses to ~30px, hiding the counter

## Description

On a phone, a compact counter form panel (a form with exactly one field, a counter) collapses to about 30 px in the
mobile panel stack. Only the panel title shows. The counter's value, its `+`/`-` buttons, and (for an editor) the
"Your net change this session" caption added by HEL-1788 are hidden until the user scrolls inside the card.

It affects every compact counter, including the owner's. It predates HEL-1788.

## Acceptance Criteria

- On a phone (390 px), a compact counter card is tall enough to show its value, both buttons and, for a non-owner,
  the caption, without scrolling inside the card, in light and dark.
- Also holds at 768 px and at 1100 px with the sidebar open (the single-column panel stack).
- Other panel kinds in the mobile panel stack keep their current height.
- A test that fails first.

## Agent notes (from the ticket, claims to re-probe)

Measured during HEL-1788's evaluation and final gate (2026-11-19, base a867001d7):

- Reproduced at 390, 768 and 1100 px (with the sidebar open) in `mobile-panel-stack`. The card is 30-42 px tall.
  Owner and editor alike.
- Ancestor probe: `.crossfade` (`flex: 1 1 0%`, `min-height: 0`) and `.crossfade__layer` compute to 0 px inside the
  intrinsic-height card. `.panel-content--form` is 24 px with `overflow-y: auto` (scrollHeight 56).
- Likely files: `frontend/src/shared/ui/Crossfade.css`, `frontend/src/features/panels/ui/PanelContent.css`,
  `frontend/src/features/panels/ui/grid/MobilePanelStack.css`, `frontend/src/features/panels/ui/form/CounterControl.css`
  (`.form-panel-view__compact-counter`).
- Screenshots (main checkout) under `.concertino/runs/HEL-1788/evidence/.concertino/scratch/HEL-1788/`; reports
  `.concertino/runs/HEL-1788/evidence/openspec/changes/label-editor-counter-tally/skeptic-final-1.md` and
  `evaluation-1.md`.
