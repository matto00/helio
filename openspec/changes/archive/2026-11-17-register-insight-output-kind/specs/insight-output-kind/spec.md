## Purpose

Defines the `insight` Output kind: a narrative Output attached to a pipeline node whose config says what it may read
and how it refreshes. This capability covers registration, config validation and the not-yet-rendered panel state only.

## ADDED Requirements

### Requirement: Insight config contract
An `insight` Output's config SHALL accept only these keys, each optional: `preset` (one of `auto`, `delta`, `trend`,
`leaders`, `summary`; default `auto`), `prompt` (a string of at most 2000 characters), `reads` (an object with only
`outputs` and `windows`), `refresh` (`on_run`, `daily` or `manual`; default `on_run`), `maxSentences` (integer 1 to 6;
default 2), `maxChars` (integer 80 to 1200; default 400), and `fieldMapping` only when it is an empty object. Defaults
SHALL NOT be written into stored config. A key set to `null` is cleared. A value
outside these rules SHALL be rejected with 400 naming the key. The assistant's proposal key documentation SHALL NOT list
insight keys until the proposal surface accepts the kind.

#### Scenario: Minimal insight created
- **WHEN** a client creates an Output with kind `insight` and config `{}`
- **THEN** the response is 201 and the Output's stored config is `{}`

#### Scenario: Unknown key rejected
- **WHEN** an insight Output is created or updated with config containing `model` or any other unlisted key
- **THEN** the response is 400 and the message names that key

#### Scenario: Out-of-range value rejected
- **WHEN** an insight config sets `refresh` to `hourly`, `maxSentences` to 0, or `preset` to `poem`
- **THEN** the response is 400 and the message names the offending key

#### Scenario: Field mapping rejected
- **WHEN** an insight config carries a non-empty `fieldMapping`
- **THEN** the response is 400 naming `fieldMapping`

### Requirement: Insight reads are scoped to the same pipeline
`reads.outputs` SHALL be an array of at most 8 distinct Output ids, each naming an Output that belongs to the same
pipeline as the insight once the write completes, is not of kind `insight`, and is never the insight itself. `reads.windows` SHALL be an array of
at most 4 distinct history windows (`1d`, `7d`, `30d` or `custom:<ISO-8601 duration>` up to 365 days). When
`reads.outputs` is absent the insight reads the other Outputs on its own node; that default is resolved by readers, not stored. An empty `reads.outputs` means the insight reads no sibling Output.
`reads` is judged only when a write introduces or changes it, and restoring previously stored state (undo, rollback)
is never refused, so an id left dangling by a later Output deletion does not block unrelated edits.

#### Scenario: Insight reading another insight rejected
- **WHEN** an insight's `reads.outputs` names another Output of kind `insight` in the same pipeline
- **THEN** the response is 400 naming `reads.outputs`

#### Scenario: Unrelated edit with dangling reads succeeds
- **WHEN** an Output named in an insight's `reads.outputs` is deleted and the insight is then patched with only a new
  `prompt`
- **THEN** the response is 200

#### Scenario: Another pipeline's Output rejected
- **WHEN** an insight's `reads.outputs` names an Output of a different pipeline (or an unknown id)
- **THEN** the response is 400 naming `reads.outputs`

#### Scenario: Self-read rejected
- **WHEN** an insight is updated so that `reads.outputs` contains its own id
- **THEN** the response is 400 naming `reads.outputs`

#### Scenario: Too many reads rejected
- **WHEN** `reads.outputs` has 9 entries, or `reads.windows` contains `previous_run`
- **THEN** the response is 400 naming the `reads` sub-key

### Requirement: Insight has no row binding and summarizes to nulls
An `insight` Output SHALL have no fieldMapping slots, SHALL be bindable to any node, and its history summary SHALL store
null `metric` and null `series`.

#### Scenario: Summary nulls
- **WHEN** a run records a history summary for an insight Output
- **THEN** the summary's `metric` and `series` are null

### Requirement: Insight panel shows a not-yet-rendered state
A panel bound to an `insight` Output, and the insight's entry in the pipeline live Output column, SHALL show a
"not yet rendered" state and SHALL NOT request a model render or call any new endpoint. No code path in this change calls a model.

#### Scenario: Placed on a dashboard
- **WHEN** an insight Output is placed on a dashboard and the dashboard is opened
- **THEN** the panel shows the not-yet-rendered state in light and dark themes, on desktop and phone widths

### Requirement: Every Output-kind enumeration site is pinned
An automated drift check SHALL compare every hand-written Output-kind enumeration site (backend, migration CHECK, JSON
schemas, frontend, helio-mcp, assistant tool schema) against the canonical kind set. A site that deliberately excludes
`insight` until a later leaf SHALL be listed as an explicit exclusion, and the check SHALL fail both when a site drops
a kind and when an excluded site gains `insight` without the exclusion being removed.

#### Scenario: A site drops insight
- **WHEN** `insight` is removed from any one pinned site
- **THEN** the drift check fails naming that site
