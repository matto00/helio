## MODIFIED Requirements

### Requirement: Insight panel states
The panel SHALL show exactly one of these states, each following the DESIGN.md state patterns:
- not yet rendered: no render and no attempt (`role="status"`);
- rendering: a refresh the user started is pending;
- failed: the newest attempt failed; the previous render stays visible with a note, or a failed message when there is
  no render;
- unchanged: the newest attempt was skipped as unchanged; the render stays visible with a quiet note;
- quota reached: the newest attempt's status is `skipped_quota` (the server sends it only to the pipeline owner and
  editors); the render stays visible with a note naming no actor;
- not updated: the newest attempt's status is `skipped_budget`, `not_updated` (a viewer's view of a quota or budget
  skip) or a status the client does not know; the render stays visible with a neutral note naming no reason;
- upsell: the signed-in user owns the insight's pipeline, has the `free` tier and there is no render.

Ownership is the pipeline's owner, never the user who created the Output.

A public or share-token viewer SHALL see only the render or the not-yet-rendered state.

#### Scenario: Failed keeps the previous render
- **WHEN** an insight has an `ok` render and a newer `failed` attempt
- **THEN** the previous render is shown with a note that the last update failed

#### Scenario: Viewer never sees quota
- **WHEN** a viewer grantee views an insight whose newest stored attempt is `skipped_quota`
- **THEN** the read returns `not_updated` and the panel shows the neutral not-updated note and no quota or plan wording

#### Scenario: Editor sees quota
- **WHEN** an editor grantee views an insight whose newest attempt is `skipped_quota`
- **THEN** the panel shows the quota note, worded without naming whose limit it is

#### Scenario: Free-tier owner
- **WHEN** a free-tier pipeline owner views an insight on their pipeline that has no render
- **THEN** the upsell state is shown with a link to beta access

#### Scenario: Refresh button for owner and editor
- **WHEN** the read's `canRefresh` is true on an authenticated panel
- **THEN** a Refresh button is shown; pressing it shows the rendering state, posts a refresh and polls the read until
  the newest attempt changes or 45 seconds pass; a viewer and a public viewer see no button
