## ADDED Requirements

### Requirement: The run result reports source-read truncation
The `POST /api/pipelines/:id/run` response body SHALL carry `sourceTruncated` (boolean),
`sourceAvailableRowCount` (number, present only when a total was actually observed) and
`truncationNotice` (string, present only when the read was truncated), in addition to the existing
`rows`, `rowCount`, `stepRowCounts` and `sourceRowCount` fields.

`sourceRowCount` SHALL retain its existing meaning — the number of rows actually read into the run —
and SHALL NOT be redefined to mean the available total.

The same fields SHALL be carried by the step-preview run result.

#### Scenario: Truncated run response
- **WHEN** a non-dry run reads 1000 of 3303 available rows
- **THEN** the `200 OK` body carries `sourceTruncated: true`, `sourceAvailableRowCount: 3303`,
  `sourceRowCount: 1000` and a non-empty `truncationNotice`

#### Scenario: Complete run response
- **WHEN** a non-dry run reads every row of its source
- **THEN** the body carries `sourceTruncated: false` and omits `truncationNotice`

#### Scenario: Truncation fields are backward compatible
- **WHEN** a client written before this change reads a run response
- **THEN** `rows`, `rowCount`, `stepRowCounts` and `sourceRowCount` are unchanged in name, type and meaning
