# modal-body-scroll-extent Specification

## Purpose
Bounds every shared modal's scroll extent to its visible content, so visually hidden absolutely positioned content in
a modal body never produces blank scroll in the dialog or the body.

## Requirements

### Requirement: Hidden content does not extend a modal's scroll area

Every dialog built on the shared modal SHALL have a scroll extent (for the dialog and for its scrolling body) no larger
than the bottom of its laid-out visible content, within a small rounding tolerance, regardless of where visually hidden
absolutely positioned elements (screen-reader text, visually hidden inputs) sit in the body.

#### Scenario: Phone modal with hidden text low in the body

- **WHEN** a modal whose body contains visually hidden absolutely positioned elements is opened at a phone viewport
  (375 px and 390x844), in light or dark theme
- **THEN** the dialog's scrollHeight does not exceed its content bottom, and the body's scrollHeight does not exceed
  its in-flow content plus padding

#### Scenario: Desktop modal

- **WHEN** the same modal is opened at a desktop viewport in light or dark theme
- **THEN** the same bounds hold

#### Scenario: Hidden element added outside any positioned wrapper

- **WHEN** a visually hidden absolutely positioned element is placed as the last child of a modal body whose in-flow
  content overflows the body (so the element's static position is below the visible part of the body), with no
  positioned ancestor between it and the body, and the body is scrolled to the top
- **THEN** the dialog's scroll extent still does not exceed its content

### Requirement: Positioned content inside modal bodies keeps its placement

Absolutely positioned visible content inside a modal body (badges, hit expanders, overlays, in-place menus) and
popovers rendered from inside a modal SHALL keep the on-screen placement they had before the fix.

#### Scenario: Popover opened from a modal

- **WHEN** a select, menu or popover is opened from a control inside a modal body, at phone and desktop widths
- **THEN** it appears anchored to its trigger exactly as before the fix
