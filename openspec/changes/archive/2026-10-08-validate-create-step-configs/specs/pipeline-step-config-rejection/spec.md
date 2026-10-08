## ADDED Requirements

### Requirement: Single-call pipeline create applies the same step-configuration rejection as every other write surface

Creating a pipeline together with its steps in one request SHALL reject any supplied step whose configuration the
step create/update surfaces would reject, for every step kind, with the same 422 status and a message that names the
offending step (by its client id) and carries the same rejection message those surfaces return. The whole request
SHALL fail atomically: no pipeline, root, step or Output from that request SHALL be persisted.

A pipeline proposal apply carrying such a step SHALL likewise fail with 422 and persist nothing. A patch-set
pipeline-create edit carrying such a step SHALL be rejected with a 422 response, naming the edit and the step, before
any edit in the patch set is applied, and previewing such a patch set SHALL be rejected the same way. A configuration that is not parseable at all keeps its existing 400 response. Server-generated
steps (first-run planning, shape templates) SHALL continue to be created successfully.

This requirement SHALL NOT introduce read-path or analyze-path validation: a stored step whose configuration would now
be rejected on write SHALL still load and still be analyzed exactly as before.

#### Scenario: Compute step calling an unknown function is rejected at single-call create
- **GIVEN** a data source owned by the caller
- **WHEN** the caller creates a pipeline in one request whose `compute` step has expression `$a + nosuchfn($b)`
- **THEN** the response status is 422
- **AND** the message names the step's client id, the unrecognised function `nosuchfn`, and the supported functions
- **AND** no pipeline is created

#### Scenario: A wrong-shape config of a non-compute kind is rejected at single-call create
- **GIVEN** a data source owned by the caller
- **WHEN** the caller creates a pipeline in one request with a `cast` step whose `casts` is an array
- **THEN** the response status is 422
- **AND** the message names `casts`
- **AND** no pipeline is created

#### Scenario: An invalid aggregation is rejected at single-call create
- **GIVEN** a data source owned by the caller
- **WHEN** the caller creates a pipeline in one request with an `aggregate` step using an unsupported `fn`
- **THEN** the response status is 422
- **AND** no pipeline is created

#### Scenario: A valid multi-step create still succeeds
- **WHEN** the caller creates a pipeline in one request with filter, aggregate (object-form `groupBy`), sort and select
  steps in their documented shapes
- **THEN** the pipeline and its steps are created

#### Scenario: An empty compute draft is still accepted at single-call create
- **WHEN** the caller creates a pipeline in one request with a `compute` step whose `column` and `expression` are empty
- **THEN** the pipeline is created
- **AND** the incompleteness is reported by analyze, not by the write

#### Scenario: A patch-set pipeline-create edit with an invalid step config is rejected
- **WHEN** a patch set containing a pipeline-create edit whose `compute` step calls an unknown function is applied
- **THEN** the apply response status is 422 and the message names the edit and the step
- **AND** no pipeline is created
- **AND** no other edit in that patch set is applied

#### Scenario: A legacy stored invalid step still reads and analyzes
- **GIVEN** a stored `compute` step whose expression calls an unknown function, written before this rejection existed
- **WHEN** the pipeline's steps are listed and the pipeline is analyzed
- **THEN** the step is returned
- **AND** analyze reports it as a step configuration problem rather than failing the request
