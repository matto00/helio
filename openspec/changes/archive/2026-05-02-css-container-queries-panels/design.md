## Context

Panel content layout is defined in `PanelContent.css` with fixed padding and font sizes (`2rem` for metric value,
`0.78rem` for table cells, `0.9rem` for text). The panel card wrapper (`.panel-grid-card` in `PanelGrid.css`) uses
`clamp()` for padding and title font-size, but the inner content area does not react to the panel's own size as it
changes from grid drag/resize. All modern browsers (Chrome 105+, Firefox 110+, Safari 16+) support CSS Container
Queries natively with no polyfill required.

## Goals / Non-Goals

**Goals:**
- Establish `container-type: size` on `.panel-grid-card` so all descendant `@container` rules can fire on panel resize.
- Add `@container` breakpoint rules for metric, table, and text panel types covering small/medium/large size buckets.
- Keep purely CSS — no JS `ResizeObserver` hook or additional React state.
- No layout shift; changes should be additive on top of the HEL-158 baseline values.

**Non-Goals:**
- Content density improvements (enlarging metric value, increasing table row height) — separate follow-on tickets.
- ECharts / chart panels — already fill 100% via `style={{ height:"100%", width:"100%" }}` and `autoResize: true`.
- Browser polyfilling for container queries.

## Decisions

### Decision: Place container context on `.panel-grid-card`, not `.panel-content`

The content area (`panel-content`) already uses `flex: 1` and `min-height: 0` which removes intrinsic sizing.
A container element must have a definite size for `container-type: size` to work; `.panel-grid-card` has `height: 100%`
filling the full grid cell and `overflow: hidden`, making it the correct anchor. Placing the container on `.panel-content`
would work for width but not always for height in a flex child with `flex: 1`.

**Alternative considered**: Wrapping only `panel-content` with a container div — rejected to avoid extra DOM nodes.

### Decision: Three size buckets via `@container` width and height queries

Use three named breakpoints:
- **compact**: `width < 220px` or `height < 180px` — minimal padding, smaller type
- **default**: normal (no override, uses HEL-158 baseline)
- **spacious**: `width >= 420px` and `height >= 280px` — slightly increased type for readability

This maps to the typical grid breakpoints without hard-coupling to `rowHeight`/`margin` values.

**Alternative considered**: Using only width queries — rejected because a panel can be wide but very short (1-2 rows)
and needs different treatment.

### Decision: Named container (`panel-card`) for scoped queries

Use `container-name: panel-card` alongside `container-type: size` so queries reference the named container
explicitly. This prevents accidental matches if nested container elements are introduced later.

### Decision: Modify `PanelGrid.css` and `PanelContent.css` directly — no new CSS file

Both files are already scoped to panel structure. Adding `@container` blocks at the end of each file keeps
the context collocated with the base rules they override.

## Risks / Trade-offs

- `container-type: size` establishes a new stacking/formatting context which suppresses the `overflow` scroll
  ancestor search for any scrollable descendants. Current panel content types (metric, text, table, chart) are
  all non-scrolling, so this is benign for now. [Risk] Future scrollable panel types may need `container-type: inline-size`
  instead → Mitigation: document the constraint in code comments.
- `clamp()` on `.panel-grid-card` padding already uses `2vw`, which is viewport-relative. Container queries operate
  on the container, not the viewport, so `@container` rules that set padding will shadow the `clamp()` value in
  compact/spacious states. → Mitigation: explicitly set padding in those states to known pixel values rather than
  re-using `clamp()`.

## Migration Plan

1. Add `container-type: size; container-name: panel-card;` to `.panel-grid-card` in `PanelGrid.css`.
2. Append `@container panel-card` blocks to `PanelGrid.css` for card-level overrides (padding, gap, title font-size).
3. Append `@container panel-card` blocks to `PanelContent.css` for content-type overrides (metric font, table cell padding).
4. Run `npm run build` to confirm no CSS errors; run `npm test` to confirm no regressions.
5. No backend changes, no migrations, no feature flags required.

## Planner Notes

Self-approved: Pure CSS infrastructure change — no new external dependencies, no API changes, no architectural
risk. Scope is contained to two existing CSS files. The `panel-content-sizing` spec (HEL-158) provides the baseline
values this change extends; the new `panel-container-queries` spec documents the `@container` rules.
