## MODIFIED Requirements

### Requirement: Run History UI shows provenance per run
The pipeline Run History view SHALL display each run's trigger source (manual, scheduled, external, or auto-run)
alongside its existing status, timing, and row-count information. The home run timeline SHALL label a run's trigger
source with the same wording. In Run History, the auto-run badge SHALL be visually distinct from the manual badge in
both the light and dark themes, and its text SHALL meet a 4.5:1 contrast ratio against the badge's own rendered fill.

#### Scenario: Manual run shows a manual badge
- **WHEN** a run record with `triggerSource: "manual"` is rendered in Run History
- **THEN** the row displays a "Manual" provenance indicator

#### Scenario: Scheduled run shows a scheduled badge
- **WHEN** a run record with `triggerSource: "scheduled"` is rendered in Run History
- **THEN** the row displays a "Scheduled" provenance indicator

#### Scenario: Auto-run shows an Auto-run label in Run History and on the home timeline
- **WHEN** a run with `triggerSource: "auto-run"` is rendered in Run History or as a home timeline mark's details
- **THEN** it displays "Auto-run", never the raw value or a generic fallback

#### Scenario: Auto-run badge differs visibly from manual in both themes
- **WHEN** Run History renders an auto-run run and a manual run, in the light theme and in the dark theme
- **THEN** the auto-run badge's rendered background differs from the manual badge's, with a fill-to-row contrast of at
  least 1.10:1
- **AND** the auto-run badge's text has a contrast ratio of at least 4.5:1 against its own rendered fill
