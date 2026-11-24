## MODIFIED Requirements

### Requirement: Schedule bar shows current schedule state
For the pipeline owner (HEL-1837: grantees get the read-only chip defined in "Schedule write controls are owner-only" instead), the pipeline detail page's single header region SHALL show the schedule summary, compactly, on
one line, alongside the bound-source and bound-type information: "No schedule set" when the
pipeline has no schedule, or the schedule's kind/expression, enabled state, and next-run time
(formatted as a local date/time) when one exists. The corresponding action — "Set schedule" when
no schedule exists, "Edit schedule" when one does — SHALL be available as an item in the header's
single actions menu (see `pipeline-editor-page`'s "Header actions consolidate into one menu"
requirement), not as its own always-visible button.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop there is no schedule bar: the header's schedule chip shows the state. "Add schedule" when there is none; otherwise the expression summary with "next <time>" (or "no next run yet"), and a muted "Paused" marker when disabled. Activating the owner's chip opens the schedule dialog. The chip's narrow forms key off the pipeline page's own content width (the viewport minus the rail and the 200–400px context list), not the viewport: at 800px of content width or less the chip is compact (expression ellipsized, the "next run" text moved into its title, "Paused" kept); at or below 600px of content width an active schedule's chip collapses to its icon and a paused schedule's chip shows only its "Paused" word, each with the full state in its title. For the owner it is never hidden.

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

## ADDED Requirements

### Requirement: Schedule write controls are owner-only
The pipeline page SHALL offer schedule write controls (the interactive schedule chip including "Add schedule", the
"Set schedule"/"Edit schedule"/"Pause schedule"/"Resume schedule" menu items, the schedule dialog, and the
pause/resume action) only to the pipeline's owner (HEL-1837: read all, owner writes). An editor or viewer grantee, and
a caller whose ownership is not yet known, SHALL see a non-interactive read-only schedule chip when the pipeline has a
schedule, carrying the same expression, next-run and "Paused" state as the owner's chip, and no schedule chip or
schedule entry at all when it has none. The owner's controls are unchanged.

#### Scenario: Editor sees a read-only chip
- **WHEN** an editor grantee opens a shared pipeline that has an enabled schedule
- **THEN** the header shows the schedule's expression and next run in a chip that is not a button, and the actions
  menu offers no schedule item

#### Scenario: Viewer sees a paused schedule read-only
- **WHEN** a viewer grantee opens a shared pipeline whose schedule is disabled
- **THEN** the header shows the read-only chip with the "Paused" marker and no schedule write control

#### Scenario: Grantee with no schedule
- **WHEN** an editor or viewer grantee opens a shared pipeline that has no schedule
- **THEN** no "Add schedule" control and no schedule menu item is shown

#### Scenario: Owner unchanged
- **WHEN** the owner opens their pipeline
- **THEN** the chip opens the schedule dialog and the menu offers the schedule items exactly as before
