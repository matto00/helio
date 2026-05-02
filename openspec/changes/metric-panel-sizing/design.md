## Context

The metric panel currently renders `MetricContent` in `PanelContent.tsx` with two children:
`.panel-content__metric-value` and `.panel-content__metric-label`. HEL-159 added container query
breakpoints to PanelContent.css for the value font-size only. The label stays at a fixed `0.75rem`
regardless of panel height, and there is no trend indicator element.

`MappedPanelData` is `Record<string, string>` — a flat string map. The `value` and `label` slots
are already consumed by convention; `trend` will follow the same pattern.

## Goals / Non-Goals

**Goals:**
- Label font-size scales at the same compact/spacious breakpoints as the value
- Trend indicator (arrow + delta text) renders when `data.trend` is present and scales with container
- All changes are CSS-only (container queries) plus a thin JSX addition — no Redux, no API changes

**Non-Goals:**
- Parsing or computing trend direction from raw data — the `trend` string is rendered as-is
- Backend schema changes
- Changing any other panel type

## Decisions

**1. Trend indicator is purely presentational — direction inferred from the string prefix.**
The `trend` field is a pre-formatted string (e.g. `"+3.2%"`, `"-1.1%"`, `"0%"`). The CSS class
is set based on whether the string starts with `+`, `-`, or neither, giving color coding without
any computation in the component. Alternative: use separate `trendValue` and `trendDirection` fields —
rejected as premature; single string is consistent with how `value` and `label` are already consumed.

**2. Same compact/spacious breakpoints as value — no new breakpoint thresholds.**
`height < 180px` (compact) and `height >= 280px` (spacious) are already established by HEL-159.
Adding new breakpoints for label/trend would create an inconsistent system.

**3. Trend indicator lives inside `MetricContent` — not a separate component.**
The metric panel is a small, self-contained render. Extracting a `TrendIndicator` component adds
indirection without reuse benefit at this stage.

## Risks / Trade-offs

- [Risk] `MappedPanelData.trend` string format is undefined — any bound data source could
  provide arbitrary content. → Mitigation: render as-is; direction class fallback is "flat"
  (neutral color), so malformed strings degrade gracefully.

## Planner Notes

- No escalation required: change is frontend-only CSS + JSX, no API contract change, no new dependencies.
- Trend indicator is net-new UI within the existing metric panel; no existing tests need changing
  (PanelContent tests cover state branches, not metric internals).
