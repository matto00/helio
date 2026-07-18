# panel-detail-modal Specification

## Purpose
The panel detail modal provides panel-level customization (appearance and data configuration) accessible from the panel actions menu and from a direct click on the panel card body.
## Requirements
### Requirement: Panel detail modal opens from the actions menu
The "Customize" action in the panel actions menu MUST open the panel detail modal for that panel. Panel body click is also a trigger — see the ADDED requirement below.

#### Scenario: Customize action opens the modal
- **WHEN** the user clicks "Customize" in a panel's actions menu
- **THEN** the panel detail modal opens with the panel's title in the header

### Requirement: Panel detail modal has Appearance and Data tabs
The modal MUST present an Appearance tab and a Data tab. The Appearance tab MUST be active by default **when in edit mode**. Tabs are not visible in view mode.

#### Scenario: Appearance tab is active on entering edit mode
- **WHEN** the user clicks Edit to enter edit mode
- **THEN** the Appearance tab is selected and its content is visible

#### Scenario: User switches to the Data tab in edit mode
- **WHEN** the user clicks the Data tab while in edit mode
- **THEN** the Data tab content is shown and Appearance tab content is hidden

### Requirement: Data tab shows a placeholder
The Data tab MUST display a placeholder message indicating data source connectivity is not yet available.

#### Scenario: Data tab shows placeholder text
- **WHEN** the Data tab is active
- **THEN** a message such as "Connect a data source to display real content" is visible

### Requirement: Modal dismisses on Escape, backdrop click, and Cancel
The modal MUST close when the user presses Escape (in view mode), clicks the backdrop (in view mode), or clicks the close (✕) button — with a discard warning if there are unsaved changes and the modal is in edit mode. In edit mode, Escape and Cancel return to view mode (not close the modal); see the `panel-edit-mode-save-cancel` capability for the full Cancel/Esc flow.

#### Scenario: Escape closes the modal from view mode
- **GIVEN** the modal is in view mode
- **WHEN** the user presses Escape
- **THEN** the modal closes immediately

#### Scenario: Backdrop click closes the modal from view mode
- **GIVEN** the modal is in view mode and no changes have been made
- **WHEN** the user clicks outside the modal content area
- **THEN** the modal closes

#### Scenario: Dismiss with unsaved changes from edit mode shows a warning
- **GIVEN** the user has changed a value in edit mode
- **WHEN** the user presses Escape or clicks Cancel
- **THEN** an inline discard warning is shown instead of closing or returning to view mode immediately

#### Scenario: Confirming discard returns to view mode
- **GIVEN** the discard warning is shown
- **WHEN** the user confirms discard
- **THEN** the modal transitions to view mode and changes are not persisted

### Requirement: Save persists appearance and closes the modal
Clicking Save MUST dispatch the appearance update to the backend and transition the modal to view mode on success. The modal SHALL NOT close after a save.

#### Scenario: Save submits appearance changes and returns to view mode
- **WHEN** the user modifies appearance values and clicks Save
- **THEN** the appearance update is submitted to the backend
- **AND** the modal transitions to view mode (tab bar hidden, footer hidden)
- **AND** the modal does not close

### Requirement: Panel detail modal opens from the panel body click
The panel detail modal MUST also open when the user clicks the panel card body (not on an interactive control), as defined in the `panel-body-click` capability. Both triggers open the same modal.

#### Scenario: Panel body click opens the modal
- **WHEN** the user clicks the panel body (not on a drag handle, actions menu, title input, or resize handle)
- **THEN** the panel detail modal opens for that panel

### Requirement: Detail modal is full-screen on phone and dismissible without hover
Below the 430px phone breakpoint (ratified in `DESIGN.md` §4) the panel detail modal SHALL render
full-screen. It MUST be dismissible without any hover-dependent target: a persistent, tappable close
control SHALL be visible, and existing dismissal paths (Escape, backdrop where applicable) remain.
Desktop and tablet (≥768px) modal presentation is unchanged.

#### Scenario: Phone viewport — modal is full-screen
- **WHEN** the panel detail modal opens below the 430px phone breakpoint
- **THEN** the modal occupies the full viewport

#### Scenario: Phone viewport — dismissible by tap
- **WHEN** the modal is open below the 430px phone breakpoint in view mode
- **THEN** a visible close control dismisses the modal on tap, with no hover required to reveal it

#### Scenario: Desktop presentation unchanged
- **WHEN** the modal opens at a viewport of 768px or wider
- **THEN** the modal presentation is unchanged from current behavior

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

