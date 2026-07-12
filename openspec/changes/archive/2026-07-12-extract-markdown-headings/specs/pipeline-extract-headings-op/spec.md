## ADDED Requirements

### Requirement: Extract-headings op extracts Markdown headings from a string-body field
The execution engine SHALL support the `extractheadings` op. The step config SHALL contain: `field`
(string, the source column name), `indexField` (string, defaults to `"headingIndex"`), and
`levelField` (string, defaults to `"headingLevel"`). For each input row: if the value of `field` is
`null` or the field is absent, the row SHALL be dropped (zero output rows for that input row).
Otherwise the field's string value SHALL be scanned line-by-line (after normalizing `\r\n` to `\n`)
for Markdown ATX heading lines matching `^#{1,6}\s+(.*)$`, in document order. One output row SHALL
be emitted per matched heading: every field from the input row other than `field` passes through
unchanged, `field` is replaced by the heading's trimmed title text (the line with its leading `#`
markers and following whitespace stripped), `indexField` is set to the heading's 0-based position
among the headings found in that row, and `levelField` is set to the number of `#` characters (1-6)
in the matched heading marker. If the content contains no heading line at all, zero output rows
SHALL be emitted for that input row.

#### Scenario: Headings of mixed levels are extracted in document order
- **WHEN** an `extractheadings` step with `{"field":"content","indexField":"headingIndex",
  "levelField":"headingLevel"}` is applied to a row
  `{"content":"# Title\ntext\n## Section\nmore text\n### Sub"}`
- **THEN** three output rows are produced: `{"content":"Title","headingIndex":0,"headingLevel":1}`,
  `{"content":"Section","headingIndex":1,"headingLevel":2}`,
  `{"content":"Sub","headingIndex":2,"headingLevel":3}`

#### Scenario: Other row fields pass through unchanged
- **WHEN** an `extractheadings` step with `{"field":"content"}` is applied to a row
  `{"content":"# Heading","filename":"doc.md"}`
- **THEN** the output row contains `{"filename":"doc.md"}` unchanged alongside the extracted heading

#### Scenario: Null content field drops the row
- **WHEN** an `extractheadings` step is applied to a row where `field` is `null`
- **THEN** zero output rows are produced for that input row

#### Scenario: No heading lines yields zero output rows
- **WHEN** an `extractheadings` step is applied to a row whose content contains no line matching
  `^#{1,6}\s+`
- **THEN** zero output rows are produced for that input row

### Requirement: Extract-headings op schema inference validates the field is a string-body field
`PipelineAnalyzeService.inferExtractHeadings` SHALL look up `config.field` in the step's
`inputSchema`. If the field is absent, `AnalyzedStep.validationError` SHALL be set to a message
identifying the unknown field, and the output schema SHALL pass through unchanged (identity
fallback). If the field is present but its type is not `"string-body"`, `validationError` SHALL be
set to a message stating the field is not a content field, and the output schema SHALL likewise
pass through unchanged. If the field is present and is `"string-body"`, `validationError` SHALL be
`None` and the output schema SHALL be the input schema with `indexField` appended as type
`"integer"` and `levelField` appended as type `"integer"` (each replacing any existing field of the
same name).

#### Scenario: Valid string-body field produces the expected output schema
- **WHEN** an `extractheadings` step with `{"field":"content","indexField":"headingIndex",
  "levelField":"headingLevel"}` is analyzed against an `inputSchema` of
  `[{"name":"content","type":"string-body"}]`
- **THEN** the output schema is `[{"name":"content","type":"string-body"},
  {"name":"headingIndex","type":"integer"}, {"name":"headingLevel","type":"integer"}]` and
  `validationError` is `None`

#### Scenario: Unknown field is flagged at analyze time
- **WHEN** an `extractheadings` step with `{"field":"missing"}` is analyzed against an
  `inputSchema` that does not contain `missing`
- **THEN** `validationError` is set to a message identifying the unknown field, and the output
  schema equals the input schema

#### Scenario: Non-string-body field is flagged at analyze time
- **WHEN** an `extractheadings` step with `{"field":"price"}` is analyzed against an `inputSchema`
  of `[{"name":"price","type":"integer"}]`
- **THEN** `validationError` is set to a message stating `price` is not a content field, and the
  output schema equals the input schema

### Requirement: Frontend extract-headings op renders a field editor restricted to content fields
When a pipeline step has `op: "extractheadings"` and the step card is expanded, the frontend SHALL
render an `ExtractHeadingsConfig` component with a field dropdown listing only entries from the
step's `analyzeSchema` whose `type` is `"string-body"`. The component SHALL patch the step config on
any change. If no `string-body` field exists in `analyzeSchema`, the field dropdown SHALL render
empty (no fields offered) rather than falling back to all columns.

#### Scenario: Field dropdown offers only string-body fields
- **WHEN** an `extractheadings` step card is expanded and the analyze response's `inputSchema` for
  that step is `[{"name":"content","type":"string-body"},{"name":"filename","type":"string"}]`
- **THEN** the field dropdown offers only `content`, not `filename`

#### Scenario: Changing the field updates the step config
- **WHEN** the user selects `content` in the field dropdown
- **THEN** the step config is patched with `{"field":"content", ...}`

#### Scenario: No string-body fields renders an empty dropdown
- **WHEN** an `extractheadings` step card is expanded and the analyze response's `inputSchema`
  contains no `string-body` fields
- **THEN** the field dropdown renders with no options
