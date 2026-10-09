# HEL-1398: Truncation-note follow-ups: chart area collapses at w=2 with annotation + note; stale "one-line" comment; weak style-test regex

## Description

origin_kind: followup
origin_ticket: HEL-1358

From HEL-1358 (8efa42298). Verify each.

1. On a w=2, minimum-height chart that has both an annotation and the truncation note, the chart area shrinks to about 5px. Fix with a short form at narrow widths ("200 of 1,234 rows") and/or a minimum chart height. Check both themes and the mobile stack.
2. The `truncationNote` prop comment in `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx` still says "one-line"; the note now clamps to two lines.
3. In `PanelContent.truncationNoteStyle.test.ts`, the "no standalone note rule" regex misses a rule that comes after a comment. Make it robust and show it red against such a rule.
4. The "matching rows" wording (viewer filter / server cross-filter) has only been checked in unit tests. Check it live once in each theme.

## Acceptance criteria

* 1: measured chart height >= a stated minimum at w=2 with both footnotes; red-first.
* 2-4 as described.

## Driver context (claims to verify, not facts)

- HEL-1392 (#882, 586da928) changed panel data reuse across the desktop/phone remount (usePanelData/useOutputMeta). Do not regress it.
- HEL-1438 holds a pre-existing "phone-stack chart cards render 100px high" finding. If item 1's fix naturally covers the mobile stack's chart height, say so; do not absorb HEL-1438's other items.
- Item 1: measure in the RUNNING app (light + dark themes, plus the mobile stack), not only jsdom.
- Item 3: show the improved regex red against a rule placed after a comment.
- Item 4: one live check of the "matching rows" wording in each theme; screenshots go to the run evidence dir (`.concertino/runs/HEL-1398/evidence/` in the main checkout, via `scripts/concertino/persist-evidence.sh`).
