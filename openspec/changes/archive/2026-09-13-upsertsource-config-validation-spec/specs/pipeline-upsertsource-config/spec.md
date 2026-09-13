## Purpose
Defines the config model and write-path validation contract for the future `upsertsource`
pipeline step, so its later engine, cycle-detection, and UI/MCP work share one config shape.

## ADDED Requirements

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

### Requirement: The upsertsource step is not yet creatable
The `upsertsource` config model and its write-path validator SHALL exist independently of the
pipeline step registry. The system SHALL continue to reject an attempt to create or add a
pipeline step of type `upsertsource` through the pipeline creation and step-addition APIs, until
a subsequent change registers a runnable step. That registration SHALL NOT land before a
validation-time check exists rejecting a pipeline that writes to a source it reads (cycle
detection) — a registered-but-cycle-unchecked write step is a correctness hazard, not merely an
unfinished feature.

#### Scenario: Creating a pipeline with an upsertsource step is rejected
- **WHEN** a pipeline is created with a step of type `"upsertsource"`
- **THEN** the request is rejected as an invalid step type
