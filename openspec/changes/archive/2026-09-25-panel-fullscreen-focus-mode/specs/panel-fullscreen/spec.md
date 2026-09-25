## Purpose

Lets a user expand a single dashboard panel's rendered content to fill a maximized, view-only overlay for
a closer look or presentation, without leaving the dashboard or entering `PanelDetailModal`'s edit surface.

## ADDED Requirements

### Requirement: Fullscreen control on eligible panel kinds
`PanelCard`'s header SHALL render a keyboard-accessible "Fullscreen" icon button for a panel whose
resolved content kind is `output` (any Output `kind`: chart, table, metric, markdown, collection,
timeline), `text`, `markdown`, or `image`. The control SHALL NOT render for a `divider` panel (no
maximizable content) or a `form` panel (a write surface, not appropriate for a view-only overlay).

#### Scenario: Fullscreen button visible on a chart panel
- **WHEN** a dashboard panel is bound to an `output` Output of kind `chart`
- **THEN** its `PanelCard` header shows a Fullscreen icon button alongside the existing actions

#### Scenario: Fullscreen button absent on a divider panel
- **WHEN** a dashboard panel is of kind `divider`
- **THEN** its `PanelCard` header does not render a Fullscreen icon button

#### Scenario: Fullscreen button absent on a form panel
- **WHEN** a dashboard panel is of kind `form`
- **THEN** its `PanelCard` header does not render a Fullscreen icon button

### Requirement: Opening fullscreen renders the same data via the shared overlay
Activating the Fullscreen control SHALL open a maximized, opaque overlay (the shared `Modal` primitive)
showing the panel's title and rendered content via the existing content renderer used by the grid card,
fed by the same data already fetched for that panel — no independent second fetch is triggered.

#### Scenario: Overlay shows matching content
- **GIVEN** a panel's grid card is rendering its fetched data
- **WHEN** the user activates that panel's Fullscreen control
- **THEN** the overlay renders the panel's title and the same data, via the same content renderer, with
  no additional network request for that data

### Requirement: Chart panels re-fit to the overlay's size
When a panel of kind `output`/`chart` is opened in the fullscreen overlay, its chart SHALL resize to the
overlay's available area.

#### Scenario: Chart resizes on open
- **WHEN** a chart panel is opened in the fullscreen overlay
- **THEN** the chart canvas fills the overlay's content area at its larger size

### Requirement: Fullscreen overlay is view-only
The fullscreen overlay SHALL present no editing controls (no rename, appearance, or data-editing
affordances). It offers only the panel's rendered content, a title/header, and a close control.

#### Scenario: No editing controls in the overlay
- **WHEN** the fullscreen overlay is open
- **THEN** no rename, appearance-editing, or data-editing control is present in the overlay

### Requirement: Closing restores focus
The overlay SHALL close via `Esc`, a close button, or a backdrop click, and closing SHALL return keyboard
focus to the control that opened it.

#### Scenario: Esc closes and restores focus
- **GIVEN** the fullscreen overlay is open, having been opened by activating a panel's Fullscreen button
- **WHEN** the user presses `Esc`
- **THEN** the overlay closes
- **AND** keyboard focus returns to that panel's Fullscreen button
