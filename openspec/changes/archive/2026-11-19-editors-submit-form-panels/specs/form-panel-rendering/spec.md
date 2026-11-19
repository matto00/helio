## MODIFIED Requirements

### Requirement: The renderer loads the declared schema and surfaces its loading and failure states

Rendering requires the bound dataset's declared schema. When the signed-in user is the form's owner the renderer SHALL
load it from the dataset's schema route; otherwise it SHALL load only the form's bound field declarations from the
panel's form-schema route and SHALL NOT request any `/api/data-sources/*` route. While it loads, the panel body SHALL
show a loading state; if it cannot be loaded, the panel body SHALL show an inline error with a retry action rather than
rendering fields from the config alone.

#### Scenario: Schema fails to load
- **WHEN** the declared schema request fails
- **THEN** the panel body shows an error with a retry action and no field controls

#### Scenario: A non-owner's form loads its schema through the panel
- **WHEN** a dashboard editor who is not the form's owner opens a dashboard with a form panel
- **THEN** the form's fields render from the panel form-schema response and no `/api/data-sources/*` request is made

## ADDED Requirements

### Requirement: The form body is offered to dashboard owners and editors, not to viewers

On a dashboard the caller owns or holds `editor` access to, a configured form panel SHALL render its fields and submit
controls. On a dashboard whose access role is `viewer`, the panel SHALL render no fields or submit control and SHALL
show a status saying only editors can submit the form.

#### Scenario: Editor sees the submit control
- **WHEN** an editor grantee opens a shared dashboard containing a configured form panel
- **THEN** the form's fields and its submit control are shown

#### Scenario: Viewer sees no submit control
- **WHEN** a viewer grantee opens the same dashboard
- **THEN** no field or submit control is shown and the panel says only editors can submit it
