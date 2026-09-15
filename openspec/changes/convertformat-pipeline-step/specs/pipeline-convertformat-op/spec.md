## Purpose

A deterministic, local pipeline step that converts a content field between CSV and JSON and between plain text and
Markdown, with a defined lossless round trip and named failure reasons.

## ADDED Requirements

### Requirement: convertformat is a creatable step kind with a validated config
The system SHALL accept a `convertformat` step with config `field`, `from`, `to` and optional `outputField`
(defaulting to `field`). The only accepted `from`/`to` pairs SHALL be `csv`->`json`, `json`->`csv`,
`text`->`markdown` and `markdown`->`text`; any other pair SHALL be rejected with 400 at create/update time. A persisted
`convertformat` step SHALL load without error.

#### Scenario: Supported pair accepted
- **WHEN** a pipeline is created with a `convertformat` step `{field: "content", from: "csv", to: "json"}`
- **THEN** the request succeeds and the step is persisted

#### Scenario: Unsupported pair rejected
- **WHEN** a `convertformat` step is created with `from: "csv"` and `to: "markdown"`
- **THEN** the request is rejected with 400 naming the unsupported pair

#### Scenario: Persisted step analyzes without a server error
- **WHEN** `GET /api/pipelines/:id/analyze` is called for a pipeline containing a persisted `convertformat` step
- **THEN** the response is 200 and the step is not reported as `Unknown op`

### Requirement: convertformat converts one row to exactly one row
Each input row SHALL produce exactly one output row with every other field unchanged and the converted string written
to `outputField`. The step SHALL NOT drop rows, add rows, or emit rows with an empty converted value in place of an
error.

#### Scenario: Row count preserved
- **WHEN** three rows with valid CSV content are converted csv->json
- **THEN** three rows are emitted, each with its JSON string in `outputField` and other fields untouched

### Requirement: CSV and JSON round trip is lossless
csv->json SHALL produce a JSON array of objects keyed by header, in header order, with string values. json->csv SHALL
accept only an array of objects sharing one key set with string values. Converting any parseable CSV to JSON and back
SHALL reproduce its canonical form with every cell byte-identical, and converting any accepted JSON to CSV and back
SHALL reproduce a structurally equal value.

#### Scenario: CSV with quoting survives a round trip
- **WHEN** CSV containing embedded commas, doubled quotes and a newline inside a quoted field is converted to JSON and back
- **THEN** every cell value is byte-identical to the original

#### Scenario: JSON survives a round trip
- **WHEN** a JSON array of string-valued objects is converted to CSV and back
- **THEN** the result has the same keys, key order and string values

### Requirement: Text and Markdown round trip is lossless from text
For every text value `t`, converting text->markdown then markdown->text SHALL return `t` with only line endings
normalized to `\n`. text->markdown output SHALL render as the literal text.

#### Scenario: Markdown-significant characters survive
- **WHEN** text containing `# not a heading`, `*stars*`, `[brackets](x)`, leading spaces and single line breaks is converted to Markdown and back
- **THEN** the result equals the original text

### Requirement: Unconvertible input fails the step with a named reason
When a value cannot be converted, the step SHALL fail the run with an error message containing a stable reason code
(`field-missing`, `field-not-string`, `csv-malformed`, `json-malformed`, `json-not-array-of-objects`,
`json-nested-value`, `json-non-string-value`, `json-inconsistent-keys`) and SHALL NOT emit rows for it.

#### Scenario: Malformed CSV
- **WHEN** a csv->json step receives content with an unterminated quoted field
- **THEN** the run fails with a message containing `csv-malformed`

#### Scenario: Non-array JSON
- **WHEN** a json->csv step receives `{"a":"1"}`
- **THEN** the run fails with a message containing `json-not-array-of-objects`

#### Scenario: Missing content field
- **WHEN** the configured field is null or absent on a row
- **THEN** the run fails with a message containing `field-missing`

### Requirement: Analyze infers the convertformat output schema
Analyze SHALL report a validation error when `field` is absent from the input schema, is not a `string-body` field, or
the pair is unsupported; otherwise the output schema SHALL be the input schema with `outputField` as `string-body`.

#### Scenario: Non-content field flagged
- **WHEN** a `convertformat` step names an `integer` field
- **THEN** analyze returns a validation error stating the field is not a content field
