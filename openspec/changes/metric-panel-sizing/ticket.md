# HEL-160: Apply sizing system to metric panel

## Title
Apply sizing system to metric panel

## Description
Apply the sizing system to the metric panel type. Value, label, and trend indicator should scale proportionally with the panel container.

## Acceptance Criteria
(Derived from ticket description and project context)

- The metric panel's value (primary numeric display) scales proportionally with the panel container size
- The metric panel's label (title/subtitle text) scales proportionally with the panel container size
- The metric panel's trend indicator (if present) scales proportionally with the panel container size
- Scaling uses the CSS container query sizing system established in HEL-159 (css-container-queries-panels)
- No layout breakage at any panel size (small, medium, large)
- The sizing behavior is consistent with other panel types that have had the sizing system applied

## Project Context
- Parent: HEL-136 (sizing system parent epic)
- Project: Helio v1.1 — UX Foundations
- Priority: Medium
- The CSS container queries foundation was established in HEL-159
