## Context

The table panel (`panel-content--table`) currently uses the base `.panel-content` flex layout which centers
content vertically and does not force fill height. The `align-items: flex-start` override was added, but the
container still does not take up full available height and the `<table>` element itself has no overflow
control. When a table panel has many rows the rows push outside the panel card boundary. When it has few rows
there is dead space below.

The metric panel HEL-160 already established the reference pattern: content divs flex-grow to fill the card
content area while CSS container queries handle compact/spacious font adjustments. The table needs the same
fill treatment, plus a vertical scroll.

The existing `panel-container-queries` compact cell padding rule (`padding: 2px 6px; height: 14px` at
`max-height: 179px`) is already correct and requires no change.

## Goals / Non-Goals

**Goals:**
- Table fills available vertical space inside the panel card content area
- Table scrolls vertically when rows exceed the panel height
- No dead space between last row and panel card footer
- Implementation follows the same flex-fill pattern already present in `panel-content--metric`

**Non-Goals:**
- Horizontal scroll
- Sticky table headers
- Column width changes or font-size changes
- Any panel type other than table

## Decisions

**Decision: use `overflow-y: auto` on `.panel-content--table` directly, no wrapper div**

The base `.panel-content` class has `flex: 1; min-height: 0`, which means the table container already
participates in the panel card flex column. The only missing pieces are:
1. `align-items: stretch` (currently `center`) so the table fills the cross-axis
2. `justify-content: flex-start` (currently `center`) so rows anchor to the top
3. `overflow-y: auto` so the container scrolls
4. `flex-direction: column` so the `<table>` can stretch

No wrapper div is needed — the existing element just needs corrected flex properties. This is the least
invasive change and matches how `panel-content--text` anchors its content to the top with
`align-items: flex-start`.

The `<table>` itself gets `height: 100%` so it expands to fill its parent when rows are fewer than the
available space (preventing dead space below a short table), while `min-height: min-content` ensures it
never collapses when there are no rows.

Alternatives considered:
- Wrapper div (`panel-content__table-wrapper`): adds a DOM node with no functional advantage; rejected.
- `display: block; overflow-y: auto` on the table element itself: breaks table semantics and column sizing.

## Risks / Trade-offs

[Risk] `height: 100%` on the `<table>` causes the table to expand and push an empty tbody area when there
are zero data rows → Mitigation: the empty-state placeholder table still renders thead+tbody rows that fill
the space acceptably; if visual regression is reported, add a `min-content` fallback.

[Risk] Existing snapshot/render tests for `TableContent` may fail if they assert on the absence of scroll
styles → Mitigation: update assertions to match the new layout; this is not a behavioral regression.

## Planner Notes

Self-approved: purely a CSS layout fix to an existing component. No new dependencies, no API changes, no
architectural decisions. Scope is two files (`PanelContent.css`, `PanelContent.test.tsx`) plus a spec delta.
