# pipeline-upsertsource-config Specification

## Purpose
Defines the config model and write-path validation contract for the future `upsertsource`
pipeline step, so its later engine, cycle-detection, and UI/MCP work share one config shape.

## Requirements

### Requirement: upsertsource config model
The system SHALL define an `upsertsource` step config with two fields: `target`, a discriminated
value of either a new-source-name form or an existing-data-source-id form; and `mode`, one of
`"append"` or `"replace"`. `target` SHALL be represented on the wire as `{"kind": "newSource",
"name": <string>}` or `{"kind": "existingSource", "dataSourceId": <string>}`.

#### Scenario: New-source target round-trips
- **WHEN** a config `{"target":{"kind":"newSource","name":"Weekly Signups"},"mode":"append"}` is
  decoded
- **THEN** the decoded value carries a new-source target named `"Weekly Signups"` and mode
  `"append"`

#### Scenario: Existing-source target round-trips
- **WHEN** a config `{"target":{"kind":"existingSource","dataSourceId":"ds-1"},"mode":"replace"}`
  is decoded
- **THEN** the decoded value carries an existing-source target with id `"ds-1"` and mode
  `"replace"`

### Requirement: Read-path config decoding is tolerant of absent or legacy values
Decoding a persisted `upsertsource` config SHALL NOT fail when `target` or `mode` is absent —
an absent `target` SHALL decode to an incomplete-draft value and an absent `mode` SHALL decode to
`"append"`. A present value of the wrong JSON type SHALL still fail to decode.

#### Scenario: A step with no config configured yet still reads
- **WHEN** a persisted `upsertsource` config of `{}` is decoded
- **THEN** decoding succeeds, producing an incomplete-draft target and mode `"append"`

#### Scenario: A wrong-typed present value fails to decode
- **WHEN** a persisted config `{"target":"ds-1"}` (a string instead of an object) is decoded
- **THEN** decoding fails

### Requirement: Write-path validation rejects malformed or unsupported config values
The system SHALL provide a strict write-path validator for an `upsertsource` config that rejects,
with a named and typed message, any of: a non-object top-level config; a `target` that is not an
object; a `target.kind` other than `"newSource"` or `"existingSource"`; a `target.name` or
`target.dataSourceId` that is not a string; a `mode` that is not a string; and a `mode` string that
is not `"append"` or `"replace"`. An absent `target` or `mode` SHALL NOT be rejected — an
incomplete draft is not a write-time error.

#### Scenario: A valid config is accepted
- **WHEN** the write-path validator checks
  `{"target":{"kind":"existingSource","dataSourceId":"ds-1"},"mode":"replace"}`
- **THEN** no validation problem is reported

#### Scenario: An incomplete draft is accepted
- **WHEN** the write-path validator checks `{}`
- **THEN** no validation problem is reported

#### Scenario: An unrecognised target kind is rejected
- **WHEN** the write-path validator checks
  `{"target":{"kind":"otherThing","dataSourceId":"x"}}`
- **THEN** a validation problem is reported naming `"otherThing"`

#### Scenario: An unsupported mode is rejected rather than silently defaulted
- **WHEN** the write-path validator checks
  `{"target":{"kind":"existingSource","dataSourceId":"ds-1"},"mode":"upsert"}`
- **THEN** a validation problem is reported naming `"upsert"` and the supported values
  `"append"`/`"replace"`

#### Scenario: A wrong-typed field is rejected
- **WHEN** the write-path validator checks `{"target":{"kind":"newSource","name":7}}`
- **THEN** a validation problem is reported

### Requirement: Existing-source targets are ownership-checked without a cross-tenant oracle
The system SHALL provide an ownership check for an existing-source target that resolves to "not
found" both when the referenced data source does not exist and when it exists but is owned by a
different caller, using the same message in both cases. An empty `dataSourceId` SHALL be treated
as an incomplete draft rather than a lookup. A new-source target SHALL always pass this check —
there is nothing to own yet.

#### Scenario: A caller-owned existing source passes
- **WHEN** the ownership check runs for an existing-source target the caller owns
- **THEN** no problem is reported

#### Scenario: An unknown id and another tenant's id report the same way
- **WHEN** the ownership check runs for an existing-source target naming a data source owned by a
  different caller, and separately for a target naming a wholly unknown id
- **THEN** both report "data source not found", identical in shape, with no signal distinguishing
  "exists under another owner" from "does not exist"

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
