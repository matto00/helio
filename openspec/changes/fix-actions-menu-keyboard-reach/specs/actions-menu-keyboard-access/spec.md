## Purpose

Defines the keyboard and programmatic-focus contract for the shared
`ActionsMenu` chrome, independent of which surface hosts it, so a
surface-level presentation choice (such as revealing the trigger on hover)
cannot render its actions unreachable without a pointer.

## ADDED Requirements

### Requirement: The trigger is programmatically focusable at rest

A host surface MAY visually de-emphasize the `ActionsMenu` trigger until hover
or focus, but the trigger MUST remain a valid focus target at rest. Calling
`.focus()` on it MUST move real focus to the trigger, so a dialog opened from
the menu can restore focus to its invoker on dismiss.

#### Scenario: Focus restore from a dialog opened via the menu

- **WHEN** a dialog is opened from an `ActionsMenu` item and subsequently
  dismissed, at a viewport width where that `ActionsMenu` is rendered
- **THEN** `document.activeElement` is the `ActionsMenu` trigger that invoked
  it, and is not `<body>`

#### Scenario: Programmatic focus on a resting, visually-hidden trigger

- **WHEN** `.focus()` is called on a **rendered** `ActionsMenu` trigger whose
  host surface has not revealed it (no hover, no focus within the row)
- **THEN** the trigger receives focus rather than the call silently no-opping

### Requirement: Menu actions are reachable and operable by keyboard alone

Every action in an `ActionsMenu` MUST be reachable, and activatable, using only
the keyboard, on every surface that renders the menu. This requirement binds
only where the menu is actually rendered: a surface that does not render an
`ActionsMenu` at a given viewport width is out of its scope, and the absence of
an actions affordance at that width is a separate product concern rather than a
violation of this requirement.

#### Scenario: Reaching and opening the menu by keyboard

- **WHEN** a keyboard user tabs through a surface hosting an `ActionsMenu`
- **THEN** the trigger is reached within the surface's tab cycle, and pressing
  Enter opens the menu and moves focus to its first enabled item

#### Scenario: Dismissing the menu restores focus to the trigger

- **WHEN** the open menu is dismissed with Escape
- **THEN** focus returns to the trigger that opened it

### Requirement: Keyboard reachability is verified in a layout-aware runner

Because jsdom has no layout engine and will report focus on a `display: none`
or 0x0 element, an assertion that an `ActionsMenu` action is keyboard-reachable
MUST be made in a real browser. A jsdom assertion MUST NOT be treated as
evidence for this requirement.

#### Scenario: A jsdom focus assertion is offered as evidence

- **WHEN** the only evidence for keyboard reachability is a jsdom-based focus
  assertion
- **THEN** the requirement is not satisfied, and any such retained jsdom
  assertion carries an explicit note of what it cannot prove
