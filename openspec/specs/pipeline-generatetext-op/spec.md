# pipeline-generatetext-op Specification

## Purpose
Defines the `generatetext` pipeline step: per-row, model-backed free-text generation over a content field,
writing the generated narrative to a `string-body` output column that downstream Outputs can bind to.

## Requirements

### Requirement: generatetext config declares input, instruction and output field
The `generatetext` step config SHALL be `{inputField, instruction, outputField}`, all strings. Create, add and
update SHALL reject a config with 400 when `inputField`, `instruction` or `outputField` is empty or absent.
`outputField` SHALL NOT default to `inputField`: a generator that silently overwrote its own source content
would destroy the input it was given. A persisted step SHALL decode without throwing, including a legacy or
partially-configured row whose keys are absent.

#### Scenario: Empty instruction rejected
- **WHEN** a step is created with a non-empty `inputField` and `outputField` but an empty `instruction`
- **THEN** the request fails with 400 naming the empty field

#### Scenario: Absent outputField rejected
- **WHEN** a step is created with no `outputField` key at all
- **THEN** the request fails with 400 naming `outputField`

#### Scenario: Persisted step decodes
- **WHEN** a pipeline containing a saved `generatetext` step is analyzed
- **THEN** the response is 200 and includes the step, not a 500

### Requirement: Generation runs once per row through the injectable AI step client
The step SHALL call the model only through the execution context's AI step client, backed in production by
`ClaudeClient`. It SHALL issue exactly one call per input row, sequentially, so a failure on row N issues no
call for row N+1. A zero-row input SHALL issue no model call and produce no rows. The step SHALL NOT batch,
retry, cache, or collapse multiple rows into a single call.

#### Scenario: One call per row, in order
- **WHEN** the step runs over three rows and every response succeeds
- **THEN** exactly three model calls are made, and each row gains its own generated text in input order

#### Scenario: Zero rows makes no call
- **WHEN** the step runs over an empty row set
- **THEN** no model call is made and the output is empty

#### Scenario: First failing row stops the run
- **WHEN** the model call for the second of three rows fails
- **THEN** no call is made for the third row and the whole run fails

### Requirement: Token budgets are enforced by the existing client clamps
The step SHALL NOT implement its own token accounting. Output-token clamping and the pre-flight input-token
budget SHALL remain `ClaudeClient`'s (`CLAUDE_MAX_TOKENS`, `CLAUDE_MAX_INPUT_TOKENS`). An input that exceeds
the input budget SHALL fail with reason `ai-guardrail` before any network call is made.

#### Scenario: Oversized input fails pre-flight
- **WHEN** a row's content exceeds the configured input-token budget
- **THEN** the run fails with `generatetext ai-guardrail` and zero transport calls are made

### Requirement: The generated text lands in a string-body output column
On success the row SHALL gain `outputField` holding the model's response text. When `outputField` names an
existing column, that column SHALL be overwritten. A row SHALL never be emitted with a partially-written or
placeholder output value.

#### Scenario: Generated text appended
- **WHEN** the model returns narrative text for a row
- **THEN** that row's `outputField` holds exactly that text and every other field passes through unchanged

#### Scenario: Output column overwrites a colliding input column
- **WHEN** `outputField` names a column already present on the input row
- **THEN** the output row's value for that column is the generated text

### Requirement: Named failure reasons, with no partial output
Every failure SHALL fail the step with a message prefixed `generatetext <code>: `, surfaced verbatim to the
run's error. The codes SHALL be `field-missing` (input field absent or null), `field-not-string`,
`ai-unavailable` (no AI client configured), `ai-guardrail`, `ai-error` (API or transport failure), and
`response-empty` (a response that is empty or only whitespace). No rows SHALL be materialized for a failed run.

#### Scenario: No API key configured
- **WHEN** a pipeline with a `generatetext` step runs and no AI client is configured
- **THEN** the run fails with an error containing `generatetext ai-unavailable` and no rows are materialized

#### Scenario: Missing input field
- **WHEN** a row's `inputField` is absent or null
- **THEN** the run fails with `generatetext field-missing`

#### Scenario: Non-string input field
- **WHEN** a row's `inputField` holds a number
- **THEN** the run fails with `generatetext field-not-string`

#### Scenario: Blank response
- **WHEN** the model returns an empty or whitespace-only response
- **THEN** the run fails with `generatetext response-empty` and the output column is not written

### Requirement: Analyze reports the output column without calling the model
Analyze SHALL report the step's output schema as the input schema with `outputField` set or added as type
`string-body`, so the generated column is bindable at that node. Analyze SHALL NOT call the model. Analyze
SHALL flag a `validationError` when the config is invalid, when `inputField` is absent from the input schema,
or when `inputField` is neither `string` nor `string-body`.

#### Scenario: Output column reported as string-body
- **WHEN** analyze runs over a valid `generatetext` step writing to `summary`
- **THEN** the step's output schema contains `summary` with type `string-body`, and no model call is made

#### Scenario: Unknown input field flagged
- **WHEN** `inputField` names a column absent from the input schema
- **THEN** analyze returns 200 with a `validationError` naming that field

#### Scenario: Non-content input field flagged
- **WHEN** `inputField` names a column of type `integer`
- **THEN** analyze returns 200 with a `validationError` stating the field must be `string` or `string-body`

### Requirement: generatetext is never auto-runnable
A pipeline containing an enabled `generatetext` step SHALL be denied by the auto-run cheapness verdict with
the `ai-step` reason code.

#### Scenario: Auto-run denied
- **WHEN** the cheapness verdict is computed for a pipeline with an enabled `generatetext` step
- **THEN** the verdict is not auto-runnable and its reasons include `ai-step`
