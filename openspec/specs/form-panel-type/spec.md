# form-panel-type Specification

## Purpose
Defines the `form` panel kind: a dashboard panel that writes rather than reads, binding to a
`dataset` source and declaring an ordered list of input fields plus its submit behaviour. It is
the second panel kind requiring no Output binding, and the foundation the rest of the form-panel
epic (builder, renderers, submit path, counter chrome) is configured by.

## Requirements

### Requirement: A form panel is a registered panel kind that binds to a source

The system SHALL provide a panel kind with the discriminator `form`, registered in the panel
registry so every registry-derived consumer accepts it. A `form` panel SHALL bind to a
`dataset`-kind data source rather than to an Output, making it the second kind after `divider`
that requires no Output binding. Registering `form` SHALL NOT change the default panel type,
which remains `divider`.

#### Scenario: The registry accepts the form kind
- **WHEN** the panel registry's kind set is read
- **THEN** it contains `form` alongside `output`, `text`, `markdown`, `image`, and `divider`

#### Scenario: The default panel type is unchanged
- **WHEN** a panel is created with no `type` field at all
- **THEN** the created panel's type is `divider`, exactly as before this change

#### Scenario: A form panel requires no Output binding
- **WHEN** a `form` panel is created with a valid `dataSourceId` and no `outputId`
- **THEN** the panel is created successfully and no Output binding is required or persisted

### Requirement: A form panel config declares its dataset, its fields, and its submit behaviour

The system SHALL persist a `form` panel's config as three parts: `dataSourceId` (the bound
dataset source), `fields` (an ordered list of field entries), and `submit` (the submit
behaviour). Field order as authored SHALL be preserved across persistence and every read.
`submit.writeMode` SHALL be `append` — a form submit appends one row and never replaces the
dataset's contents.

#### Scenario: Field order is preserved
- **WHEN** a form panel is created with fields in a given order and then read back
- **THEN** the returned `fields` are in the same order as authored

#### Scenario: A non-append write mode is rejected
- **WHEN** a form panel is created with `submit.writeMode` set to `replace`
- **THEN** the request is rejected with 400 and the message names `append` as the accepted value

### Requirement: A form field references a declared dataset field and chooses a presentation control

Each entry in `fields` SHALL identify the dataset field it writes to by name (`sourceField`) and
SHALL choose a presentation `control` from `text`, `textarea`, `number`, `date`, `select`,
`checkbox`, `file`. A field entry MAY additionally carry `label`, `placeholder`, `helpText`,
`required`, `initialValue`, `step`, and — for `select` — `options`. That enumeration is
CLOSED: an unrecognized field attribute SHALL be rejected, never ignored or silently discarded.

The `control` vocabulary is a **presentation** concern and is deliberately orthogonal to the
dataset's own `DataFieldType` vocabulary (`string`, `integer`, `float`, `boolean`, `timestamp`,
`string-body`, `binary-ref`). A control is how a value is entered; a field type is what the
dataset declares the value to be. The two sets SHALL NOT be conflated, merged, or derived from
one another. A form field therefore never re-declares its own data type: the dataset's declared
schema remains the single authoritative source of a field's type, required-ness, and write-time
default, and a form field only references it and overrides presentation.

No form attribute may contradict that declaration, and the shape makes contradiction
structurally impossible rather than merely discouraged:

- `initialValue` SHALL be prefill only — it seeds the control before first input and SHALL NOT
  change what is stored for a field the submitted row omits. The dataset's declared `default`
  remains the only write-time fill.
- `required` SHALL be tighten-only. Absent means inherit the dataset declaration; `true` means
  additionally required at form level. `required: false` SHALL be rejected as malformed, so a
  form can never present a dataset-required field as optional.
- `step` SHALL be a positive number and SHALL be valid only alongside `control: "number"`; a
  `step` on any other control SHALL be rejected. A counter (the single-field compact
  configuration) SHALL be expressed as `control: "number"` carrying `step`, whose PRESENCE is
  the counter discriminator. `step` is accepted and persisted by this capability with no
  counter-rendering behaviour implied, exactly as `file` is accepted before upload semantics
  exist. Because `step` is in the attribute set above and `number` is in the control set, a
  counter requires a delta to NEITHER set. Any further attribute (for example `min`/`max`)
  would be an additive delta to this capability — additive, but a real spec change, not a
  silent extension.

#### Scenario: A field names a dataset field and a control
- **WHEN** a form panel is created with a field whose `sourceField` is `quantity` and whose `control` is `number`
- **THEN** the panel config round-trips both values unchanged

#### Scenario: An unrecognized field attribute is rejected
- **WHEN** a form panel is created with a field carrying an attribute outside the closed set above
- **THEN** the request is rejected with 400, and the attribute is never silently dropped from the persisted config

#### Scenario: A step on a non-number control is rejected
- **WHEN** a form panel is created with a `text` control carrying a `step`
- **THEN** the request is rejected with 400

#### Scenario: A step persists before any counter chrome exists
- **WHEN** a form panel is created with a `number` control carrying a positive `step`
- **THEN** the config persists and round-trips `step` unchanged, with no counter rendering implied by this capability

#### Scenario: An unknown control is rejected
- **WHEN** a form panel is created with a field whose `control` is not one of the seven accepted controls
- **THEN** the request is rejected with 400 and the message names the accepted controls

#### Scenario: A select field requires options
- **WHEN** a form panel is created with a `select` field carrying no `options`
- **THEN** the request is rejected with 400

#### Scenario: A form field carries no data type of its own
- **WHEN** a form panel's persisted config is read
- **THEN** no field entry carries a `DataFieldType`, and the field's type is resolvable only from the bound dataset's declared schema

#### Scenario: A field cannot loosen a dataset-declared requirement
- **WHEN** a form panel is created with a field carrying `required: false`
- **THEN** the request is rejected with 400, because requiredness may only be tightened

#### Scenario: A file-typed control persists before upload semantics exist
- **WHEN** a form panel is created with a `file` control
- **THEN** the config persists and round-trips unchanged, with no upload or storage behaviour implied by this capability

### Requirement: Form panel config is validated at create and patch time

The system SHALL reject a `form` panel whose `dataSourceId` is absent or empty, whose `fields`
contain a blank `sourceField`, or whose `fields` name the same `sourceField` more than once. The
system SHALL reject a `form` panel whose `dataSourceId` names a data source that does not exist
or that the caller does not own, with a not-found response rather than a server error, and
SHALL NOT leak the existence of another owner's data source.

Beyond those structural rules, the system SHALL validate a form config against the bound data source's
declared schema whenever a create or patch supplies a form config, evaluating the config that would result
after the patch is applied — never the patch alone, so a patch that only re-binds `dataSourceId` re-validates
the existing fields against the new dataset. Each rule below SHALL be rejected with a 400 whose message names
the offending field:

- The bound data source SHALL be `dataset`-kind; any other kind is rejected and the message names the actual
  kind.
- Every `sourceField` SHALL name a field the dataset declares.
- The field's `control` SHALL fit the declared type. The fitting sets are: `string` → `text`, `textarea`,
  `select`; `string-body` → `textarea`, `text`, `select`; `integer` and `float` → `number`, `select`, `text`;
  `boolean` → `checkbox`, `select`; `timestamp` → `date`, `text`, `select`; `binary-ref` → `file`. The first
  entry is the type's default control. A control outside the set is rejected and the message names the fitting
  controls.
- `options`, when present, SHALL be a non-empty JSON array in which every value is a valid value of the field's
  declared type (the same value rule the dataset applies to its own rows and defaults); anything else is
  rejected and the message names the first offending value.
- `initialValue`, when present and not null, SHALL be a valid value of the field's declared type.

These checks apply to the panel-creation API and the panel-patch API. The dashboard import path reconstructs
panels without them (as it does for every other create-time check today); a form imported with an inconsistent
config remains readable and is surfaced by the builder when opened.

#### Scenario: A form panel with no dataSourceId is rejected
- **WHEN** a `form` panel is created with an empty or absent `dataSourceId`
- **THEN** the request is rejected with 400 naming `dataSourceId` as required

#### Scenario: A duplicate sourceField is rejected
- **WHEN** a form panel is created with two field entries naming the same `sourceField`
- **THEN** the request is rejected with 400

#### Scenario: A cross-owner dataSourceId does not leak existence
- **WHEN** a form panel is created naming a `dataSourceId` owned by a different user
- **THEN** the response is a not-found error, not a forbidden error and not a server error

#### Scenario: A non-dataset source is rejected
- **WHEN** a form panel is created bound to a `csv`-kind source the caller owns
- **THEN** the request is rejected with 400 and the message names `csv`

#### Scenario: An undeclared sourceField is rejected
- **WHEN** a form panel is created bound to a dataset declaring `quantity` and `note`, with a field whose
  `sourceField` is `legacy`
- **THEN** the request is rejected with 400 and the message names `legacy`

#### Scenario: An unfit control is rejected
- **WHEN** a form panel is created with `control: checkbox` on a field the dataset declares as `string`
- **THEN** the request is rejected with 400 and the message names the fitting controls for `string`

#### Scenario: A fitting control is accepted
- **WHEN** a form panel is created with `control: text` on a field the dataset declares as `integer`
- **THEN** the request succeeds

#### Scenario: Wrongly typed options are rejected
- **WHEN** a form panel is created with a `select` on an integer field whose `options` is `[1, "two"]`
- **THEN** the request is rejected with 400 and the message names `"two"`

#### Scenario: Empty or non-array options are rejected
- **WHEN** a form panel is created with a `select` whose `options` is `[]` or is not an array
- **THEN** the request is rejected with 400

#### Scenario: A wrongly typed initialValue is rejected
- **WHEN** a form panel is created with `initialValue: "soon"` on a field the dataset declares as `timestamp`
- **THEN** the request is rejected with 400 and the message names the field

#### Scenario: Re-binding re-validates existing fields
- **WHEN** a form panel with field `quantity` is patched only to change `dataSourceId` to a dataset that does
  not declare `quantity`
- **THEN** the patch is rejected with 400 naming `quantity` and the panel is unchanged

#### Scenario: A consistent config round-trips unchanged
- **WHEN** a form panel is created whose every field is declared, fits, and carries valid typed options and
  initial values
- **THEN** the request succeeds and the config reads back byte-for-byte as sent

### Requirement: A form panel round-trips through creation and through dashboard export/import

A `form` panel created through the panel-creation API SHALL be readable with its
`dataSourceId`, field list (including order and every per-field attribute), and submit behaviour
byte-for-byte intact. A dashboard containing a `form` panel SHALL export and re-import with the
same config preserved, with no field, attribute, or ordering lost.

#### Scenario: Create then read preserves the whole config
- **WHEN** a `form` panel is created and then re-read (there is no authenticated per-panel GET; the read is the create response plus a repository-level re-read)
- **THEN** its `dataSourceId`, ordered `fields` with every attribute, and `submit` are identical to those sent

#### Scenario: Export then import preserves the whole config
- **WHEN** a dashboard containing a `form` panel is exported and the resulting snapshot is imported
- **THEN** the imported dashboard's form panel carries the same `dataSourceId`, ordered `fields`, and `submit` as the original

#### Scenario: A persisted form panel does not decode as another kind
- **WHEN** a stored `form` panel row is read back through the persistence layer
- **THEN** it decodes as a `form` panel, never silently as an `output` panel

#### Scenario: A stored config with an unrecognized attribute reads as unconfigured, not as an error
- **WHEN** a stored `form` panel's persisted config carries a field attribute outside the closed set (for example one written by a later version and then rolled back)
- **THEN** reading the panel succeeds and yields an empty, visibly-unconfigured form config with the failure logged, and never returns a server error

### Requirement: The agent-facing proposal path accepts form but cannot yet bind a source

The agent-facing dashboard-proposal surfaces SHALL accept `form` as a proposable panel type.
The proposal wire carries no **typed** field for a bound data source, so a proposal that supplies
no config SHALL be rejected by config validation for the same missing-`dataSourceId` reason as any
other unbound form panel. A proposal that supplies a bound source through the generic `config`
passthrough SHALL be created successfully, and SHALL remain subject to the same ownership
rejection as any other create path. The system SHALL NOT silently drop, skip, or auto-repair
either shape — every outcome is observable, not degraded.

This is a knowingly incomplete path, accepted deliberately and tracked as a separate follow-up
rather than closed here. It is recorded as a requirement so a later reader does not mistake an
agent-proposable panel kind that cannot bind a source for an oversight.

#### Scenario: An agent-proposed form panel fails loudly
- **WHEN** a dashboard proposal containing a `form` panel is applied
- **THEN** the apply is rejected with a 400 naming `dataSourceId` as required, and no panel is created

#### Scenario: The failure is not silent
- **WHEN** a dashboard proposal containing a `form` panel is applied
- **THEN** the response surfaces the rejection, and the proposal is not applied with the form panel quietly omitted

#### Scenario: A config-bound agent-proposed form panel is created
- **WHEN** a dashboard proposal contains a `form` panel whose generic `config` carries a valid `dataSourceId` the caller owns
- **THEN** the panel is created successfully

#### Scenario: A config-bound cross-owner dataSourceId is still rejected
- **WHEN** a dashboard proposal contains a `form` panel whose `config.dataSourceId` names a data source owned by another user
- **THEN** the apply is rejected with a not-found error and no panel is created
