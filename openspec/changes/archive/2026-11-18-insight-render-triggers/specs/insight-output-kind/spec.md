## MODIFIED Requirements

### Requirement: Insight config contract
An `insight` Output's config SHALL accept only these keys, each optional: `preset` (one of `auto`, `delta`, `trend`,
`leaders`, `summary`; default `auto`), `prompt` (a string of at most 2000 characters), `reads` (an object with only
`outputs` and `windows`), `refresh` (`on_run`, `daily` or `manual`; default `on_run`), `maxSentences` (integer 1 to 6;
default 2), `maxChars` (integer 80 to 1200; default 400), `model` (a model id the shared `ClaudeModelCatalog` currently
lists as selectable; absent means the server default `CLAUDE_MODEL`), and `fieldMapping` only when it is an empty
object. Defaults SHALL NOT be written into stored config. A key set to `null` is cleared. A value
outside these rules SHALL be rejected with 400 naming the key. The assistant's proposal key documentation SHALL NOT list
insight keys until the proposal surface accepts the kind.

#### Scenario: Minimal insight created
- **WHEN** a client creates an Output with kind `insight` and config `{}`
- **THEN** the response is 201 and the Output's stored config is `{}`

#### Scenario: Unknown key rejected
- **WHEN** an insight Output is created or updated with config containing an unlisted key
- **THEN** the response is 400 and the message names that key

#### Scenario: Model outside the catalog rejected
- **WHEN** an insight config sets `model` to `claude-opus-4-8`, to an id `CLAUDE_SELECTABLE_MODELS` narrowed out, or to
  a non-string, through Output create/update, single-call pipeline create (`POST /api/pipelines` with outputs), a pipeline
  draft save or a patch-set apply
- **THEN** the response is 400 and the message names `model`

#### Scenario: Out-of-range value rejected
- **WHEN** an insight config sets `refresh` to `hourly`, `maxSentences` to 0, or `preset` to `poem`
- **THEN** the response is 400 and the message names the offending key

#### Scenario: Field mapping rejected
- **WHEN** an insight config carries a non-empty `fieldMapping`
- **THEN** the response is 400 naming `fieldMapping`
