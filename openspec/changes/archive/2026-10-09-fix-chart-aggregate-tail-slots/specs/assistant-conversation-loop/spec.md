## ADDED Requirements

### Requirement: Worked examples put Output config on the Output
Every `propose_*` worked example SHALL bind an `output`-type dashboard panel by `outputId` alone: no output panel in
an example SHALL carry a key that is an Output config key in `OutputConfigValidation.KnownKeys` (for example
`aggregation`, `fieldMapping`, `label`, `unit`, `chartType`), because the proposal apply path ignores those on a panel.
Every Output an example proposes, and every Output `config` an example patch carries, SHALL pass
`OutputConfigValidation` for its kind. At least one example SHALL show `aggregation` on an Output's `config`. This is
asserted by a test that derives the forbidden and allowed key sets from `KnownKeys`, never from a hand-copied list.

#### Scenario: An output panel in an example carries no Output config key
- **WHEN** every `output`-type panel in every `propose_*` tool's `examples` is inspected
- **THEN** none of its keys is in the union of `OutputConfigValidation.KnownKeys` values

#### Scenario: Example Output configs pass the validator
- **WHEN** every Output in every `propose_*` example (pipeline outputs, combined pipeline outputs, Output-targeted
  patch-set edits) is validated with `OutputConfigValidation` for its kind
- **THEN** each passes, and at least one of them carries a non-null `aggregation`

#### Scenario: Reintroducing a panel-level aggregation fails the test
- **WHEN** an `aggregation` key is added back to an output panel in a dashboard example
- **THEN** the example test fails naming the offending key
