## Purpose

Defines the "Outputs (N)" tab: a gallery of every Output on the pipeline rendered live, with
placement info and a path to place it on a dashboard.

## ADDED Requirements

### Requirement: Gallery lists every Output on the pipeline
The Outputs tab, labeled "Outputs (N)" where N is the pipeline's total Output count, SHALL render
one live card per Output regardless of whether it is on the trunk or a tail.

#### Scenario: Tab count matches total Outputs
- **WHEN** the pipeline has 5 Outputs across trunk and tails
- **THEN** the tab label reads "Outputs (5)" and the gallery shows 5 cards

### Requirement: Each card shows origin, placement count, and Place action
Each gallery card SHALL show the Output rendered live (reusing panel renderers), an "off <step
name>" subtitle naming its node step, an "on N dashboards" placement count, and a "Place on
dashboard" button.

#### Scenario: Placement count reflects current panels
- **WHEN** an Output is placed as a panel on two dashboards
- **THEN** its gallery card reads "on 2 dashboards"

#### Scenario: Place on dashboard opens picker
- **WHEN** a user clicks "Place on dashboard" on a card
- **THEN** a dashboard picker opens and, on confirmation, calls `POST /api/panels` to create the panel

### Requirement: New output entry point asks which step
The gallery's "+ New output" affordance SHALL prompt the user to choose a target step before opening the Output sheet.

#### Scenario: "+ New output" from the gallery
- **WHEN** a user clicks "+ New output" in the gallery tab
- **THEN** the system prompts for which pipeline step the new Output should attach to, then opens
  the Output sheet for that step
