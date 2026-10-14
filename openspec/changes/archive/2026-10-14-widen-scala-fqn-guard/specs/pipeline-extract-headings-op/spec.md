## MODIFIED Requirements

### Requirement: Extract-headings op schema inference validates the field is a string-body field
`TextSchemaInference.inferExtractHeadings` SHALL look up `config.field` in the step's
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

