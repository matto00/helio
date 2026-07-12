# pipeline-chunk-by-token-count-op Specification

## Purpose
Defines the `chunkbytokencount` pipeline op, which splits a `string-body` content field into one
output row per fixed-size chunk of real BPE tokens (via a per-step selectable `jtokkit` encoding),
plus its schema-inference and step-card-UI behavior.
## Requirements
### Requirement: Chunk-by-token-count op splits a string-body field into one row per real-BPE-token chunk

The execution engine SHALL support the `chunkbytokencount` op. The step config SHALL contain:
`field` (string, the source column name), `targetTokenCount` (integer, defaults to `500`),
`encoding` (string, `"o200k_base"` or `"cl100k_base"`, defaults to `"o200k_base"` and falls back to
`"o200k_base"` for any other value), `indexField` (string, defaults to `"chunkIndex"`), and
`tokenCountField` (string, defaults to `"tokenCount"`). For each input row: if the value of `field`
is `null` or the field is absent, the row SHALL be dropped (zero output rows for that input row).
Otherwise the field's string value SHALL be tokenized using the selected encoding, and the resulting
token sequence SHALL be split into consecutive chunks of at most `targetTokenCount` tokens each (the
final chunk holds the remainder; a `targetTokenCount` less than `1` SHALL be treated as `1`). One
output row SHALL be emitted per chunk: every field from the input row other than `field` passes
through unchanged, `field` is replaced by the chunk's decoded text, `indexField` is set to the
chunk's 0-based position, and `tokenCountField` is set to that chunk's exact token count. An empty
string value SHALL yield zero output rows (zero tokens produce zero chunks).

#### Scenario: A long field is split into fixed-size token chunks

- **WHEN** a `chunkbytokencount` step with `{"field":"content","targetTokenCount":500,"encoding":"o200k_base","indexField":"chunkIndex","tokenCountField":"tokenCount"}`
  is applied to a row whose `content` value tokenizes to 1200 tokens under `o200k_base`
- **THEN** three output rows are produced with `chunkIndex` `0`, `1`, `2`; the first two rows have
  `tokenCount` `500` and the last row has `tokenCount` `200`; each row's `content` decodes back to
  that chunk's token range

#### Scenario: Other row fields pass through unchanged

- **WHEN** a `chunkbytokencount` step with `{"field":"content","targetTokenCount":500}` is applied
  to a row `{"content":"some long text...","filename":"doc.txt"}`
- **THEN** every output row contains `{"filename":"doc.txt"}` unchanged

#### Scenario: Null content field drops the row

- **WHEN** a `chunkbytokencount` step is applied to a row where `field` is `null`
- **THEN** zero output rows are produced for that input row

#### Scenario: Empty string content yields zero output rows

- **WHEN** a `chunkbytokencount` step is applied to a row where `field` is `""`
- **THEN** zero output rows are produced for that input row

#### Scenario: Unrecognized encoding value falls back to o200k_base

- **WHEN** a `chunkbytokencount` step's stored config has `"encoding":"not-a-real-encoding"`
- **THEN** the step decodes with `encoding` treated as `"o200k_base"` rather than failing

### Requirement: Chunk-by-token-count op schema inference validates the field is a string-body field

`PipelineAnalyzeService.inferChunkByTokenCount` SHALL look up `config.field` in the step's
`inputSchema`. If the field is absent, `AnalyzedStep.validationError` SHALL be set to a message
identifying the unknown field, and the output schema SHALL pass through unchanged (identity
fallback). If the field is present but its type is not `"string-body"`, `validationError` SHALL be
set to a message stating the field is not a content field, and the output schema SHALL likewise pass
through unchanged. If the field is present and is `"string-body"`, `validationError` SHALL be `None`
and the output schema SHALL be the input schema with `indexField` appended as type `"integer"` and
`tokenCountField` appended as type `"integer"` (each replacing any existing field of the same name).

#### Scenario: Valid string-body field produces the expected output schema

- **WHEN** a `chunkbytokencount` step with `{"field":"content","indexField":"chunkIndex",
  "tokenCountField":"tokenCount"}` is analyzed against an `inputSchema` of
  `[{"name":"content","type":"string-body"}]`
- **THEN** the output schema is `[{"name":"content","type":"string-body"},
  {"name":"chunkIndex","type":"integer"},{"name":"tokenCount","type":"integer"}]` and
  `validationError` is `None`

#### Scenario: Unknown field is flagged at analyze time

- **WHEN** a `chunkbytokencount` step with `{"field":"missing"}` is analyzed against an
  `inputSchema` that does not contain `missing`
- **THEN** `validationError` is set to a message identifying the unknown field, and the output
  schema equals the input schema

#### Scenario: Non-string-body field is flagged at analyze time

- **WHEN** a `chunkbytokencount` step with `{"field":"price"}` is analyzed against an `inputSchema`
  of `[{"name":"price","type":"integer"}]`
- **THEN** `validationError` is set to a message stating `price` is not a content field, and the
  output schema equals the input schema

### Requirement: Frontend chunk-by-token-count op renders a field, token-count, and encoding editor restricted to content fields

When a pipeline step has `op: "chunkbytokencount"` and the step card is expanded, the frontend SHALL
render a `ChunkByTokenCountConfig` component with: a field dropdown listing only entries from the
step's `analyzeSchema` whose `type` is `"string-body"`, a numeric `targetTokenCount` input, and an
`encoding` dropdown offering `"o200k_base"` (default) and `"cl100k_base"`. The component SHALL patch
the step config on any change. If no `string-body` field exists in `analyzeSchema`, the field
dropdown SHALL render empty (no fields offered) rather than falling back to all columns.

#### Scenario: Field dropdown offers only string-body fields

- **WHEN** a `chunkbytokencount` step card is expanded and the analyze response's `inputSchema` for
  that step is `[{"name":"content","type":"string-body"},{"name":"filename","type":"string"}]`
- **THEN** the field dropdown offers only `content`, not `filename`

#### Scenario: Encoding dropdown defaults to o200k_base

- **WHEN** a new `chunkbytokencount` step is added with no explicit `encoding` set
- **THEN** the encoding dropdown shows `"o200k_base"` selected

#### Scenario: Changing the encoding updates the step config

- **WHEN** the user selects `"cl100k_base"` in the encoding dropdown
- **THEN** the step config is patched with `{"encoding":"cl100k_base", ...}`

#### Scenario: No string-body fields renders an empty dropdown

- **WHEN** a `chunkbytokencount` step card is expanded and the analyze response's `inputSchema`
  contains no `string-body` fields
- **THEN** the field dropdown renders with no options

