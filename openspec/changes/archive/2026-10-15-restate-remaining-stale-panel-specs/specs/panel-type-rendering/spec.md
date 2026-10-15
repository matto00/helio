## MODIFIED Requirements

### Requirement: Panel type selector includes markdown option
The panel type selector used when creating a panel SHALL include `markdown` as a selectable option alongside the
other creatable types. A panel's type is fixed at creation: no panel update path accepts a `type` change.

#### Scenario: Markdown appears in type selector
- **WHEN** the panel type selector is opened
- **THEN** `markdown` is listed as a valid selectable type

### Requirement: Panel type selector includes image option
The panel type selector used when creating a panel SHALL include `image` as a selectable option alongside the
other creatable types. A panel's type is fixed at creation: no panel update path accepts a `type` change.

#### Scenario: Image appears in type selector
- **WHEN** the panel type selector is opened
- **THEN** `image` is listed as a valid selectable type
