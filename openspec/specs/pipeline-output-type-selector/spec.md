# pipeline-output-type-selector Specification

## Purpose
Provide a memoized derived-state selector that surfaces pipeline-output DataTypes (`sourceId === null`) with a referentially stable reference for unchanged input, so React-Redux render bailout succeeds and no "selector returned a different result" warning is emitted in consuming components.
## Requirements
### Requirement: Stable pipeline-output DataType selector

The system SHALL expose `selectPipelineOutputDataTypes`, a memoized selector that returns the
DataTypes produced by a pipeline (`sourceId === null`). The selector MUST return a referentially
stable array (`===`) across repeated calls whenever `state.dataTypes.items` is unchanged, so that
React-Redux render bailout succeeds and no "selector returned a different result" warning is emitted
in any consuming component.

#### Scenario: Stable reference for unchanged input

- **WHEN** `selectPipelineOutputDataTypes` is called twice with a state whose `dataTypes.items`
  reference has not changed
- **THEN** both calls return the same array reference (`===`)

#### Scenario: Unrelated state change does not break stability

- **WHEN** an unrelated slice of state changes but `dataTypes.items` is unchanged
- **THEN** `selectPipelineOutputDataTypes` returns the same array reference as before the change

#### Scenario: Recomputes when input items change

- **WHEN** `state.dataTypes.items` is replaced with a new array
- **THEN** `selectPipelineOutputDataTypes` returns a newly computed array containing only DataTypes
  with `sourceId === null`

#### Scenario: Filters out companion source DataTypes

- **WHEN** `state.dataTypes.items` contains both pipeline-output DataTypes (`sourceId === null`) and
  companion source DataTypes (`sourceId != null`)
- **THEN** the selector returns only the pipeline-output DataTypes

