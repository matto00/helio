# mcp-assert-step-authoring Specification

## Purpose
Let an MCP agent add a well-formed `assert` step to a pipeline via `add_pipeline_step`, with malformed
rule shapes rejected by Zod before any network call.
## Requirements
### Requirement: add_pipeline_step documents and Zod-validates the assert op
The `add_pipeline_step` MCP tool SHALL document the `assert` op's config shape (`{rules: [{kind, field?,
params, severity}]}`, six v1 kinds: `notNull`, `unique`, `range`, `rowCountMin`, `rowCountMax`, `regex`;
severity `warn`|`error`) in its description, matching the documentation depth of every other op. When
`type` is `"assert"`, the tool SHALL validate `config` against a dedicated Zod schema before calling the
backend, rejecting a malformed rule shape (unknown `kind`, invalid `severity`, missing a required
`field`/param for its kind) without any network call.

#### Scenario: A well-formed assert step is added successfully
- **WHEN** `add_pipeline_step` is called with `type: "assert"` and `config: {rules: [{kind: "notNull",
  field: "email", params: {}, severity: "error"}]}`
- **THEN** the backend call succeeds and the created step is returned

#### Scenario: An invalid rule kind is rejected before the server call
- **WHEN** `add_pipeline_step` is called with `type: "assert"` and a rule whose `kind` is not one of the
  six supported values
- **THEN** the tool returns a Zod validation error and no request reaches the backend

#### Scenario: A rowCountMin rule without field is accepted
- **WHEN** `add_pipeline_step` is called with `type: "assert"` and `config: {rules: [{kind:
  "rowCountMin", params: {count: 1}, severity: "warn"}]}` (no `field`)
- **THEN** the rule validates successfully — `rowCountMin`/`rowCountMax` are dataset-level and never
  require `field`

#### Scenario: A range rule missing its required field is rejected
- **WHEN** `add_pipeline_step` is called with `type: "assert"` and a `range` rule with no `field`
- **THEN** the tool returns a Zod validation error and no request reaches the backend

