## Context

Panel content components live in `frontend/src/components/PanelContent.tsx` and `PanelContent.css`. The grid container is configured in `PanelGrid.tsx` with `rowHeight: 52`, `margin: [18, 18]`, and default panel height of 5 rows, yielding a typical rendered height of ~314px (5 × 52 + 4 × 18 margins). The design token system is in `frontend/src/theme/theme.css` and defines a 4px spacing grid, a named type scale, and semantic color tokens.

The audit finds that sizing values in `PanelContent.css` are hard-coded rather than referencing theme tokens, and that sizing differs meaningfully across panel types without a documented rationale.

## Goals / Non-Goals

**Goals:**
- Document current padding, font sizes, and element dimensions for each panel type exactly as they exist in the codebase.
- Identify where content feels sparse or undersized relative to container dimensions.
- Produce a testable spec (`panel-content-sizing`) that follow-on implementation tickets can reference.

**Non-Goals:**
- Implementing any sizing changes.
- Defining new design tokens or changing token values.
- Changing grid row height, margin, or container padding.

## Decisions

**Audit scope includes PanelContent.css and PanelGrid.css only.** The chart panel (ECharts via `ChartPanel.tsx`) delegates sizing entirely to the ECharts `autoResize` flag with `height: 100%; width: 100%` — its sizing is container-driven, not spec-able at the CSS level.

**Sparseness threshold is documented as a ratio.** A panel whose content area (after removing header + footer + card padding) is less than 60% utilized at the default 5-row height is marked "sparse". This gives implementation tickets a concrete criterion.

**No token references in the audit.** The spec records raw px/rem values from the source, not token aliases. This makes it useful even before a token migration is complete.

## Risks / Trade-offs

**Static snapshot risk**: Sizing may drift after this spec is written. Mitigation: the spec is linked from the ticket and referenced in follow-on implementation issues, which forces updates.

**Chart panel is under-specified**: ECharts manages its own internal padding and font sizes. Mitigation: the spec notes this explicitly and marks chart as out-of-audit-scope for internal sizing.

## Planner Notes

- Self-approved: pure documentation change, no architecture or API impact.
- The `batch-update-api-endpoint` stale change will be removed in the same PR as requested.
