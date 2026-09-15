# pipeline-analyzewithai-op Specification

## Purpose
Defines the `analyzewithai` pipeline step: model-backed structured extraction over a content field, whose declared
output schema is enforced strictly on every model response.

## Requirements

### Requirement: analyzewithai config declares an ordered output schema
The `analyzewithai` step config SHALL be `{inputField, instruction, outputSchema}` where `outputSchema` is an ordered
array of `{name, type}` with type in `string|integer|float|boolean`. Create/add/update SHALL reject invalid config
with 400, and a persisted step SHALL decode without throwing.

#### Scenario: Invalid output type rejected
- **WHEN** a step is created with an `outputSchema` entry of type `timestamp`
- **THEN** the request fails with 400 naming the invalid type

#### Scenario: Persisted step decodes
- **WHEN** a pipeline containing a saved `analyzewithai` step is analyzed
- **THEN** the response is 200 and includes the step, not a 500

### Requirement: Model calls go through an injectable AI step client
Pipeline AI steps SHALL call the model only through the execution context's AI step client, backed in production by
`ClaudeClient` (so input-token and output-token guardrails apply). When `ANTHROPIC_API_KEY` is absent the backend SHALL
boot and the step SHALL fail with reason `ai-unavailable`.

#### Scenario: No API key
- **WHEN** a pipeline with an `analyzewithai` step runs and no AI client is configured
- **THEN** the run fails with an error containing `analyzewithai ai-unavailable` and no rows are materialized

### Requirement: Declared output schema is enforced on the model response
Each row's response SHALL be a single JSON object with exactly the declared keys and types, and nothing after it.
A non-conforming response SHALL fail the step with a named reason (`response-malformed-json`, `response-not-object`,
`response-missing-field`, `response-wrong-type`, `response-extra-field`) and SHALL NOT emit partial columns.

#### Scenario: Conforming response
- **WHEN** the model returns an object matching the declared schema
- **THEN** the row gains the declared columns, typed as declared, in declared order

#### Scenario: Missing field
- **WHEN** the response omits a declared key
- **THEN** the run fails with `response-missing-field` and no output rows

#### Scenario: Wrong type
- **WHEN** a declared `integer` key holds the string `"42"`
- **THEN** the run fails with `response-wrong-type`

#### Scenario: Extra field
- **WHEN** the response includes a key not in the declared schema
- **THEN** the run fails with `response-extra-field`

#### Scenario: Malformed JSON or trailing content
- **WHEN** the response is not valid JSON, or is a valid object followed by more content
- **THEN** the run fails with `response-malformed-json`

### Requirement: Analyze reports the declared output schema
Analyze SHALL return input schema plus declared columns in declared order for `analyzewithai`, without calling the
model, and SHALL flag a missing or non-string input field as a validation error.

#### Scenario: Output schema from config
- **WHEN** analyze runs over an `analyzewithai` step declaring `sentiment:string, score:float`
- **THEN** the step's output schema ends with `sentiment` (string) then `score` (float)
