## MODIFIED Requirements

### Requirement: Successful runs persist a source-schema baseline

On each successful (non-dry) pipeline run, the system SHALL persist the pipeline's current source schema — the
same `[{name, type}]` derivation the analyze path uses (source Output declared fields) — to
`pipelines.last_source_schema` (nullable JSONB), alongside the existing last-run metadata update. This SHALL hold
whether the run was submitted by the pipeline's owner or by an editor grantee of the pipeline: an editor grantee's
successful run SHALL persist exactly the baseline the owner's run would — the source schema as the pipeline's owner
sees it (the same view the owner's drift comparison uses) — regardless of whether the submitting editor owns the source. Baseline persistence SHALL be best-effort: a persistence
failure SHALL NOT fail or block the run. Dry runs SHALL NOT update the baseline. Failed runs SHALL NOT update the
baseline.

#### Scenario: Baseline written on successful run
- **WHEN** a pipeline run completes successfully for a source whose schema is `[{name: "a", type: "string"}]`
- **THEN** `pipelines.last_source_schema` for that pipeline contains `[{"name": "a", "type": "string"}]`

#### Scenario: Baseline written on an editor grantee's successful run
- **WHEN** an editor grantee's real run of a pipeline they do not own completes successfully for a source owned by the
  pipeline's owner whose schema is `[{name: "a", type: "string"}]`
- **THEN** `pipelines.last_source_schema` for that pipeline contains `[{"name": "a", "type": "string"}]`

#### Scenario: Dry run leaves baseline untouched
- **WHEN** a dry run completes successfully for a pipeline with an existing baseline
- **THEN** `pipelines.last_source_schema` is unchanged
