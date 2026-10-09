## Context

See proposal.md for motivation. Current state (main @ 586da928):

- `ChartRenderer.tsx` renders `.chart-panel__canvas` (flex `1 1 auto`, `min-height: 0`) followed by optional `.chart-panel__annotation` and `.chart-panel__truncation-note` paragraphs. Both footnotes share one rule in `PanelContent.css` (`flex: 0 0 auto`, 2-line `-webkit-line-clamp`, `--text-xs`, padding `--space-1 --space-3 --space-2`). A joined note drops its top padding.
- The card is a size container named `panel-card` (existing `@container panel-card (max-height: 179px)` / `(min-height: 280px)` queries in `PanelContent.css`).
- Grid: `rowHeight` 52, margin 18, min `h` 4 (262px card). At lg, 12 columns; w=2 is the narrowest card.
- The truncation text comes from `chartTruncationNoteText(loaded, total, narrowed)` in `chartTruncationNote.ts`.
- The "~5px" figure in the ticket is a claim from HEL-1358's review, not yet measured on this branch. Two two-line footnotes alone (~90px) do not obviously explain a ~5px canvas in a 262px card, so the real budget (card chrome, header wrapping, footnote line count at that width) must be measured before choosing numbers.

## Goals / Non-Goals

**Goals:**
- A measured, red-first proof that a w=2, h=4 chart with both footnotes keeps a canvas >= 96px in both themes.
- The four ticket items, each verified.

**Non-Goals:**
- HEL-1438's phone-stack chart-card height work (the 100px stack card). If the fix here incidentally changes the stack's chart height, report the measured before/after; do not otherwise change `mobilePanelHeights.ts` or stack sizing.
- Any change to HEL-1392's row/metadata reuse (`usePanelData`/`useOutputMeta`); this change is render/CSS only.
- Changing the long-form copy or when the note appears.

## Decisions

**D1 — Measure before fixing (systematic-debugging law).** First reproduce on the running app at w=2, h=4 at the lg breakpoint, with an annotation and a >200-row chart Output: record the card height, header height, each footnote's rendered height and line count, and the canvas height. The fix's numbers (container-query width threshold, clamp) are chosen from that measurement and written into `files-modified.md` / the evaluator-visible evidence. If the measured canvas is NOT collapsed (claim false), stop and report rather than fixing a non-problem.

**D2 — Short form at narrow widths, full sentence kept for AT.** Add `chartTruncationNoteShortText(loaded, total, narrowed)` -> `"{loaded} of {total} rows."` / `"{loaded} of {total} matching rows."` (same digit grouping), the copy the ticket itself proposes. `ChartRenderer` renders the note paragraph with two spans: the long sentence and the short form. Default: long visible, short `display:none`. Inside `@container panel-card (max-width: <threshold>)`: the long span gets the canonical `.sr-only` visually-hidden treatment (still in the DOM and in the accessibility tree), the short span is shown and `aria-hidden="true"`. The paragraph's `title` stays the full sentence. Alternatives rejected: JS width measurement (ResizeObserver per card — heavier, and the container already exists); short form only via text truncation (the total is exactly what an ellipsis drops). The prop contract changes from a single string to the data needed for both forms (or ChartRenderer receives both strings); pick whichever keeps every existing caller (grid card, mobile stack, fullscreen, detail modal, public viewer) passing through one place — existing tests asserting the long sentence via `findByText` must keep passing (adjust only if the span split changes text matching, and say so).

**D3 — Footnotes yield before the canvas.** Inside the same narrow container query, both footnotes clamp to one line (`-webkit-line-clamp: 1`/`line-clamp: 1`) and the canvas gets `min-height: 96px` as a floor. The 96px floor is the stated minimum for the AC. If D1's measurement shows the floor alone would push footnotes out of the card (clipped), the clamp/short form must be what makes room — the floor is a backstop, not the primary fix. A clipped-away note is a failure (the note must stay visible).

**D4 — Red-first proof is an e2e measurement.** Add a Playwright spec under `e2e/` (pattern: `e2e/hel1023-breakpoint-layout-derivation.spec.ts`, `e2e/hel588-cross-filter-panels.spec.ts`) that seeds a throwaway user, a >200-row source/pipeline/Output, a chart panel with an annotation at w=2, h=4 on the lg breakpoint, and asserts `.chart-panel__canvas` bounding height >= 96 and both footnotes visible, in light and dark. Run it against pre-fix code first and capture the red (assertion with measured px) as evidence, then green. If seeding a >200-row chart in e2e proves infeasible, fall back to a recorded live Playwright measurement (pre-fix and post-fix numbers, both themes) persisted as evidence, and state why the e2e was not possible. Also measure the mobile stack (phone viewport) and record the number; per Non-Goals, only report it.

**D5 — Comment fix (item 2).** Rewrite the `truncationNote` prop doc to describe the shared two-line clamp and (after D2) the narrow short form.

**D6 — Robust style guard (item 3).** Strip CSS comments (`/\/\*[\s\S]*?\*\//g`) before matching, and match a standalone rule with the `m` flag where the selector list is exactly `.chart-panel__truncation-note` (selector start at string start, after `}` or after a newline; the compound `.chart-panel__annotation + .chart-panel__truncation-note` and the shared `.chart-panel__annotation,\n.chart-panel__truncation-note` list must NOT match). Prove red by running the guard against a fixture CSS string (in-test, not a committed CSS edit) containing `}\n/* note */\n.chart-panel__truncation-note { white-space: nowrap; }`, showing the OLD regex passes it (false green) and the NEW regex flags it. Keep the new short-form/sr-only rules compatible with the guard (they target spans, e.g. `.chart-panel__truncation-note-short`, not a standalone `.chart-panel__truncation-note {}` rule — or, if a container-query override of the shared clamp is needed, override the shared selector pair together).

**D7 — Live "matching rows" check (item 4).** On the running app, apply a viewer control filter (and, if reachable, a server cross-filter) to a truncated chart and screenshot the note reading "... matching rows." in light and dark. Persist screenshots with `scripts/concertino/persist-evidence.sh HEL-1398 <path>` (screenshots taken inside the worktree, never at the main checkout root). No code change.

## Risks / Trade-offs

- [Container query threshold mis-tuned] -> chosen from D1's measurement, covered by the e2e at w=2; widths >= w=3 keep the long form.
- [Span split breaks existing text-match tests across five surfaces] -> run the full frontend suite; any test edit must be explained (a fixture/test change to make tests pass is a defect symptom unless the DOM change is intentional and stated).
- [Shared dev DB residue] -> e2e/live checks use throwaway users; residue deleted only by exact id.
- [HEL-1392 regression] -> no change to data hooks; the full suite including HEL-1392's tests must stay green.
