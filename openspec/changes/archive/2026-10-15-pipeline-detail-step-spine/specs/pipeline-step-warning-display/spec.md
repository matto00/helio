## MODIFIED Requirements

### Requirement: A step's analyze warnings render on its own StepCard
The pipeline editor SHALL render each analyze warning on the StepCard of the step whose id the warning names. In the card header, visible whether the card is collapsed or expanded, a compact warning-intent indicator SHALL appear with an accessible name stating the number of warnings, and SHALL show the count visibly when there is more than one. When the card is expanded, a region directly below its header (above the step's Outputs rail) SHALL list every warning message for that step under the heading "Check before running" with the qualifier "(these don't block runs)". A step with no warnings SHALL render neither element.

**Layout scope (HEL-1579).** The paragraphs above and the scenarios below describe the phone layout (at or below 768px, the river view), which is unchanged. On desktop each warning renders on the step it names: the spine row carries a quiet warning-intent marker with a count ("N schema warnings") and the focused editor shows the "Check before running" region, in server order, only for that step, never styled as a block.

#### Scenario: Warned step shows indicator and messages
- **WHEN** analyze returns two warnings for step S and S's card is expanded
- **THEN** S's header shows a warning indicator whose accessible name states 2 warnings and a visible count of 2
- **AND** the region below S's header lists both messages under "Check before running (these don't block runs)"

#### Scenario: Collapsed card still shows the indicator
- **WHEN** analyze returns one warning for step S and S's card is collapsed
- **THEN** S's header shows the warning indicator without a visible count and the message list is not rendered

#### Scenario: Step without warnings
- **WHEN** analyze returns no warning for step S
- **THEN** S's card renders no warning indicator and no warning list

#### Scenario: Desktop warnings on the row and the editor
- **WHEN** an analyze response carries two warnings naming step 2 on desktop
- **THEN** step 2's row shows a warning marker with count 2 and its focused editor lists both warnings; no other row shows a marker
