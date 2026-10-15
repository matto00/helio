# pipeline-outputs-rail Specification

## Purpose
Defines the per-trunk-step Outputs rail: a row of chips showing every Output attached directly
to that step, each rendering a live thumbnail from the most recent dry/live run frame.

## Requirements

### Requirement: Outputs rail renders one chip per direct Output
Each trunk `StepCard` SHALL render an Outputs rail containing exactly one chip per Output whose
`nodeStepId` equals that step's id, plus a trailing "+ output" affordance.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop there is no per-step rail: a step's Outputs are listed in the spine's OUTPUTS section (with the step each hangs off) and "Add output" is a step-row menu item. The rail remains on the phone river view.

#### Scenario: Rail reflects direct Outputs only
- **WHEN** a step has two Outputs attached directly and one Output attached to its tail's leaf step
- **THEN** the step's rail shows exactly two chips (the tail's Output appears on the tail chain, not the trunk rail)

#### Scenario: Desktop has no rail
- **WHEN** a step has a direct Output on desktop
- **THEN** the Output appears in the OUTPUTS section with "off <step>" and no rail chip renders under the step

### Requirement: Chip shows kind badge, name, and live thumbnail
Each rail chip SHALL display a kind badge, the Output's name, and a live thumbnail (metric value
for `metric`, sparkline-sized chart for `chart`, table skeleton for `table`/`collection`/`timeline`,
truncated rendered text for `markdown`) sourced from the last dry or live run's per-Output preview
frame for that `outputId`.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop the OUTPUTS card shows the name and "<Kind> · used in N panels"; the live row-count thumbnail is not shown there.

#### Scenario: Thumbnail updates after a dry run
- **WHEN** a dry run completes and returns a preview frame containing this Output's `outputId`
- **THEN** the chip's thumbnail re-renders from that frame without a page reload

#### Scenario: No frame yet
- **WHEN** no dry/live run has produced a frame for this Output since page load
- **THEN** the chip shows a neutral placeholder thumbnail, not stale or error content

#### Scenario: Desktop output card content
- **WHEN** an Output is listed on desktop
- **THEN** its card shows the name and kind with the panel count

### Requirement: Chip opens the Output sheet
Clicking a rail chip SHALL open the Output side sheet scoped to that chip's Output.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop activating an OUTPUTS card (accessible name "Open <name> output") opens the Output sheet.

#### Scenario: Click opens sheet scoped to that Output
- **WHEN** a user clicks a rail chip
- **THEN** the Output side sheet opens pre-loaded with that Output's kind, name, and config

#### Scenario: Desktop card opens the sheet
- **WHEN** the user activates an Output card on desktop
- **THEN** the Output sheet opens for that Output

### Requirement: The Output "off <step>" subtitle names the lane
Where an Output is described by the step it hangs off — the Outputs gallery tab and per-Output thumbnails —
the description SHALL include the lane the step belongs to when that step is not in the primary lane, as a
`›`-separated path (for example `off filter › lane 2 › aggregate`).

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop the OUTPUTS card's "off <step>" subtitle names the lane in the same format as before.

#### Scenario: An Output on a non-primary lane
- **WHEN** an Output hangs off an `aggregate` step in the second lane below a `filter` step
- **THEN** its subtitle reads `off filter › lane 2 › aggregate`

#### Scenario: An Output on the primary lane
- **WHEN** an Output hangs off a step in the primary lane
- **THEN** its subtitle names the step without a lane segment

#### Scenario: Desktop subtitle names the lane
- **WHEN** an Output hangs off a step in a branch lane on desktop
- **THEN** its card subtitle names the lane as the rail did
