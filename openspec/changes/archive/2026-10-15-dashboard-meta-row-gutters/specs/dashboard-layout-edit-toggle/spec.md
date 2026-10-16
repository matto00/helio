## Purpose

An explicit, dashboard-wide layout edit toggle on the desktop dashboard grid: panels are moved and resized only while it is on, and the layout history controls live inside it. Distinct from `panel-edit-mode`, which is a single panel's detail-modal edit view and is unaffected by this toggle.

## ADDED Requirements

### Requirement: Drag and resize are available only in edit mode
The desktop dashboard grid SHALL allow dragging and resizing panels only while layout edit mode is on, and SHALL NOT show drag or resize handles while it is off. Edit mode SHALL be off when a dashboard is opened or the selected dashboard changes. All other panel interactions (title edit, detail, delete) SHALL behave the same in and out of edit mode. Entering or leaving edit mode SHALL NOT write the layout; staged changes SHALL keep being persisted by the existing auto-save, Save now and unmount flush.

#### Scenario: Viewing
- **WHEN** a user opens a dashboard
- **THEN** panels cannot be dragged or resized and no drag or resize handle is shown

#### Scenario: Editing
- **WHEN** the user activates Edit layout
- **THEN** panels can be dragged and resized
- **AND** the toggle is announced as pressed and reads "Done"

#### Scenario: Leaving edit mode keeps staged changes
- **WHEN** the user drags a panel in edit mode and then activates Done
- **THEN** the dragged position stays and is persisted by the next flush

#### Scenario: Switching dashboards
- **WHEN** edit mode is on and the user switches to another dashboard
- **THEN** edit mode is off on the newly opened dashboard

### Requirement: Escape leaves edit mode
While edit mode is on, pressing Escape SHALL turn edit mode off, unless focus is inside an editable element, a dialog, popover or menu is open, or an inner handler has already handled the event (`defaultPrevented`).

#### Scenario: Escape
- **WHEN** edit mode is on and the user presses Escape on the grid
- **THEN** edit mode turns off

#### Scenario: Escape closes an open menu first
- **WHEN** edit mode is on and a panel's menu is open and the user presses Escape
- **THEN** the menu closes and edit mode stays on

### Requirement: Tidy layout compacts panels upward only when the user asks
While edit mode is on, the meta row SHALL offer a "Tidy layout" action that operates on the dashboard's saved (authored) layout, breakpoint by breakpoint, considering only entries for the dashboard's live panels:
- a breakpoint with no authored entries, or one the layout resolver treats as unauthored (an entry out of bounds), SHALL be left exactly as stored;
- a partially authored breakpoint (some live panels have no stored entry) SHALL have only its stored entries moved and SHALL gain no entries, so the positions derived for the panels without entries are never written;
- a fully authored breakpoint SHALL have its entries moved.
Moving an entry SHALL place it at the highest row where it overlaps no other stored entry, without changing its column, width or height and without changing the top-to-bottom order of entries. Stored entries for panels not currently loaded SHALL be kept unchanged. The action SHALL be recorded as one layout-history entry, so a single undo restores the previous layout at every breakpoint, and the result SHALL be persisted only by the normal layout save path. It SHALL be disabled when no stored entry at any breakpoint would move. The application SHALL NOT compact or rewrite a saved layout at any other time (on load, on open, on a timer, or on leaving edit mode).

#### Scenario: Tidy removes a gap
- **WHEN** a fully authored breakpoint has a panel with 4 empty rows above it in its column and the user activates Tidy layout
- **THEN** that panel moves up by 4 rows and no panels overlap

#### Scenario: Unauthored breakpoint
- **WHEN** a breakpoint has no stored entries (its positions are derived) and the user activates Tidy layout
- **THEN** that breakpoint's stored layout is unchanged and still has no entries

#### Scenario: Partially authored breakpoint
- **WHEN** a breakpoint stores entries for some panels only, with a gap among them, and the user activates Tidy layout
- **THEN** the stored entries move up to close the gap and no entry is added for the panels without one

#### Scenario: Undo tidy
- **WHEN** the user activates Tidy layout and then presses `Cmd/Ctrl+Z`
- **THEN** every breakpoint's layout is exactly what it was before the tidy

#### Scenario: Opening a dashboard with gaps
- **WHEN** a user opens a dashboard whose saved layout has gaps
- **THEN** the gaps render as saved and no layout write is sent

#### Scenario: Nothing to tidy
- **WHEN** no stored entry at any breakpoint would move
- **THEN** Tidy layout is disabled
