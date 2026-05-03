# HEL-170: Starter templates per panel type

## Title
Starter templates per panel type

## Description
2–3 preset configurations per panel type (e.g. "KPI Metric", "Time-series line chart", "Data summary table"). Selecting a template pre-fills the creation form. Templates are hardcoded for v1.2.

## Parent Epic: HEL-138 — Robust Panel Creation
Replace the current minimal creation form with a type-first modal. User selects panel type first via a visual card picker, then configures with a live inline preview. Includes starter templates per type (2–3 presets). Modal is accessible (Escape / click-outside to dismiss).

## Context
This ticket is part of the Helio v1.2 Panel System project. The type-first panel creation modal (HEL-169) has been implemented — it introduced a multi-step modal: Step 1 is a visual card picker for panel type, Step 2 is the configuration form with live preview.

HEL-170 adds starter template selection as an additional step or enhancement in that flow. When a user picks a panel type, they should see 2–3 preset template options (hardcoded for v1.2). Selecting a template pre-fills the Step 2 configuration form with that template's settings.

## Acceptance Criteria
- Each panel type has 2–3 hardcoded starter templates (v1.2)
- Templates are presented as selectable cards after the user picks a panel type
- Selecting a template pre-fills the panel creation form fields (title, type-specific config)
- The user can proceed without selecting a template (blank/default form)
- Templates integrate into the existing type-first creation modal (from HEL-169)
- No backend changes required — templates are purely frontend/hardcoded

## Panel Types (from existing codebase)
- stat (KPI/statistic display)
- timeseries (line/area chart)
- table (data table)
- text (markdown/text display)

## Example Template Ideas
- stat: "KPI Metric" (shows a single value with label), "Percentage Change" (with delta indicator)
- timeseries: "Time-series Line Chart" (basic line), "Trend Overview" (area chart variant)
- table: "Data Summary Table" (compact table), "Full Data Grid" (expanded columns)
- text: "Section Header" (large heading), "Description Block" (body text)
