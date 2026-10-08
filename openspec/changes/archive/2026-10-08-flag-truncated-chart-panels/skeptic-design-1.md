## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD `0ebc784be678caa547bebe76c070a6834bad7e6b` (the change dir is untracked; no code changes yet).
Scope honoured: no objection is raised about the deferred load/summarise strategy or about the "vs" overlay for >200 rows.

### What I verified (with evidence)

Design claims checked against the live tree. Paths are under `frontend/src/features/panels/` unless stated otherwise.

- Authenticated page size is 200: `hooks/usePanelData.ts:159,186` (`pageSize: 200`). CONFIRMED.
- `PanelPaginationState.total` holds the filtered/unfiltered server count and defaults to 0: `types/panel.ts:451-468`. On `.pending` the slice carries the old `total`/`rows` forward (`state/panelsSlice.ts:304-311`), so a refresh never pairs a new count with old rows. CONFIRMED. With D1, a total of 0 before the first load means nothing renders (fails closed).
- `usePanelData.rowsTruncated = paginationEntry?.hasMore` (`hooks/usePanelData.ts:269`). The grid card, mobile stack and detail modal all read the same `paginationState[panel.id]` entry, so D5's "same source" is feasible with no new fetch. CONFIRMED.
- Public path: `hooks/usePublicPanelData.ts:110` fetches `(…, 0, 200, …)`, `:116` sets `total` from `result.total`, `:158` sets `rowsTruncated = rows === null || total > rows.length`. `dashboards/ui/PublicDashboardViewerPage.tsx:123-124` passes `totalRowCount`/`rowsTruncated`, plus `viewerFilterActive` (`:135`) and `crossFilterMode="none"`. `publicDashboardService.ts:35` already types `total`. No new public data is needed. CONFIRMED.
- Hosts missing `totalRowCount`: `PanelFullscreenOverlay.tsx:215-228` and `detailModal/PanelDetailModal.tsx:488-511` pass `rowsTruncated` but not `totalRowCount`. `PanelCardBody.tsx:272` passes `paginationEntry?.total`. `MobilePanelStack.tsx:65` renders `PanelCardBody`. CONFIRMED.
- Chart dispatch and the loaded count: `ui/PanelContent.tsx:261-281` (chart branch) and `:256` (`crossFilterLoadedRowCount = rawRows?.length`, before the cross-filter). CONFIRMED.
- Overlay gate: `history/chartOverlay.ts:87` (`ctx.rowsTruncated !== false` → null). CONFIRMED. D7 leaves it alone.
- Loaded-scope precedent: `ui/renderers/TableRenderer.css:37-42` (`--text-xs`, `--app-text-muted`, `margin:0`, nowrap). CONFIRMED, but it is not the nearest precedent (see CR1).
- `CrossFilterMode` is `"server" | "client-fallback" | "none"` (`hooks/useCrossFilterServerOps.ts:20`). The "matching" condition in D2 matches the overlay/metric `filterActive` convention already used at `PanelContent.tsx:277,320`. OK.
- Copy check ("Based on the first…" instead of "Showing…"): the reasoning holds. Aggregated Outputs group the loaded rows, and the client-fallback cross-filter plots a subset of them.
- AC coverage: AC1 → D1/D2 and tasks 1.1/1.2/2.2. AC2 → task 2.2. AC3 → D5/D6 and tasks 1.4/1.5/2.5. AC4 → D3/D4 and tasks 1.3/2.5. AC5 → D7 and task 2.3, plus the proposal's "Deferred" bullet. Every AC has a task, and there is no scope drift. No API or schema change, so no contract delta is missing.

### Findings that drive the verdict

1. **The design misses the chart's own footnote precedent and leaves the render site ambiguous.** `ChartRenderer` already renders a footnote under every chart, inside the chart's flex column (`ui/renderers/ChartRenderer.tsx:53-75`):
   - Markup: `<div class="panel-content panel-content--chart"><div class="chart-panel__canvas">…</div><p class="chart-panel__annotation" title=…>`.
   - Styles (`ui/PanelContent.css:164-196`): `.panel-content--chart` is `flex-direction: column`, the canvas is `flex: 1 1 auto; min-height: 0`, and `.chart-panel__annotation` is `flex: 0 0 auto`, `padding: var(--space-1) var(--space-3) var(--space-2)`, muted `--text-xs`, centered, with `title`.

   That is exactly the "below the chart, never collapses it, theme-aware" layout D3 describes, and it already works on every host. D3 says nothing about it. Instead, D3 lets the note render in `OutputPanelContent`'s chart branch or in `ChartOutputPanel` "wrapping `ChartRenderer`". Both places are outside the `.panel-content--chart` root, so the note becomes a sibling in whatever container each host provides:
   - Grid card: the panel body, flush.
   - Public viewer: `.public-dashboard-viewer__panel-row` has `gap: var(--space-3)` (`PublicDashboardViewerPage.css:19-27`).
   - Fullscreen: `.panel-fullscreen-overlay__body`, a flex column.

   So spacing would differ by host. Wrapping `ChartRenderer` in a new element would also break the `.panel-content { flex: 1 }` fill unless the wrapper reproduces it.

   The recipe D3 picks (the table's left-aligned, unpadded, nowrap `loaded-scope-note`) also clashes visually with the centered, padded annotation. A chart with both an annotation and a truncation note would show two muted footnotes in different alignments and insets. An experienced reviewer would reject that.

2. **D3 does not settle how the note sits next to the two other notes that can appear under the same chart.**
   - The annotation footnote (above).
   - The HEL-588 cross-filter disclosure, which `PanelContent.tsx:374-381` already renders for a cross-filtered, truncated chart ("N of M loaded rows match.").

   A client-fallback cross-filtered, truncated, annotated chart could stack three muted lines and squeeze the canvas. The design names neither the order nor whether that is acceptable, and the "small charts" risk only accounts for one line.

### Verdict: REFUTE

Category: design-judgment. Each fix is a small, specific edit to `design.md` (D3), `tasks.md` and the spec. The rest of the design is accurate and well grounded.

### Change Requests

1. **D3: fix one render site inside the chart's own flex column, next to the annotation.** Render the note inside `ChartRenderer`'s `.panel-content--chart` root, as a `flex: 0 0 auto` sibling after `.chart-panel__canvas`, and thread a prop through `ChartOutputPanel`. Remove the "OutputPanelContent's chart branch or ChartOutputPanel (wrapping ChartRenderer)" choice so there is exactly one site whose layout is the same on every host. Cite `ChartRenderer.tsx:53-75` and `PanelContent.css:164-196` as the precedent.
2. **D3: align the styling with `.chart-panel__annotation`, not the table's `loaded-scope-note`.** Use the same inset (`--space-1 --space-3 --space-2`, or a stated tokenised variant), the same alignment and `--font-sans` as the annotation, so two footnotes under one chart look like one family. Keep the single line and `title` for the full text. If you keep the table recipe on purpose, say why the mismatch with the annotation is acceptable. Do not leave it unstated.
3. **D3/Risks: state the order and coexistence for (a) the annotation footnote and (b) the HEL-588 cross-filter `LoadedScopeDisclosure` (`PanelContent.tsx:374-381`).** Say which line comes first, and whether three lines on a small panel is acceptable or one should absorb the other. Add a render test in task 2.2, and a screenshot in task 2.5 at the default grid size with an annotated, truncated chart.
4. **tasks.md 1.3:** name the stylesheet the rule goes in (`ui/PanelContent.css`, next to `.chart-panel__annotation`), so the new rule does not land in `TableRenderer.css`.

### Non-blocking notes

- `Intl.NumberFormat(undefined, …)` depends on the locale. Task 2.1 checks "1,234", which relies on Jest running in an en-US default locale. Consider pinning the locale in the test or asserting through the same formatter.
- D5 offers two options: threading the prop, or reading the selector inside the host. Either works, because the detail modal's own `usePanelData` writes the same `paginationState[panel.id]` entry. The simplest version is for `usePanelData` to return `total` next to `rowsTruncated`, which avoids a second selector.
- D1's "rowsTruncated === true AND loaded < total" is redundant in the authenticated path (`hasMore` is derived from the same counts), but it fails closed, so it is fine.
- The tasks.md "Standing Constraints" heading is empty. Either fill it or drop it.
