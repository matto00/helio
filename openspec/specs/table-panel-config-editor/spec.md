# table-panel-config-editor Specification

## Purpose
Defines the Table panel edit-pane display controls (cell-density dropdown, column visibility and
order controls, reset-column-widths action) in the Epic A config language, their dirty/save/cancel
persistence semantics, and their mobile ≥44px touch-target requirements.
## Requirements
### Requirement: Table panel edit pane exposes display controls
The panel detail modal's edit pane for a Table panel SHALL present, in the Epic A config language
(shared `Select`, existing `panel-detail-modal__*` section patterns): a **Cell density** dropdown
(Condensed / Normal / Spacious, initialized from `config.density` defaulting to Normal), a
**Columns** control listing every field of the bound DataType with a visibility toggle and
up/down reorder buttons (initialized from `config.columnOrder`; absent → all visible in natural
order), and a **Reset column widths** action (disabled when no widths are stored). When the panel
has no bound DataType, the Columns control SHALL NOT be shown. These controls SHALL replace the
vestigial table `columns` fieldMapping slot, which SHALL be removed from `PANEL_SLOTS`.

#### Scenario: Controls reflect stored config on open
- **WHEN** the edit pane opens for a Table panel with `density: "spacious"` and
  `columnOrder: ["b"]` on a DataType with fields `a`, `b`
- **THEN** the density dropdown shows Spacious, and the Columns control lists `a` and `b` with
  only `b` toggled visible

#### Scenario: Unbound table hides the Columns control
- **WHEN** the edit pane opens for a Table panel with no bound DataType
- **THEN** no Columns control is rendered and the vestigial "Columns" fieldMapping select does
  not appear

### Requirement: Display-control edits persist through the edit pane save flow
Changes to density, column visibility/order, or a pending width reset SHALL participate in the
edit pane's existing dirty/save/cancel contract: they mark the pane dirty, persist via a single
config PATCH on Save, revert on Cancel, and the Redux-stored panel SHALL reflect the saved values
so re-opening the modal and already-rendered panels show the new state without a reload. The
Reset column widths action SHALL clear stored `columnWidths` (PATCH `columnWidths: null`) and the
rendered grid SHALL return to default-derived widths without a page reload. A save that touches
only display controls SHALL NOT alter `dataTypeId` or `fieldMapping`.

#### Scenario: Density change saves and applies
- **WHEN** the user changes density from Normal to Condensed and clicks Save
- **THEN** one PATCH persists `density: "condensed"` and the panel's grid re-renders condensed
  without a reload

#### Scenario: Hiding and reordering columns saves columnOrder
- **WHEN** the user hides column `b` and moves column `c` above `a`, then saves
- **THEN** the persisted `columnOrder` is `["c", "a"]` and the panel renders columns `c`, `a`

#### Scenario: Cancel reverts unsaved display edits
- **WHEN** the user changes density and column visibility, then clicks Cancel
- **THEN** no PATCH is sent and re-opening the pane shows the previously stored values

#### Scenario: Reset widths clears stored widths without reload
- **WHEN** a Table panel has stored `columnWidths` and the user clicks Reset column widths, then
  Save
- **THEN** the PATCH clears `columnWidths` and the rendered grid returns to default-derived
  widths without a page reload

### Requirement: New display controls meet mobile touch-target size
Every new display control SHALL have a hit area at least 44px tall at viewports of 768px and
below — the density dropdown, column visibility toggles, up/down reorder buttons, and
reset-widths button — enforced by
extending the existing `@media (max-width: 768px)` block in `PanelDetailModal.css` and locked by
extending the existing `PanelDetailModal.css.test.ts` CSS-lock test.

#### Scenario: Controls are 44px at mobile width
- **WHEN** the edit pane renders at a ~390px-wide viewport
- **THEN** each new display control's interactive element measures at least 44px tall

#### Scenario: CSS-lock test guards the mobile block
- **WHEN** the CSS-lock test suite runs
- **THEN** it asserts the mobile media block covers the new display controls' selectors

