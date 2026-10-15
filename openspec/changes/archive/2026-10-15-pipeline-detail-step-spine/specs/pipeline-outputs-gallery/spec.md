## MODIFIED Requirements

### Requirement: Gallery lists every Output on the pipeline
The Outputs tab, labeled "Outputs (N)" where N is the pipeline's total Output count, SHALL render
one live card per Output regardless of whether it is on the trunk or a tail.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop there is no Outputs tab: the spine's OUTPUTS section lists every Output of the pipeline (regardless of step) as a card with its name, "<Kind> · used in N panels" and the step it hangs off. The panel count comes from `panelCount` on the pipeline's Outputs list response (no per-Output request).

#### Scenario: Tab count matches total Outputs
- **WHEN** the pipeline has 5 Outputs across trunk and tails
- **THEN** the tab label reads "Outputs (5)" and the gallery shows 5 cards

#### Scenario: Desktop outputs section
- **WHEN** a pipeline has two Outputs on desktop
- **THEN** the spine's OUTPUTS section lists both with kind, panel count and origin step

### Requirement: Each card shows origin, placement count, and Place action
Each gallery card SHALL show the Output rendered live (reusing panel renderers), an "off <step
name>" subtitle naming its node step, an "on N dashboards" placement count, and a "Place on
dashboard" button.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop each OUTPUTS card shows its origin ("off <step>") and its placement count ("used in N panels"); activating the card opens the Output editor sheet, and its quiet menu carries "History for <name>".

#### Scenario: Placement count reflects current panels
- **WHEN** an Output is placed as a panel on two dashboards
- **THEN** its gallery card reads "on 2 dashboards"

#### Scenario: Place on dashboard opens picker
- **WHEN** a user clicks "Place on dashboard" on a card
- **THEN** a dashboard picker opens and, on confirmation, calls `POST /api/panels` to create the panel

#### Scenario: Desktop output card actions
- **WHEN** the user activates an Output card on desktop
- **THEN** the Output editor sheet opens, and the card's menu offers History

### Requirement: New output entry point asks which step
The gallery's "+ New output" affordance SHALL prompt the user to choose a target step before opening the Output sheet.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop the ghost "+ Output" (accessible name "New output") in the OUTPUTS section opens the Output sheet with no pre-chosen step, whose own step picker asks which step; a step row's "Add output" menu item opens it targeted at that step.

#### Scenario: "+ New output" from the gallery
- **WHEN** a user clicks "+ New output" in the gallery tab
- **THEN** the system prompts for which pipeline step the new Output should attach to, then opens
  the Output sheet for that step

#### Scenario: Desktop new output entry
- **WHEN** the user chooses "+ Output" in the spine
- **THEN** the Output sheet opens in create mode with no pre-chosen step
