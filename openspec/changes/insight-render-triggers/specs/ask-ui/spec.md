## MODIFIED Requirements

### Requirement: Pin as insight
The answer card SHALL show a "Pin as insight" action if and only if the response's `pin` is non-null. Activating it
SHALL POST `pin.request` unchanged to `/api/pipelines/:pin.pipelineId/outputs`, never adding answer text. On success
from the dashboard surface, when the signed-in user owns the dashboard, the new Output SHALL be placed on that
dashboard as a panel. A successful pin SHALL be announced, the action SHALL not be repeatable for the same answer, and
after a successful create the client SHALL start one render of the new Output with trigger `pin`
(`POST /api/outputs/:id/insight/refresh` with `{"trigger":"pin"}`); a failed render request SHALL NOT fail or revert the
pin, and the new insight Output SHALL show the not-yet-rendered state until its first attempt is recorded, then the
insight panel state for that attempt (for example the failed state when no model is configured). On the Output sheet, while a
pipeline draft exists, the pin action SHALL be disabled with a visible reason.

#### Scenario: Viewer sees no pin
- **WHEN** the response's `pin` is `null`, as for a dashboard viewer without a pipeline edit grant
- **THEN** no pin action is rendered

#### Scenario: Pin disabled during a draft
- **WHEN** the Output sheet's pipeline has an open draft and the answer carries a pin
- **THEN** the pin action is disabled and states that the draft must be saved or discarded first

#### Scenario: Editor pins
- **WHEN** a dashboard owner who can edit the cited pipeline pins an answer
- **THEN** one insight Output is created from the server-built body, a panel bound to it is placed on the dashboard, and
  the panel shows the not-yet-rendered state until the pin render's first attempt is recorded

#### Scenario: Pin starts one render
- **WHEN** a pin's create succeeds
- **THEN** exactly one refresh request with `{"trigger":"pin"}` is sent for the new Output, and a failing refresh
  request still leaves the pin announced as successful
