## MODIFIED Requirements

### Requirement: Batch create is all-or-nothing

The backend SHALL create zero panels and return HTTP 400 identifying the offending item by its
1-based index and title (an absent/omitted `title` renders as an empty string, never omitted from
the message) if any item in the `panels` array is invalid (unrecognized `type`, invalid
`appearance.chart.chartType`, or a `config.outputId` binding that violates the pipeline-only
rule).

#### Scenario: One bad item rejects the whole batch
- **WHEN** a `POST /api/panels/batch` payload's second item has an invalid `type`
- **THEN** the response is 400 naming panel 2, and no panel from the batch (including the valid
  first and third items) is created

#### Scenario: V41 binding violation rejects the whole batch
- **WHEN** a `POST /api/panels/batch` payload's item binds `config.outputId` to a source-companion
  (non-pipeline-output) DataType
- **THEN** the response is 400 (pipeline-only binding rule) and no panels in the batch are created

#### Scenario: Empty panels array is rejected
- **WHEN** a `POST /api/panels/batch` payload's `panels` array is empty
- **THEN** the response is 400 and no panels are created

