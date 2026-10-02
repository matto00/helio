# dashboard-auto-layout Specification

## Purpose
Give agents and callers a server-side geometry helper that packs `{panelId, w, h}` sizes into
non-overlapping `{x,y,w,h}` grid positions, so building a dashboard no longer requires re-implementing
shelf-flow packing, ragged-edge fill, and per-kind size clamping client-side.

## Requirements

### Requirement: Auto-pack endpoint packs sizes into non-overlapping positions

`POST /api/dashboards/:id/auto-layout` SHALL accept a JSON body `{ items: [{panelId, w, h}], cols? }`
(`cols` optional, default 12) and pack the given items left-to-right into shelves that wrap when a row
would exceed `cols`, preserving input order as visual order, producing zero pairwise-overlapping
`{panelId,x,y,w,h}` rectangles.

#### Scenario: Panels wrap to a new shelf when a row is full
- **WHEN** a caller POSTs `items` whose cumulative widths exceed `cols` within the first several items
- **THEN** the response places the overflowing item at `x=0` on a new row below the tallest item in the
  previous shelf, and no two returned items overlap

#### Scenario: Input order is preserved as visual order
- **WHEN** a caller POSTs three items in a given order
- **THEN** the packed items appear left-to-right, top-to-bottom in that same order, and repeating the
  same request produces byte-identical `x,y,w,h` values every time

### Requirement: Ragged shelf edges are widened to close the gap

A shelf whose total item width is below `cols` but at or above a fill threshold SHALL have its items'
widths widened proportionally (preserving relative sizing) so the shelf's total width equals `cols`; a
shelf below the fill threshold SHALL be left unmodified.

#### Scenario: A nearly-full shelf is widened flush
- **WHEN** a shelf's items sum to 10 of 12 columns
- **THEN** each item's width is scaled up proportionally so the shelf's items sum to exactly 12 columns

#### Scenario: A sparse shelf is left alone
- **WHEN** a shelf contains a single item using 3 of 12 columns
- **THEN** that item's width is not changed

### Requirement: Per-kind size clamping corrects out-of-bounds sizes

Each item's `w`/`h` SHALL be clamped to its panel kind's configured minimum width, minimum height, and
maximum height (looked up server-side from the panel's actual kind, never trusted from the request body)
before packing; a kind with no configured bounds SHALL use a default floor/ceiling.

#### Scenario: An undersized chart is corrected
- **WHEN** a chart panel is submitted with `h` below the chart kind's minimum height
- **THEN** the packed item's `h` is raised to the chart kind's minimum height

#### Scenario: An oversized metric is corrected
- **WHEN** a metric panel is submitted with `h` above the metric kind's maximum height
- **THEN** the packed item's `h` is lowered to the metric kind's maximum height

### Requirement: Omitted and unknown panels are handled explicitly

Panels belonging to the dashboard but absent from the request body SHALL retain their current saved
`{x,y,w,h}` position unchanged. A `panelId` present in the request body but not belonging to the target
dashboard SHALL cause the entire request to be rejected with `400 Bad Request` and no persistence.

#### Scenario: An omitted panel keeps its position
- **WHEN** a dashboard has a panel not included in the auto-layout request's `items`
- **THEN** that panel's stored layout position is unchanged after the request completes

#### Scenario: An unknown panel id is rejected
- **WHEN** the request `items` includes a `panelId` that does not belong to the target dashboard
- **THEN** the endpoint returns `400 Bad Request` and the dashboard's stored layout is unchanged

### Requirement: Auto-layout packs each breakpoint at its own column count

The endpoint SHALL accept an optional `breakpoint` (`lg|md|sm|xs`). When omitted, it SHALL pack every breakpoint independently at that breakpoint's own column count (`lg` at `cols`, default 12; request `w` is expressed in `cols` units and scaled to each other breakpoint, then clamped to `[1, breakpoint cols]`) and persist all four. When given, it SHALL pack only that breakpoint (request `w` in that breakpoint's units; `cols`, if supplied, must equal the breakpoint's column count else `400`) and leave the other breakpoints untouched. No packed item SHALL exceed its breakpoint's column count, per-kind minimum widths notwithstanding. Panels omitted from the request SHALL keep their stored position in each packed breakpoint and packed items SHALL be placed below them, never overlapping them. The result is subject to the layout-validation rules (`400`, nothing saved, if a packed breakpoint is invalid, e.g. omitted stored panels already overlap).

#### Scenario: xs never overflows
- **WHEN** an auto-layout request packs three Output panels of width 4 with no `breakpoint`
- **THEN** every stored `xs` item has `x + w <= 2` and no two `xs` items overlap

#### Scenario: Single breakpoint leaves the others alone
- **WHEN** a request with `breakpoint: "xs"` succeeds
- **THEN** `lg`, `md`, `sm` are byte-identical to before

#### Scenario: Packed items do not overlap kept panels
- **WHEN** a dashboard has an omitted panel at the top of `lg` and a request packs two others
- **THEN** the packed items sit below the kept panel in every packed breakpoint
