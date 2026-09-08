## ADDED Requirements

### Requirement: Declarations carry the description and group needed to present them
Each entry in the global shortcut declaration SHALL carry a human-readable description of what the binding
does and the name of the functional area it belongs to, in addition to its existing id, label, and
combination. These SHALL be sufficient for a consumer to present a grouped, self-explanatory list of the
application's shortcuts without consulting any other source.

#### Scenario: Every declaration is presentable
- **WHEN** the declaration is enumerated
- **THEN** every entry yields a description and a group name alongside its combination

#### Scenario: Groups cluster related bindings
- **WHEN** entries belonging to the same functional area are enumerated
- **THEN** they report the same group name, so a consumer can cluster them

### Requirement: The declared combination shape expresses modifier-free and Shift-bearing bindings
The declared combination SHALL be able to express a binding that requires no platform modifier, in addition
to the platform-modifier bindings already supported.

Matching SHALL treat the two modifiers differently, and deliberately so:

- The **platform modifier** SHALL be matched exactly. An event holding it SHALL NOT match a combination that
  does not declare it, and an event without it SHALL NOT match a combination that does.
- The **Shift modifier** SHALL be three-valued. A combination MAY require Shift to be held, MAY require it
  NOT to be held, or MAY leave it unstated — and when it is unstated, the presence or absence of Shift SHALL
  NOT affect whether the event matches.

Leaving Shift unstated is what allows a binding on a printable character to remain correct across keyboard
layouts, because the character a key produces already encodes whether Shift was needed to produce it.
Stating Shift explicitly is what allows two bindings on the same key to be told apart.

#### Scenario: A modifier-free binding on a printable character matches
- **WHEN** an event for the `?` character with no platform modifier is tested against a combination
  declaring that character with no platform modifier
- **THEN** it matches

#### Scenario: An unstated Shift requirement matches regardless of Shift
- **WHEN** a combination does not state a Shift requirement, and events for that key are tested both with
  and without Shift held
- **THEN** both match, so a binding on a printable character that some layouts produce with Shift and others
  without remains correct on every layout

#### Scenario: A stated absence of Shift is enforced
- **WHEN** a combination states that Shift must NOT be held, and an event for that key WITH Shift is tested
- **THEN** it does not match, so two bindings differing only by Shift cannot shadow one another

#### Scenario: Existing platform-modifier bindings are unaffected
- **WHEN** an event for the platform modifier plus `k` is tested against the command palette's combination
- **THEN** it matches exactly as it did before the combination shape was extended

### Requirement: Global bindings may opt into suppression while a modal surface is open
The declaration module SHALL provide a single shared guard reporting whether ANY modal surface is currently
open, including surfaces that are not native dialogs. Each global binding SHALL declare whether that guard
applies to it, so that a binding which opens a surface can be suppressed while another surface is open
without changing the behavior of bindings that do not opt in. Dismissing the open surface with `Esc` SHALL
remain unaffected.

#### Scenario: The guard detects a portalled modal surface, not only native dialogs
- **WHEN** a modal surface that is not a native dialog — such as the mobile navigation sheet or the
  refinement chat drawer — is open
- **THEN** the shared guard reports that a modal surface is open, exactly as it does for a native dialog

#### Scenario: A binding that opts in does not fire while a modal surface is open
- **WHEN** any modal surface is open and the user presses the help-overlay binding
- **THEN** nothing opens and the existing surface remains as it was

#### Scenario: A binding that does not opt in is unaffected
- **WHEN** the command palette is open and the user presses the command-palette binding
- **THEN** the binding still fires, because the palette is itself rendered as a modal surface and that
  binding does not opt into the guard

#### Scenario: Esc still dismisses the open modal
- **WHEN** a modal is open and the user presses `Esc`
- **THEN** that modal closes as it normally would

#### Scenario: The binding fires again once the modal closes
- **WHEN** the modal has been closed and the user presses the help-overlay binding
- **THEN** the help overlay opens

## MODIFIED Requirements

### Requirement: Global keyboard bindings are declared in exactly one enumerable module
The frontend SHALL declare every application-global keyboard binding in a single module that exports them as
enumerable data, each carrying at minimum a stable id, a human-readable label, and its key combination. Every
global binding's handler SHALL resolve its combination from that declaration rather than testing key
properties inline. No global binding SHALL exist that is absent from the declaration. This SHALL include the
dashboard layout undo and redo bindings, which SHALL be declared and matched through the module rather than
by inline key-property tests, and SHALL apply the module's shared typing guard rather than a private
equivalent.

#### Scenario: Every global binding is listed in one place
- **WHEN** the declaration module is enumerated
- **THEN** it yields an entry for every application-global keyboard binding, including the command palette's,
  the assistant quick-launcher's, the help overlay's, and the layout undo and redo bindings, each with an id,
  a label, and its key combination

#### Scenario: Handlers resolve their combination from the declaration
- **WHEN** a global keyboard handler decides whether an event matches its binding
- **THEN** it does so against the declared combination, so changing a binding requires editing only the
  declaration

#### Scenario: A consumer can render the binding list
- **WHEN** a feature needs to display the app's keyboard shortcuts to the user
- **THEN** it can obtain the full list, with labels and combinations, from the declaration alone

#### Scenario: Layout undo and redo behave exactly as before the migration
- **WHEN** the user presses the layout undo binding, and then the layout redo binding, on a dashboard with
  layout history available
- **THEN** the layout is reverted and then reapplied exactly as it was before those bindings were migrated
  onto the declaration, and neither fires while the user is typing in a text-entry context
