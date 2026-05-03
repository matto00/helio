# HEL-172 — Creation modal accessibility (Escape / click-outside)

## Title
Creation modal accessibility (Escape / click-outside)

## Description
Escape key and click-outside both dismiss the creation modal without creating a panel. If the user has entered any data, show a discard confirmation. Focus trap within the modal while open.

## Acceptance Criteria
- Pressing Escape dismisses the creation modal without creating a panel
- Clicking outside the modal dismisses the creation modal without creating a panel
- If the user has entered any data (e.g. typed in a field, selected a panel type), show a discard confirmation dialog before closing
- Focus is trapped within the modal while it is open (tabbing does not leave the modal)

## Priority
Medium

## Project
Helio v1.2 — Panel System

## Parent
HEL-138
