## MODIFIED Requirements

### Requirement: Panel detail modal opens from the actions menu
The "Customize" action in the panel actions menu MUST open the panel detail modal for that panel. Panel body click is also a trigger — see the ADDED requirement below.

#### Scenario: Customize action opens the modal
- **WHEN** the user clicks "Customize" in a panel's actions menu
- **THEN** the panel detail modal opens with the panel's title in the header

## ADDED Requirements

### Requirement: Panel detail modal opens from the panel body click
The panel detail modal MUST also open when the user clicks the panel card body (not on an interactive control), as defined in the `panel-body-click` capability. Both triggers open the same modal.

#### Scenario: Panel body click opens the modal
- **WHEN** the user clicks the panel body (not on a drag handle, actions menu, title input, or resize handle)
- **THEN** the panel detail modal opens for that panel
