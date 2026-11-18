## MODIFIED Requirements

### Requirement: Insight panel shows a not-yet-rendered state
A panel bound to an `insight` Output that has no render and no render attempt, and the insight's entry in the pipeline
live Output column, SHALL show a "not yet rendered" state with `role="status"` and SHALL NOT request a model render.
No code path in this change calls a model.

#### Scenario: Placed on a dashboard
- **WHEN** an insight Output with no render is placed on a dashboard and the dashboard is opened
- **THEN** the panel shows the not-yet-rendered state, exposed as a status, in light and dark themes, on desktop and
  phone widths
