## MODIFIED Requirements

### Requirement: Schedule bar shows current schedule state
The pipeline detail page's single header region SHALL show the schedule summary, compactly, on
one line, alongside the bound-source and bound-type information: "No schedule set" when the
pipeline has no schedule, or the schedule's kind/expression, enabled state, and next-run time
(formatted as a local date/time) when one exists. The corresponding action — "Set schedule" when
no schedule exists, "Edit schedule" when one does — SHALL be available as an item in the header's
single actions menu (see `pipeline-editor-page`'s "Header actions consolidate into one menu"
requirement), not as its own always-visible button.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop there is no schedule bar: the header's schedule chip shows the state. "Add schedule" when there is none; otherwise the expression summary with "next <time>" (or "no next run yet"), and a muted "Paused" marker when disabled. Activating the chip opens the schedule dialog. The chip's narrow forms key off the pipeline page's own content width (the viewport minus the rail and the 200–400px context list), not the viewport: at 800px of content width or less the chip is compact (expression ellipsized, the "next run" text moved into its title, "Paused" kept); at or below 600px of content width an active schedule's chip collapses to its icon and a paused schedule's chip shows only its "Paused" word, each with the full state in its title. It is never hidden.

#### Scenario: No schedule set
- **WHEN** `GET /api/pipelines/:id/schedule` resolves to no schedule (404)
- **THEN** the page header shows "No schedule set", the header's actions menu offers "Set
  schedule", and no next-run time is displayed

#### Scenario: Schedule exists and is enabled
- **WHEN** the pipeline has a schedule with `enabled: true` and a non-null `nextRunAt`
- **THEN** the page header shows the schedule's expression and the next-run time

#### Scenario: Schedule exists but has no computed next run yet
- **WHEN** the pipeline has a schedule with `enabled: true` and `nextRunAt: null`
- **THEN** the page header shows the schedule's expression without a next-run time, and does not
  render an error

#### Scenario: Desktop schedule chip
- **WHEN** the pipeline has a disabled interval schedule on desktop
- **THEN** the header chip shows "Every <interval>" with a "Paused" marker

