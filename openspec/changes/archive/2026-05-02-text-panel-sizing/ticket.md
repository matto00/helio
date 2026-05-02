# HEL-162: Apply sizing system to text panel

## Title
Apply sizing system to text panel

## Description
Apply the sizing system to the text panel type. Text content should fill the panel with appropriate padding; font size may scale with container size.

## Acceptance Criteria
- Text content fills the panel area with appropriate padding
- Font size may scale with container/panel size
- The text panel uses the same sizing system applied to other panel types (e.g. metric panel)
- No layout regressions in other panel types

## Context
- Parent issue: HEL-136
- Project: Helio v1.1 — UX Foundations
- Priority: Medium

## Related Work
- HEL-160: metric-panel-sizing (recently merged) — the sizing system was applied to the metric panel; the text panel should follow the same pattern.
- The sizing system likely involves CSS container queries (HEL-154: css-container-queries-panels was archived).
