# HEL-1583 Phase A rendered-pixel measurements

Source: `e2e/hel1583-mobile-dashboard.spec.ts` ("HEL-1583 measurements"), run against this worktree's dev server (port 7015, backend 9922), headless Chromium, after `document.fonts.ready`. Screenshots (as-loaded state) in `evidence/phone-<width>-<theme>.png`.
Markdown text insets are read from a text `Range` rect (min left / max right of every text node's client rects) vs `document.documentElement.clientWidth`. Chip label contrast is computed from the screenshot's rendered pixels (modal pixel = fill, pixel farthest in luminance = ink).

| width | theme | md text left (px) | md text right (px, ragged) | card left/right (px) | card gaps (px) | stack/grid | zoom widgets | chip painted/hit height | chips overlap | active chip in row | active/inactive label contrast | h-overflow |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 320 | dark | 27 | 27 | 12/12 | 10, 10 | stack | 0 | 32/44 | False | True (scrollLeft 112) | 16.8 / 16.8 | False |
| 375 | dark | 27 | 27 | 12/12 | 10, 10 | stack | 0 | 32/44 | False | True (scrollLeft 57) | 16.8 / 16.8 | False |
| 390 | dark | 27 | 42 | 12/12 | 10, 10 | stack | 0 | 32/44 | False | True (scrollLeft 42) | 16.8 / 16.8 | False |
| 430 | dark | 27 | 30 | 12/12 | 10, 10 | stack | 0 | 32/44 | False | True (scrollLeft 2) | 16.8 / 16.8 | False |
| 768 | dark | 27 | 132 | 12/12 | 10, 10 | stack | 0 | 32/44 | False | True (scrollLeft 0) | 16.8 / 16.8 | False |
| 320 | light | 27 | 27 | 12/12 | 10, 10 | stack | 0 | 32/44 | False | True (scrollLeft 112) | 16.5 / 15.1 | False |
| 375 | light | 27 | 27 | 12/12 | 10, 10 | stack | 0 | 32/44 | False | True (scrollLeft 57) | 16.5 / 15.1 | False |
| 390 | light | 27 | 42 | 12/12 | 10, 10 | stack | 0 | 32/44 | False | True (scrollLeft 42) | 16.5 / 15.1 | False |
| 430 | light | 27 | 30 | 12/12 | 10, 10 | stack | 0 | 32/44 | False | True (scrollLeft 2) | 16.5 / 15.1 | False |
| 768 | light | 27 | 132 | 12/12 | 10, 10 | stack | 0 | 32/44 | False | True (scrollLeft 0) | 16.3 / 15.0 | False |

## Acceptance read-out

- AC1: at 375px markdown text starts 27px from the left edge in both themes (<= 28px); chain 12 (`.panel-list`) + 1 border + 14 card + 0 markdown = 27. The card box is 12px from both edges at every width. The right column is ragged-right text; the markdown body box's own right edge is 12 + 1 + 14 = 27px from the edge (asserted <= 28 in the e2e).
- Panel gaps are 10px (spec: 8-12px). The single-column stack (never the grid) renders at 768px.
- Chips: 32px painted pill, 44px hit area (`::after`), no horizontal overlap; the active chip is fully inside the row at load at every width, with `scrollLeft` set on the row itself (not `scrollIntoView`).
- Zoom widget: 0 elements in the DOM at 375/430/768 (and 600 in the dedicated test).
- Chip label contrast >= 4.5:1 from rendered pixels in both themes (min 15.0 measured).


# HEL-1583 Phase B rendered-pixel measurements (tasks 3.2a, 3.3, 3.5, 3.5a)

Source: `e2e/hel1583-glass-nav.spec.ts` and `e2e/hel1583-home-375.spec.ts`, this worktree's dev server (7015 / 9922), headless Chromium, DPR 1, after `document.fonts.ready` and after the nav's transitions settled. Screenshots: `evidence/` (copied from `e2e-evidence/HEL-1583/`).

## Contrast (owner answer `opaque-pill-text-ring`: treatment NOT adjusted)

Method: a screenshot of the nav (plus an 8px margin) is decoded to RGBA. The backdrop is a fixed layer inserted just before the nav in its own stacking context (white, black, the accent colour, a 6px black/white checker as the photo worst case), so the nav's `backdrop-filter` samples it. Ring edge = contrast between the 1px ring and the capsule material 4px outside it, on the straight top and bottom segments at 35-65% of the pill's width (the ring row is found by scanning 3 rows). Label / glyph = farthest pixel from the box's corner-mean surface. Floors: edge >= 3, label >= 4.5, glyph >= 3.

| width | theme | active | backdrop | ring edge top / bottom | label | active glyph | min inactive glyph |
|---|---|---|---|---|---|---|---|
| 320 | light | Dashboards | default | 15.13 / 14.87 | 16.74 | 6.86 | 14.87 |
| 320 | light | Dashboards | white | 16.48 / 16.48 | 16.74 | 6.86 | 16.66 |
| 320 | light | Dashboards | black | 4.86 / 4.86 | 16.74 | 6.86 | 4.91 |
| 320 | light | Dashboards | accent | 9.22 / 9.21 | 16.74 | 6.86 | 9.31 |
| 320 | light | Dashboards | photo | 9.41 / 9.41 | 16.74 | 6.86 | 9.42 |
| 320 | light | Pipelines | default | 15.66 / 15.65 | 16.74 | 6.9 | 15.78 |
| 320 | light | Pipelines | white | 16.48 / 16.48 | 16.74 | 6.9 | 16.48 |
| 320 | light | Pipelines | black | 4.86 / 4.86 | 16.74 | 6.9 | 4.86 |
| 320 | light | Pipelines | accent | 9.22 / 9.21 | 16.74 | 6.9 | 9.21 |
| 320 | light | Pipelines | photo | 9.41 / 9.41 | 16.74 | 6.9 | 9.42 |
| 320 | dark | Dashboards | default | 15.61 / 15.26 | 13.62 | 6.39 | 14.64 |
| 320 | dark | Dashboards | white | 3.96 / 3.43 | 13.62 | 6.39 | 3.43 |
| 320 | dark | Dashboards | black | 16.92 / 16.92 | 13.62 | 6.39 | 16.92 |
| 320 | dark | Dashboards | accent | 6.89 / 6.95 | 13.62 | 6.39 | 6.86 |
| 320 | dark | Dashboards | photo | 8.34 / 8.34 | 13.62 | 6.39 | 7.71 |
| 320 | dark | Pipelines | default | 16.18 / 16.18 | 13.62 | 6.39 | 16.27 |
| 320 | dark | Pipelines | white | 3.96 / 3.43 | 13.62 | 6.39 | 3.43 |
| 320 | dark | Pipelines | black | 16.92 / 16.92 | 13.62 | 6.39 | 16.92 |
| 320 | dark | Pipelines | accent | 6.89 / 6.95 | 13.62 | 6.39 | 6.86 |
| 320 | dark | Pipelines | photo | 8.34 / 8.34 | 13.62 | 6.39 | 7.71 |
| 375 | light | Dashboards | default | 14.74 / 16.05 | 16.21 | 6.86 | 15.45 |
| 375 | light | Dashboards | white | 16.48 / 16.48 | 16.21 | 6.86 | 16.66 |
| 375 | light | Dashboards | black | 4.86 / 4.86 | 16.21 | 6.86 | 4.91 |
| 375 | light | Dashboards | accent | 9.22 / 9.21 | 16.21 | 6.86 | 9.31 |
| 375 | light | Dashboards | photo | 9.41 / 9.41 | 16.21 | 6.86 | 9.72 |
| 375 | dark | Dashboards | default | 15.11 / 15.58 | 12.77 | 6.39 | 15.26 |
| 375 | dark | Dashboards | white | 3.96 / 3.43 | 12.77 | 6.39 | 3.43 |
| 375 | dark | Dashboards | black | 16.92 / 16.92 | 12.77 | 6.39 | 16.92 |
| 375 | dark | Dashboards | accent | 6.89 / 6.95 | 12.77 | 6.39 | 6.86 |
| 375 | dark | Dashboards | photo | 8.34 / 8.34 | 12.77 | 6.39 | 7.83 |
| 768 | light | Dashboards | default | 16.22 / 15.52 | 16.21 | 6.86 | 16.11 |
| 768 | light | Dashboards | white | 16.48 / 16.48 | 16.21 | 6.86 | 16.66 |
| 768 | light | Dashboards | black | 4.86 / 4.86 | 16.21 | 6.86 | 4.91 |
| 768 | light | Dashboards | accent | 9.22 / 9.21 | 16.21 | 6.86 | 9.31 |
| 768 | light | Dashboards | photo | 9.21 / 9.12 | 16.21 | 6.86 | 9.42 |
| 768 | dark | Dashboards | default | 15.58 / 16.15 | 12.77 | 6.39 | 15.76 |
| 768 | dark | Dashboards | white | 3.96 / 3.43 | 12.77 | 6.39 | 3.43 |
| 768 | dark | Dashboards | black | 16.92 / 16.92 | 12.77 | 6.39 | 16.92 |
| 768 | dark | Dashboards | accent | 6.89 / 6.95 | 12.77 | 6.39 | 6.86 |
| 768 | dark | Dashboards | photo | 8.6 / 8.74 | 12.77 | 6.39 | 7.83 |

Minimums across all 40 rows: ring edge 3.43:1 (dark theme over white), label 12.77:1, active glyph 6.39:1, inactive glyphs 3.43:1 (dark theme over white). **No backdrop falls below any floor in either theme**, so there is nothing to report as a shortfall. The thin margin the owner flagged is real: dark-theme-over-white is 3.43:1 at the pill's bottom edge (3.96:1 at the top) and the same 3.43:1 for the inactive icons, 0.43 above the floor. Mutation evidence: with the ring removed the same spec reads 1.04:1 at the pill edge and goes red (`evidence/mutation-e2e-ring.txt`).

## 320px fit and truncation (task 3.5)

Capsule content box 278px, every tab 44px floor, the active tab 102px:

- Dashboards active: label client width 54px, scroll width 72px: truncated with an ellipsis (both themes).
- Pipelines active: label client width 54px, scroll width 55px: 1px of overflow, ellipsised.
- With either active, no tab or label box crosses the capsule's content box and the active lozenge box stays inside its own tab's box; with the lozenge's bound removed (`min-width: max-content`) the spec fails (`evidence/mutation-e2e-fit320.txt`).
- Evenly spread tabs: at 430px the gaps are 15.3/15.3/15.3/15.3/15.3/15.4px and at 768px 71.7px each (space-evenly, active pill content-sized).

## Home at 375px (task 3.5a; HEL-1578's risk) -- measured, NOT changed

Home's phone gutters already match this ticket's rule (cards 12px from both edges, no horizontal overflow). The shelf collapses to one column at <= 430px, so the four cards stack:

| width | viewport h | shelf height (4 cards + gaps) | each card | "Pipeline runs" section top | timeline top | section top / viewport |
|---|---|---|---|---|---|---|
| 375 | 800 | 841px | 198px | 1070.75px | 1152.75px | 1.34 |
| 430 | 800 | 937px | 222px | 1167px | 1249px | 1.46 |

Identical numbers in the dark theme. The run timeline starts about 1.3 viewport heights down at 375px, entirely below the fold; the cause is the 1-column shelf (4 x 198px), not a gutter, so it falls outside this ticket's own phone-gutter rules and is left for a follow-up (e.g. a horizontally scrolling or 2-column compact shelf on the phone). Screenshots: `home-375-<theme>-viewport.png`, `-full.png`, `-at-timeline.png` (and 430).
