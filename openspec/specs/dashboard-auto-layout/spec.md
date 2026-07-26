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

### Requirement: Auto-layout persists identically across all four responsive breakpoints

The endpoint SHALL persist the single packed placement to all four layout breakpoints (`lg`, `md`, `sm`,
`xs`) identically, matching the existing convention used by other bulk (non-interactive) layout writers.

#### Scenario: All breakpoints receive the same packed items
- **WHEN** an auto-layout request succeeds
- **THEN** the dashboard's stored `layout.lg`, `layout.md`, `layout.sm`, and `layout.xs` each contain the
  same packed `{panelId,x,y,w,h}` items

