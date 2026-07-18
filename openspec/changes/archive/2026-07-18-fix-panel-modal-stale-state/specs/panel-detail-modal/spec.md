## ADDED Requirements

### Requirement: Modal form state always reflects the currently shown panel
The panel detail modal's form state MUST be re-initialized from the target panel whenever the panel it
is showing changes, including a direct switch from one panel's open modal to another panel without an
intervening close. Every form field — title, appearance (background, color, transparency), chart
appearance, data binding (data type, field mapping, refresh interval, aggregation), and every
subtype-specific config section — MUST show the target panel's current persisted values after such a
switch. Save MUST only ever write values that were staged for the panel the modal is currently
showing; no save path SHALL write one panel's staged values onto another panel.

#### Scenario: Direct switch shows the target panel's values
- **GIVEN** panel A's edit form is open in the panel detail modal with A's values staged
- **WHEN** the modal switches directly to panel B without closing
- **THEN** every form field shows panel B's current persisted values, not panel A's

#### Scenario: Save after a direct switch cannot carry the previous panel's values
- **GIVEN** panel A's edit form was open and the modal switched directly to panel B
- **WHEN** the user saves panel B's form without editing any field
- **THEN** no update containing panel A's staged values is dispatched against panel B's id

#### Scenario: Unsaved edits do not survive a direct switch
- **GIVEN** panel A's edit form has unsaved changes
- **WHEN** the modal switches directly to panel B
- **THEN** panel A's unsaved changes are discarded (matching close-then-reopen behavior) and panel B's
  form starts clean from B's persisted values
