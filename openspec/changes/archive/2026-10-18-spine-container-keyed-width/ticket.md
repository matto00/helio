# HEL-1608: Pipeline detail at 769–1100px desktop widths: key the spine and header to the page container, keep step titles readable

## Description

Follow-up of HEL-1579 (desktop pipeline detail: step spine, focused editor, preview table). All HEL-1579 ACs are met at
1280×800 and 1440; the owner accepted one known narrow-desktop defect (escalation answer `proceed-with-followup`,
2026-10-15): between a 769px and about a 950px viewport the spine's step titles are unreadable.

Cause: the spine grid track `clamp(180px, 22vw, 340px)` follows the **viewport**, not the page's own width. The page is
already a size container (`.pipeline-detail-page--spine`; the header uses container queries at 800px and 600px). So the
spine is 180px at any viewport ≤818px and under 270px below 1227px, however much room the page actually has. The context
list ranges 200–400px. Rows stay selectable and their accessible names keep the full label; the HEL-1579 769–1100 sweep
does not measure spine content, so it passes over the defect.

Evaluator measurements (HEL-1579 evaluation-5), visible / full title width in px, identical in both themes and with the
context list at default (248px) or max (400px):

| Viewport | "Filter rows" | Lane row "Limit rows" |
| -- | -- | -- |
| 769 | 21 / 70 ("F…") | 1 / 68 (nothing visible) |
| 900 | 39 / 70 | 19 / 68 |
| 1000 | 61 / 70 | 41 / 68 |
| 1100 | 83 / 83 | 63 / 68 |

Cycle 4 of HEL-1579 had a 270px floor and showed full titles, but its header clipped the "Pipeline actions" menu at
780–835px. Restoring that floor alone brings the clipping back.

## What

- Key the spine track's narrowing to the page container (container units/queries), not the viewport. Floor it at about
  230–240px. If that floor does not fit at the narrowest page width, move the row count to a second line or show the
  row ⋮ only on hover/focus below it.
- Keep every HEL-1579 narrow-width guarantee: the header never overflows, the ⋮ menu is fully reachable, the editor
  actions wrap, and the document never scrolls.
- Extend `e2e/hel1579-pipeline-spine-layout.spec.ts`'s 769–1100 sweep (8px steps, both themes, list default + max) with
  a step-title width assertion: each `.spine-row__title` is at least about 60px visible, or shows the full title. Show it
  failing on the current CSS first.
- Fix the doc nits evaluation-5 found: the spec says the paused chip keeps its icon below ~600px, but the CSS drops it;
  design D2 still says `clamp(270px…)`; one CSS comment still refers to the old 1100px block.

## Acceptance criteria

- [ ] At every width from 769 to 1100px, in both themes, with the context list at default and maximum width, every spine
  step title (trunk and lane rows) is readable (≥ ~60px visible or full), and the header and editor checks of the
  HEL-1579 sweep still pass.
- [ ] The new sweep assertion fails against the HEL-1579 CSS and passes after the fix.
- [ ] 1280×800 still shows the spine (~270–340px), the editor and ≥8 preview rows with no document scroll.

## Driver constraints (this run)

- Phone layout (≤768px) stays exactly as HEL-1582 left it; `e2e/hel1582-*` specs stay green.
- Out of scope: HEL-1668 (phone pipeline polish), HEL-1669 (accent hover contrast tokens).
