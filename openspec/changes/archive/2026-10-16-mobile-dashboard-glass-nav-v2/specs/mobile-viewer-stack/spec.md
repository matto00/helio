## ADDED Requirements

### Requirement: Phone stack gutters keep content close to the screen edge
On the phone shell (viewport at or below 768px) the dashboard view SHALL inset stacked panels 12px from the left and
right screen edges (the `--space-3` token), separate consecutive stacked panels by about 10px, and pad each stacked
panel card by about 14px. Markdown and plain-text panel bodies SHALL NOT add a further horizontal inset of their own inside the card (other
panel kinds keep their own internal layout). At a 375px viewport, the first glyph of a markdown panel's body text SHALL start no more than 28px from the
screen's left edge, measured from the rendered page, and the markdown body's box SHALL end no more than 28px from
the screen's right edge. Stacked panels SHALL remain fully scrollable above the glass nav (bottom clearance). A dashboard's saved zoom
level SHALL NOT scale the phone shell's stack (the zoom controls are hidden there, so a saved level could not be
seen or reset); the saved level itself SHALL be left unchanged and still apply above 768px.

#### Scenario: Markdown text starts within 28px of the edge at 375px
- **WHEN** a dashboard with a markdown panel renders at a 375px viewport
- **THEN** the left edge of the markdown body's first text line is at most 28px from the screen's left edge
- **AND** the panel card's outer edge is 12px from each screen edge

#### Scenario: Stacked panels are separated by a narrow gap
- **WHEN** two or more panels render in the phone stack
- **THEN** the vertical gap between consecutive panel cards is between 8px and 12px

#### Scenario: The last panel clears the glass nav
- **WHEN** the user scrolls to the end of a phone dashboard
- **THEN** the last panel's bottom edge sits above the glass nav's top edge

#### Scenario: A saved zoom level does not shrink the phone stack
- **WHEN** a dashboard whose saved zoom level is 50% renders at 375px
- **THEN** the stack renders at 100% with the gutters above, and the saved 50% still applies when the viewport is
  wider than 768px

#### Scenario: Other dashboard-view content shares the 12px edge
- **WHEN** a status message, onboarding checklist, empty state or chip row renders on the phone dashboard view
- **THEN** its content starts 12px from the screen edge (the chip row may scroll edge to edge, first chip at 12px)

#### Scenario: A 768px phone viewport keeps the stack
- **WHEN** the viewport is exactly 768px wide with overlay (zero-width) scrollbars
- **THEN** the single-column stack renders, not the desktop grid

#### Scenario: Desktop grid unchanged
- **WHEN** the viewport is wider than 768px
- **THEN** the grid's gutters and panel padding are unchanged by this requirement
