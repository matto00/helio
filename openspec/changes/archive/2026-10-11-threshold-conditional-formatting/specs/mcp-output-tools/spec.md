## ADDED Requirements

### Requirement: Output config write tools document conditionalFormats
The helio-mcp tools that write an Output's `config` (`add_output`, `update_output`, `create_pipeline`, any
pipeline-proposal tool that carries Output config, and `apply_patch_set`) SHALL list `conditionalFormats` among the
metric, table and collection known config keys. `add_output` and `update_output` SHALL additionally document the rule
shape: an ordered list of `{op, value, value2?, tone, label?, column?, target?}` rules where the first matching rule
wins; `op` is one of `gt`, `gte`, `lt`, `lte`, `between`, `eq`, `neq`; `tone` is one of `success`, `warning`,
`error`; `column` is required on table rules and not allowed on metric or collection rules; `target` is `cell` or
`row` on table rules only; rules compare the raw (unformatted) value; and `null` or `[]` clears all rules.

#### Scenario: Tool descriptions list the key
- **WHEN** a client lists tools
- **THEN** the description of each config-writing tool lists `conditionalFormats` under metric, table and collection

#### Scenario: add_output documents the rule shape
- **WHEN** the `add_output` or `update_output` tool's description is read
- **THEN** it names every operator, every tone, the first-match rule, the table-only `column`/`target` fields and how
  to clear the rules
