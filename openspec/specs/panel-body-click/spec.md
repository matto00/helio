# panel-body-click Specification

## Purpose
TBD - created by archiving change panel-click-detail-modal. Update Purpose after archive.
## Requirements
### Requirement: Clicking the panel body opens the detail modal
The panel card body SHALL respond to a click that is not on an interactive control (button, input, anchor, or resize handle) by opening the panel detail modal for that panel.

#### Scenario: Click on panel body opens modal
- **WHEN** the user clicks on the panel body (not on the drag handle, actions menu, title input, or resize handle)
- **THEN** the panel detail modal opens for the clicked panel

### Requirement: Drag interactions do not open the detail modal
The panel click handler SHALL suppress the modal open when the pointer has moved more than a threshold distance between `mousedown` and `click` (indicating a drag rather than a genuine click).

#### Scenario: Dragging a panel does not open the modal
- **WHEN** the user drags a panel to a new position and releases
- **THEN** the panel detail modal does NOT open

### Requirement: Resize interactions do not open the detail modal
The panel click handler SHALL suppress the modal open when a resize handle interaction is detected.

#### Scenario: Resizing a panel does not open the modal
- **WHEN** the user resizes a panel using the resize handle
- **THEN** the panel detail modal does NOT open

### Requirement: Interactive controls within the panel do not open the detail modal
Clicks that originate on interactive controls inside the panel card (buttons, inputs, anchors, or the `.react-resizable-handle` element) SHALL NOT open the detail modal.

#### Scenario: Clicking the drag handle does not open the modal
- **WHEN** the user clicks the drag handle button
- **THEN** the panel detail modal does NOT open

#### Scenario: Clicking the actions menu trigger does not open the modal
- **WHEN** the user clicks the actions menu trigger button
- **THEN** the panel detail modal does NOT open and the actions menu opens normally

