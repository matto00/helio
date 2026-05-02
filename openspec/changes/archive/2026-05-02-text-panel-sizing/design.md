## Context

The text panel renders `TextContent` in `PanelContent.tsx` with `.panel-content__text-live` at a
fixed `font-size: 0.9rem`. The metric panel (HEL-160) already uses CSS container queries to scale
its value font-size at compact (`height < 180px` → `1.25rem`) and spacious (`height >= 280px` →
`2.5rem`) breakpoints. The compact text panel breakpoint (`0.78rem`) was added with HEL-159 in
`PanelContent.css`. The spacious breakpoint is missing.

The panel card already establishes a `container-type: size; container-name: panel-card` context
(via `panel-container-queries` spec), so no structural changes are needed — only an additional
`@container panel-card` rule in `PanelContent.css`.

Additionally, `.panel-content--text` currently has no overflow handling. When font-size increases
at the spacious breakpoint, long text strings can overflow the card boundary. Adding
`overflow-y: auto` confines content within the panel.

## Goals / Non-Goals

**Goals:**
- Text live content font-size scales up at spacious panel height (>= 280px)
- Text content does not overflow the panel boundary at any font size
- Tests cover the spacious rendering class

**Non-Goals:**
- Dynamic viewport-unit or `clamp()` scaling that fills all available height
- Changes to placeholder skeleton lines
- Changes to metric, table, or chart panels

## Decisions

**1. Reuse the same height breakpoints as the metric panel (compact < 180px, spacious >= 280px).**
The breakpoints are already established by the `panel-container-queries` spec. Introducing new
thresholds would create an inconsistent system.

**2. Spacious font-size: 1.1rem (from `0.9rem` base).**
This is a modest increase that improves content density without aggressively enlarging text in a
panel users are likely viewing as a summary. `panel-content-sizing` spec describes the goal as
"fill the panel with appropriate padding" — incremental scaling meets this intent without the
visual disruption of a larger jump.

**3. `overflow-y: auto` on `.panel-content--text` instead of `overflow: hidden`.**
`auto` preserves scroll access to long content at large font sizes. `hidden` would silently clip
content the user cannot reach.

## Risks / Trade-offs

- [Risk] `overflow-y: auto` may introduce a scrollbar at certain content lengths at the spacious
  breakpoint. → Acceptable: the scrollbar signals content overflow, which is correct feedback.

## Planner Notes

- No escalation required: change is pure CSS + tests, no API changes, no new dependencies.
- The spacious breakpoint text-size value (`1.1rem`) is self-approved; it follows the same
  proportional step used for the metric label (`0.75rem` → `0.85rem`) scaled from the larger base.
