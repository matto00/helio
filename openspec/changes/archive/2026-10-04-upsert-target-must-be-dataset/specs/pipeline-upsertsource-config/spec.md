## ADDED Requirements

### Requirement: Existing-source targets must be writable datasets
An `upsertsource` step's existing-source target SHALL be writable: owned by the pipeline owner AND of canonical source
kind `dataset`. A single shared predicate SHALL decide writability for every surface below, so they cannot disagree.
Step create and step config update SHALL reject an owned target of any other kind with HTTP 422 whose message names
the target (its id, its name and its kind). An unknown id, or a source owned by someone other than the pipeline owner,
SHALL keep the existing uniform "data source not found" 404 with no kind or name disclosed. An empty `dataSourceId`
SHALL remain an incomplete draft (savable, not runnable). Every create path SHALL be covered: the single-call pipeline
create, step add, step update, and every path that funnels into them (UI editor, MCP `add_pipeline_step`,
apply-proposal / `apply_pipeline_proposal`, patch-set apply).

#### Scenario: Creating a step targeting an owned CSV source is rejected
- **WHEN** the pipeline owner adds an `upsertsource` step whose target is `existingSource` with the id of a CSV source
  they own
- **THEN** the response is 422, the message names that source's id, name and kind, and no step is persisted

#### Scenario: Updating a step's target to a non-dataset source is rejected
- **WHEN** an existing `upsertsource` step's config is updated to target an owned REST source
- **THEN** the response is 422 naming the target and the stored config is unchanged

#### Scenario: A pipeline create with an inline non-dataset target is rejected atomically
- **WHEN** a single-call pipeline create (or apply-proposal) includes an `upsertsource` step targeting an owned SQL
  source
- **THEN** the response is 422 naming the target and no pipeline, step or Output is persisted

#### Scenario: A dataset target still passes
- **WHEN** the step targets a dataset owned by the pipeline owner
- **THEN** create and update succeed exactly as before

#### Scenario: A foreign or unknown target stays an indistinguishable 404
- **WHEN** the target id belongs to another tenant's CSV source, and separately to no source at all
- **THEN** both responses are the same 404 "data source not found", with no kind or name in either

### Requirement: Non-writable targets are reported by analyze and refused at execution
Pipeline analysis SHALL report a stored `upsertsource` step whose existing-source target is not a writable dataset as
that step's `validationError`, naming the target. Step preview, Output preview, dry run and real run SHALL refuse such
a step before any row is written, with HEL-1147's named 422 body `{message, code: "STEP_CONFIG_INVALID", stepId,
stepKind: "upsertsource", reason}` and a single WARN log line without a stack trace. A preview whose evaluated path
does not include the step SHALL be unaffected. Stored steps with such a target SHALL still read back cleanly through
every step listing.

#### Scenario: Analyze flags a stored non-dataset target
- **WHEN** a pipeline whose stored `upsertsource` step targets an owned CSV source is analyzed
- **THEN** that step's `validationError` names the target and says it is not a dataset

#### Scenario: Preview and dry run refuse with STEP_CONFIG_INVALID
- **WHEN** the step, an Output downstream of it, or the whole pipeline (dry run) is previewed or run
- **THEN** the response is 422 with `code: "STEP_CONFIG_INVALID"`, `stepId` equal to the upsert step's id,
  `stepKind: "upsertsource"`, and a `reason` naming the target

#### Scenario: A real run fails before writing
- **WHEN** a real run is submitted for that pipeline
- **THEN** the run ends `failed` with the same reason, and no row of any source is written

#### Scenario: A sibling branch still previews
- **WHEN** a step on a branch that does not pass through the invalid upsert step is previewed
- **THEN** the preview succeeds

#### Scenario: Stored invalid steps still list
- **WHEN** the steps of a pipeline holding such a step are listed
- **THEN** the listing succeeds and returns the step with its stored config
