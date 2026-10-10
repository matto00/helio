## ADDED Requirements

### Requirement: A step's analyze warnings render on its own StepCard
The pipeline editor SHALL render each analyze warning on the StepCard of the step whose id the warning names. In the card header, visible whether the card is collapsed or expanded, a compact warning-intent indicator SHALL appear with an accessible name stating the number of warnings, and SHALL show the count visibly when there is more than one. When the card is expanded, a region directly below its header (above the step's Outputs rail) SHALL list every warning message for that step under the heading "Check before running" with the qualifier "(these don't block runs)". A step with no warnings SHALL render neither element.

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

### Requirement: Warnings are presented as non-blocking
Warning presentation SHALL use the warning design tokens, never the error accent; a warned step card SHALL NOT be marked as errored and SHALL NOT change any run control's enabled state. No warning copy SHALL state that the pipeline or step cannot run. A step that has both a `validationError` and warnings SHALL show both.

#### Scenario: Warned but valid step is not errored
- **WHEN** a step has warnings and no `validationError`
- **THEN** its card carries no errored styling and the pipeline's run controls are unchanged

#### Scenario: Both error and warnings
- **WHEN** a step has a `validationError` and one warning
- **THEN** its header shows both the error indicator and the warning indicator
