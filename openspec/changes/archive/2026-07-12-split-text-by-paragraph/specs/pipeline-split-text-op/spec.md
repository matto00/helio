## ADDED Requirements

### Requirement: Split-text op splits a string-body field into one row per segment
The execution engine SHALL support the `splittext` op. The step config SHALL contain: `field`
(string, the source column name), `mode` (string, `"paragraph"` or `"heading"`), `headingLevel`
(integer, defaults to `1`, only consulted when `mode` is `"heading"`), and `indexField` (string,
defaults to `"segmentIndex"`). For each input row: if the value of `field` is `null` or the field
is absent, the row SHALL be dropped (zero output rows for that input row). Otherwise the field's
string value SHALL be split into an ordered sequence of segments per `mode` (see the paragraph and
heading scenarios below), and one output row SHALL be emitted per segment: every field from the
input row other than `field` passes through unchanged, `field` is replaced by the segment's text,
and `indexField` is set to the segment's 0-based position in the sequence. If splitting yields zero
segments (e.g. no heading of the target level is found), zero output rows SHALL be emitted for that
input row.

Paragraph mode SHALL split on one-or-more blank lines (after normalizing `\r\n` to `\n`), trimming
each segment and dropping empty segments. Heading mode SHALL split at each Markdown ATX heading
line matching exactly `headingLevel` `#` characters followed by whitespace; each segment is the
heading line through (not including) the next heading line at the same level; any content before
the first matching heading is dropped.

#### Scenario: Paragraph mode splits on blank lines
- **WHEN** a `splittext` step with `{"field":"content","mode":"paragraph","indexField":"segmentIndex"}`
  is applied to a row `{"content":"Para one.\n\nPara two.\n\nPara three."}`
- **THEN** three output rows are produced: `{"content":"Para one.","segmentIndex":0}`,
  `{"content":"Para two.","segmentIndex":1}`, `{"content":"Para three.","segmentIndex":2}`

#### Scenario: Heading mode splits on level-2 Markdown headings
- **WHEN** a `splittext` step with `{"field":"content","mode":"heading","headingLevel":2}` is
  applied to a row `{"content":"## Intro\ntext a\n## Body\ntext b"}`
- **THEN** two output rows are produced, each starting with its own `## ` heading line, with
  `segmentIndex` `0` and `1` respectively

#### Scenario: Other row fields pass through unchanged
- **WHEN** a `splittext` step with `{"field":"content","mode":"paragraph"}` is applied to a row
  `{"content":"A.\n\nB.","filename":"doc.md"}`
- **THEN** both output rows contain `{"filename":"doc.md"}` unchanged

#### Scenario: Null content field drops the row
- **WHEN** a `splittext` step is applied to a row where `field` is `null`
- **THEN** zero output rows are produced for that input row

#### Scenario: No matching heading yields zero output rows
- **WHEN** a `splittext` step with `mode:"heading"`, `headingLevel: 2` is applied to a row whose
  content contains no `## ` heading line
- **THEN** zero output rows are produced for that input row

### Requirement: Split-text op schema inference validates the field is a string-body field
`PipelineAnalyzeService.inferSplitText` SHALL look up `config.field` in the step's `inputSchema`.
If the field is absent, `AnalyzedStep.validationError` SHALL be set to a message identifying the
unknown field, and the output schema SHALL pass through unchanged (identity fallback). If the
field is present but its type is not `"string-body"`, `validationError` SHALL be set to a message
stating the field is not a content field, and the output schema SHALL likewise pass through
unchanged. If the field is present and is `"string-body"`, `validationError` SHALL be `None` and
the output schema SHALL be the input schema with `indexField` appended as type `"integer"`
(replacing any existing field of the same name).

#### Scenario: Valid string-body field produces the expected output schema
- **WHEN** a `splittext` step with `{"field":"content","indexField":"segmentIndex"}` is analyzed
  against an `inputSchema` of `[{"name":"content","type":"string-body"}]`
- **THEN** the output schema is `[{"name":"content","type":"string-body"},
  {"name":"segmentIndex","type":"integer"}]` and `validationError` is `None`

#### Scenario: Unknown field is flagged at analyze time
- **WHEN** a `splittext` step with `{"field":"missing"}` is analyzed against an `inputSchema` that
  does not contain `missing`
- **THEN** `validationError` is set to a message identifying the unknown field, and the output
  schema equals the input schema

#### Scenario: Non-string-body field is flagged at analyze time
- **WHEN** a `splittext` step with `{"field":"price"}` is analyzed against an `inputSchema` of
  `[{"name":"price","type":"integer"}]`
- **THEN** `validationError` is set to a message stating `price` is not a content field, and the
  output schema equals the input schema

### Requirement: Frontend split-text op renders a field-and-mode editor restricted to content fields
When a pipeline step has `op: "splittext"` and the step card is expanded, the frontend SHALL render
a `SplitTextConfig` component with: a field dropdown listing only entries from the step's
`analyzeSchema` whose `type` is `"string-body"`, a mode toggle (`"paragraph"` / `"heading"`), and —
only when `mode` is `"heading"` — a heading-level numeric input. The component SHALL patch the step
config on any change. If no `string-body` field exists in `analyzeSchema`, the field dropdown SHALL
render empty (no fields offered) rather than falling back to all columns.

#### Scenario: Field dropdown offers only string-body fields
- **WHEN** a `splittext` step card is expanded and the analyze response's `inputSchema` for that
  step is `[{"name":"content","type":"string-body"},{"name":"filename","type":"string"}]`
- **THEN** the field dropdown offers only `content`, not `filename`

#### Scenario: Heading-level input is shown only in heading mode
- **WHEN** the user selects `"heading"` mode
- **THEN** a heading-level numeric input becomes visible; switching back to `"paragraph"` mode
  hides it

#### Scenario: Changing the field updates the step config
- **WHEN** the user selects `content` in the field dropdown
- **THEN** the step config is patched with `{"field":"content", ...}`

#### Scenario: No string-body fields renders an empty dropdown
- **WHEN** a `splittext` step card is expanded and the analyze response's `inputSchema` contains
  no `string-body` fields
- **THEN** the field dropdown renders with no options
