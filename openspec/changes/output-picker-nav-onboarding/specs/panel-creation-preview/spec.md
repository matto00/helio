## REMOVED Requirements

### Requirement: Panel creation modal shows a live preview pane on the name-entry step
**Reason**: The name-entry step and its preview pane belonged to the retired `PanelCreationModal` wizard. The Output picker itself renders each Output live (thumbnail/value/sparkline) as its primary list item — there is no separate name-entry-with-preview step.
**Migration**: See `output-picker`.

### Requirement: Panel preview title updates live as the user types
**Reason**: Same as above — there is no title-entry step in the picker; title override happens in the Panel sheet after placement.
**Migration**: See `panel-detail-modal` (Panel sheet).

### Requirement: Preview pane is styled to resemble a dashboard panel card
**Reason**: Same as above.
**Migration**: See `output-picker`'s live Output cards.

### Requirement: Preview is hidden on narrow viewports
**Reason**: Same as above — the picker's own mobile layout (verified at 375px/430px) supersedes this.
**Migration**: See `output-picker`.
