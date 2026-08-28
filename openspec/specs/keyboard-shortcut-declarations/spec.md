# keyboard-shortcut-declarations Specification

## Purpose
Establishes that the application's global keyboard bindings are declared as data in exactly one enumerable
module, so every binding can be listed, documented, and checked for conflicts from a single place instead of
being rediscovered by reading scattered event handlers.

## Requirements

### Requirement: Global keyboard bindings are declared in exactly one enumerable module
The frontend SHALL declare every application-global keyboard binding in a single module that exports them as
enumerable data, each carrying at minimum a stable id, a human-readable label, and its key combination. Every
global binding's handler SHALL resolve its combination from that declaration rather than testing key
properties inline. No global binding SHALL exist that is absent from the declaration.

#### Scenario: Every global binding is listed in one place
- **WHEN** the declaration module is enumerated
- **THEN** it yields an entry for every application-global keyboard binding, including the command palette's
  and the assistant quick-launcher's, each with an id, a label, and its key combination

#### Scenario: Handlers resolve their combination from the declaration
- **WHEN** a global keyboard handler decides whether an event matches its binding
- **THEN** it does so against the declared combination, so changing a binding requires editing only the
  declaration

#### Scenario: A consumer can render the binding list
- **WHEN** a feature needs to display the app's keyboard shortcuts to the user
- **THEN** it can obtain the full list, with labels and combinations, from the declaration alone

### Requirement: A shared guard suppresses global bindings while the user is typing
The declaration module SHALL provide a single shared guard that determines whether an event target is a
text-entry context — a text input, textarea, select, or `contenteditable` element. Every global binding SHALL
apply that shared guard rather than re-implementing its own, so the suppression rule cannot drift between
bindings.

#### Scenario: Typing context is recognized consistently
- **WHEN** the guard is applied to a text input, a textarea, a select, or a contenteditable element
- **THEN** it reports a text-entry context in every one of those cases

#### Scenario: Non-typing targets are not suppressed
- **WHEN** the guard is applied to the document body, a button, or a link
- **THEN** it does not report a text-entry context, so the global binding proceeds

### Requirement: The command palette owns Cmd/Ctrl+K and the quick-launcher moves to Cmd/Ctrl+J
The command palette SHALL be bound to `Cmd/Ctrl+K`. The assistant quick-launcher, which previously held that
combination, SHALL be bound to `Cmd/Ctrl+J` and SHALL remain fully reachable — by that shortcut, by its
existing command-bar trigger, and from the command palette itself. Both bindings SHALL prevent the browser's
default action for their combination.

#### Scenario: Cmd/Ctrl+K opens the palette, not the quick-launcher
- **WHEN** the user presses `Cmd/Ctrl+K` on an authenticated route
- **THEN** the command palette opens and the assistant quick-launcher does not

#### Scenario: Cmd/Ctrl+J opens the quick-launcher
- **WHEN** the user presses `Cmd/Ctrl+J` on an authenticated route
- **THEN** the assistant quick-launcher overlay opens, matching its click-triggered behavior

#### Scenario: The quick-launcher keeps its non-keyboard entry points
- **WHEN** the user activates the command-bar quick-launcher trigger
- **THEN** the quick-launcher overlay opens exactly as before the rebind
