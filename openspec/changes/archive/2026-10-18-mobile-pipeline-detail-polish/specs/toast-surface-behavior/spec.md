## MODIFIED Requirements

### Requirement: Live-region politeness follows toast intent
Toast announcement SHALL use live regions that are mounted before any toast exists, so that announcement never depends
on a live region being created together with its content. The toast viewport SHALL mount a polite region
(`role="status"`, `aria-live="polite"`) and an assertive region (`role="alert"`, `aria-live="assertive"`) from first
render. An `error` toast's message SHALL be rendered into the assertive region and every other intent's into the polite
region. The visible toast element SHALL NOT itself carry a live-region role, so that no message is announced twice.
Every toast SHALL expose a dismiss control with an accessible name, and SHALL be reachable and operable by keyboard.
When the viewport moves into or out of an open modal dialog, the live regions at the new location SHALL be connected
and exposed, empty, before any message is inserted into them; a toast whose message was committed just before the
modal opened (and so could not be announced) SHALL then be inserted into the new region, and a toast already
announced SHALL NOT be inserted again.

#### Scenario: Both live regions exist before any toast
- **WHEN** the toast viewport is rendered with no toasts present
- **THEN** a polite live region and an assertive live region are both present

#### Scenario: An error message is routed to the assertive region
- **WHEN** a toast with the `error` intent is pushed
- **THEN** its message appears in the assertive region and not in the polite region

#### Scenario: Other intents are routed to the polite region
- **WHEN** a toast with the `success`, `info`, or `warning` intent is pushed
- **THEN** its message appears in the polite region and not in the assertive region

#### Scenario: The visible toast is not a second live region
- **WHEN** any toast is rendered
- **THEN** the visible toast element carries no `aria-live` or live-region role of its own

#### Scenario: The visible message is not encountered twice
- **WHEN** a toast is rendered and its message also exists in a live region
- **THEN** the visible copy of the message is hidden from assistive technology
- **AND** the toast's action and dismiss controls remain reachable

#### Scenario: A coalesced repeat does not silently drop its announcement
- **WHEN** an identical `variant` and `message` is pushed while the earlier one is still present
- **THEN** the surviving toast's message is still present in its intent's live region

#### Scenario: A toast racing a modal open is announced after its region exists
- **WHEN** a step delete fails in the phone step sheet, so the sheet reopens and an error toast is pushed in the same update
- **THEN** the assertive region inside the open sheet is connected, empty, and has no inert or aria-hidden ancestor
  for at least one completed rendered frame before the error message is inserted into it, and the message is
  inserted exactly once

## ADDED Requirements

### Requirement: Toasts stay visible above an open modal dialog
While a modal dialog (including the phone step sheet) is open, a toast SHALL render above it, be dismissable by its
close control, and still be announced through the toast live regions. Moving into or out of a modal SHALL NOT restart a visible toast's auto-dismiss time or replay its entrance. When
several modal dialogs are open the toasts
render in the most recently opened one. Toast controls inside a modal join its keyboard focus cycle; if a focused toast
is removed, focus moves to the dialog's first focusable element. When no modal is open, toasts render as before.

#### Scenario: Failed delete inside the sheet
- **WHEN** removing a step from the phone step sheet fails and the sheet reopens
- **THEN** the error toast is visible above the sheet, its dismiss control is clickable, and its message is in the
  assertive live region exposed to assistive technology
