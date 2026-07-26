# workspace-tag-teardown Specification

## Purpose
Lets an agentic workflow tear down every data source, pipeline, and DataType carrying a given
tag in one owner-scoped, all-or-nothing call, refusing entirely rather than reaching resources
outside that tag's batch, with a dry-run preview of exactly what the call would delete.
## Requirements
### Requirement: Bulk teardown deletes exactly the resources carrying a given tag
`POST /api/workspace/teardown` with `{ tag }` SHALL delete every data source, pipeline, and
DataType owned by the caller whose `tag` equals the given value, and SHALL NOT delete any
resource whose `tag` does not equal the given value — including resources that would otherwise
be reached by an existing single-resource delete's cascade (e.g. a pipeline built on a tagged
data source, or the pipeline producing a tagged output DataType). The response SHALL report
per-kind counts: `sourcesDeleted`, `pipelinesDeleted`, `typesDeleted`.

#### Scenario: Teardown deletes only the tagged set
- **WHEN** a caller has data sources/pipelines/DataTypes tagged `T` and other resources tagged
  differently or untagged, and calls `POST /api/workspace/teardown {tag: "T"}`
- **THEN** every resource tagged `T` is deleted, every other resource (regardless of tag) is
  untouched, and the response counts match exactly the number of resources tagged `T` per kind

#### Scenario: Teardown with no matching tag deletes nothing
- **WHEN** `POST /api/workspace/teardown {tag: "nonexistent"}` is called and no owned resource
  carries that tag
- **THEN** the call succeeds with `sourcesDeleted: 0, pipelinesDeleted: 0, typesDeleted: 0` and
  nothing is deleted

### Requirement: Teardown refuses when a tagged resource has a dependent outside this batch
The teardown call SHALL be refused in its entirety — no resource deleted — when deleting a
tagged data source would cascade to a Pipeline whose `tag` is not the same tag being torn down
(untagged, or tagged into a different batch), or deleting a tagged output DataType would cascade
to the Pipeline that produces it and that Pipeline's `tag` is likewise not the same tag being
torn down. The response SHALL list each blocking conflict (the blocked resource, its kind, and
the out-of-batch dependent causing the block).

#### Scenario: Tagged data source with an untagged dependent pipeline blocks the whole call
- **WHEN** a data source tagged `T` has a dependent pipeline that is NOT tagged `T` (the
  dependent pipeline carries no tag at all), and `POST /api/workspace/teardown {tag: "T"}` is
  called
- **THEN** no resource tagged `T` is deleted, and the response reports the data source as
  blocked by the untagged pipeline

#### Scenario: Tagged data source with a differently-tagged dependent pipeline blocks the whole call
- **WHEN** a data source tagged `T` has a dependent pipeline tagged `U` (a different, live tag
  batch, not untagged), and `POST /api/workspace/teardown {tag: "T"}` is called
- **THEN** no resource tagged `T` is deleted, the `U`-tagged pipeline is left completely
  untouched, and the response reports the data source as blocked by that pipeline

#### Scenario: Tagging the dependent resolves the block
- **WHEN** the previously out-of-batch dependent pipeline is also tagged `T` and teardown is
  retried
- **THEN** the teardown succeeds and deletes the full tagged set including the pipeline

#### Scenario: Existing per-DataType delete guards still apply
- **WHEN** a DataType tagged `T` is bound to a caller-owned panel, or is still the linked
  auto-inferred schema of a data source that is NOT tagged `T` (untagged or differently tagged)
- **THEN** teardown is refused with that DataType reported as blocked, matching the same
  conflict reasons `DELETE /api/types/:id` already returns for these cases

#### Scenario: A tagged data source and its own tagged companion DataType are torn down together
- **WHEN** a data source tagged `T` has an auto-inferred companion DataType also tagged `T`
  (the default shape produced by every data-source create path), and
  `POST /api/workspace/teardown {tag: "T"}` is called
- **THEN** the source-link guard does not block on this pairing — both the data source and its
  companion DataType are deleted in the same call

### Requirement: Teardown is all-or-nothing
Validation (computing the tagged set and any blocking conflicts) and deletion SHALL run inside a
single database transaction. Either every resource in the tagged set is deleted, or none are.

#### Scenario: A blocked teardown deletes nothing, even for the unblocked portion of the tagged set
- **WHEN** a tagged set contains some resources with no conflicts and one resource that is
  blocked
- **THEN** none of the tagged set is deleted — not even the unblocked resources

### Requirement: Teardown supports a dry-run preview
`POST /api/workspace/teardown` SHALL accept an optional `dryRun: true` flag. When set, the same
validation and plan computation SHALL run, and the response SHALL report the same shape
(counts and/or conflicts) that a non-dry-run call would produce, but no resource SHALL be
deleted.

#### Scenario: Dry run reports would-be counts without deleting
- **WHEN** `POST /api/workspace/teardown {tag: "T", dryRun: true}` is called against a clean
  (unblocked) tagged set
- **THEN** the response reports the counts that would be deleted, `dryRun: true`, and no
  resource is actually deleted

#### Scenario: Dry run surfaces the same conflicts a real call would hit
- **WHEN** `POST /api/workspace/teardown {tag: "T", dryRun: true}` is called against a tagged set
  that has a blocking untagged dependent
- **THEN** the response reports the same conflict that a non-dry-run call would report

### Requirement: Teardown is idempotent
Calling teardown a second time with the same tag, after a successful first call, SHALL delete
nothing and report zero counts.

#### Scenario: Repeat teardown call is a no-op
- **WHEN** `POST /api/workspace/teardown {tag: "T"}` succeeds and is called again with the same
  tag
- **THEN** the second call returns `sourcesDeleted: 0, pipelinesDeleted: 0, typesDeleted: 0` and
  deletes nothing

### Requirement: Teardown is owner-scoped
Teardown SHALL only ever discover and delete resources owned by the calling user. A
foreign-owned resource carrying the same tag value SHALL never be discovered, reported, or
deleted, regardless of the RLS session context being correctly established.

#### Scenario: Foreign-owned resource with a matching tag is untouched
- **WHEN** user A calls `POST /api/workspace/teardown {tag: "T"}` and user B (not A) owns a
  data source, pipeline, or DataType also tagged `T`
- **THEN** user B's resource is not deleted, not counted, and not reported as a conflict — the
  response reflects only user A's owned resources tagged `T`

#### Scenario: Owner-scoping holds even when user A owns nothing with the tag
- **WHEN** user A calls `POST /api/workspace/teardown {tag: "T"}`, user A owns no resource
  tagged `T`, but user B owns several
- **THEN** the call succeeds with all-zero counts; user B's resources are unaffected

