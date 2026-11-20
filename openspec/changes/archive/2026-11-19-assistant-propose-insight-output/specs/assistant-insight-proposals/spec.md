## ADDED Requirements

### Requirement: Assistant proposal tools offer every Output kind
The in-app assistant's proposal tool schemas SHALL offer exactly the canonical Output kinds (`OutputKind.all`),
including `insight`, derived from that one source rather than a hand-written list.

#### Scenario: Pipeline proposal tool lists insight
- **WHEN** the `propose_pipeline` tool's input schema is built
- **THEN** its Output `kind` enum equals `OutputKind.all` as strings, including `insight`

#### Scenario: Drift guard checks the assistant positively
- **WHEN** `OutputKindDriftSpec` runs
- **THEN** it asserts the assistant proposal kind enum equals the canonical kinds and `KeysDoc` documents every insight
  key, and fails if either drops `insight`

### Requirement: Assistant config docs describe the insight config per write path
`OutputConfigValidation.KeysDoc` SHALL document the insight config keys (`preset`, `prompt`, `reads`, `refresh`,
`maxSentences`, `maxChars`, `model`) with values and ranges built from the backend constants, and the assistant tool
descriptions SHALL state the `reads.outputs` rule for each write path.

#### Scenario: New pipeline proposal
- **WHEN** the assistant reads the `propose_pipeline` Output config description
- **THEN** it states that a non-empty `reads.outputs` is rejected on a new pipeline and `reads` should be omitted

#### Scenario: Existing pipeline patch set
- **WHEN** the assistant reads the `propose_patch_set` output create description
- **THEN** it states that `reads.outputs` names stored ids of other non-insight Outputs of that same pipeline

### Requirement: Assistant insight proposals validate, apply and are not rendered by creation
An assistant proposal carrying an `insight` Output SHALL preview and apply like any other kind, SHALL be rejected at
preview for any insight config or `reads.outputs` that apply would reject (on output create and output update), and
creating the insight SHALL NOT write a render or call a model. A pipeline proposal's apply run remains an `on_run`
insight's first render trigger, and the assistant docs SHALL say so.

#### Scenario: Patch-set insight create applies without rendering
- **WHEN** a patch set with an `insight` output create on an existing pipeline is previewed and applied, with a real
  insight render trigger wired over a model that fails on any call
- **THEN** both succeed, the stored Output has kind `insight` and its config, and after the post-apply backfill no
  `output_insights` row exists and no model call was made

#### Scenario: Bad reads rejected at preview on output create
- **WHEN** a patch-set insight output create names an id that is not a non-insight Output of that pipeline
- **THEN** preview is rejected with `400` naming the problem, before any write

#### Scenario: Bad reads rejected at preview on output update
- **WHEN** a patch-set output update of an existing insight sets `reads.outputs` to an id that is not a non-insight
  Output of that pipeline
- **THEN** preview is rejected with `400` naming the problem, before any write

#### Scenario: Reads of an Output deleted in the same set
- **WHEN** a patch set deletes Output X and creates an insight whose `reads.outputs` names X
- **THEN** preview is rejected with `400`

#### Scenario: Pipeline proposal with insight
- **WHEN** a pipeline proposal with an `insight` Output with `refresh: "manual"` and no `reads.outputs` is applied
- **THEN** it applies, and after the apply run completes no `output_insights` row exists for it; the same proposal
  with a non-empty `reads.outputs` is rejected with `400`

#### Scenario: Pipeline proposal docs state the render trigger
- **WHEN** the assistant reads the `propose_pipeline` Output config description
- **THEN** it states that the apply's run renders an `on_run` insight and that `refresh: "manual"` avoids it
