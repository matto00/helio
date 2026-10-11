## ADDED Requirements

### Requirement: Patch-set target kinds are enumerated identically on every contract surface
The set of valid patch-set `target.kind` values SHALL be exactly `panel`, `dashboard`, `dataSource`, `pipeline`, `pipelineStep`, `output` on every surface that enumerates it: the `EditTarget.kind` enum in `schemas/patch-sets/patch-set.schema.json`, the `EditPreview.kind` enum in `schemas/patch-sets/patch-set-preview-response.schema.json`, the backend request decoder, the assistant `propose_patch_set` tool input schema, the frontend `EditTarget` type, and the helio-mcp patch-set input schema. The `propose_patch_set` tool description and the refinement prompt's edit skeleton SHALL name every kind. The frontend `EditTarget` type SHALL carry the optional `parentId` field the schema defines. Automated guard tests SHALL fail when any of these surfaces diverges from the schema enum.

#### Scenario: Frontend type matches the schema
- **WHEN** the frontend patch-set target-kind list is compared with the `EditTarget.kind` enum in `patch-set.schema.json`
- **THEN** they contain exactly the same values, with no `dataType` and including `output`

#### Scenario: Tool description names every kind
- **WHEN** the assistant tool catalog is built
- **THEN** the `propose_patch_set` description names each of the six target kinds, including `output`

#### Scenario: Preview response schema accepts an output edit preview
- **WHEN** a preview response contains an `EditPreview` whose `kind` is `output`
- **THEN** it validates against `patch-set-preview-response.schema.json`

#### Scenario: A schema enum change without a matching code change fails tests
- **WHEN** a target kind is added to or removed from a schema enum, or from one side's list, without the other surfaces changing
- **THEN** a guard test fails naming the diverging surface
