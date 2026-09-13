# pipeline-upsertsource-execution Specification

## Purpose
Defines how a pipeline run executes an `upsertsource` step: when and how rows are written into a dataset source,
under whose identity, with what validation, and how the rest of the pipeline tooling treats the step.

## Requirements

### Requirement: upsertsource is a creatable step kind
The pipeline creation, step-addition and step-update APIs SHALL accept a step of type `upsertsource`, applying its
strict config validation and, for an existing-source target, the "data source not found" ownership check. Step
types `convertformat`, `analyzewithai` and `generatetext` SHALL still be rejected as invalid step types.

#### Scenario: Creating a pipeline with an upsertsource step succeeds
- **WHEN** an owner creates a pipeline with an `upsertsource` step targeting a dataset they own
- **THEN** the pipeline and step are persisted

#### Scenario: A grantee cannot target a dataset the pipeline owner does not own
- **WHEN** an editor grantee adds an `upsertsource` step targeting a dataset the grantee owns but the pipeline owner
  does not
- **THEN** the request is rejected with "data source not found"

#### Scenario: Another tenant's dataset cannot be targeted
- **WHEN** a caller adds an `upsertsource` step targeting a dataset owned by someone else
- **THEN** the request is rejected with "data source not found"

#### Scenario: Other write-back ops stay rejected
- **WHEN** a pipeline is created with a step of type `generatetext`
- **THEN** the request is rejected as an invalid step type

### Requirement: Write-back cycles are rejected once the step is creatable
Every pipeline write path covered by `pipeline-cycle-detection` SHALL reject, through the public API, an
`upsertsource` step whose target is a source the same pipeline reads (direct) or a source that transitively feeds
it (transitive).

#### Scenario: Direct cycle via the API
- **WHEN** a pipeline reading dataset D adds an `upsertsource` step targeting D through the API
- **THEN** the request is rejected and nothing is persisted

#### Scenario: Transitive cycle via the API
- **WHEN** pipeline P1 reads A and writes B, and pipeline P2 reading B adds an `upsertsource` step targeting A
- **THEN** the request is rejected and nothing is persisted

### Requirement: The step passes rows through and writes only after a successful run
An `upsertsource` step SHALL output its input rows unchanged. Its write SHALL be applied only after every step in
the run evaluated successfully, only for a non-dry run, and only when no error-severity assertion blocked the run.
Previews and dry runs SHALL NOT write.

#### Scenario: A later failing step prevents the write
- **WHEN** a run's `upsertsource` step evaluates and a different step in the same run then fails
- **THEN** the run fails and the target dataset is unchanged

#### Scenario: Preview does not write
- **WHEN** a step preview or dry run is executed for a pipeline with an `upsertsource` step
- **THEN** the target dataset is unchanged

### Requirement: Append and replace modes
In `append` mode the rows SHALL be added after the dataset's existing rows, leaving existing rows unchanged. In
`replace` mode the dataset's full row set SHALL be swapped for the rows such that a concurrent reader observes
either the complete prior row set or the complete new row set, never an empty or partial set.

#### Scenario: Replace with zero rows clears the dataset
- **WHEN** a run in `replace` mode writes zero rows to an existing dataset
- **THEN** the dataset has zero rows

#### Scenario: Append preserves existing rows
- **WHEN** a run appends 2 rows to a dataset with 3 rows
- **THEN** the dataset has 5 rows and the original 3 are unchanged

#### Scenario: Replace is never observed half-applied
- **WHEN** a reader repeatedly reads a dataset while a run replaces its rows
- **THEN** every read returns either exactly the old row set or exactly the new row set

### Requirement: A failed write fails the run with nothing committed
All writes of a run SHALL commit together or not at all. If any write fails, the run SHALL be recorded as failed
with an error naming the step and reason, no row of any write in that run SHALL be committed, and no Output node
snapshot SHALL be updated by that run.

#### Scenario: Mid-write failure commits zero rows
- **WHEN** a failure occurs after some rows of a run's writes were issued but before commit
- **THEN** the run is failed and every target dataset holds exactly its pre-run rows

### Requirement: Rows are validated against the target's declared schema
Rows SHALL be matched to the target's declared fields by column name and validated against the declared schema
before commit. A column absent from a row SHALL be treated as null. A row column not declared by the dataset, a
value not matching its declared type, a missing required value, or a resulting row count above the dataset row
limit SHALL fail the run with an error naming the offending columns, values or limit. Values SHALL NOT be coerced
or truncated to fit.

#### Scenario: Undeclared column fails the run
- **WHEN** upstream rows carry a column `extra` the target dataset does not declare
- **THEN** the run fails with an error naming `extra` and the dataset is unchanged

#### Scenario: Type mismatch fails the run
- **WHEN** a row supplies a text value for a field declared as a number
- **THEN** the run fails with a field-level error and the dataset is unchanged

#### Scenario: Row limit fails the run
- **WHEN** a write would leave the dataset with more rows than the dataset row limit
- **THEN** the run fails with an error naming the limit and the dataset is unchanged

### Requirement: Writes run as the pipeline owner under row-level security
A write SHALL be performed as the pipeline's owner, regardless of whether the run was started by the owner, an
editor grantee, a token, a hook or the scheduler, and SHALL be subject to the same row-level security as an
owner's own row-write request. A write SHALL never land in a dataset the pipeline owner does not own.

#### Scenario: Grantee-triggered run writes into the owner's dataset
- **WHEN** an editor grantee runs a pipeline whose `upsertsource` step targets the owner's dataset
- **THEN** the rows land in the owner's dataset

#### Scenario: Scheduled run writes as the owner
- **WHEN** the scheduler fires a pipeline with an `upsertsource` step
- **THEN** the rows land in the owner's dataset

#### Scenario: A target that is not the owner's is never written
- **WHEN** a persisted step's existing-source target refers to a dataset not owned by the pipeline owner
- **THEN** the run fails with "data source not found" and that dataset is unchanged

### Requirement: New-source targets create an owner-owned dataset once
On the first successful run of a step with a new-source target, the system SHALL create a dataset source with the
target's name, owned by the pipeline owner, whose declared schema is inferred from the written rows with every
field optional, and SHALL rewrite that step's target to the created dataset's id in the same commit. Subsequent
runs SHALL write to that dataset. A new-source target with a blank name SHALL fail the run as unconfigured.

#### Scenario: Zero rows with a new-source target creates nothing
- **WHEN** a run's `upsertsource` step with a new-source target receives zero rows
- **THEN** no dataset is created and the step's target is unchanged

#### Scenario: Concurrent first runs create one dataset
- **WHEN** two runs of the same pipeline with a new-source target commit concurrently
- **THEN** exactly one dataset is created and both runs' rows land in it

#### Scenario: A step edited during the run is not overwritten
- **WHEN** the step's config is changed by a user between the run's start and its write
- **THEN** the run fails, nothing is committed, and the user's config is kept

#### Scenario: Second run reuses the created dataset
- **WHEN** a pipeline with a new-source target named "Signups" runs successfully twice in append mode
- **THEN** exactly one dataset named "Signups" exists, owned by the pipeline owner, and the step targets its id

### Requirement: Write-back runs require the in-process engine
When the configured execution engine cannot perform write-back, a run of a pipeline with an enabled `upsertsource`
step SHALL be rejected at submission with an error naming the step type, and SHALL write nothing.

#### Scenario: Non-in-process engine rejects the run
- **WHEN** a pipeline with an `upsertsource` step is submitted to an engine without write-back support
- **THEN** the submission is rejected with an error naming `upsertsource`

### Requirement: Analyze treats upsertsource as schema pass-through
Pipeline analysis SHALL report an `upsertsource` step's output schema as equal to its input schema, and SHALL
report an unconfigured target as a configuration problem rather than an unknown op.

#### Scenario: Downstream schema equals input
- **WHEN** a pipeline is analyzed with a step following an `upsertsource` step
- **THEN** that step's input schema equals the `upsertsource` step's input schema

### Requirement: The editor never disguises an unrecognised step type
The pipeline editor SHALL render a persisted step whose type it does not recognise as an explicit, read-only
unsupported step showing its type, SHALL NOT present it as a different step type, and SHALL NOT send a config
update for it.

#### Scenario: Unknown step type renders read-only
- **WHEN** the editor loads a pipeline containing an `upsertsource` step
- **THEN** that step is shown as unsupported `upsertsource`, with no editable config, and the page does not crash
