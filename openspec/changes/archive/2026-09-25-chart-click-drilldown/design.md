## Context

`ChartPanel.tsx` builds its ECharts `option` via `buildDataOption(rawRows, headers,
fieldMapping, chartType, scatterOptions)` — bar/line single-series (categories from
`xCol`, values from `yCol`), bar/line multi-series (grouped by `seriesCol`), pie
(`{name,value}[]` from mapped-y or auto-detected numeric column), and scatter
(coordinate pairs, optionally grouped into one series per `colorField` value). It
renders via `echarts-for-react/esm/core`'s `<ReactECharts>`, which is not currently
passed an `onEvents` prop anywhere in the codebase (confirmed: zero `onEvents` hits
repo-wide).

`usePanelData` (single call site: `PanelCard.tsx`) always returns `chartAggregate:
null` for a dashboard panel post-HEL-909 — a chart panel always renders from
`rawRows`, so "the inspect view shows exactly the plotted rows" is achievable
without a server round-trip. `rowsTruncated` (`paginationEntry.hasMore`) is the
existing truncation signal to surface honestly when true.

Both `PanelCard`'s in-grid render and `PanelFullscreenOverlay` (HEL-584) mount
`ChartPanel` via the shared `PanelContent`/`ChartRenderer`, fed from the same
single `usePanelData(panel)` result — no second data-fetch path to reconcile.

`DesktopPanelGrid.tsx`'s `handleCardClick` already opens `PanelDetailModal` (view
mode) for any click on the panel body that isn't a drag/resize and doesn't land on
`button, input, a, .react-resizable-handle` (see `panel-body-click` spec). A chart
element is none of those — an unmodified click on a bar/point/slice today falls
through to that handler and opens Customize. This ticket must intercept it first.

`Modal` (`shared/ui/Modal.tsx`) wraps the native `<dialog>` + `showModal()`;
Escape is handled per-dialog via the native `cancel` event (not a global keydown
listener), so nesting a second native dialog inside an already-open one (Inspect
opened while Fullscreen is open) gets correct Escape-closes-the-topmost-dialog
behavior for free from the browser — no bespoke stacking logic needed.

No existing panel-interaction/selection state exists (confirmed, see
premise-validation.md).

## Goals / Non-Goals

**Goals:**
- Click→selection→inspect for every chart type `buildDataOption` supports.
- A selection descriptor shaped for HEL-588 to consume directly, without this
  ticket needing to guess its future dashboard-level cross-filter shape.
- Inspect works identically from the grid card and the fullscreen overlay.

**Non-Goals:**
- Cross-panel propagation (HEL-588).
- Any server-aggregate / HEL-1027 filtering path — this ticket only ever
  operates on already-loaded `rawRows`.
- Persisting the selection (view state only, per the ticket).

## Decisions

**D1 — Selection state lives in `panelsSlice`, keyed by `panelId`.** Add
`interactionState: Record<string, SelectionDescriptor | null>` alongside the
existing `paginationState` map (same per-panel-keyed shape). Two reducers,
`selectDataPoint({panelId, dimension, value, series})` and
`clearSelection(panelId)`. Cleared in `extraReducers`: `delete
state.interactionState[panelId]` on `deletePanel.fulfilled`, and
`state.interactionState = {}` on `fetchPanels.pending` (the existing
dashboard-switch signal `loadedDashboardId` is reset off of). These are two
NEW clear points this change originates — `paginationState` is not currently
cleared on either trigger today (verified: neither `deletePanel.fulfilled`
nor `fetchPanels.pending` touches it, and `resetPanelPagination` is dead code
with zero dispatch call sites), so this is not "reusing an established
mechanism," just the same per-panel-map SHAPE. Never written to
`localStorage`/persisted panel fields — Redux-only, satisfying "view state,
cleared on panel/dashboard switch." A panel's selection is untouched by any
OTHER panel's inspect view opening or closing — HEL-588 needs to read
`interactionState` across panels while any number of inspect views are open
or closed, so nothing here clears one panel's entry as a side effect of
interacting with a different panel.
Alternative considered: component-local `useState` in `PanelCard`. Rejected —
HEL-588 needs to read a panel's selection from outside that panel's own
subtree (dashboard-level cross-filter), so it must be lifted to Redux now
rather than re-plumbed later.

**`SelectionDescriptor` field semantics (skeptic design-gate round 1, CR1):**
`dimension` is the SOURCE COLUMN NAME the selection is keyed on (the mapped
x/label column, e.g. `"quarter"` — `headers[xCol]`, resolved the same way
`buildDataOption` resolves it). `value` is the CLICKED CATEGORY/LABEL
(stringified), e.g. `"Q1"` — this is what earlier drafts of this design
mistakenly called `dimension`. `series` identifies which measure/group the
click landed on: for a single-series bar/line/pie it is the y-column's
header name (there is exactly one); for a grouped bar/line or color-grouped
scatter it is the clicked group's value (`params.seriesName` / the matched
`colorField` value). This mirrors how HEL-588 will need to read it: "filter
sibling panels' rows where column `dimension` equals `value`," with `series`
as the (advisory, not filtered-on) measure/group label shown in the inspect
header.

**D2 — Click wiring lives in `ChartPanel.tsx`, and stops propagation to the
card-click handler.** Pass `onEvents={{click: handleClick}}` to
`<ReactECharts>`. Inside the handler: bail out (return, do nothing) unless
`params.componentType === "series"` — so clicks on the legend or empty grid
area still fall through to the existing panel-body-click "open Customize"
behavior, unchanged. For a genuine series-element click, call
`params.event?.event?.stopPropagation()` on the underlying native DOM event
before doing anything else, so the click never reaches
`DesktopPanelGrid.handleCardClick`'s `article onClick` — this is what
satisfies the modified `panel-body-click` requirement without touching
`DesktopPanelGrid.tsx` at all (the interception happens entirely inside
`ChartPanel`, which owns the canvas the native event is dispatched on).
`ChartPanel` gains an optional `onDataPointSelect` callback prop; the click
handler resolves the clicked element to a `{dimension, series}` pair (D3) and
invokes it — `ChartPanel` itself stays free of Redux, consistent with its
existing presentational-component shape (appearance-only currently).

**D3 — One click→column mapping function per chart type, mirroring
`buildDataOption`'s own branching exactly.** New pure function
`mapChartClickToSelection(params, chartType, fieldMapping, headers)`
alongside `buildDataOption` in `ChartPanel.tsx` (see the field semantics
above for what `dimension`/`value`/`series` each mean):
- bar/line, single series: `dimension = fieldMapping.xAxis` (the mapped
  column name, `headers[xCol]`), `value = params.name` (the clicked
  x-category), `series = fieldMapping.yAxis`/`headers[yCol]` (there is
  exactly one).
- bar/line, multi-series (`seriesCol` mapped): `dimension = headers[xCol]`,
  `value = params.name`, `series = params.seriesName` (ECharts already
  disambiguates which series a multi-series click landed on — its click
  params carry `seriesName` regardless of shared-x axis-trigger tooltip
  mode).
- pie: `dimension = headers[xCol]` (the label column), `value = params.name`
  (the slice's `name`), `series = headers[yCol]` — the y-column name used to
  build the slice, resolved via the SAME mapped-or-auto-detected logic
  `buildDataOption`'s pie branch already performs (shared helper, D4).
- scatter: `dimension = headers[xCol]`, `value = String(params.value[0])`
  (the clicked point's x value, as ECharts reports it back — stringified for
  the descriptor), `series` = the clicked point's group (`colorField` value)
  when grouped, else `headers[yCol]`. Scatter has no natural "category" the
  way bar/line/pie do, so this selects by x-value equality like the others
  rather than by a precise single-point row identity — when multiple points
  share an x value they are all included in the inspect view together, the
  same granularity bar/line/pie already have. (An earlier draft of this
  design matched scatter clicks by exact row identity across x/y/size
  instead; dropped in favor of this simpler, uniform x-value-equality
  approach — see skeptic design-gate round 1, CR1, and the Risk this removes
  below.)
- Any chart type/shape not covered above (none currently exist beyond these
  four) does not wire a click handler at all, per the spec's "excluded
  rather than mapped dishonestly."

**D4 — Row filtering for the inspect view reuses the resolved
`fieldMapping` columns, not a second re-derivation.** Given a selection
`{dimension, value, series}`, filter `rawRows` by `row[xCol] === value &&
(seriesCol === -1 || row[seriesCol] === series)` for bar/line/pie, using the
exact same `xCol`/`seriesCol` index resolution `buildDataOption` already
computes — extract that index resolution into a small shared helper both
functions call, so the click mapping and the row filter can never disagree
about which column is "the" x/series column. For scatter, filter by
`parseFloat(row[xCol]) === parseFloat(value)` (numeric comparison, since
`value` was stringified from a parsed float and a raw string equality check
could mismatch on formatting, e.g. `"3"` vs `"3.0"`), further narrowed by
`row[colorCol] === series` when the scatter was color-grouped. `dimension` is
carried on the descriptor for HEL-588's benefit (which column this selection
is about) but is not itself part of the row-filter predicate — matching
happens on `value`/`series` against the columns `dimension`/`fieldMapping`
already identify.

**D5 — Inspect is its own `Modal`, not `PanelDetailModal`.** `PanelDetailModal`
owns panel customization (appearance/data config) semantics; overloading it
for row-inspection would conflate two different actions users take from the
same trigger surface and would fight the "opens Customize on plain body
click, opens Inspect on chart-element click" split this ticket introduces.
New `PanelInspectView` component: wraps `Modal` directly (same primitive
`PanelFullscreenOverlay`/`PanelDetailModal` already use), renders a header
("Showing rows for {dimension}: {value}{series ? ` / ${series}` : ""}", e.g.
"Showing rows for quarter: Q1 / Revenue", plus a truncation notice when
`rowsTruncated`), a `DataGrid` (`variant="preview"`
inside the grid card context, `variant="full"` inside fullscreen — matching
the space available, per ticket §6) over the filtered rows, and a
clear/return control that calls `onClose` (which both closes the view and
dispatches `clearSelection`). Mounted from `PanelCard` (grid) and
`PanelFullscreenOverlay` (HEL-584) independently — each owns its own "is the
inspect view open" local boolean (parallel to `PanelCard`'s existing
`isFullscreenOpen` local state), while the *selection itself* stays the
single Redux-owned source of truth both read. Opening the view is triggered
either by a chart click (`onDataPointSelect` → `dispatch(selectDataPoint)` +
`setIsInspectOpen(true)`) or by the `ActionsMenu` "Inspect" entry
(`setIsInspectOpen(true)` alone, reading whatever selection currently exists
for that panel — an empty state when none).

**D6 — Cursor affordance is CSS on the ECharts series, not a DOM/appearance
conditional.** `buildDataOption`'s returned `series` entries get a bare
`cursor: "pointer"` merged in for every clickable chart type, inside the
SAME function that already returns those series (never merged onto the
`appearance`-derived half of the option) — so it applies unconditionally,
independent of whether `appearance?.chart` is set (closing the HEL-1178
hazard flagged in the ticket/premise-validation).

**D7 — `ActionsMenu` gets a new "Inspect" item, not a new header icon.**
`PanelCard`'s header already hosts Refresh (HEL-579) and Fullscreen (HEL-584)
icon buttons; a third always-visible icon crowds it further for a per-panel
action that (until a selection exists) has nothing to show. `ActionsMenu`
already has header-icon precedent for infrequent/contextual actions
(Rename/Customize/Duplicate/Delete) — Inspect joins that list.

## Risks / Trade-offs

- [Risk] ECharts' click `params` shape/field names differ subtly across
  ECharts versions for grouped/stacked series → Mitigation: unit-test
  `mapChartClickToSelection` directly against constructed `params` objects
  for each of the four branches, not just through a full chart render.
- [Risk] `stopPropagation` on the native event inside an ECharts `onEvents`
  callback is a less-obvious code path than a React `onClick` handler →
  Mitigation: a code comment at the call site cross-referencing this
  decision and the `panel-body-click` spec delta; an evaluator/skeptic UI
  check that a plain (non-element) click on a chart panel still opens
  Customize, proving the bail-out branch works, not just the intercept.
- [Trade-off] Scatter selects by x-value equality (D3/D4), so multiple
  points sharing the same x value are inspected together rather than
  individually. Accepted: scatter has no natural category dimension to key
  on instead, and this is the same granularity bar/line/pie already provide
  (a category, not a single row) — not a regression relative to them.

## Planner Notes

- Reused `panelsSlice`'s existing per-panel-map SHAPE (`paginationState`) for
  `interactionState` rather than a new slice, so both live in the same
  reducer/state tree a panel-scoped consumer already reads from. This is
  originating new clear-on-delete/clear-on-dashboard-switch behavior, not
  reusing an existing one — `paginationState` itself is not currently
  cleared on either trigger (verified against the live `panelsSlice.ts`;
  corrected here per skeptic design-gate round 1's non-blocking note, which
  is accurate — a first draft of this note incorrectly claimed an existing
  "well-tested" pagination-clearing mechanism was being mirrored).
- Decided inspect-view-open is per-surface local state (not Redux) since
  HEL-588 only needs the *selection*, never "is a modal currently open" —
  keeping that out of Redux avoids growing the shared state surface with
  something no consumer besides this ticket's own two mount points needs.
