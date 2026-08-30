## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

### Requirement: Shared InferredField-to-DataField projection
The backend SHALL define a single `InferredField` → `DataField` projection function, honoring an
optional per-field-name override (`FieldOverridePayload`, providing `displayName` and `dataType`
overrides) when supplied, and defaulting to the inferred `displayName`/`dataType` when no override
is present for a field. `SourceService`'s create/refresh paths SHALL call this single function
rather than each defining an inline mapping.

#### Scenario: Projection without overrides matches inferred values
- **WHEN** the projection is called with an `InferredSchema` and no overrides
- **THEN** each resulting `DataField` has the inferred `displayName`, `dataType` (as its string
  form), and `nullable` value, unchanged from the `InferredField`

#### Scenario: Projection applies a matching override
- **WHEN** the projection is called with an `InferredSchema` and an override present for a given
  field name
- **THEN** the resulting `DataField` for that field uses the override's `displayName` and
  `dataType`, with `nullable` left as inferred

#### Scenario: SourceService reuses the shared projection
- **WHEN** `SourceService.createSql`, `.createRest`, `.refreshSql`, or `.refreshRest` builds a
  `Output/node`'s fields from an `InferredSchema`
- **THEN** it does so by calling the shared projection function, not an inline field-by-field map
