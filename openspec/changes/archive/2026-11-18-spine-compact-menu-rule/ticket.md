# HEL-1671: Pipeline spine compact mode after HEL-1608: consistent ⋮ rule for source/output cards, marker gap, assert compact is on, spec viewport wording

## Description

origin_kind: followup
origin_ticket: HEL-1608 (PR matto00/helio#1064, merged as 647734111)

HEL-1608 added a compact spine mode on desktop when the spine is narrower than about 259px. The selected row's ⋮ then shows only on hover or focus. Remaining items:

1. **⋮ consistency.** The source and output cards always show their ⋮, while compacted step rows show it only on hover or focus. Pick one rule for all three.
2. **Marker gap.** In compact mode, rows with no markers still spend one 8px gap (from evaluation-2).
3. **Test gap.** The hel1608 spec doesn't assert that compact mode is actually on. It is on today at 769–1009px.
4. **Truncation.** At 1100px, above the compaction threshold, "Compute column" cuts to "Compute col…" (about 95px visible). This meets HEL-1608's AC, but check it is acceptable.
5. **Doc error.** The `pipeline-schedule-config-ui` spec's "Layout scope (HEL-1579)" paragraph says ≤1100/≤900px of viewport, but the CSS uses 800/600px of page width. Correct the wording.

HEL-1608's overnight UI decisions are listed in PR #1064's body, and the owner may revisit them:

* the hover/focus-only ⋮ below ~259px;
* in compact rows, the count keeps its full width and the summary ellipsizes first.

## Acceptance Criteria

Items 1–3 fixed with tests that fail first, compared against the running app at 769, 900, 1024 and 1100px in light and dark. Items 4–5 either decided or corrected.

## Driver notes (claims, verified at Planning — see premise-validation evidence)

- Item 1: choose the rule using DESIGN.md and touch/no-hover reachability; justify in design.md.
- Item 4: decide if the only fix is a layout trade-off within DESIGN.md; park with a written question if it needs a product call (e.g. renaming step labels).
- Item 5: verify the CSS values first.
- Run the full hel1608 spec and any spine spec touched. Measure truncation via scrollWidth/clientWidth, not hard-coded pixels (fonts are a committed local copy, HEL-1757).
- Concurrent lanes HEL-1762 (usePortalPopover / panelFit) and HEL-1736 (open-dialog registry): do not change the shared popover fit.
