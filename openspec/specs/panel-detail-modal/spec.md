# panel-detail-modal Specification

## Purpose
The panel detail modal provides panel-level customization (appearance and data configuration) accessible from the panel actions menu and from a direct click on the panel card body.

## Requirements

### Requirement: Panel detail modal opens from the actions menu
The "Customize" action in the panel actions menu MUST open the panel detail modal for that panel. Panel body click is also a trigger — see the ADDED requirement below.

#### Scenario: Customize action opens the modal
- **WHEN** the user clicks "Customize" in a panel's actions menu
- **THEN** the panel detail modal opens with the panel's title in the header

### Requirement: Modal dismisses on Escape, backdrop click, and Cancel
The modal MUST close when the user presses Escape (in view mode), clicks the backdrop (in view
mode), or clicks the close (✕) button (in view mode) — with a discard warning if there are
unsaved changes and the modal is in edit mode. In edit mode, Escape, the close (✕) button,
backdrop click, and Cancel all return to view mode (not close the modal) — including after
confirming the discard warning; see the `panel-edit-mode-save-cancel` capability for the full
Cancel/Esc flow.

HEL-716: the close (✕) button previously closed the modal outright from edit mode — both when
clicked with no unsaved changes, and after confirming the discard warning — unlike Escape,
backdrop click, and Cancel, which always returned to view mode in both of those cases. Migrating
onto the shared `Modal` primitive unifies its three dismiss vectors (close button, backdrop
click, Escape) behind a single `onClose` callback with no way to distinguish which vector
triggered it, so the close button's distinct "closes outright" behavior could not survive
alongside that unification. It now matches Escape/backdrop/Cancel: dismissing from edit mode —
by any vector, in either the clean or the dirty-then-confirmed case — always returns to view
mode rather than closing the modal component. Only a dismiss from view mode actually closes it.

#### Scenario: Escape closes the modal from view mode
- **GIVEN** the modal is in view mode
- **WHEN** the user presses Escape
- **THEN** the modal closes immediately

#### Scenario: Backdrop click closes the modal from view mode
- **GIVEN** the modal is in view mode and no changes have been made
- **WHEN** the user clicks outside the modal content area
- **THEN** the modal closes

#### Scenario: Close (✕) button closes the modal from view mode
- **GIVEN** the modal is in view mode
- **WHEN** the user clicks the close (✕) button
- **THEN** the modal closes immediately

#### Scenario: Close (✕) button with no unsaved changes returns to view mode from edit mode
- **GIVEN** the modal is in edit mode with no unsaved changes
- **WHEN** the user clicks the close (✕) button
- **THEN** the modal transitions to view mode
- **AND** the modal does not close

#### Scenario: Dismiss with unsaved changes from edit mode shows a warning
- **GIVEN** the user has changed a value in edit mode
- **WHEN** the user presses Escape, clicks the close (✕) button, or clicks Cancel
- **THEN** an inline discard warning is shown instead of closing or returning to view mode immediately

#### Scenario: Confirming discard returns to view mode, regardless of which vector triggered it
- **GIVEN** the discard warning is shown (triggered by Escape, the close (✕) button, backdrop
  click, or Cancel)
- **WHEN** the user confirms discard
- **THEN** the modal transitions to view mode and changes are not persisted
- **AND** the modal does not close

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

### Requirement: Modal closes automatically when its backing panel is removed
The panel detail modal SHALL close automatically, rather than continue to render, once the panels
list is known up to date (a successfully-loaded panels list) and no longer contains the panel
backing it — for any reason, including the panel being deleted from another surface, deleted by
another actor (a second tab, an MCP/agent apply, or a proposal apply), or the parent dashboard
being removed. This applies regardless of which mode (view or edit) the modal was in, including
when the modal has unsaved edits — the auto-close bypasses the ordinary discard-confirmation
prompt in this case, since the panel itself no longer exists and there is nothing left to save.
The modal SHALL NOT render with an undefined backing panel at any time, including during a
transient panels-list loading or failed-refetch state — during such a transient state the modal is
not rendered (it is not visible to the user), but it SHALL NOT be permanently dismissed either: its
underlying "which panel is this for" state SHALL be preserved through the transient state, so that
if the panels list subsequently loads successfully with the panel still present, the modal is shown
again for that same panel. The modal is only permanently closed once the list is confirmed
successfully loaded and still missing the panel. (Any in-progress unsaved edits within the modal are
not preserved across this not-rendered window regardless of outcome — out of scope for this
requirement; see design.md.)

#### Scenario: Modal closes when its own panel is deleted
- **GIVEN** a panel's detail modal is open
- **WHEN** that same panel is deleted
- **THEN** the modal closes automatically
- **AND** no error is thrown

#### Scenario: Modal closes when its panel is removed by another actor
- **GIVEN** a panel's detail modal is open
- **WHEN** the backing panel is removed from the panels list by a source other than this modal's own
  interactions (e.g. a concurrent update), and the panels list has finished loading successfully
  without the panel present
- **THEN** the modal closes automatically
- **AND** no error is thrown

#### Scenario: Modal closes without a discard prompt when open in edit mode with unsaved changes
- **GIVEN** a panel's detail modal is open in edit mode with unsaved changes
- **WHEN** the backing panel is removed from the panels list (panels list successfully reloaded
  without it)
- **THEN** the modal closes automatically
- **AND** no discard-confirmation prompt is shown
- **AND** no error is thrown

#### Scenario: Modal recovers, rather than being permanently dismissed, after a transient panels-list refetch failure
- **GIVEN** a panel's detail modal is open
- **WHEN** the panels list enters a loading or failed state (e.g. a transient refetch failure)
- **THEN** no error is thrown
- **WHEN** the panels list subsequently loads successfully with the panel still present
- **THEN** the modal is shown again for that same panel (it was not permanently closed by the
  transient state)

### Requirement: Output-kind panel sheet has no binding controls; content-kind panels are unaffected
For an output-kind panel, the panel detail modal (the "Panel sheet") SHALL show title override, appearance, a link to the panel's Output on its pipeline page, a "Swap output" action, and a placements note ("used on N dashboards") — it SHALL NOT show a field-mapping, aggregation, or any other visualization-configuration control, and SHALL have no "Data" tab. Content-kind panels (text, markdown, image, divider) are unaffected by this requirement: like every other panel kind, they render a single unified edit form (Appearance section plus a kind-specific section — e.g. Divider, or the literal text/markdown content editor) with no tab bar at all. This was already true before this change (there was never a tab bar for any panel kind); this requirement records it as unchanged rather than reintroducing one.

#### Scenario: Output panel sheet has no binding controls
- **WHEN** the user opens the detail sheet for an output-kind panel
- **THEN** the sheet shows title override, appearance, an Output link, and Swap output
- **AND** no field-mapping or aggregation control is rendered anywhere in the sheet
- **AND** no "Data" tab is shown

#### Scenario: Output link opens the Output's pipeline page
- **WHEN** the user activates the Output link in the panel sheet
- **THEN** the user is navigated to `/pipelines/:id` with that Output's sheet opened

#### Scenario: Content panel keeps its unified, tab-free edit form
- **WHEN** the user opens the detail sheet for a text, markdown, image, or divider panel
- **THEN** a single edit form is shown with an Appearance section and that kind's literal-content editor, with no tab bar and no "Data" tab — unchanged from before this change

### Requirement: Swap output re-uses the picker
Activating "Swap output" on an output-kind panel's sheet MUST re-open the Output picker, scoped to replacing the current panel's `outputId` in place (preserving the panel's position/size) rather than creating a new placement.

#### Scenario: Swap output preserves placement position and size
- **WHEN** the user swaps an output-kind panel's Output via the picker
- **THEN** the panel's existing position and size are preserved
- **AND** only `outputId` changes
