## Purpose

Defines the frontend step-card editor for a `generatetext` pipeline step: a required input field,
instruction and destination field, where the destination is never silently defaulted to the source.

## ADDED Requirements

### Requirement: The destination field is never defaulted or prefilled from the input field

The editor SHALL require an explicit `outputField` and SHALL NOT prefill, default, or suggest it from
`inputField`. A generator that overwrote its own source would destroy the content it was asked to
summarize, and the backend deliberately rejects an absent or empty `outputField`.

#### Scenario: A freshly added step has an empty destination
- **WHEN** a new `generatetext` step is added
- **THEN** the `outputField` control is empty and is not populated from `inputField`

#### Scenario: Choosing an input field does not populate the destination
- **WHEN** a user selects an `inputField` on a `generatetext` step card
- **THEN** the `outputField` control remains empty

### Requirement: All three fields are required, and a missing one is shown inline

The editor SHALL surface, inline on the card, any of `inputField`, `instruction` or `outputField` being
empty or whitespace-only — each of which the backend rejects with a named 422 — rather than allowing the
condition to surface only as a failed request.

#### Scenario: An empty instruction is flagged
- **WHEN** a step has an input field and destination but a blank instruction
- **THEN** the card shows an inline error naming the empty instruction

#### Scenario: A whitespace-only destination is flagged
- **WHEN** a step's `outputField` contains only whitespace
- **THEN** the card shows an inline error naming the empty destination

### Requirement: Naming an existing column as the destination is disclosed as an overwrite

Because naming an existing column as `outputField` overwrites that column, the editor SHALL disclose that
consequence when the chosen destination matches an existing input-schema field.

#### Scenario: An existing column chosen as destination is flagged as overwriting
- **WHEN** a user sets `outputField` to the name of a field already in the input schema
- **THEN** the card states that the existing column will be overwritten

### Requirement: The input field picker offers only string-bearing fields

The editor SHALL populate `inputField` from the analyze input schema restricted to `string` and
`string-body` fields, matching what the backend accepts, and SHALL start with no selection on a freshly
added step.

#### Scenario: Only string-bearing fields are offerable
- **WHEN** the input schema mixes string, content and numeric fields
- **THEN** only the `string` and `string-body` fields appear in the `inputField` picker

### Requirement: A persisted or agent-created step round-trips as an editable card

A `generatetext` step created through `add_pipeline_step` or already persisted SHALL render as a fully
editable card, not the unsupported-step notice, and a config authored through the card SHALL match the
shape documented for the op by `add_pipeline_step` for the same intent.

#### Scenario: An MCP-created step renders as an editable card
- **WHEN** the editor loads a pipeline containing a `generatetext` step created via `add_pipeline_step`
- **THEN** the card shows its input field, instruction and destination, editable

#### Scenario: UI and agent authoring agree
- **WHEN** the same generation intent is authored once through the card and once through
  `add_pipeline_step`
- **THEN** the two persisted configs are equal
