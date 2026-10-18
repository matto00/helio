## ADDED Requirements

### Requirement: Swipe-dismissable bottom sheet
`shared/motion` SHALL provide a bottom sheet primitive that composes the shared modal dialog (focus trap, focus restore,
Escape and a visible close control all routed through one vetoable close request). On a phone it SHALL present
full-height from the bottom edge with a grab handle. A downward drag on the handle or the header SHALL move the sheet
with the finger; releasing past a distance or velocity threshold SHALL request close (and the sheet SHALL return to rest
if the request is vetoed), otherwise the sheet SHALL return to its rest position; a cancelled pointer SHALL return it.
At rest the sheet SHALL carry no transform, so popovers portalled from inside it anchor to their triggers. The sheet
SHALL stay open through its exit animation and only then report closed.
Settling, closing and the entrance SHALL take timing only from motion tokens. Under Subtle the entrance and exit SHALL
be an opacity fade only and a release SHALL snap; under Off nothing SHALL animate transform or position. Following the
finger is direct manipulation and SHALL work at every Motion level. A drag inside the body SHALL scroll the body and
never move the sheet.

#### Scenario: Swipe down dismisses
- **WHEN** a user drags the open sheet's handle down past the threshold and releases
- **THEN** the sheet requests close through the same path as the close button

#### Scenario: Short drag returns
- **WHEN** a user drags the handle down a short distance slowly and releases
- **THEN** the sheet returns to its rest position and stays open

#### Scenario: Body drag scrolls
- **WHEN** the user drags inside the sheet body
- **THEN** the body scrolls and the sheet does not move

#### Scenario: No transform at rest
- **WHEN** the sheet has settled after opening or after a short drag
- **THEN** the sheet element has no transform and a select popover inside it opens anchored to its trigger

#### Scenario: Motion off
- **WHEN** Motion = Off and the sheet opens or is dismissed by swipe
- **THEN** no transform or position animation runs after the finger lifts
