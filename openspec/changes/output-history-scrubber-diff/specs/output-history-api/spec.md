## ADDED Requirements

### Requirement: Resolved points carry their stored chart series
Both the authenticated and the public history responses SHALL include, on `current` and on `baseline` when non-null, a `series` field equal to that point's stored `summary.series` (an object, or JSON `null` when the summary has none, e.g. a non-chart Output). It SHALL be taken from the point already loaded to resolve the comparison, adding no database statement (the "Bounded query count" bounds are unchanged). It SHALL NOT add any id, payload indicator, run id, trigger source or row payload to the public response.

#### Scenario: Window baseline older than the returned points
- **WHEN** a chart Output has compare `7d`, 40 points newer than the baseline, and the request uses the default limit
- **THEN** `baseline.series` holds the baseline point's stored series even though that point is not in `points`

#### Scenario: Non-chart Output
- **WHEN** the Output is a metric Output
- **THEN** `current.series` is JSON `null`

#### Scenario: Public response
- **WHEN** an anonymous viewer reads a public panel's history
- **THEN** `baseline.series` is present and the response still carries no `id`, `hasPayload`, `runId` or `triggerSource` key anywhere
