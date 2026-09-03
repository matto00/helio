## MODIFIED Requirements

### Requirement: Grounding for join, pivot, window, and unpivot step edits SHALL include a worked, decoder-verified example
The grounding assembled for a `pipelineStep` refinement edit SHALL include a worked UPDATE example for each of `join`, `pivot`, `window`, and `unpivot` whose `patch.config` shape has been verified (by an automated test) to decode via that step kind's real config decoder into a non-empty, correctly-populated config. The `join` worked example SHALL use the discriminated `secondaryInput` shape; the legacy flat `rightDataSourceId` field SHALL NOT appear in any worked example.

This is a prompt-grounding guarantee, not a decoder-level one: it makes a correctly-shaped edit available to the model for each kind, verified by regression test; it does NOT guarantee the model always uses it.

#### Scenario: The join worked example decodes to a fully-populated JoinConfig
- **WHEN** the `join` worked UPDATE example is decoded through the real `join` config decoder
- **THEN** the resulting config's `secondaryInput`, `joinKey`, and `joinType` are all non-empty and match
  the example's intended values — never a silently-defaulted empty input or `"inner"`
- **AND** `secondaryInput` is a well-formed discriminated object, not a legacy flat field

#### Scenario: The pivot worked example decodes to a fully-populated PivotConfig
- **WHEN** the `pivot` worked UPDATE example is decoded through the real `pivot` config decoder
- **THEN** the resulting config's `index` is non-empty and `column`/`values`/`agg` all match the example's
  intended values — never silently defaulted

#### Scenario: The unpivot worked example decodes to a fully-populated UnpivotConfig
- **WHEN** `RefinementEditShapeSpec` decodes the `unpivot` worked UPDATE example through
  `UnpivotConfig.decode`
- **THEN** the resulting config's `idVars` and `valueVars` are non-empty and match the example's intended
  columns

#### Scenario: The window worked example decodes to a fully-populated WindowConfig
- **WHEN** `RefinementEditShapeSpec` decodes the `window` worked UPDATE example through
  `WindowConfig.decode`
- **THEN** the resulting config's `orderBy` and `partitionBy` both reflect every intended entry — no entry
  is silently dropped by a shape mismatch
