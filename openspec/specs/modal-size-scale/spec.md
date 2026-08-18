# modal-size-scale Specification

## Purpose
Defines the shared `Modal` primitive's size scale (`sm`/`md`/`lg`/`xl`/`full`) and its close-request
semantics, so wizard- and detail-scale surfaces (e.g. panel creation, panel detail) can adopt the
shared dialog lifecycle — including a vetoable close for unsaved-changes guards — instead of
hand-rolling their own.
## Requirements
### Requirement: Modal SHALL support an extended size scale
The shared `Modal` primitive's `size` prop SHALL accept `sm`, `md`, `lg`, `xl`, and `full`. `xl`
and `full` SHALL be wide enough to host wizard/detail-scale content while still clamping to the
viewport, matching the existing `sm`/`md`/`lg` `min(<px>, calc(100vw - 32px))` pattern.

#### Scenario: xl size renders a wider dialog than lg
- **WHEN** `Modal` is rendered with `size="xl"`
- **THEN** the rendered `<dialog>` carries a size class wider than the `lg` preset
- **AND** its width still clamps to the viewport on narrow screens

#### Scenario: full size renders the widest preset
- **WHEN** `Modal` is rendered with `size="full"`
- **THEN** the rendered `<dialog>` carries the widest size class of the scale
- **AND** its width still clamps to the viewport on narrow screens

#### Scenario: size prop can change across re-renders without remounting
- **WHEN** a mounted `Modal` instance's `size` prop changes (e.g. `"md"` to `"full"`)
- **THEN** the rendered `<dialog>` element's size class updates to match
- **AND** the dialog's open/closed state and content are unaffected by the size change

### Requirement: Modal's onClose SHALL be a single vetoable close-request signal
`Modal` SHALL invoke `onClose` for every user-initiated dismiss attempt — clicking the header
close button, clicking the backdrop, and pressing Escape — without itself closing the native
`<dialog>` element as part of handling any of those three vectors. Actual closing SHALL be
driven only by the `open` prop or by the consumer unmounting `Modal`, so a consumer's `onClose`
handler MAY decline to close (e.g. to show a discard-confirmation) by not flipping `open` to
false and not unmounting.

#### Scenario: Escape does not close the dialog before onClose runs
- **WHEN** `Modal` is open
- **AND** the user presses Escape
- **THEN** `onClose` is called
- **AND** the dialog remains open if the consumer does not set `open` to false or unmount `Modal`
  in response

#### Scenario: Backdrop click routes through onClose without pre-closing
- **WHEN** `Modal` is open
- **AND** the user clicks the backdrop (the `<dialog>` element itself, not inner content)
- **THEN** `onClose` is called exactly once
- **AND** the dialog remains open if the consumer does not set `open` to false or unmount `Modal`
  in response

#### Scenario: Close button routes through onClose without pre-closing
- **WHEN** `Modal` is open
- **AND** the user clicks the header close button
- **THEN** `onClose` is called exactly once
- **AND** the dialog remains open if the consumer does not set `open` to false or unmount `Modal`
  in response

### Requirement: Modal SHALL support an optional header actions slot
`Modal` SHALL accept an optional `headerActions` prop (`ReactNode`). When provided, it SHALL
render in the header, positioned before the close button. When omitted, the header renders
exactly as it does today (title/description block, then close button, with nothing between).

#### Scenario: headerActions renders before the close button
- **WHEN** `Modal` is rendered with a `headerActions` node
- **THEN** that node appears in the header, before the close button

#### Scenario: Omitting headerActions changes nothing
- **WHEN** `Modal` is rendered without a `headerActions` prop
- **THEN** the header renders identically to the current (pre-change) header markup

