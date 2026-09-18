## MODIFIED Requirements

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
