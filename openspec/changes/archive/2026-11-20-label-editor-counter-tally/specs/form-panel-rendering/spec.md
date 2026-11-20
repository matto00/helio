## ADDED Requirements

### Requirement: A non-owner's compact counter tally is captioned as their own session change
When a compact counter form panel (exactly one field, a counter) is rendered for a user who is not the form's owner, the
tally SHALL start at 0 regardless of the field's `initialValue`, the counter SHALL show the caption
"Your net change this session" beneath its tally, and the caption SHALL be part of the
counter value's accessible description. The form's owner SHALL see no caption. A counter inside a multi-field form SHALL
show no caption for any user. Rendering the caption SHALL NOT cause any `/api/data-sources/*` request.

#### Scenario: Editor sees the caption
- **WHEN** a dashboard editor who is not the form's owner views a compact counter form panel
- **THEN** the caption "Your net change this session" is visible beneath the counter's tally
- **AND** the counter value's accessible description includes the caption
- **AND** no request to `/api/data-sources/*` is made

#### Scenario: Editor's tally ignores the initial value
- **WHEN** a user who is not the form's owner views a compact counter whose field has `initialValue: 10` and `step: 5`
- **THEN** the tally shows 0
- **AND** after one `+` the tally shows 5

#### Scenario: Owner sees no caption
- **WHEN** the form's owner views the same compact counter form panel
- **THEN** no caption is shown and the counter behaves as before, including starting at its `initialValue`

#### Scenario: Stacked counter has no caption
- **WHEN** a user who is not the form's owner views a form with a counter and at least one other field
- **THEN** no caption is shown
