## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD `0ebc784be678caa547bebe76c070a6834bad7e6b`. The only untracked content is the change dir, so there are no code changes yet. Scope honoured: no objection is raised about the deferred load/summarise strategy or about the "vs" overlay for >200-row charts.

### Prior change requests (skeptic-design-1.md): are they addressed?

1. **CR1 (one render site inside the chart column): ADDRESSED.** D3 now names exactly one site: inside `ChartRenderer`'s `.panel-content--chart` root, after the canvas and the annotation, with a new `truncationNote` prop. The "wrapper or chart branch" choice is gone, and D3 explicitly forbids a wrapper.
   - Live tree: `ui/renderers/ChartRenderer.tsx:53-75` has exactly the markup D3 cites (canvas div, then a conditional `<p className="chart-panel__annotation" title=…>`).
   - `ui/ChartOutputPanel.tsx:111-119` already renders `ChartRenderer` with `annotation`, so passing one more prop through is trivial.
   - `ui/PanelContent.tsx:262-282` (chart branch) already has `totalRowCount`, `rowsTruncated`, `crossFilterLoadedRowCount` (`:256`, pre-filter `rawRows.length`), `viewerFilterActive` and `crossFilterMode` in scope, as D3 says.
2. **CR2 (match the annotation's styling): ADDRESSED.** D3 copies the declarations of `.chart-panel__annotation` (`ui/PanelContent.css:177-193`): `margin:0`, `flex:0 0 auto`, padding `--space-1 --space-3 --space-2`, `--app-text-muted`, `--font-sans`, `--text-xs`, `line-height:1.4`, centered. It swaps the 2-line clamp for a 1-line ellipsis and keeps the full text in the DOM and in `title`. The adjacent-sibling `padding-top: 0` rule joins the two lines into one footnote block. Every token named already exists in that file.
3. **CR3 (order and coexistence): ADDRESSED.**
   - D3a fixes the order: canvas → annotation → truncation note → the HEL-588 `LoadedScopeDisclosure`.
   - Live tree: the disclosure is rendered as a sibling after `{content}` at `PanelContent.tsx:374-381`, outside the chart column, so the stated order is what the DOM will produce.
   - D3a accepts the three-line worst case with a reason (each line states a different fact; the canvas keeps `flex:1 1 auto; min-height:0`).
   - It is pinned by task 2.2a (a DOM-order render test) and task 2.5 (a screenshot at the default grid size).
4. **CR4 (name the stylesheet): ADDRESSED.** Task 1.3 names `ui/PanelContent.css` next to `.chart-panel__annotation`.
5. **Non-blocking note (locale): ADOPTED.** Task 2.1 now requires a pinned locale, or an assertion made through `Intl.NumberFormat`.

### Fresh review: claims re-verified against the live tree

- **Hosts:**
  - `PanelCardBody.tsx:272` passes `totalRowCount={paginationEntry?.total}`.
  - `PanelFullscreenOverlay.tsx:215-232` and `detailModal/PanelDetailModal.tsx` (`:488-509`) pass `rowsTruncated` but no `totalRowCount`, so the D5 gap is real.
  - The detail modal's own `usePanelData` (`:213`) writes the same `paginationState[panel.id]` entry, so the "same source" in D5 holds.
- **Public path:**
  - `usePublicPanelData.ts:110` fetches one page of 200 rows and sets `total` from the response.
  - `rowsTruncated = rows === null || total > rows.length`.
  - `PublicDashboardViewerPage.tsx:123-124` already passes both.
  - The D1 condition `loaded < total` stops a "first 0 of N" note: when rows is null, `rawRows` is null and the panel is in a loading or error state, not the chart branch. No new public data is needed (AC3).
- **Fail-closed before load:**
  - Authenticated `rowsTruncated` is `paginationEntry?.hasMore ?? false` (`usePanelData.ts:269`), so it is false before load, and D1 requires `=== true`.
  - The spec scenario "total not yet known → no note" therefore holds.
- **Overlay:** the `history/chartOverlay.ts` gate is untouched (D7), and task 2.3 pins it (AC5). The proposal's "Deferred" bullet records the owner question.
- **AC coverage:**
  - AC1 → D1/D2, tasks 1.1/1.2/2.2.
  - AC2 → task 2.2.
  - AC3 → D5/D6, tasks 1.4/1.5/2.5.
  - AC4 → D3/D4, tasks 1.3/2.5.
  - AC5 → D7, task 2.3, proposal.
- **Scope and consistency:** there is no scope drift. There is no API or schema change, so no contract delta is missing. Proposal, design, tasks and spec do not contradict each other, and the spec's copy matches D2 exactly.
- **Placeholders:** none. The only open item is the D5 choice between threading a prop and reading the selector; both are sound, and a guessed count is forbidden.

### Verdict: CONFIRM

### Non-blocking notes

- The `title` attribute duplicates the visible text, and some screen readers may read it twice. This copies the existing annotation pattern, so it is acceptable. The executor may drop `title` once the text is no longer ellipsised, but that is not required.
- On narrow panels the "…of 1,234 matching rows." line will ellipsise. Task 2.5's screenshots should include one narrow or compact panel to confirm the truncated text still makes sense.
- The tasks.md "Standing Constraints" heading still says "(none yet)". This is harmless.
