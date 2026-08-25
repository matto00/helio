## ADDED Requirements

### Requirement: Grounding for join, pivot, window, and unpivot step edits SHALL include a worked, decoder-verified example
The grounding assembled for a `pipelineStep` refinement edit SHALL include a worked UPDATE example for each of `join`, `pivot`, `window`, and `unpivot` whose `patch.config` shape has been verified (by an automated test) to decode via that step kind's real config decoder into a non-empty, correctly-populated config — extending the existing `aggregate`/`groupby` worked-example guarantee (HEL-411) to these four step kinds.

This is a prompt-grounding guarantee, not a decoder-level one: it makes a correctly-shaped edit available to the model for each kind, verified by regression test; it does NOT guarantee the model always uses it, nor does it change decode-time behavior for any caller (decoder hardening is explicitly out of scope for this change — see design.md D3).

#### Scenario: The join worked example decodes to a fully-populated JoinConfig
- **WHEN** `RefinementEditShapeSpec` decodes the `join` worked UPDATE example through `JoinConfig.decode`
- **THEN** the resulting config's `rightDataSourceId`, `joinKey`, and `joinType` are all non-empty and match
  the example's intended values — never a silently-defaulted `""`/`"inner"`

#### Scenario: The pivot worked example decodes to a fully-populated PivotConfig
- **WHEN** `RefinementEditShapeSpec` decodes the `pivot` worked UPDATE example through `PivotConfig.decode`
- **THEN** the resulting config's `index` is non-empty and `column`/`values`/`agg` all match the example's
  intended values — never silently defaulted to `""`/empty

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
