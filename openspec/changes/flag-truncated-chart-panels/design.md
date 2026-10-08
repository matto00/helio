## Context

See proposal.md (Why). Ground truth in the tree at `0ebc784be` (post HEL-1365 PanelCard split):

- Authenticated chart data pages at `pageSize: 200` (`features/panels/hooks/usePanelData.ts:159,186`). The Redux
  `PanelPaginationState` (`types/panel.ts:453-467`) carries `rows`, `hasMore` and `total` (the Output-wide count from
  the rows endpoint; the FILTERED total when a viewer control or server cross-filter applied, per HEL-1027/HEL-1191).
- Public chart data is one 200-row page (`hooks/usePublicPanelData.ts:110`); it already exposes `total` and
  `rowsTruncated` (`total > rows.length`), and `PublicDashboardViewerPage.tsx:123` passes `totalRowCount`. The public
  rows endpoint already returns `total`, so the count is already public.
- `PanelContent` → `OutputPanelContent` dispatches `kind === "chart"` to `ChartOutputPanel`
  (`ui/PanelContent.tsx:262-282`). `OutputPanelContent` already receives `totalRowCount` and `rowsTruncated`, and
  computes `crossFilterLoadedRowCount = rawRows?.length` (pre-cross-filter loaded count).
- Callers: `PanelCardBody` passes `totalRowCount={paginationEntry?.total}` (grid card and `MobilePanelStack`, which
  reuses `PanelCardBody`); `PublicDashboardViewerPage` passes `panelData.total`; `PanelFullscreenOverlay` and
  `PanelDetailModal` pass `rowsTruncated` but NOT `totalRowCount`.
- Existing disclosure precedent: `LoadedScopeDisclosure` / `.panel-content__loaded-scope-note`
  (`renderers/TableRenderer.css:37`: `font-size: var(--text-xs)`, `color: var(--app-text-muted)`, one line) — "N of M
  loaded rows match." The overlay gate is `history/chartOverlay.ts:87` (`rowsTruncated !== false` → no overlay).

## Goals / Non-Goals

**Goals:** a visible, honest, theme-correct note on every truncated chart surface, using counts already on the client.

**Non-Goals:** any loading/summarising strategy, overlay coverage for >200 rows, a chart "Load more", backend changes.

## Decisions

**D1 — Show condition.** Render the note iff `rowsTruncated === true` AND `totalRowCount` is a finite number AND
`loadedCount < totalRowCount`, where `loadedCount` is the PRE-cross-filter loaded row count (`rawRows.length` before
the client-fallback cross-filter narrows it — i.e. the existing `crossFilterLoadedRowCount`). Requiring both signals
fails closed: before the first load (`rowsTruncated` undefined/total unknown) nothing renders, never a wrong number.
Alternative rejected: deriving from `hasMore` alone — gives no denominator, and the ticket asks for the count.

**D2 — Copy.** "Based on the first {loaded} of {total} rows." — "Based on" rather than the driver's example "Showing"
because an aggregated Output groups the loaded rows (the chart shows N bars, not 200 rows) and a client-fallback
cross-filter plots a subset of the loaded rows; "based on" is true in every case, "showing" is not. When the total was
narrowed server-side (`viewerFilterActive || crossFilterMode === "server"`), append "matching": "Based on the first
200 of 640 matching rows." Counts formatted with `Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })` (same
shape `MetricRenderer` uses). Copy is built by one pure exported helper (e.g. `chartTruncationNoteText`) so the
wording is unit-tested in one place. Tone/format mirrors the existing "N of M loaded rows match." precedent, so this is
a self-approved DESIGN.md-pattern decision, not a new product call.

**D3 — Placement and markup (revised after skeptic-design-1 CR1/CR2).** ONE render site, inside `ChartRenderer`'s own
`.panel-content--chart` flex column (`renderers/ChartRenderer.tsx:53-75`), after the canvas and after the existing
HEL-318 annotation footnote (`.chart-panel__annotation`, `ui/PanelContent.css:164-196`). `ChartRenderer` gains an
optional `truncationNote?: string | null` prop; `ChartOutputPanel` passes it through; `OutputPanelContent`'s chart
branch computes it (D1/D2) because that is where `totalRowCount`, `rowsTruncated`, the pre-cross-filter loaded count
and the filter state already meet. No wrapper around `ChartRenderer` (it would break the canvas height fill and make
spacing host-dependent). Markup: `<p className="chart-panel__truncation-note" title={text}>{text}</p>`.
Styling matches the annotation it sits beside, so the chart has one consistent footnote style: same `margin: 0`,
`flex: 0 0 auto`, `padding: var(--space-1) var(--space-3) var(--space-2)`, `color: var(--app-text-muted)`,
`font-family: var(--font-sans)`, `font-size: var(--text-xs)`, `line-height: 1.4`, `text-align: center`; via the SAME shared rule (a combined selector with `.chart-panel__annotation`), so it gets the
annotation's 2-line clamp (revised after skeptic-final-1 CR1: a one-line ellipsis hid the total at the grid's minimum
width), with the full sentence in the DOM and in
`title`. When it follows an annotation, `.chart-panel__annotation + .chart-panel__truncation-note { padding-top: 0 }`
so the two read as one footnote block. Rule lives in `ui/PanelContent.css` next to `.chart-panel__annotation`. Only
existing tokens; light/dark legibility comes from `--app-text-muted`, verified by screenshot in both themes.

**D3a — Coexistence (skeptic-design-1 CR3).** Vertical order is fixed: canvas → annotation (≤2 lines, existing) →
truncation note (1 line, 2 at the narrowest widths per D3) → the existing HEL-588 cross-filter "N of M loaded rows match." disclosure
(`PanelContent.tsx:374-381`, rendered outside the chart column, unchanged). All three can appear together only when a
chart has an annotation, is truncated, AND is client-fallback cross-filtered; they state different facts (author
caption / loaded scope vs Output total / cross-filter matches within the loaded rows) so neither is suppressed. This
is accepted: worst case adds one `--text-xs` line to today's two existing footnotes, and the canvas keeps
`flex: 1 1 auto; min-height: 0`. Pinned by a render test (all three present, in this DOM order) and a screenshot at
the default grid panel size.

**D4 — Not a live region.** Plain text, no `role="status"`/`aria-live`: the note changes on every refresh/poll and an
announcement each time would be noise. It is static descriptive text adjacent to the chart, read in reading order.

**D5 — Thread the total to fullscreen and the detail modal.** `PanelFullscreenOverlay` and `PanelDetailModal` gain
`totalRowCount` from the SAME source the grid card uses (the panel's `PanelPaginationState.total` — `PanelCardBody`'s
`paginationEntry?.total`), passed to their `PanelContent`. No new fetch. If threading proves awkward for one host, it
MAY read the entry via the existing Redux selector; it MUST NOT fall back to a guessed count.

**D6 — Public path.** No change beyond what D1/D3 render: `PublicDashboardViewerPage` already supplies `total` and
`rowsTruncated`. No backend file is touched (contended HEL-1253/HEL-1187 services are untouched).

**D7 — Overlay unchanged.** `selectChartOverlay`'s gate and `ChartCompareField`'s hint text are not modified. A test
pins that a truncated chart with `config.compare` shows the note AND no overlay.

## Risks / Trade-offs

- [The note steals vertical space from small charts] → one `--text-xs` line (two at w=2, never clipped), `flex: 0 0 auto`; verified at the default
  grid panel size and in compact mode.
- [Total is the filtered total under a filter] → D2's "matching" wording keeps it true.
- [Rows paged past 200 elsewhere (a table's Load more on the same panel's entry)] → D1 compares the actual loaded count,
  not a hardcoded 200, so the numbers stay right if more rows are loaded.

## Planner Notes

- Self-approved: copy (D2) and placement (D3) follow the existing loaded-scope disclosure pattern; no escalation.
- Owner product question (not decided here; carried to the delivery report): how should large charts load or
  summarise data — load all rows up to a cap, server-side downsample/aggregate for charts, plot the stored summary
  series with its caveats, or other — and should the "vs" overlay then cover >200-row charts.
