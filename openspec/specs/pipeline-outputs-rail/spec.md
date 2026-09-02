# pipeline-outputs-rail Specification

## Purpose
Defines the per-trunk-step Outputs rail: a row of chips showing every Output attached directly
to that step, each rendering a live thumbnail from the most recent dry/live run frame.

## Requirements

### Requirement: Outputs rail renders one chip per direct Output
Each trunk `StepCard` SHALL render an Outputs rail containing exactly one chip per Output whose
`nodeStepId` equals that step's id, plus a trailing "+ output" affordance.

#### Scenario: Rail reflects direct Outputs only
- **WHEN** a step has two Outputs attached directly and one Output attached to its tail's leaf step
- **THEN** the step's rail shows exactly two chips (the tail's Output appears on the tail chain, not the trunk rail)

### Requirement: Chip shows kind badge, name, and live thumbnail
Each rail chip SHALL display a kind badge, the Output's name, and a live thumbnail (metric value
for `metric`, sparkline-sized chart for `chart`, table skeleton for `table`/`collection`/`timeline`,
truncated rendered text for `markdown`) sourced from the last dry or live run's per-Output preview
frame for that `outputId`.

#### Scenario: Thumbnail updates after a dry run
- **WHEN** a dry run completes and returns a preview frame containing this Output's `outputId`
- **THEN** the chip's thumbnail re-renders from that frame without a page reload

#### Scenario: No frame yet
- **WHEN** no dry/live run has produced a frame for this Output since page load
- **THEN** the chip shows a neutral placeholder thumbnail, not stale or error content

### Requirement: Chip opens the Output sheet
Clicking a rail chip SHALL open the Output side sheet scoped to that chip's Output.

#### Scenario: Click opens sheet scoped to that Output
- **WHEN** a user clicks a rail chip
- **THEN** the Output side sheet opens pre-loaded with that Output's kind, name, and config
