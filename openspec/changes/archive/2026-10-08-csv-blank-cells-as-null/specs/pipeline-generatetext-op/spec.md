## MODIFIED Requirements

### Requirement: Named failure reasons, with no partial output
Every failure SHALL fail the step with a message prefixed `generatetext <code>: `, surfaced verbatim to the
run's error. The codes SHALL be `field-missing` (input field absent), `field-not-string`,
`ai-unavailable` (no AI client configured), `ai-guardrail`, `ai-error` (API or transport failure), and
`response-empty` (a response that is empty or only whitespace). No rows SHALL be materialized for a failed run.
An input field that is present with a null value SHALL be treated as the empty string, not as `field-missing`.

#### Scenario: No API key configured
- **WHEN** a pipeline with a `generatetext` step runs and no AI client is configured
- **THEN** the run fails with an error containing `generatetext ai-unavailable` and no rows are materialized

#### Scenario: Missing input field
- **WHEN** a row's `inputField` is absent
- **THEN** the run fails with `generatetext field-missing`

#### Scenario: Null input field is empty text
- **WHEN** a row's `inputField` is present with a null value
- **THEN** the step sends the empty string as content and does not fail with `field-missing`

#### Scenario: Non-string input field
- **WHEN** a row's `inputField` holds a number
- **THEN** the run fails with `generatetext field-not-string`

#### Scenario: Blank response
- **WHEN** the model returns an empty or whitespace-only response
- **THEN** the run fails with `generatetext response-empty` and the output column is not written
