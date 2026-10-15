## MODIFIED Requirements

### Requirement: Schedule bar shows current schedule state
The pipeline detail page's single header region SHALL show the schedule summary, compactly, on
one line, alongside the bound-source and bound-type information: "No schedule set" when the
pipeline has no schedule, or the schedule's kind/expression, enabled state, and next-run time
(formatted as a local date/time) when one exists. The corresponding action — "Set schedule" when
no schedule exists, "Edit schedule" when one does — SHALL be available as an item in the header's
single actions menu (see `pipeline-editor-page`'s "Header actions consolidate into one menu"
requirement), not as its own always-visible button.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop there is no schedule bar: the header's schedule chip shows the state. "Add schedule" when there is none; otherwise the expression summary with "next <time>" (or "no next run yet"), and a muted "Paused" marker when disabled. Activating the chip opens the schedule dialog. At ≤1100px the chip is compact (expression ellipsized, "Paused" kept, full state in its title); at ≤900px it collapses to an icon that keeps the "Paused" marker. It is never hidden.

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

### Requirement: User can enable or disable a schedule
The page header and the schedule dialog SHALL each provide a way to toggle `enabled` without
altering the `kind`/`expression`/`timezone` fields, persisted via
`PUT /api/pipelines/:id/schedule`.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop the enable/disable control is a menu item in the header's "Pipeline actions" menu ("Pause schedule" / "Resume schedule") instead of a visible switch; it sends the same PUT with the unchanged kind, expression and timezone.

#### Scenario: Disabling from the header
- **WHEN** the user toggles the enabled control in the page header's schedule section
- **THEN** `PUT /api/pipelines/:id/schedule` is called with `enabled: false` and the same
  `kind`/`expression`/`timezone` as before

#### Scenario: Desktop pause and resume
- **WHEN** the user chooses "Pause schedule" from the header menu on desktop
- **THEN** a PUT is sent with the unchanged kind, expression and timezone and `enabled: false`
